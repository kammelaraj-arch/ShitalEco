"""Finance router."""
from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
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
    limit: int = 200,
) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(text("""
            SELECT id::text, branch_id, amount, currency, purpose, payment_provider,
                   payment_ref, gift_aid_eligible, gift_aid_amount, status,
                   reference, created_at, updated_at
            FROM donations
            WHERE deleted_at IS NULL
              AND created_at >= :from_dt::timestamptz
              AND created_at < (:to_dt::date + INTERVAL '1 day')::timestamptz
            ORDER BY created_at DESC
            LIMIT :lim
        """), {"from_dt": from_date, "to_dt": to_date, "lim": limit})
        rows = result.mappings().all()
    return {"donations": [_row(r) for r in rows]}


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
