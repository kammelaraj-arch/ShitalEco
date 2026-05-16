"""General Ledger router (Phase 2).

Read/post API over the existing `transactions` + `transaction_lines` tables
extended in Phase 2 with nominal_code + fund + project + source linkage.

Endpoints
    GET   /admin/gl/journal                    — list entries (filter + page)
    GET   /admin/gl/journal/{id}               — header + lines
    POST  /admin/gl/journal                    — manual posting (balanced)
    POST  /admin/gl/journal/{id}/reverse       — create reversing entry
    GET   /admin/gl/trial-balance              — sum debits/credits per code
                                                  (filter: branch, fund, date range)
    GET   /admin/gl/audit/{source_type}/{id}   — all entries for a source doc
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace
from shital.services import gl

router = APIRouter(tags=["gl"])

PRIVILEGED = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "AUDITOR"}
WRITERS    = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT"}


def _require_read(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Privileged role required")


def _require_write(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in WRITERS:
        raise HTTPException(403, detail="Write role required")


def _row(r: Any) -> dict[str, Any]:
    if r is None:
        return {}
    from datetime import date, datetime
    out: dict[str, Any] = {}
    for k, v in dict(r).items():
        if isinstance(v, UUID):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif hasattr(v, "normalize"):  # Decimal
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                out[k] = str(v)
        else:
            out[k] = v
    return out


class LineIn(BaseModel):
    nominal_code: str
    debit: float = 0
    credit: float = 0
    description: str = ""
    fund_type: str = ""
    project_id: str | None = None
    branch_id: str = ""


class JournalIn(BaseModel):
    branch_id: str = "main"
    entry_date: str = ""           # YYYY-MM-DD; defaults to today
    description: str
    reference: str = ""
    fund_type: str = "UNRESTRICTED"
    project_id: str | None = None
    lines: list[LineIn] = Field(default_factory=list)


# ─── List ───────────────────────────────────────────────────────────────────

@router.get("/admin/gl/journal")
async def list_journal(
    ctx: CurrentSpace,
    branch_id: str = "",
    source_type: str = "",
    fund_type: str = "",
    project_id: str = "",
    from_date: str = "",
    to_date: str = "",
    search: str = "",
    page: int = 1,
    per_page: int = 25,
) -> dict[str, Any]:
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = ["t.deleted_at IS NULL"]
    params: dict[str, Any] = {
        "limit":  max(1, min(per_page, 200)),
        "offset": max(0, (page - 1) * per_page),
    }
    if branch_id.strip():
        where.append("t.branch_id = :bid")
        params["bid"] = branch_id.strip()
    if source_type.strip():
        where.append("t.source_type = :st")
        params["st"] = source_type.strip()
    if fund_type.strip():
        where.append("t.fund_type = :ft")
        params["ft"] = fund_type.strip()
    if project_id.strip():
        where.append("t.project_id = :pid")
        params["pid"] = project_id.strip()
    if from_date.strip():
        where.append("t.date >= :fd")
        params["fd"] = from_date.strip()
    if to_date.strip():
        where.append("t.date <= :td")
        params["td"] = to_date.strip()
    if search.strip():
        where.append("(LOWER(t.reference) LIKE :q OR LOWER(t.description) LIKE :q)")
        params["q"] = f"%{search.strip().lower()}%"

    sql_where = " AND ".join(where)

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT t.id, t.branch_id, t.reference, t.description, t.date,
                   t.total_amount, t.currency, t.status, t.source_type, t.source_id,
                   t.reversal_of, t.fund_type, t.project_id,
                   t.posted_by, t.posted_at, t.created_at
            FROM   transactions t
            WHERE  {sql_where}
            ORDER  BY t.date DESC, t.posted_at DESC NULLS LAST
            LIMIT  :limit OFFSET :offset
        """), params)).mappings().all()
        total = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM transactions t WHERE {sql_where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).scalar() or 0

    return {
        "items":    [_row(r) for r in rows],
        "total":    int(total),
        "page":     page,
        "per_page": per_page,
    }


@router.get("/admin/gl/journal/{txn_id}")
async def get_journal(txn_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        header = (await db.execute(text("""
            SELECT * FROM transactions WHERE id = :id
        """), {"id": txn_id})).mappings().first()
        if not header:
            raise HTTPException(404, detail="Journal entry not found")
        lines = (await db.execute(text("""
            SELECT tl.*, nc.code AS code, nc.name AS code_name, nc.type AS code_type
            FROM   transaction_lines tl
            LEFT JOIN nominal_codes nc ON nc.id = tl.nominal_code_id
            WHERE  tl.transaction_id = :id
            ORDER  BY tl.created_at
        """), {"id": txn_id})).mappings().all()
    out = _row(header)
    out["lines"] = [_row(line) for line in lines]
    return out


@router.post("/admin/gl/journal", status_code=201)
async def post_journal(body: JournalIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_write(ctx)
    if not body.description.strip():
        raise HTTPException(400, detail="description is required")
    if not body.lines:
        raise HTTPException(400, detail="at least one line is required")

    from datetime import UTC, datetime

    from shital.core.fabrics.database import SessionLocal

    entry_date = (body.entry_date or "").strip() or datetime.now(UTC).date().isoformat()
    posted_by  = (getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or "")

    try:
        async with SessionLocal() as db:
            txn_id = await gl.post(
                db,
                branch_id=(body.branch_id or "main").strip(),
                entry_date=entry_date,
                description=body.description.strip(),
                reference=body.reference,
                fund_type=body.fund_type or "UNRESTRICTED",
                project_id=body.project_id or None,
                source_type=gl.SOURCE_MANUAL,
                posted_by=posted_by,
                lines=[{
                    "nominal_code": ln.nominal_code,
                    "debit": ln.debit, "credit": ln.credit,
                    "description": ln.description,
                    "fund_type": ln.fund_type or body.fund_type,
                    "project_id": ln.project_id or body.project_id or None,
                    "branch_id": ln.branch_id or body.branch_id,
                } for ln in body.lines],
            )
            await db.commit()
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc)) from exc

    return await get_journal(txn_id, ctx)


@router.post("/admin/gl/journal/{txn_id}/reverse")
async def reverse_journal(txn_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_write(ctx)
    from shital.core.fabrics.database import SessionLocal

    posted_by = getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or ""
    try:
        async with SessionLocal() as db:
            new_id = await gl.reverse(db, original_txn_id=txn_id, posted_by=posted_by)
            await db.commit()
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc)) from exc
    return await get_journal(new_id, ctx)


# ─── Trial balance ──────────────────────────────────────────────────────────

@router.get("/admin/gl/trial-balance")
async def trial_balance(
    ctx: CurrentSpace,
    branch_id: str = "",
    fund_type: str = "",
    from_date: str = "",
    to_date: str = "",
) -> dict[str, Any]:
    """Sum debits + credits per nominal code (POSTED entries only).

    Filters compose so a trustee can view eg.
    'restricted funds at Wembley between Apr and Sep'.
    Always returns nominal_codes that have NO movement too — so the
    chart-of-accounts coverage is visible (Trustees can spot codes
    that were set up but never used)."""
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = ["t.status = 'POSTED'", "t.deleted_at IS NULL"]
    params: dict[str, Any] = {}
    if branch_id.strip():
        where.append("tl.branch_id = :bid")
        params["bid"] = branch_id.strip()
    if fund_type.strip():
        where.append("tl.fund_type = :ft")
        params["ft"] = fund_type.strip()
    if from_date.strip():
        where.append("t.date >= :fd")
        params["fd"] = from_date.strip()
    if to_date.strip():
        where.append("t.date <= :td")
        params["td"] = to_date.strip()
    sql_where = " AND ".join(where)

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT nc.id, nc.code, nc.name, nc.type, nc.category, nc.fund_type AS code_fund,
                   COALESCE(SUM(tl.debit_amount),  0) AS total_debit,
                   COALESCE(SUM(tl.credit_amount), 0) AS total_credit
            FROM   nominal_codes nc
            LEFT JOIN transaction_lines tl ON tl.nominal_code_id = nc.id
            LEFT JOIN transactions      t  ON t.id = tl.transaction_id
                                          AND {sql_where}
            WHERE  nc.is_active = true
            GROUP  BY nc.id, nc.code, nc.name, nc.type, nc.category, nc.fund_type
            ORDER  BY nc.code
        """), params)).mappings().all()

    total_dr = 0.0
    total_cr = 0.0
    items: list[dict[str, Any]] = []
    for r in rows:
        d = float(r["total_debit"] or 0)
        c = float(r["total_credit"] or 0)
        total_dr += d
        total_cr += c
        items.append({
            "id":           str(r["id"]),
            "code":         r["code"],
            "name":         r["name"],
            "type":         r["type"],
            "category":     r["category"],
            "code_fund":    r["code_fund"],
            "total_debit":  round(d, 2),
            "total_credit": round(c, 2),
            "balance":      round(d - c, 2),
        })
    return {
        "items":        items,
        "total_debit":  round(total_dr, 2),
        "total_credit": round(total_cr, 2),
        "is_balanced":  abs(total_dr - total_cr) < 0.005,
        "filters":      {"branch_id": branch_id, "fund_type": fund_type,
                         "from_date": from_date, "to_date": to_date},
    }


# ─── Source-document audit trail ────────────────────────────────────────────

@router.get("/admin/gl/audit/{source_type}/{source_id}")
async def source_audit(source_type: str, source_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """All journal entries posted against a given upstream document.
    eg. /admin/gl/audit/po_receive/{po_id} returns every GL entry the
    PO receipt event(s) generated, including any reversals."""
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        headers = (await db.execute(text("""
            SELECT id, reference, description, date, total_amount,
                   source_type, source_id, reversal_of, posted_by, posted_at
            FROM   transactions
            WHERE  (source_type = :st AND source_id = :sid)
               OR  reversal_of IN (
                     SELECT id FROM transactions WHERE source_type = :st AND source_id = :sid
                   )
            ORDER  BY posted_at NULLS LAST, created_at
        """), {"st": source_type, "sid": source_id})).mappings().all()
    return {"source_type": source_type, "source_id": source_id,
            "entries": [_row(h) for h in headers]}
