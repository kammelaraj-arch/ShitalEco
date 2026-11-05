"""Finance accounts — bank, Stripe, SumUp, Temple Safe, Hundi, cash, …

Companion to the payment_transactions ledger. Every real-world money
container finance needs to track lives here. account_type is a free
text slug (BANK / STRIPE / SUMUP / PAYPAL / SAFE / HUNDI / CASH /
OTHER / anything the operator wants) so new categories can be added
without a code change.

Endpoints — /admin/finance/accounts
  GET    /                       filterable list (admin JWT)
  POST   /                       create
  GET    /{id}
  PUT    /{id}                   update
  DELETE /{id}                   soft-delete (deleted_at)
  GET    /types                  distinct account_type slugs seen so far
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/admin/finance", tags=["finance", "finance-accounts"])


DEFAULT_TYPES = ["BANK", "STRIPE", "SUMUP", "PAYPAL", "SAFE", "HUNDI", "CASH", "OTHER"]


def _only_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="ADMIN required")


class _AccountIn(BaseModel):
    name:            str = Field(min_length=1, max_length=200)
    account_type:    str = "OTHER"
    branch_id:       str = ""
    currency:        str = "GBP"
    external_ref:    str = ""
    opening_balance: float = 0
    notes:           str = ""
    is_active:       bool = True
    sort_order:      int = 100


def _row(r: Any) -> dict[str, Any]:
    def _iso(v: Any) -> str:
        return v.isoformat() if v and hasattr(v, "isoformat") else ""
    return {
        "id":               str(r["id"]),
        "name":             r["name"],
        "account_type":     (r["account_type"] or "OTHER").upper(),
        "branch_id":        r["branch_id"] or "",
        "currency":         r["currency"] or "GBP",
        "external_ref":     r["external_ref"] or "",
        "opening_balance":  float(r["opening_balance"] or 0),
        "notes":            r["notes"] or "",
        "is_active":        bool(r["is_active"]),
        "sort_order":       int(r["sort_order"] or 100),
        "created_at":       _iso(r["created_at"]),
        "updated_at":       _iso(r["updated_at"]),
    }


@router.get("/accounts")
async def list_accounts(
    ctx: CurrentSpace,
    include_inactive: bool = False,
    account_type: str = "",
    branch_id: str = "",
    search: str = "",
) -> dict[str, Any]:
    _only_admin(ctx)
    where = ["deleted_at IS NULL"]
    params: dict[str, Any] = {}
    if not include_inactive:
        where.append("is_active = true")
    if account_type:
        where.append("UPPER(account_type) = :t")
        params["t"] = account_type.strip().upper()
    if branch_id:
        where.append("branch_id = :b")
        params["b"] = branch_id
    if search:
        where.append("(LOWER(name) LIKE :q OR LOWER(external_ref) LIKE :q)")
        params["q"] = f"%{search.lower()}%"
    clause = " AND ".join(where)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id, name, account_type, branch_id, currency, external_ref,
                   opening_balance, notes, is_active, sort_order,
                   created_at, updated_at
              FROM finance_accounts
             WHERE {clause}
             ORDER BY sort_order ASC, name ASC
        """), params)).mappings().all()
    return {"items": [_row(r) for r in rows]}


@router.get("/accounts/types")
async def account_types(ctx: CurrentSpace) -> dict[str, Any]:
    _only_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT DISTINCT UPPER(account_type) AS t
              FROM finance_accounts
             WHERE deleted_at IS NULL AND account_type <> ''
             ORDER BY t
        """))).scalars().all()
    merged: list[str] = []
    seen: set[str] = set()
    for t in list(DEFAULT_TYPES) + list(rows):
        if t and t not in seen:
            seen.add(t)
            merged.append(t)
    return {"items": merged}


@router.post("/accounts")
async def create_account(ctx: CurrentSpace, body: _AccountIn) -> dict[str, Any]:
    _only_admin(ctx)
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        try:
            await db.execute(text("""
                INSERT INTO finance_accounts
                    (id, name, account_type, branch_id, currency, external_ref,
                     opening_balance, notes, is_active, sort_order)
                VALUES
                    (:id, :name, :type, :branch, :cur, :ref,
                     :opening, :notes, :active, :sort)
            """), {
                "id":      new_id,
                "name":    body.name.strip(),
                "type":    (body.account_type or "OTHER").strip().upper(),
                "branch":  body.branch_id or "",
                "cur":     (body.currency or "GBP").strip().upper(),
                "ref":     body.external_ref or "",
                "opening": body.opening_balance or 0,
                "notes":   body.notes or "",
                "active":  bool(body.is_active),
                "sort":    int(body.sort_order or 100),
            })
            await db.commit()
        except Exception as exc:
            msg = str(exc).lower()
            if "duplicate" in msg or "unique" in msg:
                raise HTTPException(status_code=409, detail="An account with that name already exists for this branch") from exc
            raise
        r = (await db.execute(text("""
            SELECT id, name, account_type, branch_id, currency, external_ref,
                   opening_balance, notes, is_active, sort_order,
                   created_at, updated_at
              FROM finance_accounts WHERE id = :id
        """), {"id": new_id})).mappings().first()
    if r is None:
        raise HTTPException(status_code=500, detail="Insert succeeded but row missing")
    return {"account": _row(r)}


@router.get("/accounts/{aid}")
async def get_account(ctx: CurrentSpace, aid: str) -> dict[str, Any]:
    _only_admin(ctx)
    try:
        uuid.UUID(aid)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Account not found")
    async with SessionLocal() as db:
        r = (await db.execute(text("""
            SELECT id, name, account_type, branch_id, currency, external_ref,
                   opening_balance, notes, is_active, sort_order,
                   created_at, updated_at
              FROM finance_accounts WHERE id = :id AND deleted_at IS NULL
        """), {"id": aid})).mappings().first()
    if r is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"account": _row(r)}


@router.put("/accounts/{aid}")
async def update_account(ctx: CurrentSpace, aid: str, body: _AccountIn) -> dict[str, Any]:
    _only_admin(ctx)
    try:
        uuid.UUID(aid)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Account not found")
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE finance_accounts SET
              name = :name, account_type = :type, branch_id = :branch,
              currency = :cur, external_ref = :ref,
              opening_balance = :opening, notes = :notes,
              is_active = :active, sort_order = :sort,
              updated_at = NOW()
            WHERE id = :id AND deleted_at IS NULL
        """), {
            "id":      aid,
            "name":    body.name.strip(),
            "type":    (body.account_type or "OTHER").strip().upper(),
            "branch":  body.branch_id or "",
            "cur":     (body.currency or "GBP").strip().upper(),
            "ref":     body.external_ref or "",
            "opening": body.opening_balance or 0,
            "notes":   body.notes or "",
            "active":  bool(body.is_active),
            "sort":    int(body.sort_order or 100),
        })
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Account not found")
        await db.commit()
        r = (await db.execute(text("""
            SELECT id, name, account_type, branch_id, currency, external_ref,
                   opening_balance, notes, is_active, sort_order,
                   created_at, updated_at
              FROM finance_accounts WHERE id = :id
        """), {"id": aid})).mappings().first()
    if r is None:
        raise HTTPException(status_code=500, detail="Update succeeded but row missing")
    return {"account": _row(r)}


@router.delete("/accounts/{aid}")
async def delete_account(ctx: CurrentSpace, aid: str) -> dict[str, Any]:
    _only_admin(ctx)
    try:
        uuid.UUID(aid)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Account not found")
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE finance_accounts
               SET deleted_at = NOW(), is_active = false, updated_at = NOW()
             WHERE id = :id AND deleted_at IS NULL
        """), {"id": aid})
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Account not found")
        await db.commit()
    return {"ok": True}


__all__ = ["router"]
