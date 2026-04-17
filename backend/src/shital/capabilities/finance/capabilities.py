"""
Finance Capabilities — Digital DNA micro-capabilities for double-entry accounting,
donations, gift aid, budgets, and financial reporting.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import structlog
from pydantic import BaseModel, field_validator

from shital.core.dna.registry import Fabric, capability
from shital.core.fabrics.errors import AccountingError, IdempotencyError
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()

GIFT_AID_RATE = Decimal("0.25")


# ─── Input/Output schemas ────────────────────────────────────────────────────

class JournalLineInput(BaseModel):
    account_id: str
    description: str = ""
    debit: str = "0.00"
    credit: str = "0.00"


class PostJournalInput(BaseModel):
    description: str
    date: str  # ISO date
    lines: list[JournalLineInput]
    idempotency_key: str
    reference: str = ""


class DonationInput(BaseModel):
    amount: str  # string to avoid float precision
    currency: str = "GBP"
    purpose: str
    payment_provider: str
    payment_ref: str = ""
    gift_aid_declaration_id: str = ""
    idempotency_key: str

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: str) -> str:
        d = Decimal(v)
        if d <= 0:
            raise ValueError("Amount must be positive")
        return str(d.quantize(Decimal("0.01")))


class BudgetInput(BaseModel):
    name: str
    fiscal_year: int
    start_date: str
    end_date: str


# ─── Capabilities ─────────────────────────────────────────────────────────────

@capability(
    name="get_trial_balance",
    description="Get the trial balance for a branch, showing all account debit/credit balances. Use for financial health checks and period-end reporting.",
    fabric=Fabric.FINANCE,
    requires=["finance:read"],
    idempotent=True,
    tags=["reporting", "accounting"],
)
async def get_trial_balance(ctx: DigitalSpace, as_at_date: str = "") -> dict[str, Any]:
    """Return trial balance as of a given date (defaults to today)."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    log = logger.bind(**ctx.log_context)
    ctx.require_permission("finance:read")
    ctx.require_branch_scope(ctx.branch_id)

    target_date = as_at_date or date.today().isoformat()
    log.info("get_trial_balance", as_at=target_date)

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT a.code, a.name, a.type,
                       COALESCE(SUM(tl.debit_amount), 0) AS total_debits,
                       COALESCE(SUM(tl.credit_amount), 0) AS total_credits
                FROM accounts a
                LEFT JOIN transaction_lines tl ON tl.account_id = a.id
                LEFT JOIN transactions t ON t.id = tl.transaction_id
                    AND t.status = 'POSTED'
                    AND t.date <= :as_at
                    AND t.branch_id = :branch_id
                    AND t.deleted_at IS NULL
                WHERE a.branch_id = :branch_id AND a.deleted_at IS NULL
                GROUP BY a.code, a.name, a.type
                ORDER BY a.code
            """),
            {"branch_id": ctx.branch_id, "as_at": target_date},
        )
        rows = result.mappings().all()

    accounts = []
    total_dr = Decimal("0")
    total_cr = Decimal("0")
    for r in rows:
        dr = Decimal(str(r["total_debits"]))
        cr = Decimal(str(r["total_credits"]))
        total_dr += dr
        total_cr += cr
        accounts.append({
            "code": r["code"], "name": r["name"], "type": r["type"],
            "debit": str(dr), "credit": str(cr),
        })

    return {
        "as_at": target_date,
        "branch_id": ctx.branch_id,
        "accounts": accounts,
        "total_debits": str(total_dr),
        "total_credits": str(total_cr),
        "is_balanced": total_dr == total_cr,
    }


@capability(
    name="post_journal_entry",
    description="Post a double-entry journal entry to the ledger. Debits must equal credits. Used for all financial transactions.",
    fabric=Fabric.FINANCE,
    requires=["finance:write"],
    human_in_loop=False,
    idempotent=True,
    tags=["accounting", "journal"],
    raci={"responsible": ["ACCOUNTANT"], "accountable": ["TRUSTEE"]},
)
async def post_journal_entry(ctx: DigitalSpace, entry: PostJournalInput) -> dict[str, Any]:
    """Post a balanced journal entry. Raises AccountingError if debits ≠ credits."""
    ctx.require_permission("finance:write")

    total_dr = sum(Decimal(ln.debit) for ln in entry.lines)
    total_cr = sum(Decimal(ln.credit) for ln in entry.lines)
    if total_dr != total_cr:
        raise AccountingError(
            f"Journal does not balance: debits={total_dr} credits={total_cr}"
        )

    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    log = logger.bind(**ctx.log_context)

    async with SessionLocal() as db:
        # Idempotency check
        existing = await db.execute(
            text("SELECT id FROM transactions WHERE idempotency_key = :key"),
            {"key": entry.idempotency_key},
        )
        if existing.scalar():
            raise IdempotencyError(f"Transaction with key {entry.idempotency_key} already exists")

        txn_id = str(uuid.uuid4())
        now = datetime.utcnow()

        await db.execute(
            text("""
                INSERT INTO transactions
                (id, branch_id, reference, description, date, total_amount, currency,
                 status, posted_by, posted_at, idempotency_key, created_at, updated_at)
                VALUES (:id, :branch_id, :ref, :desc, :date, :amount, 'GBP',
                        'POSTED', :user, :now, :ikey, :now, :now)
            """),
            {
                "id": txn_id, "branch_id": ctx.branch_id,
                "ref": entry.reference or f"JNL-{txn_id[:8].upper()}",
                "desc": entry.description, "date": entry.date,
                "amount": str(total_dr), "user": ctx.user_id,
                "now": now, "ikey": entry.idempotency_key,
            },
        )

        for ln in entry.lines:
            line_id = str(uuid.uuid4())
            await db.execute(
                text("""
                    INSERT INTO transaction_lines
                    (id, transaction_id, account_id, description, debit_amount, credit_amount, created_at, updated_at)
                    VALUES (:id, :txn, :acc, :desc, :dr, :cr, :now, :now)
                """),
                {
                    "id": line_id, "txn": txn_id, "acc": ln.account_id,
                    "desc": ln.description, "dr": ln.debit, "cr": ln.credit,
                    "now": now,
                },
            )
            # Update account balance
            await db.execute(
                text("""
                    UPDATE accounts
                    SET balance = balance + :dr - :cr, updated_at = :now
                    WHERE id = :acc_id
                """),
                {"dr": Decimal(ln.debit), "cr": Decimal(ln.credit), "now": now, "acc_id": ln.account_id},
            )

        await db.commit()
        log.info("journal_posted", transaction_id=txn_id, amount=str(total_dr))

    return {"transaction_id": txn_id, "reference": entry.reference, "amount": str(total_dr), "status": "POSTED"}


@capability(
    name="record_donation",
    description="Record a charitable donation with optional Gift Aid. Calculates 25% Gift Aid uplift for eligible donations from signed declarations.",
    fabric=Fabric.FINANCE,
    requires=["finance:write"],
    idempotent=True,
    tags=["donations", "gift-aid"],
)
async def record_donation(ctx: DigitalSpace, donation: DonationInput) -> dict[str, Any]:
    """Record a donation, calculate gift aid, and post the accounting journal."""
    ctx.require_permission("finance:write")

    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    amount = Decimal(donation.amount)
    gift_aid_amount = Decimal("0")
    has_gift_aid = False

    async with SessionLocal() as db:
        # Check for valid gift aid declaration
        if donation.gift_aid_declaration_id:
            decl = await db.execute(
                text("""
                    SELECT id FROM gift_aid_declarations
                    WHERE id = :id AND user_id = :uid AND is_active = true
                    AND revoked_at IS NULL AND deleted_at IS NULL
                """),
                {"id": donation.gift_aid_declaration_id, "uid": ctx.user_id},
            )
            if decl.scalar():
                gift_aid_amount = (amount * GIFT_AID_RATE).quantize(Decimal("0.01"), ROUND_HALF_UP)
                has_gift_aid = True

        donation_id = str(uuid.uuid4())
        now = datetime.utcnow()
        ref = f"DON-{donation_id[:8].upper()}"

        await db.execute(
            text("""
                INSERT INTO donations
                (id, user_id, branch_id, amount, currency, gift_aid_eligible,
                 gift_aid_declaration_id, gift_aid_amount, purpose, reference,
                 payment_provider, payment_ref, status, idempotency_key, created_at, updated_at)
                VALUES (:id, :uid, :bid, :amt, :cur, :ga_elig, :ga_decl, :ga_amt,
                        :purpose, :ref, :provider, :pref, 'COMPLETED', :ikey, :now, :now)
            """),
            {
                "id": donation_id, "uid": ctx.user_id, "bid": ctx.branch_id,
                "amt": str(amount), "cur": donation.currency,
                "ga_elig": has_gift_aid,
                "ga_decl": donation.gift_aid_declaration_id or None,
                "ga_amt": str(gift_aid_amount),
                "purpose": donation.purpose, "ref": ref,
                "provider": donation.payment_provider,
                "pref": donation.payment_ref or None,
                "ikey": donation.idempotency_key, "now": now,
            },
        )
        await db.commit()

    logger.info("donation_recorded", donation_id=donation_id, amount=str(amount), gift_aid=str(gift_aid_amount))

    return {
        "donation_id": donation_id,
        "reference": ref,
        "amount": str(amount),
        "gift_aid_eligible": has_gift_aid,
        "gift_aid_amount": str(gift_aid_amount),
        "total_value": str(amount + gift_aid_amount),
    }


@capability(
    name="get_income_statement",
    description="Generate income & expenditure statement for a date range. Shows total income, expenses, and surplus/deficit.",
    fabric=Fabric.FINANCE,
    requires=["finance:read"],
    idempotent=True,
    tags=["reporting"],
)
async def get_income_statement(ctx: DigitalSpace, from_date: str, to_date: str) -> dict[str, Any]:
    ctx.require_permission("finance:read")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT a.type, a.name,
                       COALESCE(SUM(tl.credit_amount - tl.debit_amount), 0) AS net
                FROM accounts a
                JOIN transaction_lines tl ON tl.account_id = a.id
                JOIN transactions t ON t.id = tl.transaction_id
                WHERE t.branch_id = :bid AND t.status = 'POSTED'
                  AND t.date BETWEEN :from_d AND :to_d
                  AND t.deleted_at IS NULL
                  AND a.type IN ('INCOME', 'EXPENSE')
                GROUP BY a.type, a.name
                ORDER BY a.type, a.name
            """),
            {"bid": ctx.branch_id, "from_d": from_date, "to_d": to_date},
        )
        rows = result.mappings().all()

    income_lines = [{"name": r["name"], "amount": str(Decimal(str(r["net"])))} for r in rows if r["type"] == "INCOME"]
    expense_lines = [{"name": r["name"], "amount": str(abs(Decimal(str(r["net"]))))} for r in rows if r["type"] == "EXPENSE"]

    total_income = sum(Decimal(line["amount"]) for line in income_lines)
    total_expenses = sum(Decimal(line["amount"]) for line in expense_lines)
    surplus = total_income - total_expenses

    return {
        "from_date": from_date, "to_date": to_date, "branch_id": ctx.branch_id,
        "income": income_lines, "expenses": expense_lines,
        "total_income": str(total_income),
        "total_expenses": str(total_expenses),
        "surplus": str(surplus),
        "is_surplus": surplus >= 0,
    }


@capability(
    name="get_donation_summary",
    description="Summarise donations by period and purpose. Shows total donations, gift aid claimed, and breakdown by purpose.",
    fabric=Fabric.FINANCE,
    requires=["finance:read"],
    idempotent=True,
    tags=["donations", "reporting"],
)
async def get_donation_summary(ctx: DigitalSpace, from_date: str, to_date: str) -> dict[str, Any]:
    ctx.require_permission("finance:read")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT purpose,
                       COUNT(*) AS count,
                       SUM(amount) AS total,
                       SUM(CASE WHEN gift_aid_eligible THEN gift_aid_amount ELSE 0 END) AS gift_aid
                FROM donations
                WHERE branch_id = :bid
                  AND created_at BETWEEN :from_d AND :to_d
                  AND status = 'COMPLETED'
                  AND deleted_at IS NULL
                GROUP BY purpose
                ORDER BY total DESC
            """),
            {"bid": ctx.branch_id, "from_d": from_date, "to_d": to_date},
        )
        rows = result.mappings().all()

    by_purpose = [
        {"purpose": r["purpose"], "count": r["count"],
         "total": str(Decimal(str(r["total"]))),
         "gift_aid": str(Decimal(str(r["gift_aid"])))}
        for r in rows
    ]
    grand_total = sum(Decimal(r["total"]) for r in by_purpose)
    grand_ga = sum(Decimal(r["gift_aid"]) for r in by_purpose)

    return {
        "from_date": from_date, "to_date": to_date,
        "total_donations": str(grand_total),
        "total_gift_aid": str(grand_ga),
        "total_value": str(grand_total + grand_ga),
        "by_purpose": by_purpose,
    }
