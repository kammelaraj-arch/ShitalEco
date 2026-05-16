"""General Ledger (Phase 2) — shared posting service.

The single, authoritative `post()` function every other module calls when a
financial event happens (PO received, invoice paid, donation captured,
reimbursement approved, payroll run, etc.). Centralising posting here
keeps the double-entry rule (debits = credits) in one place and means
the audit trail is uniform: every row in `transactions` carries a
`source_type` + `source_id` linking back to the originating document.

We re-use the EXISTING tables — `transactions` + `transaction_lines` —
extended in Phase 2 with `nominal_code_id`, `fund_type`, `project_id`,
and `branch_id` on each line, plus `source_type`/`source_id`/`reversal_of`
on the header. No duplicated tables, no parallel ledger.

Posting is always POSTED on insert (no DRAFT GL entries) — the upstream
document (PO/Invoice/Reimbursement) has its own DRAFT state; the GL
only sees the event after it's been actioned by a human.

Reversals create a new POSTED entry that flips DR/CR on every line and
sets `reversal_of` to the original txn id. The original row is never
deleted — clean audit trail.
"""
from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import structlog

logger = structlog.get_logger()

# Source-type constants. Use these (not string literals) when posting so
# downstream reporting / search-by-source works consistently.
SOURCE_MANUAL          = "manual"
SOURCE_PO_RECEIVE      = "po_receive"
SOURCE_PO_PAY          = "po_pay"
SOURCE_INVOICE_SEND    = "invoice_send"
SOURCE_INVOICE_PAY     = "invoice_pay"
SOURCE_INVOICE_VOID    = "invoice_void"
SOURCE_DONATION        = "donation"
SOURCE_REIMBURSEMENT_APPROVE = "reimbursement_approve"
SOURCE_REIMBURSEMENT_PAY     = "reimbursement_pay"
SOURCE_PAYROLL         = "payroll"
SOURCE_BANK_IMPORT     = "bank_import"
SOURCE_REVERSAL        = "reversal"

# Default nominal codes used when an upstream document doesn't specify
# a code on its line (eg. a donation has no per-line CoA picker).
# Seeded in nominal_codes by main.py — if a deployment edits them, set
# the corresponding env var on the backend to override.
DEFAULT_BANK             = "1000"  # Cash at Bank — General
DEFAULT_DEBTOR           = "1100"  # Accounts Receivable
DEFAULT_CREDITOR         = "2000"  # Accounts Payable
DEFAULT_DONATION_INCOME  = "4030"  # Donations — Online
DEFAULT_INVOICE_INCOME   = "4100"  # Service Income — Puja Bookings
DEFAULT_EXPENSE          = "5000"  # Generic expense (added if missing)
DEFAULT_REIMBURSE_EXPENSE = "5000"
DEFAULT_VAT_INPUT        = "1200"  # VAT recoverable on purchases (Prepayments parking)
DEFAULT_VAT_OUTPUT       = "2300"  # VAT owed


def _d(x: Any) -> Decimal:
    """Coerce anything to Decimal('0.00')-rounded."""
    if x is None or x == "":
        return Decimal("0.00")
    if isinstance(x, Decimal):
        d = x
    else:
        d = Decimal(str(x))
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def _resolve_nominal_id(db: Any, code: str) -> str | None:
    """Look up nominal_codes.id by code. Returns None if not found —
    callers should still post (with NULL nominal_code_id + the textual
    code) so an orphaned line is auditable rather than silently dropped."""
    if not code:
        return None
    from sqlalchemy import text
    row = (await db.execute(
        text("SELECT id FROM nominal_codes WHERE code = :c LIMIT 1"),
        {"c": code.strip().upper()},
    )).mappings().first()
    return str(row["id"]) if row else None


async def post(
    db: Any, *,
    branch_id: str,
    entry_date: date | str,
    description: str,
    lines: list[dict[str, Any]],
    source_type: str = SOURCE_MANUAL,
    source_id: str | None = None,
    reference: str = "",
    posted_by: str = "",
    fund_type: str = "UNRESTRICTED",
    project_id: str | None = None,
    idempotency_key: str = "",
    reversal_of: str | None = None,
) -> str:
    """Post a balanced double-entry journal. Returns the new transaction id.

    Each line dict must have:
        nominal_code  (str)   — looked up to nominal_code_id, kept verbatim too
        debit         (number) — 0 if it's a credit line
        credit        (number) — 0 if it's a debit line
    Optional per-line:
        description, fund_type, project_id, branch_id

    Raises ValueError if debits != credits or lines is empty.

    Uses the caller's DB session (no nested transaction). Caller is
    responsible for the commit — this lets a multi-step upstream action
    (eg. invoice pay = update header + post GL) commit atomically.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    if not lines:
        raise ValueError("Journal posting requires at least one line")

    total_dr = sum((_d(ln.get("debit", 0)) for ln in lines), start=Decimal("0.00"))
    total_cr = sum((_d(ln.get("credit", 0)) for ln in lines), start=Decimal("0.00"))
    if total_dr != total_cr:
        raise ValueError(
            f"Journal does not balance: debits={total_dr} credits={total_cr}"
        )
    if total_dr == 0:
        raise ValueError("Journal total is zero — refusing to post empty entry")

    # Idempotency: if a key is supplied and a row already exists for it,
    # short-circuit and return the existing id (callers can safely retry).
    if idempotency_key:
        existing = (await db.execute(
            text("SELECT id FROM transactions WHERE idempotency_key = :k"),
            {"k": idempotency_key},
        )).mappings().first()
        if existing:
            return str(existing["id"])

    if isinstance(entry_date, str):
        entry_date = date.fromisoformat(entry_date)

    txn_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    ref = reference.strip() or f"JNL-{txn_id[:8].upper()}"

    try:
        await db.execute(text("""
            INSERT INTO transactions
                (id, branch_id, reference, description, date,
                 total_amount, currency, status,
                 source_type, source_id, reversal_of,
                 fund_type, project_id,
                 posted_by, posted_at, idempotency_key, created_at, updated_at)
            VALUES
                (:id, :bid, :ref, :desc, :date,
                 :amt, 'GBP', 'POSTED',
                 :stype, :sid, :rev,
                 :fund, :proj,
                 :user, :now, :ikey, :now, :now)
        """), {
            "id":   txn_id, "bid": branch_id, "ref": ref,
            "desc": description, "date": entry_date,
            "amt":  total_dr, "stype": source_type, "sid": source_id,
            "rev":  reversal_of, "fund": fund_type, "proj": project_id,
            "user": posted_by, "now": now, "ikey": idempotency_key,
        })
    except IntegrityError as exc:
        # Idempotency key clashed between the check and the insert — race.
        # Re-fetch and return the winner's id.
        await db.rollback()
        if idempotency_key:
            existing = (await db.execute(
                text("SELECT id FROM transactions WHERE idempotency_key = :k"),
                {"k": idempotency_key},
            )).mappings().first()
            if existing:
                return str(existing["id"])
        raise ValueError(f"Failed to insert journal header: {exc.orig}") from exc

    for i, ln in enumerate(lines, start=1):
        nominal_code = (ln.get("nominal_code") or "").strip().upper()
        nominal_id = ln.get("nominal_code_id")
        if not nominal_id and nominal_code:
            nominal_id = await _resolve_nominal_id(db, nominal_code)
        await db.execute(text("""
            INSERT INTO transaction_lines
                (id, transaction_id, account_id,
                 nominal_code_id, nominal_code,
                 fund_type, project_id, branch_id,
                 description, debit_amount, credit_amount, created_at, updated_at)
            VALUES
                (:id, :txn, :acc,
                 :ncid, :nc,
                 :fund, :proj, :bid,
                 :desc, :dr, :cr, :now, :now)
        """), {
            "id":   str(uuid.uuid4()), "txn": txn_id,
            # account_id is the legacy FK to `accounts` — we keep it nullable-
            # in-spirit by storing the nominal_code_id when no legacy account
            # row maps. Pre-existing rows that posted via the old capability
            # still have a real account_id; new GL rows leave it as the
            # nominal_code_id so cardinality joins still work either way.
            "acc":  nominal_id or str(uuid.uuid4()),
            "ncid": nominal_id, "nc": nominal_code,
            "fund": ln.get("fund_type") or fund_type,
            "proj": ln.get("project_id") or project_id,
            "bid":  ln.get("branch_id")  or branch_id,
            "desc": (ln.get("description") or "")[:1000],
            "dr":   _d(ln.get("debit", 0)),
            "cr":   _d(ln.get("credit", 0)),
            "now":  now,
        })

    logger.info("gl_posted",
                txn_id=txn_id, source_type=source_type, source_id=source_id,
                branch_id=branch_id, total=str(total_dr))
    return txn_id


async def reverse(
    db: Any, *,
    original_txn_id: str,
    posted_by: str = "",
    description: str = "",
) -> str:
    """Create a reversing entry: same accounts, debits and credits swapped.
    Marks the new entry's `reversal_of` = original id for traceability."""
    from sqlalchemy import text

    header = (await db.execute(text("""
        SELECT * FROM transactions WHERE id = :id
    """), {"id": original_txn_id})).mappings().first()
    if not header:
        raise ValueError(f"Cannot reverse — transaction {original_txn_id} not found")
    if (await db.execute(text(
        "SELECT id FROM transactions WHERE reversal_of = :id"
    ), {"id": original_txn_id})).scalar():
        raise ValueError(f"Transaction {original_txn_id} has already been reversed")

    lines = (await db.execute(text("""
        SELECT nominal_code_id, nominal_code, fund_type, project_id, branch_id,
               description, debit_amount, credit_amount
        FROM   transaction_lines WHERE transaction_id = :id
        ORDER  BY id
    """), {"id": original_txn_id})).mappings().all()

    flipped: list[dict[str, Any]] = [{
        "nominal_code_id": str(line["nominal_code_id"]) if line["nominal_code_id"] else None,
        "nominal_code":    line["nominal_code"] or "",
        "fund_type":       line["fund_type"] or "UNRESTRICTED",
        "project_id":      str(line["project_id"]) if line["project_id"] else None,
        "branch_id":       line["branch_id"] or header["branch_id"],
        "description":     f"REV: {line['description'] or ''}",
        # swap
        "debit":           line["credit_amount"],
        "credit":          line["debit_amount"],
    } for line in lines]

    return await post(
        db,
        branch_id=header["branch_id"],
        entry_date=datetime.now(UTC).date(),
        description=description or f"Reversal of {header['reference']}",
        lines=flipped,
        source_type=SOURCE_REVERSAL,
        source_id=original_txn_id,
        reference=f"REV-{header['reference']}",
        posted_by=posted_by,
        fund_type=header["fund_type"] or "UNRESTRICTED",
        project_id=str(header["project_id"]) if header["project_id"] else None,
        reversal_of=original_txn_id,
    )


def lines_for_po_receive(po_total: float, po_subtotal: float, po_vat: float,
                         supplier_name: str, default_expense_code: str = DEFAULT_EXPENSE,
                         creditor_code: str = DEFAULT_CREDITOR,
                         vat_input_code: str = DEFAULT_VAT_INPUT) -> list[dict[str, Any]]:
    """Helper: standard PO-receive posting.
        DR  Expense   subtotal
        DR  VAT input vat_total      (if any)
        CR  AP        total
    Callers can pass per-line nominal codes instead by building the
    `lines` dict themselves — this helper is for the simple case."""
    lines: list[dict[str, Any]] = [{
        "nominal_code": default_expense_code, "debit": po_subtotal,  "credit": 0,
        "description":  f"PO receipt — {supplier_name}",
    }]
    if po_vat and float(po_vat) > 0:
        lines.append({
            "nominal_code": vat_input_code, "debit": po_vat, "credit": 0,
            "description": f"Input VAT — {supplier_name}",
        })
    lines.append({
        "nominal_code": creditor_code, "debit": 0, "credit": po_total,
        "description": f"AP — {supplier_name}",
    })
    return lines


def lines_for_invoice_send(inv_total: float, inv_subtotal: float, inv_vat: float,
                           customer_name: str,
                           default_income_code: str = DEFAULT_INVOICE_INCOME,
                           debtor_code: str = DEFAULT_DEBTOR,
                           vat_output_code: str = DEFAULT_VAT_OUTPUT) -> list[dict[str, Any]]:
    """Helper: invoice raise/send posting.
        DR  AR        total
        CR  Income    subtotal
        CR  VAT output vat (if any)"""
    lines: list[dict[str, Any]] = [{
        "nominal_code": debtor_code, "debit": inv_total, "credit": 0,
        "description":  f"AR — {customer_name}",
    }, {
        "nominal_code": default_income_code, "debit": 0, "credit": inv_subtotal,
        "description":  f"Invoice — {customer_name}",
    }]
    if inv_vat and float(inv_vat) > 0:
        lines.append({
            "nominal_code": vat_output_code, "debit": 0, "credit": inv_vat,
            "description": f"Output VAT — {customer_name}",
        })
    return lines


def lines_for_invoice_pay(inv_total: float, customer_name: str,
                          bank_code: str = DEFAULT_BANK,
                          debtor_code: str = DEFAULT_DEBTOR) -> list[dict[str, Any]]:
    """Cash received against an invoice:
        DR  Bank        total
        CR  AR          total"""
    return [{
        "nominal_code": bank_code, "debit": inv_total, "credit": 0,
        "description":  f"Receipt — {customer_name}",
    }, {
        "nominal_code": debtor_code, "debit": 0, "credit": inv_total,
        "description":  f"AR clear — {customer_name}",
    }]


def lines_for_po_pay(po_total: float, supplier_name: str,
                     bank_code: str = DEFAULT_BANK,
                     creditor_code: str = DEFAULT_CREDITOR) -> list[dict[str, Any]]:
    """Payment to a supplier:
        DR  AP        total
        CR  Bank      total"""
    return [{
        "nominal_code": creditor_code, "debit": po_total, "credit": 0,
        "description":  f"AP clear — {supplier_name}",
    }, {
        "nominal_code": bank_code, "debit": 0, "credit": po_total,
        "description":  f"Payment — {supplier_name}",
    }]


def lines_for_donation(amount: float, payer_name: str,
                       bank_code: str = DEFAULT_BANK,
                       income_code: str = DEFAULT_DONATION_INCOME) -> list[dict[str, Any]]:
    """Donation received:
        DR  Bank        amount
        CR  Donations   amount"""
    return [{
        "nominal_code": bank_code, "debit": amount, "credit": 0,
        "description":  f"Donation receipt — {payer_name}",
    }, {
        "nominal_code": income_code, "debit": 0, "credit": amount,
        "description":  f"Donation income — {payer_name}",
    }]


def lines_for_reimbursement_approve(amount: float, claimant_name: str,
                                    expense_code: str = DEFAULT_REIMBURSE_EXPENSE,
                                    creditor_code: str = DEFAULT_CREDITOR) -> list[dict[str, Any]]:
    """Reimbursement approved — claim creates an AP balance:
        DR  Expense   amount
        CR  AP        amount
    Marking the claim PAID later books the bank-side leg."""
    return [{
        "nominal_code": expense_code, "debit": amount, "credit": 0,
        "description":  f"Reimbursement — {claimant_name}",
    }, {
        "nominal_code": creditor_code, "debit": 0, "credit": amount,
        "description":  f"AP — {claimant_name}",
    }]


def lines_for_reimbursement_pay(amount: float, claimant_name: str,
                                bank_code: str = DEFAULT_BANK,
                                creditor_code: str = DEFAULT_CREDITOR) -> list[dict[str, Any]]:
    """Pay a previously-approved reimbursement:
        DR  AP        amount
        CR  Bank      amount"""
    return [{
        "nominal_code": creditor_code, "debit": amount, "credit": 0,
        "description":  f"AP clear — {claimant_name}",
    }, {
        "nominal_code": bank_code, "debit": 0, "credit": amount,
        "description":  f"Payment — {claimant_name}",
    }]
