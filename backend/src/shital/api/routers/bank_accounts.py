"""Bank / cash / processor accounts + statement transactions.

Distinct from the chart-of-accounts `accounts` table (which is the GL).
This router manages *real-world money locations* — the temple's NatWest
current account, in-house petty cash tin, the locker safe, and the
PayPal / SumUp / Stripe payouts accounts. Statement imports (PR 2/3)
land transactions in `bank_transactions` as raw rows; reconciliation
against the GL comes in a later phase.

Endpoints (all admin-gated):
  GET    /admin/bank-accounts                   list (with optional filters)
  POST   /admin/bank-accounts                   create
  GET    /admin/bank-accounts/{id}              detail
  PUT    /admin/bank-accounts/{id}              update
  DELETE /admin/bank-accounts/{id}              soft-delete (deactivate)

  GET    /admin/bank-accounts/{id}/transactions list account's txns
  POST   /admin/bank-accounts/{id}/transactions create manual txn
  PUT    /admin/bank-transactions/{id}          update txn
  DELETE /admin/bank-transactions/{id}          delete txn (admin only)
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["bank-accounts"])

VALID_ACCOUNT_TYPES = {"BANK", "IN_HOUSE", "LOCKER", "PAYPAL", "SUMUP", "STRIPE"}
VALID_TXN_TYPES     = {"DEBIT", "CREDIT", "FEE", "TRANSFER", "INTEREST", "REFUND", "OTHER"}
VALID_TXN_SOURCES   = {"MANUAL", "CSV_IMPORT", "PDF_IMPORT", "API"}


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )


# ── Models ────────────────────────────────────────────────────────────────────

class AccountCreate(BaseModel):
    name: str
    account_type: str = "BANK"
    parent_account_id: str | None = None
    bank_name: str = ""
    account_number: str = ""
    sort_code: str = ""
    iban: str = ""
    currency: str = "GBP"
    opening_balance: float = 0.0
    location: str = ""
    holder_name: str = ""
    notes: str = ""
    branch_id: str = "main"


class AccountUpdate(BaseModel):
    # All optional — caller sends only what's changing.
    name: str | None = None
    account_type: str | None = None
    parent_account_id: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    sort_code: str | None = None
    iban: str | None = None
    currency: str | None = None
    opening_balance: float | None = None
    location: str | None = None
    holder_name: str | None = None
    notes: str | None = None
    branch_id: str | None = None
    is_active: bool | None = None


class TransactionCreate(BaseModel):
    txn_date: str          # YYYY-MM-DD
    value_date: str | None = None
    description: str = ""
    counterparty: str = ""
    reference: str = ""
    amount: float          # signed: positive = credit, negative = debit
    balance_after: float | None = None
    currency: str = "GBP"
    txn_type: str = "OTHER"
    notes: str = ""


class TransactionUpdate(BaseModel):
    txn_date: str | None = None
    value_date: str | None = None
    description: str | None = None
    counterparty: str | None = None
    reference: str | None = None
    amount: float | None = None
    balance_after: float | None = None
    txn_type: str | None = None
    reconciled: bool | None = None
    reconciled_with_id: str | None = None
    notes: str | None = None


# ── Validation helpers ────────────────────────────────────────────────────────

def _validate_account_payload(account_type: str, parent_id: str | None) -> list[str]:
    errs: list[str] = []
    if account_type and account_type not in VALID_ACCOUNT_TYPES:
        errs.append(
            f"account_type '{account_type}' must be one of: "
            f"{', '.join(sorted(VALID_ACCOUNT_TYPES))}"
        )
    if parent_id and not _looks_uuid(parent_id):
        errs.append("parent_account_id must be a UUID")
    return errs


def _looks_uuid(s: str) -> bool:
    try:
        uuid.UUID(s)
        return True
    except (ValueError, AttributeError):
        return False


def _parse_date(s: str | None, field: str, errs: list[str]) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        errs.append(f"{field} must be YYYY-MM-DD, got '{s}'")
        return None


def _to_decimal(v: float | None) -> Decimal | None:
    if v is None:
        return None
    try:
        # Round-trip via str to avoid float-binary noise (0.1 + 0.2 etc).
        return Decimal(str(v)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


# ── Account endpoints ─────────────────────────────────────────────────────────

@router.get("/admin/bank-accounts")
async def list_accounts(
    ctx: CurrentSpace,
    branch_id: str = "",
    account_type: str = "",
    is_active: bool | None = None,
    parent_account_id: str = "",  # "" = all, "null" = top-level only, UUID = children of
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {}
    if branch_id:
        where.append("branch_id = :branch_id")
        params["branch_id"] = branch_id
    if account_type:
        if account_type not in VALID_ACCOUNT_TYPES:
            raise HTTPException(400, detail={"errors": [
                f"account_type '{account_type}' invalid"
            ]})
        where.append("account_type = :account_type")
        params["account_type"] = account_type
    if is_active is not None:
        where.append("is_active = :is_active")
        params["is_active"] = is_active
    if parent_account_id == "null":
        where.append("parent_account_id IS NULL")
    elif parent_account_id:
        if not _looks_uuid(parent_account_id):
            raise HTTPException(400, detail={"errors": ["parent_account_id must be UUID or 'null'"]})
        where.append("parent_account_id::text = :parent_account_id")
        params["parent_account_id"] = parent_account_id

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT id, branch_id, name, account_type, parent_account_id,
                   bank_name, account_number, sort_code, iban, currency,
                   opening_balance, current_balance, location, holder_name,
                   notes, is_active, created_at, updated_at
            FROM   bank_accounts
            {where_sql}
            ORDER  BY account_type, name
        """), params)
        items = [_account_row_to_dict(r._mapping) for r in rows]
    return {"items": items, "total": len(items)}


def _account_row_to_dict(r: Any) -> dict[str, Any]:
    d = dict(r)
    # Coerce Decimal / UUID / date to JSON-safe primitives. The default
    # FastAPI JSON encoder handles these but we want predictable shape.
    for k in ("opening_balance", "current_balance"):
        if d.get(k) is not None:
            d[k] = float(d[k])
    for k in ("id", "parent_account_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    for k in ("created_at", "updated_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
    return d


@router.post("/admin/bank-accounts")
async def create_account(body: AccountCreate, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    errs = _validate_account_payload(body.account_type, body.parent_account_id)
    if not body.name.strip():
        errs.append("name is required")
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    new_id = str(uuid.uuid4())
    opening = _to_decimal(body.opening_balance) or Decimal("0")
    now = datetime.now(UTC)

    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO bank_accounts (
                id, branch_id, name, account_type, parent_account_id,
                bank_name, account_number, sort_code, iban, currency,
                opening_balance, current_balance, location, holder_name,
                notes, is_active, created_at, updated_at
            ) VALUES (
                :id, :branch_id, :name, :account_type, :parent_account_id,
                :bank_name, :account_number, :sort_code, :iban, :currency,
                :opening_balance, :current_balance, :location, :holder_name,
                :notes, true, :now, :now
            )
        """), {
            "id": new_id, "branch_id": body.branch_id,
            "name": body.name.strip(), "account_type": body.account_type,
            "parent_account_id": body.parent_account_id or None,
            "bank_name": body.bank_name, "account_number": body.account_number,
            "sort_code": body.sort_code, "iban": body.iban, "currency": body.currency,
            "opening_balance": opening, "current_balance": opening,
            "location": body.location, "holder_name": body.holder_name,
            "notes": body.notes, "now": now,
        })
        await db.commit()
    return {"id": new_id, "success": True}


@router.get("/admin/bank-accounts/{account_id}")
async def get_account(account_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    if not _looks_uuid(account_id):
        raise HTTPException(400, detail="account_id must be UUID")
    async with SessionLocal() as db:
        row = await db.execute(
            text("SELECT * FROM bank_accounts WHERE id::text = :id"),
            {"id": account_id},
        )
        rec = row.mappings().one_or_none()
    if not rec:
        raise HTTPException(404, detail="Account not found")
    return {"account": _account_row_to_dict(rec)}


@router.put("/admin/bank-accounts/{account_id}")
async def update_account(
    account_id: str, body: AccountUpdate, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    if not _looks_uuid(account_id):
        raise HTTPException(400, detail="account_id must be UUID")

    updates = body.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        return {"id": account_id, "success": True, "no_op": True}

    if "account_type" in updates:
        errs = _validate_account_payload(updates["account_type"], updates.get("parent_account_id"))
        if errs:
            raise HTTPException(400, detail={"errors": errs})

    if "opening_balance" in updates:
        ob = _to_decimal(updates["opening_balance"])
        if ob is None:
            raise HTTPException(400, detail={"errors": ["opening_balance must be a number"]})
        updates["opening_balance"] = ob

    set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = account_id
    updates["now"] = datetime.now(UTC)

    async with SessionLocal() as db:
        existing = await db.execute(
            text("SELECT id FROM bank_accounts WHERE id::text = :id"),
            {"id": account_id},
        )
        if not existing.mappings().one_or_none():
            raise HTTPException(404, detail="Account not found")
        await db.execute(
            text(f"UPDATE bank_accounts SET {set_clauses}, updated_at = :now WHERE id::text = :id"),
            updates,
        )
        await db.commit()
    return {"id": account_id, "success": True}


@router.delete("/admin/bank-accounts/{account_id}")
async def deactivate_account(account_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Soft-delete: flip is_active to false. Hard-delete is intentionally not
    exposed because transactions reference accounts via FK and we want a
    forensic trail. To purge, run SQL directly with a DBA's hat on."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    if not _looks_uuid(account_id):
        raise HTTPException(400, detail="account_id must be UUID")

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE bank_accounts SET is_active = false, updated_at = :now
            WHERE id::text = :id AND is_active = true
            RETURNING id
        """), {"id": account_id, "now": now})
        row = result.mappings().one_or_none()
        await db.commit()
    if not row:
        raise HTTPException(404, detail="Account not found or already inactive")
    return {"id": account_id, "success": True, "is_active": False}


# ── Transaction endpoints ─────────────────────────────────────────────────────

@router.get("/admin/bank-accounts/{account_id}/transactions")
async def list_transactions(
    account_id: str, ctx: CurrentSpace,
    date_from: str = "", date_to: str = "",
    txn_type: str = "", reconciled: bool | None = None,
    search: str = "", limit: int = 100, offset: int = 0,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    if not _looks_uuid(account_id):
        raise HTTPException(400, detail="account_id must be UUID")

    where: list[str] = ["account_id::text = :account_id"]
    params: dict[str, Any] = {
        "account_id": account_id,
        "limit": max(1, min(limit, 500)),
        "offset": max(0, offset),
    }
    err_collector: list[str] = []
    df = _parse_date(date_from or None, "date_from", err_collector)
    dt = _parse_date(date_to   or None, "date_to",   err_collector)
    if err_collector:
        raise HTTPException(400, detail={"errors": err_collector})
    if df:
        where.append("txn_date >= :date_from")
        params["date_from"] = df
    if dt:
        where.append("txn_date <= :date_to")
        params["date_to"] = dt
    if txn_type:
        if txn_type not in VALID_TXN_TYPES:
            raise HTTPException(400, detail={"errors": [f"txn_type '{txn_type}' invalid"]})
        where.append("txn_type = :txn_type")
        params["txn_type"] = txn_type
    if reconciled is not None:
        where.append("reconciled = :reconciled")
        params["reconciled"] = reconciled
    if search.strip():
        where.append(
            "(LOWER(description) LIKE :search "
            "OR LOWER(counterparty) LIKE :search "
            "OR LOWER(reference) LIKE :search)"
        )
        params["search"] = f"%{search.strip().lower()}%"

    where_sql = "WHERE " + " AND ".join(where)

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT id, account_id, txn_date, value_date, description, counterparty,
                   reference, amount, balance_after, currency, txn_type, source,
                   reconciled, reconciled_with_id, notes, created_at, updated_at
            FROM   bank_transactions
            {where_sql}
            ORDER  BY txn_date DESC, created_at DESC
            LIMIT  :limit OFFSET :offset
        """), params)
        items = [_txn_row_to_dict(r._mapping) for r in rows]
        total_row = await db.execute(
            text(f"SELECT COUNT(*) AS n FROM bank_transactions {where_sql}"), params,
        )
        total = total_row.scalar_one()
    return {"items": items, "total": total, "limit": params["limit"], "offset": params["offset"]}


def _txn_row_to_dict(r: Any) -> dict[str, Any]:
    d = dict(r)
    for k in ("amount", "balance_after"):
        if d.get(k) is not None:
            d[k] = float(d[k])
    for k in ("id", "account_id", "reconciled_with_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    for k in ("txn_date", "value_date", "created_at", "updated_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
    return d


@router.post("/admin/bank-accounts/{account_id}/transactions")
async def create_transaction(
    account_id: str, body: TransactionCreate, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    if not _looks_uuid(account_id):
        raise HTTPException(400, detail="account_id must be UUID")

    errs: list[str] = []
    txn_date = _parse_date(body.txn_date, "txn_date", errs)
    value_date = _parse_date(body.value_date, "value_date", errs)
    if not txn_date:
        errs.append("txn_date is required")
    if body.txn_type not in VALID_TXN_TYPES:
        errs.append(f"txn_type '{body.txn_type}' invalid")
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    amount = _to_decimal(body.amount)
    balance_after = _to_decimal(body.balance_after) if body.balance_after is not None else None
    if amount is None:
        raise HTTPException(400, detail={"errors": ["amount must be a number"]})

    new_id = str(uuid.uuid4())
    now = datetime.now(UTC)

    async with SessionLocal() as db:
        # Verify account exists + is active
        acct = await db.execute(
            text("SELECT id, is_active FROM bank_accounts WHERE id::text = :id"),
            {"id": account_id},
        )
        rec = acct.mappings().one_or_none()
        if not rec:
            raise HTTPException(404, detail="Account not found")
        if not rec["is_active"]:
            raise HTTPException(400, detail="Account is inactive — cannot post transactions")

        await db.execute(text("""
            INSERT INTO bank_transactions (
                id, account_id, txn_date, value_date, description, counterparty,
                reference, amount, balance_after, currency, txn_type, source,
                raw_data, reconciled, notes, created_at, updated_at
            ) VALUES (
                :id, :account_id, :txn_date, :value_date, :description, :counterparty,
                :reference, :amount, :balance_after, :currency, :txn_type, 'MANUAL',
                CAST('{}' AS jsonb), false, :notes, :now, :now
            )
        """), {
            "id": new_id, "account_id": account_id,
            "txn_date": txn_date, "value_date": value_date,
            "description": body.description, "counterparty": body.counterparty,
            "reference": body.reference, "amount": amount,
            "balance_after": balance_after, "currency": body.currency,
            "txn_type": body.txn_type, "notes": body.notes, "now": now,
        })
        # Maintain current_balance — for MANUAL entries only the running
        # balance is tracked from opening + sum(amount). For statement
        # imports we'll instead use balance_after from the statement when
        # available (PR 2).
        await db.execute(text("""
            UPDATE bank_accounts
            SET    current_balance = opening_balance + COALESCE(
                       (SELECT SUM(amount) FROM bank_transactions WHERE account_id::text = :id),
                       0
                   ),
                   updated_at = :now
            WHERE  id::text = :id
        """), {"id": account_id, "now": now})
        await db.commit()
    return {"id": new_id, "success": True}


@router.put("/admin/bank-transactions/{txn_id}")
async def update_transaction(
    txn_id: str, body: TransactionUpdate, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    if not _looks_uuid(txn_id):
        raise HTTPException(400, detail="txn_id must be UUID")

    updates = body.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        return {"id": txn_id, "success": True, "no_op": True}

    err_collector: list[str] = []
    if "txn_date" in updates:
        d = _parse_date(updates["txn_date"], "txn_date", err_collector)
        updates["txn_date"] = d
    if "value_date" in updates:
        d = _parse_date(updates["value_date"], "value_date", err_collector)
        updates["value_date"] = d
    if "txn_type" in updates and updates["txn_type"] not in VALID_TXN_TYPES:
        err_collector.append(f"txn_type '{updates['txn_type']}' invalid")
    if "amount" in updates:
        a = _to_decimal(updates["amount"])
        if a is None:
            err_collector.append("amount must be a number")
        else:
            updates["amount"] = a
    if "balance_after" in updates:
        b = _to_decimal(updates["balance_after"])
        updates["balance_after"] = b
    if "reconciled_with_id" in updates and updates["reconciled_with_id"] and not _looks_uuid(updates["reconciled_with_id"]):
        err_collector.append("reconciled_with_id must be UUID")
    if err_collector:
        raise HTTPException(400, detail={"errors": err_collector})

    set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = txn_id
    updates["now"] = datetime.now(UTC)

    async with SessionLocal() as db:
        existing = await db.execute(
            text("SELECT id, account_id FROM bank_transactions WHERE id::text = :id"),
            {"id": txn_id},
        )
        rec = existing.mappings().one_or_none()
        if not rec:
            raise HTTPException(404, detail="Transaction not found")

        await db.execute(
            text(f"UPDATE bank_transactions SET {set_clauses}, updated_at = :now WHERE id::text = :id"),
            updates,
        )
        # Recompute account's current_balance if amount changed
        if "amount" in updates:
            await db.execute(text("""
                UPDATE bank_accounts
                SET    current_balance = opening_balance + COALESCE(
                           (SELECT SUM(amount) FROM bank_transactions WHERE account_id = :acc_id),
                           0
                       ),
                       updated_at = :now
                WHERE  id = :acc_id
            """), {"acc_id": rec["account_id"], "now": updates["now"]})
        await db.commit()
    return {"id": txn_id, "success": True}


@router.delete("/admin/bank-transactions/{txn_id}")
async def delete_transaction(txn_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Hard-delete a transaction. Use with care — typically only used to
    clean up duplicate / mis-imported rows. The row is gone, no
    soft-delete column."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    if not _looks_uuid(txn_id):
        raise HTTPException(400, detail="txn_id must be UUID")

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        existing = await db.execute(
            text("SELECT account_id FROM bank_transactions WHERE id::text = :id"),
            {"id": txn_id},
        )
        rec = existing.mappings().one_or_none()
        if not rec:
            raise HTTPException(404, detail="Transaction not found")
        await db.execute(
            text("DELETE FROM bank_transactions WHERE id::text = :id"),
            {"id": txn_id},
        )
        await db.execute(text("""
            UPDATE bank_accounts
            SET    current_balance = opening_balance + COALESCE(
                       (SELECT SUM(amount) FROM bank_transactions WHERE account_id = :acc_id),
                       0
                   ),
                   updated_at = :now
            WHERE  id = :acc_id
        """), {"acc_id": rec["account_id"], "now": now})
        await db.commit()
    return {"id": txn_id, "success": True}


# Re-export for the module-level _mount() in main.py (consistent with other routers)
_ = json  # silence unused-import — reserved for future raw_data handling in PR 2
