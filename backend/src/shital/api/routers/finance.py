"""Finance router."""
from __future__ import annotations

import csv
import io
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
                false                                     AS gift_aid_eligible,
                0::numeric                                AS gift_aid_amount,
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
