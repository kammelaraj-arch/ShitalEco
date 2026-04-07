"""
Recurring Payments router — manage financial obligations:
rent, rates, leases, utilities, HMRC, insurance, payroll etc.

Generates a payment schedule (next 24 instances) on create/update.
Critical obligations (RENT, LEASE, HMRC_*) get visual alerts in the UI.
"""
from __future__ import annotations

import calendar
import uuid
from datetime import date, timedelta
from typing import Any

from dateutil.relativedelta import relativedelta  # type: ignore[import-untyped]
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace, OptionalSpace

router = APIRouter(prefix="/recurring-payments", tags=["recurring-payments"])

CRITICAL_CATEGORIES = {"RENT", "LEASE", "HMRC_VAT", "HMRC_PAYE", "HMRC_CORP_TAX"}


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class RecurringPaymentIn(BaseModel):
    name: str
    category: str = "OTHER"
    is_critical: bool = False
    amount: float
    currency: str = "GBP"
    frequency: str = "MONTHLY"
    branch_id: str = "main"
    start_date: str
    end_date: str = ""
    day_of_month: int | None = None
    renewal_date: str = ""
    notice_days: int = 30
    payee: str = ""
    reference: str = ""
    notes: str = ""
    is_active: bool = True


class MarkPaidIn(BaseModel):
    paid_date: str
    paid_amount: float | None = None
    paid_reference: str = ""
    paid_by: str = ""
    notes: str = ""


class MarkSkippedIn(BaseModel):
    notes: str = ""


# ── Schedule generation ───────────────────────────────────────────────────────

def _next_dates(start: date, frequency: str, day_of_month: int | None,
                end: date | None, count: int = 24) -> list[date]:
    """Return up to `count` due dates from today onward."""
    freq_map: dict[str, Any] = {
        "DAILY":     lambda n: timedelta(days=n),
        "WEEKLY":    lambda n: timedelta(weeks=n),
        "MONTHLY":   lambda n: relativedelta(months=n),
        "QUARTERLY": lambda n: relativedelta(months=3 * n),
        "BIANNUAL":  lambda n: relativedelta(months=6 * n),
        "ANNUAL":    lambda n: relativedelta(years=n),
    }
    delta_fn = freq_map.get(frequency, lambda n: relativedelta(months=n))
    anchor = max(start, date.today())

    # Walk from start to find first occurrence >= anchor
    d = start
    while d < anchor:
        d = start + delta_fn(1) if d == start else d + delta_fn(1)
        # Safer: just advance step by step
        temp = start
        i = 0
        while temp < anchor:
            i += 1
            temp = start + delta_fn(i)
        d = temp
        break

    dates: list[date] = []
    i = 0
    while len(dates) < count:
        candidate = d + delta_fn(i)
        if day_of_month and frequency in ("MONTHLY", "QUARTERLY", "BIANNUAL", "ANNUAL"):
            last = calendar.monthrange(candidate.year, candidate.month)[1]
            candidate = candidate.replace(day=min(day_of_month, last))
        if end and candidate > end:
            break
        dates.append(candidate)
        i += 1
    return dates


async def _generate_schedule(db: Any, payment_id: str, branch_id: str,
                              amount: float, currency: str, frequency: str,
                              start: date, day_of_month: int | None,
                              end: date | None) -> int:
    from datetime import datetime

    from sqlalchemy import text
    dates = _next_dates(start, frequency, day_of_month, end, count=24)
    now = datetime.utcnow()
    for d in dates:
        await db.execute(text("""
            INSERT INTO payment_schedule
                (id, recurring_payment_id, branch_id, due_date, amount, currency,
                 status, created_at, updated_at)
            VALUES
                (:id, :pid, :bid, :due, :amt, :cur, 'PENDING', :now, :now)
        """), {
            "id": str(uuid.uuid4()), "pid": payment_id, "bid": branch_id,
            "due": d, "amt": amount, "cur": currency, "now": now,
        })
    return len(dates)


def _parse_date(s: str) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(ctx: OptionalSpace) -> dict[str, Any]:
    """Alert dashboard: overdue, due soon, renewals."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    today = date.today().isoformat()
    in7   = (date.today() + timedelta(days=7)).isoformat()
    in30  = (date.today() + timedelta(days=30)).isoformat()
    in60  = (date.today() + timedelta(days=60)).isoformat()

    async with SessionLocal() as db:
        # Overdue: PENDING schedule items past due
        r = await db.execute(text("""
            SELECT ps.id, ps.due_date, ps.amount, ps.currency,
                   rp.name, rp.category, rp.is_critical, rp.payee, rp.id AS rp_id
            FROM payment_schedule ps
            JOIN recurring_payments rp ON rp.id = ps.recurring_payment_id
            WHERE ps.status = 'PENDING' AND ps.due_date < :today
              AND rp.is_active = true AND rp.deleted_at IS NULL
            ORDER BY ps.due_date ASC LIMIT 50
        """), {"today": today})
        overdue = [dict(x) for x in r.mappings()]

        # Due in 7 days
        r = await db.execute(text("""
            SELECT ps.id, ps.due_date, ps.amount, ps.currency,
                   rp.name, rp.category, rp.is_critical, rp.payee, rp.id AS rp_id
            FROM payment_schedule ps
            JOIN recurring_payments rp ON rp.id = ps.recurring_payment_id
            WHERE ps.status = 'PENDING'
              AND ps.due_date >= :today AND ps.due_date <= :in7
              AND rp.is_active = true AND rp.deleted_at IS NULL
            ORDER BY ps.due_date ASC LIMIT 50
        """), {"today": today, "in7": in7})
        due_7 = [dict(x) for x in r.mappings()]

        # Due in 30 days
        r = await db.execute(text("""
            SELECT ps.id, ps.due_date, ps.amount, ps.currency,
                   rp.name, rp.category, rp.is_critical, rp.payee, rp.id AS rp_id
            FROM payment_schedule ps
            JOIN recurring_payments rp ON rp.id = ps.recurring_payment_id
            WHERE ps.status = 'PENDING'
              AND ps.due_date > :in7 AND ps.due_date <= :in30
              AND rp.is_active = true AND rp.deleted_at IS NULL
            ORDER BY ps.due_date ASC LIMIT 50
        """), {"in7": in7, "in30": in30})
        due_30 = [dict(x) for x in r.mappings()]

        # Renewals due within 60 days
        r = await db.execute(text("""
            SELECT id, name, category, is_critical, renewal_date, notice_days, payee
            FROM recurring_payments
            WHERE renewal_date IS NOT NULL
              AND renewal_date >= :today AND renewal_date <= :in60
              AND is_active = true AND deleted_at IS NULL
            ORDER BY renewal_date ASC LIMIT 20
        """), {"today": today, "in60": in60})
        renewals = [dict(x) for x in r.mappings()]

    return {
        "overdue": overdue,
        "due_7_days": due_7,
        "due_30_days": due_30,
        "renewals_due": renewals,
    }


@router.get("")
async def list_recurring(
    ctx: OptionalSpace,
    branch_id: str = "",
    category: str = "",
    include_inactive: bool = False,
) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    today = date.today().isoformat()

    async with SessionLocal() as db:
        conds = ["rp.deleted_at IS NULL"]
        params: dict[str, Any] = {"today": today}
        if not include_inactive:
            conds.append("rp.is_active = true")
        if branch_id:
            conds.append("rp.branch_id = :branch_id")
            params["branch_id"] = branch_id
        if category:
            conds.append("rp.category = :category")
            params["category"] = category
        where = "WHERE " + " AND ".join(conds)

        result = await db.execute(text(f"""
            SELECT rp.*,
                   MIN(ps.due_date) FILTER (WHERE ps.status = 'PENDING') AS next_due_date,
                   CASE
                     WHEN MIN(ps.due_date) FILTER (WHERE ps.status = 'PENDING') < :today
                       THEN 'OVERDUE'
                     WHEN MIN(ps.due_date) FILTER (WHERE ps.status = 'PENDING')
                          <= (:today::date + INTERVAL '7 days')
                       THEN 'DUE_SOON'
                     WHEN MIN(ps.due_date) FILTER (WHERE ps.status = 'PENDING') IS NOT NULL
                       THEN 'OK'
                     ELSE 'NO_SCHEDULE'
                   END AS next_due_status,
                   COUNT(ps.id) FILTER (WHERE ps.status = 'PENDING' AND ps.due_date < :today)
                     AS overdue_count
            FROM recurring_payments rp
            LEFT JOIN payment_schedule ps ON ps.recurring_payment_id = rp.id
            {where}
            GROUP BY rp.id
            ORDER BY rp.is_critical DESC, rp.name ASC
        """), params)
        rows = [dict(r) for r in result.mappings()]

    return {"recurring_payments": rows}


@router.post("", status_code=201)
async def create_recurring(body: RecurringPaymentIn, ctx: CurrentSpace) -> dict[str, Any]:
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    pid = str(uuid.uuid4())
    start = _parse_date(body.start_date) or date.today()
    end   = _parse_date(body.end_date)
    renewal = _parse_date(body.renewal_date)
    is_critical = body.is_critical or body.category in CRITICAL_CATEGORIES

    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO recurring_payments
                (id, branch_id, name, category, is_critical, amount, currency,
                 frequency, start_date, end_date, day_of_month,
                 renewal_date, notice_days, payee, reference, notes,
                 is_active, created_by, created_at, updated_at)
            VALUES
                (:id, :bid, :name, :cat, :crit, :amt, :cur,
                 :freq, :start, :end, :dom,
                 :renew, :notice, :payee, :ref, :notes,
                 :active, :cb, :now, :now)
        """), {
            "id": pid, "bid": body.branch_id, "name": body.name,
            "cat": body.category, "crit": is_critical,
            "amt": body.amount, "cur": body.currency,
            "freq": body.frequency, "start": start, "end": end,
            "dom": body.day_of_month, "renew": renewal,
            "notice": body.notice_days, "payee": body.payee,
            "ref": body.reference, "notes": body.notes,
            "active": body.is_active, "cb": ctx.user_email, "now": now,
        })
        generated = await _generate_schedule(
            db, pid, body.branch_id, body.amount, body.currency,
            body.frequency, start, body.day_of_month, end,
        )
        await db.commit()
    return {"id": pid, "generated": generated}


@router.put("/{payment_id}")
async def update_recurring(payment_id: str, body: RecurringPaymentIn, ctx: CurrentSpace) -> dict[str, Any]:
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    start = _parse_date(body.start_date) or date.today()
    end   = _parse_date(body.end_date)
    renewal = _parse_date(body.renewal_date)
    is_critical = body.is_critical or body.category in CRITICAL_CATEGORIES

    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE recurring_payments SET
                name = :name, category = :cat, is_critical = :crit,
                amount = :amt, currency = :cur, frequency = :freq,
                branch_id = :bid, start_date = :start, end_date = :end,
                day_of_month = :dom, renewal_date = :renew,
                notice_days = :notice, payee = :payee, reference = :ref,
                notes = :notes, is_active = :active, updated_at = :now
            WHERE id = :pid AND deleted_at IS NULL
        """), {
            "name": body.name, "cat": body.category, "crit": is_critical,
            "amt": body.amount, "cur": body.currency, "freq": body.frequency,
            "bid": body.branch_id, "start": start, "end": end,
            "dom": body.day_of_month, "renew": renewal,
            "notice": body.notice_days, "payee": body.payee,
            "ref": body.reference, "notes": body.notes,
            "active": body.is_active, "now": now, "pid": payment_id,
        })
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Recurring payment not found")

        # Drop all future PENDING schedule entries, regenerate
        await db.execute(text("""
            DELETE FROM payment_schedule
            WHERE recurring_payment_id = :pid
              AND status = 'PENDING' AND due_date >= :today
        """), {"pid": payment_id, "today": date.today().isoformat()})

        generated = await _generate_schedule(
            db, payment_id, body.branch_id, body.amount, body.currency,
            body.frequency, start, body.day_of_month, end,
        )
        await db.commit()
    return {"ok": True, "generated": generated}


@router.delete("/{payment_id}", status_code=204)
async def delete_recurring(payment_id: str, ctx: CurrentSpace) -> None:
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE recurring_payments
            SET deleted_at = :now, is_active = false, updated_at = :now
            WHERE id = :pid AND deleted_at IS NULL
        """), {"pid": payment_id, "now": now})
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Not found")
        # Void pending future schedule entries
        await db.execute(text("""
            UPDATE payment_schedule SET status = 'SKIPPED', updated_at = :now
            WHERE recurring_payment_id = :pid
              AND status = 'PENDING' AND due_date >= :today
        """), {"pid": payment_id, "now": now, "today": date.today().isoformat()})
        await db.commit()


# ── Schedule ──────────────────────────────────────────────────────────────────

@router.get("/{payment_id}/schedule")
async def get_schedule(payment_id: str, ctx: OptionalSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(text("""
            SELECT * FROM payment_schedule
            WHERE recurring_payment_id = :pid
            ORDER BY due_date ASC
        """), {"pid": payment_id})
        rows = [dict(r) for r in result.mappings()]
    return {"schedule": rows}


@router.post("/{payment_id}/regenerate")
async def regenerate_schedule(payment_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    datetime.utcnow()
    async with SessionLocal() as db:
        rp = await db.execute(text(
            "SELECT * FROM recurring_payments WHERE id = :pid AND deleted_at IS NULL"
        ), {"pid": payment_id})
        row = rp.mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        # Drop PENDING future entries
        await db.execute(text("""
            DELETE FROM payment_schedule
            WHERE recurring_payment_id = :pid
              AND status = 'PENDING' AND due_date >= :today
        """), {"pid": payment_id, "today": date.today().isoformat()})
        start = row["start_date"] if isinstance(row["start_date"], date) else date.fromisoformat(str(row["start_date"]))
        end   = row["end_date"] if not row["end_date"] else (
            row["end_date"] if isinstance(row["end_date"], date) else date.fromisoformat(str(row["end_date"]))
        )
        generated = await _generate_schedule(
            db, payment_id, row["branch_id"], float(row["amount"]),
            row["currency"], row["frequency"], start, row["day_of_month"], end,
        )
        await db.commit()
    return {"generated": generated}


# ── Schedule item actions ─────────────────────────────────────────────────────

@router.patch("/schedule/{schedule_id}/mark-paid")
async def mark_paid(schedule_id: str, body: MarkPaidIn, ctx: CurrentSpace) -> dict[str, Any]:
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE payment_schedule SET
                status = 'PAID',
                paid_date = :pd, paid_amount = :pa,
                paid_reference = :pr, paid_by = :pb,
                notes = :notes, updated_at = :now
            WHERE id = :sid
        """), {
            "pd": body.paid_date, "pa": body.paid_amount,
            "pr": body.paid_reference, "pb": body.paid_by,
            "notes": body.notes, "now": now, "sid": schedule_id,
        })
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Schedule entry not found")
    return {"ok": True}


@router.patch("/schedule/{schedule_id}/mark-skipped")
async def mark_skipped(schedule_id: str, body: MarkSkippedIn, ctx: CurrentSpace) -> dict[str, Any]:
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE payment_schedule SET status = 'SKIPPED', notes = :notes, updated_at = :now
            WHERE id = :sid
        """), {"notes": body.notes, "now": now, "sid": schedule_id})
        await db.commit()
    return {"ok": True}


@router.patch("/schedule/{schedule_id}/mark-pending")
async def mark_pending(schedule_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE payment_schedule SET
                status = 'PENDING', paid_date = NULL, paid_amount = NULL,
                paid_reference = '', paid_by = '', updated_at = :now
            WHERE id = :sid
        """), {"now": now, "sid": schedule_id})
        await db.commit()
    return {"ok": True}
