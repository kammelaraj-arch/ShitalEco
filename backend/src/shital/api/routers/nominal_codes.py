"""Nominal codes (Chart of Accounts).

UK Charity SORP-aligned chart of accounts. Each code is granular: type
(income/expense/asset/etc.), SORP fund_type + activity_type, Gift Aid +
HMRC category, VAT code + rate, external account-code mapping for
Xero / Sage / QuickBooks.

Scope semantics:
  BRANCH      — branch-specific code (branch_id required)
  HEAD_OFFICE — HQ-only code (branch_id NULL)
  BOTH        — code usable at any level (branch_id NULL by default,
                 admins can override per-branch via separate row)

Endpoints:
  GET    /admin/nominal-codes            list (filtered + paginated)
  POST   /admin/nominal-codes            create (upsert by code)
  PUT    /admin/nominal-codes/{id}       update
  DELETE /admin/nominal-codes/{id}       soft-delete (is_active=false)
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["nominal-codes"])

VALID_TYPES      = {"INCOME", "EXPENSE", "ASSET", "LIABILITY", "EQUITY"}
VALID_SCOPES     = {"BRANCH", "HEAD_OFFICE", "BOTH"}
VALID_FUND_TYPES = {"UNRESTRICTED", "RESTRICTED", "ENDOWMENT"}
VALID_ACTIVITY   = {"CHARITABLE", "TRADING", "INVESTMENT", "GOVERNANCE", "SUPPORT"}
VALID_VAT_CODES  = {"STANDARD", "REDUCED", "ZERO", "EXEMPT", "OUT_OF_SCOPE", "REVERSE_CHARGE"}
PRIVILEGED       = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "AUDITOR"}


def _require_priv(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Privileged role required")


class CodeIn(BaseModel):
    code: str = ""
    name: str
    description: str = ""
    type: str = "INCOME"
    category: str = ""
    subcategory: str = ""
    scope: str = "BOTH"
    branch_id: str | None = None
    fund_type: str = "UNRESTRICTED"
    activity_type: str = "CHARITABLE"
    gift_aid_eligible: bool = False
    hmrc_category: str = ""
    vat_code: str = "OUT_OF_SCOPE"
    vat_rate: float = 0
    xero_account_code: str = ""
    sage_nominal_code: str = ""
    quickbooks_account: str = ""
    parent_code_id: str | None = None
    sort_order: int = 100
    is_active: bool = True
    notes: str = ""


def _row(r: Any) -> dict[str, Any]:
    d = dict(r)
    for k in ("id", "parent_code_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    for k in ("created_at", "updated_at"):
        if d.get(k) is not None and hasattr(d[k], "isoformat"):
            d[k] = d[k].isoformat()
    if d.get("vat_rate") is not None:
        try:
            d["vat_rate"] = float(d["vat_rate"])
        except (TypeError, ValueError):
            d["vat_rate"] = 0.0
    return d


def _validate(body: CodeIn, errs: list[str]) -> None:
    if not body.name.strip():
        errs.append("name is required")
    if body.type not in VALID_TYPES:
        errs.append(f"type must be one of: {sorted(VALID_TYPES)}")
    if body.scope not in VALID_SCOPES:
        errs.append(f"scope must be one of: {sorted(VALID_SCOPES)}")
    if body.fund_type not in VALID_FUND_TYPES:
        errs.append(f"fund_type must be one of: {sorted(VALID_FUND_TYPES)}")
    if body.activity_type not in VALID_ACTIVITY:
        errs.append(f"activity_type must be one of: {sorted(VALID_ACTIVITY)}")
    if body.vat_code not in VALID_VAT_CODES:
        errs.append(f"vat_code must be one of: {sorted(VALID_VAT_CODES)}")
    if body.scope == "BRANCH" and not (body.branch_id or "").strip():
        errs.append("branch_id is required when scope=BRANCH")


@router.get("/admin/nominal-codes")
async def list_codes(
    ctx: CurrentSpace,
    type: str | None = None,
    category: str | None = None,
    scope: str | None = None,
    branch_id: str = "",
    active: bool | None = None,
    search: str = "",
    page: int = 1,
    per_page: int = 100,
) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {
        "limit": max(1, min(per_page, 500)),
        "offset": max(0, (page - 1) * per_page),
    }
    if type:
        where.append("type = :type"); params["type"] = type
    if category:
        where.append("category = :cat"); params["cat"] = category
    if scope:
        where.append("scope = :scope"); params["scope"] = scope
    if branch_id:
        # Branch filter shows both branch-specific AND HEAD_OFFICE/BOTH so
        # the per-branch view shows everything that branch can use.
        where.append("(branch_id = :bid OR branch_id IS NULL)")
        params["bid"] = branch_id
    if active is True:
        where.append("is_active = true")
    elif active is False:
        where.append("is_active = false")
    if search.strip():
        where.append("(LOWER(code) LIKE :q OR LOWER(name) LIKE :q OR LOWER(description) LIKE :q)")
        params["q"] = f"%{search.strip().lower()}%"
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT * FROM nominal_codes {where_sql}
            ORDER BY sort_order, code
            LIMIT :limit OFFSET :offset
        """), params)).mappings().all()
        total = (await db.execute(
            text(f"SELECT COUNT(*) AS cnt FROM nominal_codes {where_sql}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).mappings().first()

    return {
        "items":    [_row(r) for r in rows],
        "total":    int(total["cnt"]) if total else 0,
        "page":     page,
        "per_page": per_page,
    }


@router.post("/admin/nominal-codes", status_code=201)
async def create_code(body: CodeIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_priv(ctx)
    errs: list[str] = []
    code = (body.code or "").strip().upper()
    if not code:
        errs.append("code is required")
    _validate(body, errs)
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(text("""
            INSERT INTO nominal_codes
                (code, name, description, type, category, subcategory,
                 scope, branch_id, fund_type, activity_type,
                 gift_aid_eligible, hmrc_category, vat_code, vat_rate,
                 xero_account_code, sage_nominal_code, quickbooks_account,
                 parent_code_id, sort_order, is_active, notes)
            VALUES (:code,:name,:desc,:type,:cat,:subcat,
                    :scope,:bid,:fund,:act,
                    :ga,:hmrc,:vatc,:vatr,
                    :xero,:sage,:qb,
                    :parent,:sort,:active,:notes)
            ON CONFLICT (code) DO UPDATE SET
                name              = EXCLUDED.name,
                description       = EXCLUDED.description,
                type              = EXCLUDED.type,
                category          = EXCLUDED.category,
                subcategory       = EXCLUDED.subcategory,
                scope             = EXCLUDED.scope,
                branch_id         = EXCLUDED.branch_id,
                fund_type         = EXCLUDED.fund_type,
                activity_type     = EXCLUDED.activity_type,
                gift_aid_eligible = EXCLUDED.gift_aid_eligible,
                hmrc_category     = EXCLUDED.hmrc_category,
                vat_code          = EXCLUDED.vat_code,
                vat_rate          = EXCLUDED.vat_rate,
                xero_account_code = EXCLUDED.xero_account_code,
                sage_nominal_code = EXCLUDED.sage_nominal_code,
                quickbooks_account= EXCLUDED.quickbooks_account,
                parent_code_id    = EXCLUDED.parent_code_id,
                sort_order        = EXCLUDED.sort_order,
                is_active         = EXCLUDED.is_active,
                notes             = EXCLUDED.notes,
                updated_at        = NOW()
            RETURNING *
        """), {
            "code": code, "name": body.name.strip(), "desc": body.description,
            "type": body.type, "cat": body.category, "subcat": body.subcategory,
            "scope": body.scope, "bid": body.branch_id or None,
            "fund": body.fund_type, "act": body.activity_type,
            "ga": body.gift_aid_eligible, "hmrc": body.hmrc_category,
            "vatc": body.vat_code, "vatr": float(body.vat_rate or 0),
            "xero": body.xero_account_code, "sage": body.sage_nominal_code,
            "qb": body.quickbooks_account,
            "parent": body.parent_code_id or None,
            "sort": int(body.sort_order), "active": bool(body.is_active),
            "notes": body.notes,
        })
        row = result.mappings().first()
        await db.commit()
    return _row(row) if row else {}


@router.put("/admin/nominal-codes/{code_id}")
async def update_code(code_id: str, body: CodeIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_priv(ctx)
    errs: list[str] = []
    _validate(body, errs)
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE nominal_codes SET
                name              = :name,
                description       = :desc,
                type              = :type,
                category          = :cat,
                subcategory       = :subcat,
                scope             = :scope,
                branch_id         = :bid,
                fund_type         = :fund,
                activity_type     = :act,
                gift_aid_eligible = :ga,
                hmrc_category     = :hmrc,
                vat_code          = :vatc,
                vat_rate          = :vatr,
                xero_account_code = :xero,
                sage_nominal_code = :sage,
                quickbooks_account= :qb,
                parent_code_id    = :parent,
                sort_order        = :sort,
                is_active         = :active,
                notes             = :notes,
                updated_at        = NOW()
            WHERE id = :id
            RETURNING *
        """), {
            "id": code_id, "name": body.name.strip(), "desc": body.description,
            "type": body.type, "cat": body.category, "subcat": body.subcategory,
            "scope": body.scope, "bid": body.branch_id or None,
            "fund": body.fund_type, "act": body.activity_type,
            "ga": body.gift_aid_eligible, "hmrc": body.hmrc_category,
            "vatc": body.vat_code, "vatr": float(body.vat_rate or 0),
            "xero": body.xero_account_code, "sage": body.sage_nominal_code,
            "qb": body.quickbooks_account,
            "parent": body.parent_code_id or None,
            "sort": int(body.sort_order), "active": bool(body.is_active),
            "notes": body.notes,
        })
        row = result.mappings().first()
        if not row:
            raise HTTPException(404, detail="Nominal code not found")
        await db.commit()
    return _row(row)


@router.delete("/admin/nominal-codes/{code_id}", status_code=204)
async def deactivate_code(code_id: str, ctx: CurrentSpace) -> None:
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        r = await db.execute(
            text("UPDATE nominal_codes SET is_active=false, updated_at=NOW() WHERE id=:id RETURNING id"),
            {"id": code_id},
        )
        if not r.scalar():
            raise HTTPException(404, detail="Nominal code not found")
        await db.commit()
