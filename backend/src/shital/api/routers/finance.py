"""Finance router."""
from __future__ import annotations

import csv
import io
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from shital.api.deps import CurrentSpace
from shital.capabilities.finance.capabilities import (
    DonationInput,
    PostJournalInput,
    get_donation_summary,
    get_income_statement,
    get_trial_balance,
    post_journal_entry,
    record_donation,
)

router = APIRouter(prefix="/finance", tags=["finance"])


def _safe(v: Any) -> Any:
    """Convert DB types that are not natively JSON-serializable."""
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, UUID):
        return str(v)
    if hasattr(v, 'isoformat'):
        return v.isoformat()
    return v


def _row(row: Any) -> dict:
    return {k: _safe(v) for k, v in dict(row).items()}


@router.get("/trial-balance")
async def trial_balance(ctx: CurrentSpace, as_at: str = ""):
    return await get_trial_balance(ctx, as_at)


@router.post("/journal")
async def post_journal(body: PostJournalInput, ctx: CurrentSpace):
    return await post_journal_entry(ctx, body)


@router.post("/donations")
async def create_donation(body: DonationInput, ctx: CurrentSpace):
    return await record_donation(ctx, body)


@router.get("/reports/income-statement")
async def income_statement(ctx: CurrentSpace, from_date: str, to_date: str):
    return await get_income_statement(ctx, from_date, to_date)


@router.get("/reports/donations")
async def donation_summary(ctx: CurrentSpace, from_date: str, to_date: str):
    return await get_donation_summary(ctx, from_date, to_date)


@router.get("/donations")
async def list_donations(
    ctx: CurrentSpace,
    from_date: str = "2020-01-01",
    to_date: str = "2099-12-31",
    limit: int = 500,
    source: str = "",
    branch_id: str = "",
    purpose: str = "",
    status: str = "",
) -> dict[str, Any]:
    from datetime import date as _date
    from datetime import datetime as _dt

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    try:
        fd = _date.fromisoformat(from_date)
        td = _date.fromisoformat(to_date)
    except ValueError:
        fd = _date(2020, 1, 1)
        td = _date(2099, 12, 31)

    from_dt = _dt.combine(fd, _dt.min.time())
    to_dt   = _dt.combine(td, _dt.max.time()).replace(microsecond=0)

    # Build optional WHERE fragments
    src_filter    = "AND COALESCE(d.source, CASE d.payment_provider WHEN 'KIOSK' THEN 'quick-donation' WHEN 'paypal' THEN 'service-portal' ELSE 'manual' END) = :source" if source else ""
    branch_filter = "AND d.branch_id = :branch_id" if branch_id else ""
    purpose_filter= "AND d.purpose ILIKE :purpose" if purpose else ""
    status_filter = "AND d.status = :status" if status else ""

    params: dict[str, Any] = {"from_dt": from_dt, "to_dt": to_dt, "lim": limit}
    if source:
        params["source"] = source
    if branch_id:
        params["branch_id"] = branch_id
    if purpose:
        params["purpose"] = f"%{purpose}%"
    if status:
        params["status"] = status

    # Idempotently add source column — must commit DDL before running the query
    async with SessionLocal() as db:
        await db.execute(text(
            "ALTER TABLE donations ADD COLUMN IF NOT EXISTS source VARCHAR(64) DEFAULT 'manual'"
        ))
        await db.commit()

    rgs_branch = "AND rgs.branch_id = :branch_id" if branch_id else ""
    rgs_status  = "AND rgs.status = :status"        if status    else ""

    # When filtering by a one-time-only source, exclude recurring leg with 1=0
    rgs_exclude = "AND 1=0" if (source and source != "monthly-giving") else ""

    async with SessionLocal() as db:
        result = await db.execute(text(f"""
            SELECT
                d.id::text,
                d.branch_id,
                d.amount,
                d.currency,
                COALESCE(d.source,
                    CASE d.payment_provider
                        WHEN 'KIOSK'  THEN 'quick-donation'
                        WHEN 'paypal' THEN 'service-portal'
                        ELSE 'manual'
                    END
                )                AS source,
                d.purpose,
                d.payment_provider,
                d.payment_ref,
                d.gift_aid_eligible,
                d.gift_aid_amount::numeric,
                d.status,
                d.reference,
                d.contact_id::text,
                c.full_name      AS contact_name,
                c.email          AS contact_email,
                'one-time'       AS donation_type,
                d.created_at,
                d.updated_at
            FROM donations d
            LEFT JOIN contacts c ON c.id = d.contact_id
            WHERE d.deleted_at IS NULL
              AND d.created_at >= :from_dt
              AND d.created_at < :to_dt
              {src_filter}
              {branch_filter}
              {purpose_filter}
              {status_filter}

            UNION ALL

            SELECT
                rgs.id::text,
                rgs.branch_id,
                rgs.amount,
                'GBP'::varchar                            AS currency,
                'monthly-giving'::varchar                 AS source,
                COALESCE(t.label, 'Monthly Giving')       AS purpose,
                'paypal'::varchar                         AS payment_provider,
                rgs.paypal_subscription_id                AS payment_ref,
                COALESCE(rgs.gift_aid_declared, false)    AS gift_aid_eligible,
                CASE WHEN rgs.gift_aid_declared
                     THEN ROUND(rgs.amount * 0.25, 2)
                     ELSE 0 END::numeric                  AS gift_aid_amount,
                rgs.status,
                rgs.paypal_subscription_id                AS reference,
                rgs.contact_id::text,
                COALESCE(c2.full_name, rgs.donor_name)   AS contact_name,
                COALESCE(c2.email,     rgs.donor_email)  AS contact_email,
                'recurring'::varchar                      AS donation_type,
                rgs.created_at,
                rgs.updated_at
            FROM recurring_giving_subscriptions rgs
            LEFT JOIN recurring_giving_tiers t  ON t.id  = rgs.tier_id
            LEFT JOIN contacts              c2  ON c2.id = rgs.contact_id
            WHERE rgs.created_at >= :from_dt
              AND rgs.created_at < :to_dt
              {rgs_exclude}
              {rgs_branch}
              {rgs_status}

            ORDER BY created_at DESC
            LIMIT :lim
        """), params)
        rows = result.mappings().all()
    return {"donations": [_row(r) for r in rows]}


@router.get("/donations/export.csv")
async def export_donations_csv(
    ctx: CurrentSpace,
    from_date: str = "2020-01-01",
    to_date: str = "2099-12-31",
) -> StreamingResponse:
    from datetime import date as _date
    from datetime import datetime as _dt

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    try:
        fd = _date.fromisoformat(from_date)
        td = _date.fromisoformat(to_date)
    except ValueError:
        fd, td = _date(2020, 1, 1), _date(2099, 12, 31)

    async with SessionLocal() as db:
        result = await db.execute(text("""
            SELECT id::text, branch_id, amount, currency, purpose, payment_provider,
                   payment_ref, gift_aid_eligible, gift_aid_amount, status,
                   reference, created_at
            FROM donations
            WHERE deleted_at IS NULL
              AND created_at >= :from_dt
              AND created_at < :to_dt
            ORDER BY created_at DESC
        """), {
            "from_dt": _dt.combine(fd, _dt.min.time()),
            "to_dt": _dt.combine(td, _dt.max.time()).replace(microsecond=0),
        })
        rows = result.mappings().all()

    buf = io.StringIO()
    buf.write('\ufeff')  # UTF-8 BOM — Excel reads Unicode correctly
    writer = csv.writer(buf)
    writer.writerow([
        "date", "amount", "currency", "purpose", "payment_method",
        "payment_ref", "status", "reference", "branch_id",
        "gift_aid_eligible", "gift_aid_amount",
    ])
    for r in rows:
        dt = r["created_at"]
        writer.writerow([
            dt.strftime("%Y-%m-%d") if dt else "",
            str(r["amount"] or 0),
            r["currency"] or "GBP",
            r["purpose"] or "",
            r["payment_provider"] or "",
            r["payment_ref"] or "",
            r["status"] or "COMPLETED",
            r["reference"] or "",
            r["branch_id"] or "main",
            "true" if r["gift_aid_eligible"] else "false",
            str(r["gift_aid_amount"] or 0),
        ])

    fname = f"donations-{from_date}-to-{to_date}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/donations/import")
async def import_donations_csv(
    ctx: CurrentSpace,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    import uuid
    from datetime import date as _date
    from datetime import datetime as _dt

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="ADMIN required")

    raw = await file.read()
    try:
        text_content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text_content = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text_content))
    imported = 0
    errors: list[dict[str, Any]] = []

    async with SessionLocal() as db:
        for row_num, row in enumerate(reader, start=2):
            try:
                amount_str = (row.get("amount") or "").strip()
                if not amount_str:
                    errors.append({"row": row_num, "error": "Missing amount"})
                    continue
                amount = float(amount_str)
                if amount <= 0:
                    errors.append({"row": row_num, "error": "Amount must be > 0"})
                    continue

                date_str = (row.get("date") or "").strip()
                try:
                    don_date = _dt.fromisoformat(date_str) if date_str else _dt.utcnow()
                except ValueError:
                    try:
                        don_date = _dt.combine(_date.fromisoformat(date_str), _dt.min.time())
                    except Exception:
                        don_date = _dt.utcnow()

                purpose = (row.get("purpose") or "General").strip()
                pp = (row.get("payment_method") or "cash").strip().lower()
                payment_ref = (row.get("payment_ref") or "").strip()
                status = (row.get("status") or "COMPLETED").strip().upper()
                reference = (row.get("reference") or "").strip()
                branch_id = (row.get("branch_id") or ctx.branch_id or "main").strip()
                ga = (row.get("gift_aid_eligible") or "false").strip().lower() in ("true", "1", "yes")

                await db.execute(text("""
                    INSERT INTO donations (
                        id, branch_id, amount, currency, purpose,
                        payment_provider, payment_ref, status, reference,
                        gift_aid_eligible, gift_aid_amount,
                        source, idempotency_key, created_at, updated_at
                    ) VALUES (
                        gen_random_uuid(), :bid, :amt, 'GBP', :purpose,
                        :pp, :pref, :status, :ref,
                        :ga, :ga_amt,
                        'manual', :ikey, :ddate, NOW()
                    )
                """), {
                    "bid": branch_id, "amt": amount, "purpose": purpose,
                    "pp": pp, "pref": payment_ref, "status": status, "ref": reference,
                    "ga": ga, "ga_amt": round(amount * 0.25, 2) if ga else 0,
                    "ikey": str(uuid.uuid4()), "ddate": don_date,
                })
                imported += 1
            except Exception as exc:
                errors.append({"row": row_num, "error": str(exc)[:120]})

        if imported > 0:
            await db.commit()

    return {"imported": imported, "skipped": len(errors), "errors": errors[:20]}


class DonationUpdate(BaseModel):
    amount: float | None = None
    purpose: str | None = None
    payment_provider: str | None = None
    payment_ref: str | None = None
    status: str | None = None
    reference: str | None = None
    donation_date: str | None = None  # ISO date to override created_at


@router.put("/donations/{donation_id}")
async def update_donation(
    donation_id: str, body: DonationUpdate, ctx: CurrentSpace
) -> dict[str, Any]:
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="ADMIN required")
    sets = []
    params: dict[str, Any] = {"did": donation_id, "now": datetime.utcnow()}
    if body.amount is not None:
        sets.append("amount = :amount")
        params["amount"] = body.amount
    if body.purpose is not None:
        sets.append("purpose = :purpose")
        params["purpose"] = body.purpose
    if body.payment_provider is not None:
        sets.append("payment_provider = :pp")
        params["pp"] = body.payment_provider
    if body.payment_ref is not None:
        sets.append("payment_ref = :pref")
        params["pref"] = body.payment_ref
    if body.status is not None:
        sets.append("status = :status")
        params["status"] = body.status
    if body.reference is not None:
        sets.append("reference = :ref")
        params["ref"] = body.reference
    if body.donation_date:
        sets.append("created_at = :ddate")
        params["ddate"] = body.donation_date
    if not sets:
        return {"ok": True}
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        result = await db.execute(text(
            f"UPDATE donations SET {', '.join(sets)} WHERE id = :did AND deleted_at IS NULL"
        ), params)
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Donation not found")
    return {"ok": True}


@router.delete("/donations/{donation_id}", status_code=204)
async def delete_donation(donation_id: str, ctx: CurrentSpace) -> None:
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="ADMIN required")
    async with SessionLocal() as db:
        result = await db.execute(text(
            "UPDATE donations SET deleted_at = :now WHERE id = :did AND deleted_at IS NULL"
        ), {"did": donation_id, "now": datetime.utcnow()})
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Donation not found")


@router.get("/accounts")
async def list_accounts(ctx: CurrentSpace):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT id, code, name, type, balance, currency, is_active
                FROM accounts
                WHERE branch_id = :bid AND deleted_at IS NULL
                ORDER BY code
            """),
            {"bid": ctx.branch_id},
        )
        return {"accounts": [_row(r) for r in result.mappings()]}


# ─── Incoming Funds Dashboard ────────────────────────────────────────────────
# Time-bucketed totals of donation income, with optional Gift Aid splits and
# per-branch breakdowns. Drives the Incoming Funds dashboard in the admin UI.
#
# All buckets are computed via PostgreSQL `date_trunc()` so a single SQL pass
# gives us the series for whatever granularity (day / week / month / quarter
# / year) the caller asks for. Gift Aid amounts come from
# `donations.gift_aid_amount` (set by the kiosk / service-portal capture
# handlers when the donor declared eligibility — 25% of the eligible total).

@router.get("/dashboards/incoming-funds")
async def incoming_funds(
    ctx: CurrentSpace,
    period: str = "day",        # day | week | month | quarter | year
    start_date: str = "",
    end_date:   str = "",
    branch_id:  str = "",       # "" = all branches; specific id = filter
    group_by_branch: bool = False,
) -> dict[str, Any]:
    """Time-series + breakdowns for incoming donations.

    Response shape:
    {
      "period": "day",
      "start_date": "...", "end_date": "...",
      "series": [
        {"bucket": "2026-05-01", "amount": 123.45, "gift_aid": 12.34,
         "with_gift_aid": 135.79, "count": 4},
        ...
      ],
      "by_branch": [                # populated only when group_by_branch=true
        {"branch_id": "main", "branch_name": "Wembley (Main)",
         "amount": 500.00, "gift_aid": 50.00, "with_gift_aid": 550.00,
         "count": 12},
        ...
      ],
      "totals": {"amount": ..., "gift_aid": ..., "with_gift_aid": ...,
                 "count": ...}
    }
    """
    from datetime import date as _date
    from datetime import timedelta as _td

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    if period not in {"day", "week", "month", "quarter", "year"}:
        raise HTTPException(400, detail="period must be day/week/month/quarter/year")

    # Default window: last 30 days if not supplied. Cap end at today.
    end_d   = _date.fromisoformat(end_date)   if end_date   else _date.today()
    start_d = _date.fromisoformat(start_date) if start_date else (end_d - _td(days=30))
    if start_d > end_d:
        raise HTTPException(400, detail="start_date must be on or before end_date")

    where = ["d.deleted_at IS NULL",
             "d.created_at >= :start_ts",
             "d.created_at < :end_ts"]
    params: dict[str, Any] = {
        "start_ts": datetime.combine(start_d, datetime.min.time()),
        # End is exclusive; add one day so end_date itself is included.
        "end_ts":   datetime.combine(end_d + _td(days=1), datetime.min.time()),
    }
    if branch_id:
        where.append("d.branch_id = :branch_id")
        params["branch_id"] = branch_id
    where_sql = " AND ".join(where)

    # `date_trunc` returns the start of the bucket; cast to date for ISO output.
    series_sql = f"""
        SELECT date_trunc(:period, d.created_at)::date  AS bucket,
               COALESCE(SUM(d.amount), 0)::numeric      AS amount,
               COALESCE(SUM(d.gift_aid_amount), 0)::numeric AS gift_aid,
               COUNT(*)                                  AS cnt
        FROM   donations d
        WHERE  {where_sql}
        GROUP  BY bucket
        ORDER  BY bucket
    """
    by_branch_sql = f"""
        SELECT d.branch_id,
               COALESCE(b.name, d.branch_id)            AS branch_name,
               COALESCE(SUM(d.amount), 0)::numeric      AS amount,
               COALESCE(SUM(d.gift_aid_amount), 0)::numeric AS gift_aid,
               COUNT(*)                                  AS cnt
        FROM   donations d
        LEFT   JOIN branches b ON b.branch_id = d.branch_id
        WHERE  {where_sql}
        GROUP  BY d.branch_id, b.name
        ORDER  BY amount DESC
    """

    series: list[dict[str, Any]] = []
    by_branch: list[dict[str, Any]] = []
    totals = {"amount": 0.0, "gift_aid": 0.0, "with_gift_aid": 0.0, "count": 0}

    async with SessionLocal() as db:
        # Series
        s = await db.execute(text(series_sql), {**params, "period": period})
        for r in s.mappings().all():
            amount   = float(r["amount"] or 0)
            gift_aid = float(r["gift_aid"] or 0)
            series.append({
                "bucket":         r["bucket"].isoformat() if r["bucket"] else None,
                "amount":         round(amount, 2),
                "gift_aid":       round(gift_aid, 2),
                "with_gift_aid":  round(amount + gift_aid, 2),
                "count":          int(r["cnt"] or 0),
            })
            totals["amount"]        += amount
            totals["gift_aid"]      += gift_aid
            totals["with_gift_aid"] += amount + gift_aid
            totals["count"]         += int(r["cnt"] or 0)

        # Per-branch breakdown (always cheap, even when group_by_branch=false
        # the caller often wants the top-branch chip — return it always).
        b = await db.execute(text(by_branch_sql), params)
        for r in b.mappings().all():
            amount   = float(r["amount"] or 0)
            gift_aid = float(r["gift_aid"] or 0)
            by_branch.append({
                "branch_id":     r["branch_id"],
                "branch_name":   r["branch_name"],
                "amount":        round(amount, 2),
                "gift_aid":      round(gift_aid, 2),
                "with_gift_aid": round(amount + gift_aid, 2),
                "count":         int(r["cnt"] or 0),
            })

    for k in ("amount", "gift_aid", "with_gift_aid"):
        totals[k] = round(totals[k], 2)

    return {
        "period":     period,
        "start_date": start_d.isoformat(),
        "end_date":   end_d.isoformat(),
        "branch_id":  branch_id or None,
        "series":     series,
        "by_branch":  by_branch,
        "totals":     totals,
    }
