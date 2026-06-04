"""Project costing (Phase 4).

Project P&L over the existing `projects` table (extended in Phase 4 with
status/type/fund/budget_amount/manager/sponsor) and the existing
`transaction_lines.project_id` column (added in Phase 2). No new
expense/income tables — everything posts through the GL and the project
report just slices the ledger.

Endpoints
    GET    /admin/projects                 — list with filters
    POST   /admin/projects                 — create
    GET    /admin/projects/{id}            — header
    PUT    /admin/projects/{id}            — update
    POST   /admin/projects/{id}/status     — change lifecycle status
    DELETE /admin/projects/{id}            — soft-deactivate (is_active=false)
    GET    /admin/projects/{id}/p-and-l    — income/expense/net + per-code
                                              breakdown for this project
    GET    /admin/projects/{id}/timeline   — GL entries posted against
                                              this project, newest first
    GET    /admin/projects/dashboard       — multi-project rollup
"""
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["project-costing"])

VALID_STATUSES = {"DRAFT", "ACTIVE", "PLANNING", "ON_HOLD", "COMPLETED", "CANCELLED"}
# Project type drives approval rules + which financial reports the project
# rolls into. Anything not in this set is rejected at create / update.
# Keep in sync with apps/admin/src/app/(portal)/finance/projects/page.tsx
# and apps/admin/src/app/(portal)/help/glossary/page.tsx.
VALID_TYPES = {
    "GENERAL",          # default catch-all
    "CAPITAL",          # buildings, equipment, long-life assets
    "OPERATIONAL",      # day-to-day running improvements
    "RESTRICTED_FUND",  # donor-restricted programme
    "EVENT",            # one-off time-bounded occasion
    "FUNDRAISING",      # campaign to raise money
    "GRANT",            # externally funded with reporting obligations
    "OUTREACH",         # charitable programme delivered to beneficiaries
    "TECHNOLOGY",       # software / digital infrastructure work
    "MAINTENANCE",      # repairs, upkeep, BAU fixes
    "TRAINING",         # staff / volunteer skill development
    "MARKETING",        # awareness, comms, campaigns (non-fundraising)
    "RESEARCH",         # studies, feasibility, surveys
    "PARTNERSHIP",      # joint initiative with another org
    "EMERGENCY",        # urgent response (e.g. disaster relief)
    "COMPLIANCE",       # audit, regulatory, governance
}
VALID_FUNDS    = {"UNRESTRICTED", "RESTRICTED", "ENDOWMENT"}
PRIVILEGED     = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "AUDITOR"}
WRITERS        = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT"}


def _require_read(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Privileged role required")


def _require_write(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in WRITERS:
        raise HTTPException(403, detail="Write role required")


def _row(r: Any) -> dict[str, Any]:
    if r is None:
        return {}
    out: dict[str, Any] = {}
    for k, v in dict(r).items():
        if isinstance(v, UUID):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif hasattr(v, "normalize"):
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                out[k] = str(v)
        else:
            out[k] = v
    return out


class ProjectIn(BaseModel):
    project_id: str = ""             # short code (eg. 'CAPITAL_2026'); auto if blank
    name: str
    description: str = ""
    branch_id: str = "main"
    project_type: str = "GENERAL"
    status: str = "ACTIVE"
    fund_type: str = "UNRESTRICTED"
    goal_amount: float = 0
    budget_amount: float = 0
    image_url: str = ""
    start_date: str = ""
    end_date: str = ""
    manager_user_id: str | None = None
    sponsor_contact_id: str | None = None
    reference: str = ""
    notes: str = ""


class StatusIn(BaseModel):
    status: str


# ─── CRUD ───────────────────────────────────────────────────────────────────

@router.get("/admin/projects")
async def list_projects(
    ctx: CurrentSpace,
    branch_id: str = "",
    status: str = "",
    project_type: str = "",
    fund_type: str = "",
    active: bool | None = None,
    search: str = "",
    page: int = 1,
    per_page: int = 50,
) -> dict[str, Any]:
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {
        "limit":  max(1, min(per_page, 200)),
        "offset": max(0, (page - 1) * per_page),
    }
    if branch_id.strip():
        where.append("branch_id = :bid")
        params["bid"] = branch_id.strip()
    if status.strip():
        where.append("status = :st")
        params["st"] = status.strip().upper()
    if project_type.strip():
        where.append("project_type = :pt")
        params["pt"] = project_type.strip().upper()
    if fund_type.strip():
        where.append("fund_type = :ft")
        params["ft"] = fund_type.strip().upper()
    if active is True:
        where.append("is_active = true")
    elif active is False:
        where.append("is_active = false")
    if search.strip():
        where.append("(LOWER(project_id) LIKE :q OR LOWER(name) LIKE :q OR LOWER(reference) LIKE :q)")
        params["q"] = f"%{search.strip().lower()}%"
    sql_where = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT * FROM projects {sql_where}
            ORDER BY sort_order, created_at DESC
            LIMIT :limit OFFSET :offset
        """), params)).mappings().all()
        total = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM projects {sql_where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).scalar() or 0
    return {
        "items":    [_row(r) for r in rows],
        "total":    int(total),
        "page":     page,
        "per_page": per_page,
    }


@router.post("/admin/projects", status_code=201)
async def create_project(body: ProjectIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_write(ctx)
    if body.status and body.status not in VALID_STATUSES:
        raise HTTPException(400, detail=f"status must be one of {sorted(VALID_STATUSES)}")
    if body.project_type and body.project_type not in VALID_TYPES:
        raise HTTPException(400, detail=f"project_type must be one of {sorted(VALID_TYPES)}")
    if body.fund_type and body.fund_type not in VALID_FUNDS:
        raise HTTPException(400, detail=f"fund_type must be one of {sorted(VALID_FUNDS)}")
    if not body.name.strip():
        raise HTTPException(400, detail="name is required")

    import uuid as _u

    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    from shital.core.fabrics.database import SessionLocal
    short = (body.project_id or "").strip().upper() or f"P-{_u.uuid4().hex[:8].upper()}"
    start = date.fromisoformat(body.start_date) if body.start_date else None
    end   = date.fromisoformat(body.end_date)   if body.end_date   else None
    now = datetime.now(UTC)

    async with SessionLocal() as db:
        try:
            row = (await db.execute(text("""
                INSERT INTO projects
                    (project_id, name, description, branch_id, project_type, status,
                     fund_type, goal_amount, budget_amount, image_url,
                     start_date, end_date, manager_user_id, sponsor_contact_id,
                     reference, notes, is_active, created_at, updated_at)
                VALUES
                    (:pid, :name, :desc, :bid, :pt, :st,
                     :ft, :goal, :budget, :img,
                     :start, :end, :mgr, :spons,
                     :ref, :notes, true, :now, :now)
                RETURNING *
            """), {
                "pid": short, "name": body.name.strip(), "desc": body.description,
                "bid": (body.branch_id or "main").strip(),
                "pt":  body.project_type.upper(), "st": body.status.upper(),
                "ft":  body.fund_type.upper(),
                "goal":   round(float(body.goal_amount), 2),
                "budget": round(float(body.budget_amount), 2),
                "img":  body.image_url, "start": start, "end": end,
                "mgr":  body.manager_user_id or None,
                "spons": body.sponsor_contact_id or None,
                "ref":  body.reference, "notes": body.notes, "now": now,
            })).mappings().first()
        except IntegrityError as exc:
            raise HTTPException(409, detail=f"Project ID '{short}' already exists") from exc
        await db.commit()
    return _row(row)


@router.get("/admin/projects/{project_uuid}")
async def get_project(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT * FROM projects WHERE id = :id"), {"id": project_uuid},
        )).mappings().first()
    if not row:
        raise HTTPException(404, detail="Project not found")
    return _row(row)


@router.put("/admin/projects/{project_uuid}")
async def update_project(project_uuid: str, body: ProjectIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    start = date.fromisoformat(body.start_date) if body.start_date else None
    end   = date.fromisoformat(body.end_date)   if body.end_date   else None
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE projects SET
                name            = :name,
                description     = :desc,
                branch_id       = :bid,
                project_type    = :pt,
                status          = :st,
                fund_type       = :ft,
                goal_amount     = :goal,
                budget_amount   = :budget,
                image_url       = :img,
                start_date      = :start,
                end_date        = :end,
                manager_user_id = :mgr,
                sponsor_contact_id = :spons,
                reference       = :ref,
                notes           = :notes,
                updated_at      = NOW()
            WHERE id = :id
        """), {
            "id":   project_uuid, "name": body.name.strip(), "desc": body.description,
            "bid":  body.branch_id, "pt": body.project_type.upper(),
            "st":   body.status.upper(), "ft": body.fund_type.upper(),
            "goal": round(float(body.goal_amount), 2),
            "budget": round(float(body.budget_amount), 2),
            "img":  body.image_url, "start": start, "end": end,
            "mgr":  body.manager_user_id or None,
            "spons": body.sponsor_contact_id or None,
            "ref":  body.reference, "notes": body.notes,
        })
        await db.commit()
    return await get_project(project_uuid, ctx)


@router.post("/admin/projects/{project_uuid}/status")
async def set_status(project_uuid: str, body: StatusIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_write(ctx)
    if body.status.upper() not in VALID_STATUSES:
        raise HTTPException(400, detail=f"status must be one of {sorted(VALID_STATUSES)}")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE projects SET status = :st, updated_at = NOW() WHERE id = :id
        """), {"st": body.status.upper(), "id": project_uuid})
        await db.commit()
    return await get_project(project_uuid, ctx)


@router.delete("/admin/projects/{project_uuid}", status_code=204)
async def deactivate(project_uuid: str, ctx: CurrentSpace) -> None:
    """Soft-deactivate. Hard delete is intentionally not exposed —
    transaction_lines reference the UUID for FY-end reporting."""
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE projects SET is_active = false, updated_at = NOW() WHERE id = :id
        """), {"id": project_uuid})
        await db.commit()


# ─── P&L and timeline ───────────────────────────────────────────────────────

@router.get("/admin/projects/{project_uuid}/p-and-l")
async def project_p_and_l(project_uuid: str, ctx: CurrentSpace,
                          from_date: str = "", to_date: str = "") -> dict[str, Any]:
    """Income / Expense / Net for one project, with per-nominal breakdown.

    Income / Expense come from POSTED transaction_lines where
    project_id = this project. INCOME codes: cr - dr. EXPENSE codes:
    dr - cr. Date window defaults to the project's start_date /
    end_date (or unbounded if those are NULL)."""
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        project = (await db.execute(
            text("SELECT * FROM projects WHERE id = :id"), {"id": project_uuid},
        )).mappings().first()
        if not project:
            raise HTTPException(404, detail="Project not found")

        params: dict[str, Any] = {"pid": project_uuid}
        date_clauses: list[str] = []
        if from_date.strip():
            date_clauses.append("t.date >= :fd")
            params["fd"] = from_date.strip()
        elif project["start_date"]:
            date_clauses.append("t.date >= :fd")
            params["fd"] = project["start_date"]
        if to_date.strip():
            date_clauses.append("t.date <= :td")
            params["td"] = to_date.strip()
        elif project["end_date"]:
            date_clauses.append("t.date <= :td")
            params["td"] = project["end_date"]
        date_sql = (" AND " + " AND ".join(date_clauses)) if date_clauses else ""

        rows = (await db.execute(text(f"""
            SELECT nc.id   AS code_id,
                   nc.code AS code,
                   nc.name AS code_name,
                   nc.type AS code_type,
                   COALESCE(SUM(tl.debit_amount), 0)  AS dr,
                   COALESCE(SUM(tl.credit_amount), 0) AS cr
            FROM   transaction_lines tl
            JOIN   nominal_codes nc ON nc.id = tl.nominal_code_id
            JOIN   transactions  t  ON t.id  = tl.transaction_id
            WHERE  tl.project_id = :pid
              AND  t.status = 'POSTED'
              AND  t.deleted_at IS NULL
              {date_sql}
            GROUP  BY nc.id, nc.code, nc.name, nc.type
            ORDER  BY nc.type, nc.code
        """), params)).mappings().all()

    total_income = 0.0
    total_expense = 0.0
    items: list[dict[str, Any]] = []
    for r in rows:
        dr = float(r["dr"] or 0)
        cr = float(r["cr"] or 0)
        code_type = r["code_type"] or "EXPENSE"
        if code_type == "INCOME":
            amt = round(cr - dr, 2)
            total_income += amt
        else:
            amt = round(dr - cr, 2)
            if code_type == "EXPENSE":
                total_expense += amt
        items.append({
            "code_id":   str(r["code_id"]),
            "code":      r["code"],
            "code_name": r["code_name"],
            "code_type": code_type,
            "amount":    amt,
        })

    budget_amt = float(project["budget_amount"] or 0)
    goal_amt   = float(project["goal_amount"] or 0)
    return {
        "project":        _row(project),
        "items":          items,
        "total_income":   round(total_income, 2),
        "total_expense":  round(total_expense, 2),
        "net":            round(total_income - total_expense, 2),
        "budget_amount":  budget_amt,
        "budget_pct_used": round((total_expense / budget_amt * 100), 1) if budget_amt else 0.0,
        "goal_pct_raised": round((total_income / goal_amt * 100), 1) if goal_amt else 0.0,
    }


@router.get("/admin/projects/{project_uuid}/timeline")
async def project_timeline(project_uuid: str, ctx: CurrentSpace,
                           limit: int = 100) -> dict[str, Any]:
    """All POSTED GL entries posted against this project, newest first."""
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT DISTINCT
                   t.id, t.reference, t.description, t.date, t.total_amount,
                   t.source_type, t.source_id, t.posted_by, t.posted_at,
                   t.branch_id, t.fund_type
            FROM   transactions t
            JOIN   transaction_lines tl ON tl.transaction_id = t.id
            WHERE  tl.project_id = :pid
              AND  t.status = 'POSTED'
              AND  t.deleted_at IS NULL
            ORDER  BY t.date DESC, t.posted_at DESC NULLS LAST
            LIMIT  :limit
        """), {"pid": project_uuid, "limit": max(1, min(limit, 500))})).mappings().all()
    return {"items": [_row(r) for r in rows]}


@router.get("/admin/projects/dashboard")
async def projects_dashboard(
    ctx: CurrentSpace,
    branch_id: str = "",
    status: str = "ACTIVE",
) -> dict[str, Any]:
    """Multi-project rollup for the projects landing page."""
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where = ["p.is_active = true"]
    params: dict[str, Any] = {}
    if branch_id.strip():
        where.append("p.branch_id = :bid")
        params["bid"] = branch_id.strip()
    if status.strip():
        where.append("p.status = :st")
        params["st"] = status.strip().upper()
    sql_where = " AND ".join(where)

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            WITH actuals AS (
                SELECT tl.project_id,
                       SUM(CASE WHEN nc.type = 'INCOME'  THEN tl.credit_amount - tl.debit_amount ELSE 0 END) AS income,
                       SUM(CASE WHEN nc.type = 'EXPENSE' THEN tl.debit_amount  - tl.credit_amount ELSE 0 END) AS expense
                FROM   transaction_lines tl
                JOIN   nominal_codes nc ON nc.id = tl.nominal_code_id
                JOIN   transactions  t  ON t.id  = tl.transaction_id
                WHERE  tl.project_id IS NOT NULL
                  AND  t.status = 'POSTED' AND t.deleted_at IS NULL
                GROUP  BY tl.project_id
            )
            SELECT p.id, p.project_id, p.name, p.branch_id, p.status, p.project_type,
                   p.fund_type, p.budget_amount, p.goal_amount,
                   p.start_date, p.end_date,
                   COALESCE(a.income, 0)  AS actual_income,
                   COALESCE(a.expense, 0) AS actual_expense
            FROM   projects p
            LEFT JOIN actuals a ON a.project_id = p.id
            WHERE  {sql_where}
            ORDER  BY p.sort_order, p.name
        """), params)).mappings().all()

    items: list[dict[str, Any]] = []
    sum_budget = 0.0
    sum_income = 0.0
    sum_expense = 0.0
    for r in rows:
        d = _row(r)
        d["actual_income"]  = float(r["actual_income"] or 0)
        d["actual_expense"] = float(r["actual_expense"] or 0)
        d["net"]            = round(d["actual_income"] - d["actual_expense"], 2)
        d["budget_pct_used"] = round((d["actual_expense"] / d["budget_amount"] * 100), 1) if d["budget_amount"] else 0.0
        d["goal_pct_raised"] = round((d["actual_income"]  / d["goal_amount"]   * 100), 1) if d["goal_amount"]   else 0.0
        sum_budget  += d["budget_amount"]
        sum_income  += d["actual_income"]
        sum_expense += d["actual_expense"]
        items.append(d)

    return {
        "items":         items,
        "total_budget":  round(sum_budget, 2),
        "total_income":  round(sum_income, 2),
        "total_expense": round(sum_expense, 2),
        "total_net":     round(sum_income - sum_expense, 2),
        "count":         len(items),
    }
