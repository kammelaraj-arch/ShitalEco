"""Finance router."""
from fastapi import APIRouter
from pydantic import BaseModel

from shital.api.deps import CurrentSpace
from shital.capabilities.finance.capabilities import (
    get_trial_balance, post_journal_entry, record_donation,
    get_income_statement, get_donation_summary,
    PostJournalInput, DonationInput,
)

router = APIRouter(prefix="/finance", tags=["finance"])


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


@router.get("/accounts")
async def list_accounts(ctx: CurrentSpace):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
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
        return {"accounts": [dict(r) for r in result.mappings()]}
