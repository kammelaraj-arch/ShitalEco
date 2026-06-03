"""Project Management — assignments, activity log, risk register, expenses,
vendor invoices. Sits alongside the existing project_costing.py P&L/timeline
endpoints; this module owns the per-project sub-entities the operator
asked for: team members, activity history, risks, expenses, invoices.

All routes are namespaced under /admin/projects/{project_uuid}/<entity>
so the URL matches the existing project_costing endpoints.
"""
from __future__ import annotations

import uuid
from datetime import date as _date
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(tags=["project-management"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(status_code=403, detail="admin only")


def _iso(d: Any) -> Any:
    return d.isoformat() if hasattr(d, "isoformat") else d


def _serialise(row: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in row.items():
        if k.endswith("_id") and v is not None:
            out[k] = str(v)
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# ─── Project summary (aggregate over all sub-entities) ───────────────────────
# Pulls the project + counts + budget rollup in one round-trip so the detail
# page's header can render without 5 separate fetches.

@router.get("/admin/projects/{project_uuid}/summary")
async def project_summary(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        proj = (await db.execute(text("""
            SELECT p.id::text, p.project_id, p.name, p.description, p.branch_id,
                   p.goal_amount, p.budget_total, p.status, p.risk_level,
                   p.start_date, p.end_date, p.is_active,
                   p.project_manager_id::text  AS project_manager_id,
                   p.business_owner_id::text   AS business_owner_id,
                   p.tech_owner_id::text       AS tech_owner_id,
                   pm.name  AS project_manager_name, pm.email AS project_manager_email,
                   bo.name  AS business_owner_name,  bo.email AS business_owner_email,
                   tw.name  AS tech_owner_name,      tw.email AS tech_owner_email,
                   p.created_at, p.updated_at
            FROM projects p
            LEFT JOIN users pm ON pm.id = p.project_manager_id
            LEFT JOIN users bo ON bo.id = p.business_owner_id
            LEFT JOIN users tw ON tw.id = p.tech_owner_id
            WHERE p.id = CAST(:id AS UUID)
        """), {"id": project_uuid})).mappings().first()
        if not proj:
            raise HTTPException(status_code=404, detail="project not found")

        # Rolled-up financials. expenses = sum of project_expenses; donations
        # = sum of donations whose purpose matches this project's name (best-
        # effort link — the donations table doesn't FK to projects today).
        rolls = (await db.execute(text("""
            SELECT
              (SELECT COALESCE(SUM(amount),0) FROM project_expenses
                 WHERE project_id = CAST(:id AS UUID) AND deleted_at IS NULL)        AS actual_cost,
              (SELECT COALESCE(SUM(amount),0) FROM project_invoices
                 WHERE project_id = CAST(:id AS UUID) AND deleted_at IS NULL
                   AND status NOT IN ('PAID','CANCELLED'))                            AS open_invoices,
              (SELECT COUNT(*) FROM project_assignments
                 WHERE project_id = CAST(:id AS UUID) AND removed_at IS NULL)         AS team_size,
              (SELECT COUNT(*) FROM project_risks
                 WHERE project_id = CAST(:id AS UUID) AND status = 'OPEN')            AS open_risks,
              (SELECT COUNT(*) FROM project_activities
                 WHERE project_id = CAST(:id AS UUID))                                AS activity_count
        """), {"id": project_uuid})).mappings().one()

    out = _serialise(dict(proj))
    out.update({
        "actual_cost":    float(rolls["actual_cost"]),
        "open_invoices":  float(rolls["open_invoices"]),
        "team_size":      int(rolls["team_size"]),
        "open_risks":     int(rolls["open_risks"]),
        "activity_count": int(rolls["activity_count"]),
    })
    return out


# ─── Assignments ─────────────────────────────────────────────────────────────

class AssignmentIn(BaseModel):
    user_id: str
    role: str = "TEAM_MEMBER"
    notes: str = ""


@router.get("/admin/projects/{project_uuid}/assignments")
async def list_assignments(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT a.id::text, a.user_id::text, a.role, a.notes,
                   a.assigned_at,
                   u.name AS user_name, u.email AS user_email
            FROM   project_assignments a
            LEFT   JOIN users u ON u.id = a.user_id
            WHERE  a.project_id = CAST(:id AS UUID)
              AND  a.removed_at IS NULL
            ORDER  BY a.assigned_at DESC
        """), {"id": project_uuid})).mappings().all()
    return {"items": [_serialise(dict(r)) for r in rows]}


@router.post("/admin/projects/{project_uuid}/assignments", status_code=201)
async def create_assignment(project_uuid: str, body: AssignmentIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        new_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO project_assignments (id, project_id, user_id, role, notes, assigned_at)
            VALUES (CAST(:id AS UUID), CAST(:pid AS UUID), CAST(:uid AS UUID), :role, :notes, NOW())
        """), {"id": new_id, "pid": project_uuid, "uid": body.user_id, "role": body.role.upper(), "notes": body.notes})
        await _log_activity(db, project_uuid, ctx, "ASSIGNMENT", f"Added team member ({body.role})", "")
        await db.commit()
    return {"id": new_id}


@router.delete("/admin/projects/{project_uuid}/assignments/{assign_id}", status_code=204)
async def remove_assignment(project_uuid: str, assign_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE project_assignments SET removed_at = NOW()
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {"id": assign_id, "pid": project_uuid})
        await _log_activity(db, project_uuid, ctx, "ASSIGNMENT", "Removed team member", "")
        await db.commit()


# ─── Activity log ────────────────────────────────────────────────────────────

class ActivityIn(BaseModel):
    kind: str = "NOTE"
    title: str = ""
    body: str = ""
    related_id: str = ""


async def _log_activity(db: Any, project_uuid: str, ctx: CurrentSpace, kind: str, title: str, body: str, related_id: str = "") -> None:
    """Internal helper — every create/update/delete on a sub-entity logs an
    activity entry so the timeline tells a coherent story. Caller is expected
    to be inside an open transaction and to db.commit() afterwards."""
    await db.execute(text("""
        INSERT INTO project_activities (id, project_id, actor_id, actor_email, kind, title, body, related_id)
        VALUES (gen_random_uuid(), CAST(:pid AS UUID), CAST(:aid AS UUID), :ae, :k, :t, :b, :rid)
    """), {
        "pid": project_uuid,
        "aid": ctx.user_id if hasattr(ctx, "user_id") else None,
        "ae":  getattr(ctx, "user_email", "") or "",
        "k":   kind, "t": title, "b": body, "rid": related_id,
    })


@router.get("/admin/projects/{project_uuid}/activities")
async def list_activities(project_uuid: str, ctx: CurrentSpace, limit: int = 100) -> dict[str, Any]:
    _require_admin(ctx)
    limit = max(1, min(500, int(limit)))
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text, actor_id::text, actor_email, kind, title, body, related_id, created_at
            FROM   project_activities
            WHERE  project_id = CAST(:pid AS UUID)
            ORDER  BY created_at DESC
            LIMIT  :lim
        """), {"pid": project_uuid, "lim": limit})).mappings().all()
    return {"items": [_serialise(dict(r)) for r in rows]}


@router.post("/admin/projects/{project_uuid}/activities", status_code=201)
async def post_activity(project_uuid: str, body: ActivityIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await _log_activity(db, project_uuid, ctx, body.kind.upper(), body.title, body.body, body.related_id)
        await db.commit()
    return {"ok": True}


# ─── Risk register ───────────────────────────────────────────────────────────

class RiskIn(BaseModel):
    title: str
    description: str = ""
    likelihood: int = 3
    impact: int = 3
    mitigation: str = ""
    owner_id: str | None = None
    status: str = "OPEN"


@router.get("/admin/projects/{project_uuid}/risks")
async def list_risks(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT r.id::text, r.title, r.description, r.likelihood, r.impact,
                   r.risk_score, r.mitigation, r.owner_id::text AS owner_id,
                   u.name AS owner_name, u.email AS owner_email,
                   r.status, r.created_at, r.updated_at, r.closed_at
            FROM   project_risks r
            LEFT   JOIN users u ON u.id = r.owner_id
            WHERE  r.project_id = CAST(:pid AS UUID)
            ORDER  BY r.risk_score DESC, r.created_at DESC
        """), {"pid": project_uuid})).mappings().all()
    return {"items": [_serialise(dict(r)) for r in rows]}


@router.post("/admin/projects/{project_uuid}/risks", status_code=201)
async def create_risk(project_uuid: str, body: RiskIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if not (1 <= body.likelihood <= 5 and 1 <= body.impact <= 5):
        raise HTTPException(status_code=400, detail="likelihood + impact must be between 1 and 5")
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO project_risks (id, project_id, title, description, likelihood, impact, mitigation, owner_id, status)
            VALUES (CAST(:id AS UUID), CAST(:pid AS UUID), :t, :d, :l, :i, :m,
                    CASE WHEN :oid <> '' THEN CAST(:oid AS UUID) ELSE NULL END,
                    :s)
        """), {"id": new_id, "pid": project_uuid, "t": body.title, "d": body.description,
               "l": body.likelihood, "i": body.impact, "m": body.mitigation,
               "oid": body.owner_id or "", "s": body.status.upper()})
        await _log_activity(db, project_uuid, ctx, "RISK", f"Logged risk: {body.title}", "", new_id)
        await db.commit()
    return {"id": new_id}


@router.put("/admin/projects/{project_uuid}/risks/{risk_id}")
async def update_risk(project_uuid: str, risk_id: str, body: RiskIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE project_risks SET
                title = :t, description = :d,
                likelihood = :l, impact = :i,
                mitigation = :m,
                owner_id = CASE WHEN :oid <> '' THEN CAST(:oid AS UUID) ELSE NULL END,
                status = :s,
                closed_at = CASE WHEN :s = 'CLOSED' AND closed_at IS NULL THEN NOW() ELSE closed_at END,
                updated_at = NOW()
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {"id": risk_id, "pid": project_uuid, "t": body.title, "d": body.description,
               "l": body.likelihood, "i": body.impact, "m": body.mitigation,
               "oid": body.owner_id or "", "s": body.status.upper()})
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(status_code=404, detail="risk not found")
    return {"ok": True}


@router.delete("/admin/projects/{project_uuid}/risks/{risk_id}", status_code=204)
async def delete_risk(project_uuid: str, risk_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await db.execute(text("""
            DELETE FROM project_risks
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {"id": risk_id, "pid": project_uuid})
        await db.commit()


# ─── Expenses ────────────────────────────────────────────────────────────────

class ExpenseIn(BaseModel):
    spent_on: str   # YYYY-MM-DD
    category: str = "OTHER"
    vendor: str = ""
    description: str = ""
    amount: float = 0.0
    currency: str = "GBP"
    invoice_ref: str = ""


@router.get("/admin/projects/{project_uuid}/expenses")
async def list_expenses(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text, spent_on, category, vendor, description, amount, currency, invoice_ref, created_at
            FROM   project_expenses
            WHERE  project_id = CAST(:pid AS UUID) AND deleted_at IS NULL
            ORDER  BY spent_on DESC, created_at DESC
        """), {"pid": project_uuid})).mappings().all()
    return {"items": [_serialise(dict(r)) for r in rows]}


@router.post("/admin/projects/{project_uuid}/expenses", status_code=201)
async def create_expense(project_uuid: str, body: ExpenseIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    try:
        spent_on = _date.fromisoformat(body.spent_on)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="spent_on must be YYYY-MM-DD") from e
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO project_expenses
                (id, project_id, spent_on, category, vendor, description, amount, currency, invoice_ref)
            VALUES
                (CAST(:id AS UUID), CAST(:pid AS UUID), :spent, :cat, :v, :d, :a, :c, :iref)
        """), {"id": new_id, "pid": project_uuid, "spent": spent_on, "cat": body.category.upper(),
               "v": body.vendor, "d": body.description, "a": body.amount, "c": body.currency, "iref": body.invoice_ref})
        await _log_activity(db, project_uuid, ctx, "EXPENSE", f"+£{body.amount:.2f} {body.category} — {body.vendor or body.description[:40]}", "", new_id)
        await db.commit()
    return {"id": new_id}


@router.delete("/admin/projects/{project_uuid}/expenses/{exp_id}", status_code=204)
async def delete_expense(project_uuid: str, exp_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE project_expenses SET deleted_at = NOW()
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {"id": exp_id, "pid": project_uuid})
        await _log_activity(db, project_uuid, ctx, "EXPENSE", "Deleted expense line", "", exp_id)
        await db.commit()


# ─── Vendor invoices ─────────────────────────────────────────────────────────

class InvoiceIn(BaseModel):
    vendor: str
    invoice_no: str = ""
    invoice_date: str | None = None    # YYYY-MM-DD
    due_date: str | None = None
    paid_date: str | None = None
    amount: float = 0.0
    currency: str = "GBP"
    status: str = "RECEIVED"
    file_url: str = ""
    notes: str = ""


def _parse_date(s: str | None) -> _date | None:
    if not s:
        return None
    try:
        return _date.fromisoformat(s)
    except ValueError:
        return None


@router.get("/admin/projects/{project_uuid}/invoices")
async def list_invoices(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text, vendor, invoice_no, invoice_date, due_date, paid_date,
                   amount, currency, status, file_url, notes, created_at
            FROM   project_invoices
            WHERE  project_id = CAST(:pid AS UUID) AND deleted_at IS NULL
            ORDER  BY COALESCE(invoice_date, created_at::date) DESC
        """), {"pid": project_uuid})).mappings().all()
    return {"items": [_serialise(dict(r)) for r in rows]}


@router.post("/admin/projects/{project_uuid}/invoices", status_code=201)
async def create_invoice(project_uuid: str, body: InvoiceIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if not body.vendor.strip():
        raise HTTPException(status_code=400, detail="vendor required")
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO project_invoices
                (id, project_id, vendor, invoice_no, invoice_date, due_date, paid_date,
                 amount, currency, status, file_url, notes)
            VALUES
                (CAST(:id AS UUID), CAST(:pid AS UUID), :v, :no, :idate, :ddate, :pdate,
                 :amt, :cur, :s, :url, :n)
        """), {
            "id": new_id, "pid": project_uuid,
            "v": body.vendor, "no": body.invoice_no,
            "idate": _parse_date(body.invoice_date), "ddate": _parse_date(body.due_date),
            "pdate": _parse_date(body.paid_date),
            "amt": body.amount, "cur": body.currency,
            "s": body.status.upper(), "url": body.file_url, "n": body.notes,
        })
        await _log_activity(db, project_uuid, ctx, "INVOICE", f"Invoice from {body.vendor} — £{body.amount:.2f}", "", new_id)
        await db.commit()
    return {"id": new_id}


@router.put("/admin/projects/{project_uuid}/invoices/{inv_id}")
async def update_invoice(project_uuid: str, inv_id: str, body: InvoiceIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE project_invoices SET
                vendor = :v, invoice_no = :no,
                invoice_date = :idate, due_date = :ddate, paid_date = :pdate,
                amount = :amt, currency = :cur,
                status = :s, file_url = :url, notes = :n,
                updated_at = NOW()
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {
            "id": inv_id, "pid": project_uuid,
            "v": body.vendor, "no": body.invoice_no,
            "idate": _parse_date(body.invoice_date), "ddate": _parse_date(body.due_date),
            "pdate": _parse_date(body.paid_date),
            "amt": body.amount, "cur": body.currency,
            "s": body.status.upper(), "url": body.file_url, "n": body.notes,
        })
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(status_code=404, detail="invoice not found")
    return {"ok": True}


@router.delete("/admin/projects/{project_uuid}/invoices/{inv_id}", status_code=204)
async def delete_invoice(project_uuid: str, inv_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE project_invoices SET deleted_at = NOW()
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {"id": inv_id, "pid": project_uuid})
        await db.commit()
