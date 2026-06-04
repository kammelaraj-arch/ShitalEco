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
from shital.api.routers.notifications import notify, notify_many
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
                   p.parent_project_id::text   AS parent_project_id,
                   parent.name                 AS parent_project_name,
                   p.project_manager_id::text  AS project_manager_id,
                   p.business_owner_id::text   AS business_owner_id,
                   p.tech_owner_id::text       AS tech_owner_id,
                   pm.name  AS project_manager_name, pm.email AS project_manager_email,
                   bo.name  AS business_owner_name,  bo.email AS business_owner_email,
                   tw.name  AS tech_owner_name,      tw.email AS tech_owner_email,
                   p.created_at, p.updated_at
            FROM projects p
            LEFT JOIN projects parent ON parent.id = p.parent_project_id
            LEFT JOIN users pm ON pm.id = p.project_manager_id
            LEFT JOIN users bo ON bo.id = p.business_owner_id
            LEFT JOIN users tw ON tw.id = p.tech_owner_id
            WHERE p.id = CAST(:id AS UUID)
        """), {"id": project_uuid})).mappings().first()
        if not proj:
            raise HTTPException(status_code=404, detail="project not found")

        # Immediate children — for the tree view in the detail page header.
        children = (await db.execute(text("""
            SELECT id::text, name, status, COALESCE(risk_level,'GREEN') AS risk_level
            FROM   projects
            WHERE  parent_project_id = CAST(:id AS UUID)
              AND  is_active = true
            ORDER  BY name
        """), {"id": project_uuid})).mappings().all()

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
                 WHERE project_id = CAST(:id AS UUID))                                AS activity_count,
              (SELECT COUNT(*) FROM project_milestones
                 WHERE project_id = CAST(:id AS UUID) AND deleted_at IS NULL)         AS milestones_total,
              (SELECT COUNT(*) FROM project_milestones
                 WHERE project_id = CAST(:id AS UUID) AND deleted_at IS NULL
                   AND status = 'DONE')                                                AS milestones_done,
              (SELECT COUNT(*) FROM project_documents
                 WHERE project_id = CAST(:id AS UUID) AND deleted_at IS NULL)         AS documents_count,
              (SELECT COUNT(*) FROM project_partners
                 WHERE project_id = CAST(:id AS UUID) AND removed_at IS NULL)         AS partners_count,
              (SELECT COUNT(*) FROM project_approvals
                 WHERE project_id = CAST(:id AS UUID) AND status = 'PENDING')         AS pending_approvals,
              (SELECT COALESCE(SUM(amount),0) FROM project_budget_items
                 WHERE project_id = CAST(:id AS UUID))                                AS budget_items_total,
              (SELECT COALESCE(SUM(amount),0) FROM donations
                 WHERE project_id = CAST(:id AS UUID) AND deleted_at IS NULL)         AS incoming_funds_attributed
        """), {"id": project_uuid})).mappings().one()

    out = _serialise(dict(proj))
    out.update({
        "actual_cost":              float(rolls["actual_cost"]),
        "open_invoices":            float(rolls["open_invoices"]),
        "team_size":                int(rolls["team_size"]),
        "open_risks":               int(rolls["open_risks"]),
        "activity_count":           int(rolls["activity_count"]),
        "milestones_total":         int(rolls["milestones_total"]),
        "milestones_done":          int(rolls["milestones_done"]),
        "documents_count":          int(rolls["documents_count"]),
        "partners_count":           int(rolls["partners_count"]),
        "pending_approvals":        int(rolls["pending_approvals"]),
        "budget_items_total":       float(rolls["budget_items_total"]),
        "incoming_funds_attributed": float(rolls["incoming_funds_attributed"]),
        "sub_projects":             [dict(c) for c in children],
    })
    return out


# ─── Parent link ─────────────────────────────────────────────────────────────

class ParentIn(BaseModel):
    parent_project_id: str | None = None   # None clears the link


@router.patch("/admin/projects/{project_uuid}/parent")
async def set_parent(project_uuid: str, body: ParentIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Set or clear the parent project. Guards against self-parenting and
    cycles — the new parent cannot be the project itself nor a descendant."""
    _require_admin(ctx)
    new_parent = (body.parent_project_id or "").strip() or None
    if new_parent and new_parent == project_uuid:
        raise HTTPException(status_code=400, detail="project cannot be its own parent")
    async with SessionLocal() as db:
        if new_parent:
            # Cycle check: walk up from new_parent — if we hit project_uuid,
            # reject. Bounded to 50 hops so a corrupt loop in the data
            # doesn't run forever.
            cur = new_parent
            for _ in range(50):
                row = (await db.execute(text(
                    "SELECT parent_project_id::text AS p FROM projects WHERE id = CAST(:id AS UUID)"
                ), {"id": cur})).mappings().first()
                if not row or not row["p"]:
                    break
                if row["p"] == project_uuid:
                    raise HTTPException(status_code=400, detail="would create a cycle")
                cur = row["p"]
        result = await db.execute(text("""
            UPDATE projects SET
                parent_project_id = CASE WHEN :p <> '' THEN CAST(:p AS UUID) ELSE NULL END,
                updated_at = NOW()
            WHERE id = CAST(:id AS UUID)
        """), {"id": project_uuid, "p": new_parent or ""})
        await _log_activity(db, project_uuid, ctx, "STATUS_CHANGE",
                            f"Parent project {'set' if new_parent else 'cleared'}",
                            new_parent or "")
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(status_code=404, detail="project not found")
    return {"ok": True, "parent_project_id": new_parent}


# ─── Assignments ─────────────────────────────────────────────────────────────

class OwnersIn(BaseModel):
    project_manager_id: str | None = None
    business_owner_id: str | None = None
    tech_owner_id: str | None = None


@router.patch("/admin/projects/{project_uuid}/owners")
async def set_owners(project_uuid: str, body: OwnersIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Set or clear PM / Business Owner / Tech Owner in one call. Any field
    omitted in the request is left unchanged; passing an empty string clears
    that role."""
    _require_admin(ctx)

    def _norm(v: str | None) -> tuple[bool, str | None]:
        # (touched?, value) — None means "field not in body, don't touch"
        if v is None:
            return False, None
        v = v.strip()
        return True, (v or None)

    pm_t, pm = _norm(body.project_manager_id)
    bo_t, bo = _norm(body.business_owner_id)
    tw_t, tw = _norm(body.tech_owner_id)

    sets: list[str] = []
    params: dict[str, Any] = {"id": project_uuid}
    if pm_t:
        sets.append("project_manager_id = CASE WHEN :pm <> '' THEN CAST(:pm AS UUID) ELSE NULL END")
        params["pm"] = pm or ""
    if bo_t:
        sets.append("business_owner_id  = CASE WHEN :bo <> '' THEN CAST(:bo AS UUID) ELSE NULL END")
        params["bo"] = bo or ""
    if tw_t:
        sets.append("tech_owner_id      = CASE WHEN :tw <> '' THEN CAST(:tw AS UUID) ELSE NULL END")
        params["tw"] = tw or ""
    if not sets:
        return {"ok": True, "updated": 0}
    sets.append("updated_at = NOW()")

    async with SessionLocal() as db:
        result = await db.execute(text(
            f"UPDATE projects SET {', '.join(sets)} WHERE id = CAST(:id AS UUID)"
        ), params)
        await _log_activity(db, project_uuid, ctx, "STATUS_CHANGE", "Project owners updated", "")
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(status_code=404, detail="project not found")
    return {"ok": True, "updated": 1}


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
        # Notify the user they've been assigned.
        await notify(db, body.user_id, "ASSIGNMENT",
                     f"You've been assigned to a project as {body.role}",
                     body.notes, f"/finance/projects/{project_uuid}")
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
        # High-severity risks (score >= 15) notify the project_manager + risk owner.
        risk_score = body.likelihood * body.impact
        if risk_score >= 15:
            pm = (await db.execute(text(
                "SELECT project_manager_id::text AS pm FROM projects WHERE id = CAST(:p AS UUID)"
            ), {"p": project_uuid})).mappings().first()
            recipients = [body.owner_id, pm["pm"] if pm else None]
            await notify_many(db, recipients, kind="RISK",
                              title=f"High-severity risk logged ({risk_score}/25)",
                              body=body.title,
                              link_url=f"/finance/projects/{project_uuid}",
                              severity="WARNING")
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


# ═══════════════════════════════════════════════════════════════════════════
# Phase 1b — Milestones / Documents / Budget items / Approvals
# Phase 1c — Vendors-rollup over crm_accounts + project_partners join
# All NEW endpoints below this line REUSE existing tables (crm_accounts for
# vendor/supplier/partner, donations for funding, users for people) and only
# add new tables for genuinely new concepts.
# ═══════════════════════════════════════════════════════════════════════════

# Approval threshold — projects with budget_total > this need an APPROVED
# 'START' row before they can move DRAFT → ACTIVE. CAPITAL projects + any
# RESTRICTED/ENDOWMENT fund_type also require approval regardless of size.
APPROVAL_THRESHOLD_GBP = 5000


# ─── Milestones ──────────────────────────────────────────────────────────────

class MilestoneIn(BaseModel):
    title: str
    description: str = ""
    owner_id: str | None = None
    due_date: str | None = None       # YYYY-MM-DD
    status: str = "PENDING"
    pct_complete: int = 0


@router.get("/admin/projects/{project_uuid}/milestones")
async def list_milestones(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT m.id::text, m.title, m.description, m.owner_id::text AS owner_id,
                   u.name AS owner_name, u.email AS owner_email,
                   m.due_date, m.status, m.pct_complete,
                   m.completed_at, m.created_at, m.updated_at
            FROM   project_milestones m
            LEFT   JOIN users u ON u.id = m.owner_id
            WHERE  m.project_id = CAST(:pid AS UUID) AND m.deleted_at IS NULL
            ORDER  BY m.due_date NULLS LAST, m.created_at
        """), {"pid": project_uuid})).mappings().all()
    return {"items": [_serialise(dict(r)) for r in rows]}


@router.post("/admin/projects/{project_uuid}/milestones", status_code=201)
async def create_milestone(project_uuid: str, body: MilestoneIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    new_id = str(uuid.uuid4())
    due = _parse_date(body.due_date)
    if not (0 <= body.pct_complete <= 100):
        raise HTTPException(status_code=400, detail="pct_complete must be 0..100")
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO project_milestones (id, project_id, title, description, owner_id, due_date, status, pct_complete)
            VALUES (CAST(:id AS UUID), CAST(:pid AS UUID), :t, :d,
                    CASE WHEN :oid <> '' THEN CAST(:oid AS UUID) ELSE NULL END,
                    :due, :s, :pct)
        """), {"id": new_id, "pid": project_uuid, "t": body.title, "d": body.description,
               "oid": body.owner_id or "", "due": due,
               "s": body.status.upper(), "pct": body.pct_complete})
        await _log_activity(db, project_uuid, ctx, "MILESTONE", f"Milestone: {body.title}", "", new_id)
        await db.commit()
    return {"id": new_id}


@router.put("/admin/projects/{project_uuid}/milestones/{ms_id}")
async def update_milestone(project_uuid: str, ms_id: str, body: MilestoneIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    due = _parse_date(body.due_date)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE project_milestones SET
                title = :t, description = :d,
                owner_id = CASE WHEN :oid <> '' THEN CAST(:oid AS UUID) ELSE NULL END,
                due_date = :due, status = :s, pct_complete = :pct,
                completed_at = CASE WHEN :s = 'DONE' AND completed_at IS NULL THEN NOW() ELSE completed_at END,
                updated_at = NOW()
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
              AND deleted_at IS NULL
        """), {"id": ms_id, "pid": project_uuid, "t": body.title, "d": body.description,
               "oid": body.owner_id or "", "due": due,
               "s": body.status.upper(), "pct": body.pct_complete})
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(status_code=404, detail="milestone not found")
    return {"ok": True}


@router.delete("/admin/projects/{project_uuid}/milestones/{ms_id}", status_code=204)
async def delete_milestone(project_uuid: str, ms_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE project_milestones SET deleted_at = NOW()
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {"id": ms_id, "pid": project_uuid})
        await db.commit()


# ─── Documents ──────────────────────────────────────────────────────────────

class DocumentIn(BaseModel):
    title: str
    kind: str = "OTHER"     # CHARTER | CONTRACT | REPORT | INVOICE | OTHER
    file_url: str = ""
    version: str = ""
    notes: str = ""


@router.get("/admin/projects/{project_uuid}/documents")
async def list_documents(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT d.id::text, d.title, d.kind, d.file_url, d.version,
                   d.uploaded_by::text AS uploaded_by,
                   u.name AS uploaded_by_name, u.email AS uploaded_by_email,
                   d.uploaded_at, d.notes
            FROM   project_documents d
            LEFT   JOIN users u ON u.id = d.uploaded_by
            WHERE  d.project_id = CAST(:pid AS UUID) AND d.deleted_at IS NULL
            ORDER  BY d.uploaded_at DESC
        """), {"pid": project_uuid})).mappings().all()
    return {"items": [_serialise(dict(r)) for r in rows]}


@router.post("/admin/projects/{project_uuid}/documents", status_code=201)
async def create_document(project_uuid: str, body: DocumentIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO project_documents (id, project_id, title, kind, file_url, version, uploaded_by, notes)
            VALUES (CAST(:id AS UUID), CAST(:pid AS UUID), :t, :k, :url, :v,
                    CASE WHEN :uid <> '' THEN CAST(:uid AS UUID) ELSE NULL END, :n)
        """), {"id": new_id, "pid": project_uuid, "t": body.title, "k": body.kind.upper(),
               "url": body.file_url, "v": body.version,
               "uid": str(getattr(ctx, "user_id", "") or ""), "n": body.notes})
        await _log_activity(db, project_uuid, ctx, "DOCUMENT", f"Document: {body.title}", "", new_id)
        await db.commit()
    return {"id": new_id}


@router.delete("/admin/projects/{project_uuid}/documents/{doc_id}", status_code=204)
async def delete_document(project_uuid: str, doc_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE project_documents SET deleted_at = NOW()
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {"id": doc_id, "pid": project_uuid})
        await db.commit()


# ─── Budget items (per-category breakdown) ──────────────────────────────────

class BudgetItemIn(BaseModel):
    category: str = "OTHER"
    description: str = ""
    amount: float = 0.0
    currency: str = "GBP"


@router.get("/admin/projects/{project_uuid}/budget-items")
async def list_budget_items(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    """List budget by category with variance (budget vs actual expense)
    computed on read. Same category strings as project_expenses."""
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT bi.id::text, bi.category, bi.description, bi.amount, bi.currency,
                   bi.created_at, bi.updated_at,
                   COALESCE((
                     SELECT SUM(e.amount) FROM project_expenses e
                     WHERE e.project_id = bi.project_id
                       AND e.category   = bi.category
                       AND e.deleted_at IS NULL
                   ), 0)::numeric AS spent
            FROM project_budget_items bi
            WHERE bi.project_id = CAST(:pid AS UUID)
            ORDER BY bi.category
        """), {"pid": project_uuid})).mappings().all()
    items = []
    for r in rows:
        d = _serialise(dict(r))
        d["variance"] = float(d["amount"]) - float(d["spent"])
        items.append(d)
    return {"items": items}


@router.post("/admin/projects/{project_uuid}/budget-items", status_code=201)
async def create_budget_item(project_uuid: str, body: BudgetItemIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO project_budget_items (id, project_id, category, description, amount, currency)
            VALUES (CAST(:id AS UUID), CAST(:pid AS UUID), :c, :d, :a, :cur)
        """), {"id": new_id, "pid": project_uuid, "c": body.category.upper(),
               "d": body.description, "a": body.amount, "cur": body.currency})
        await db.commit()
    return {"id": new_id}


@router.put("/admin/projects/{project_uuid}/budget-items/{bi_id}")
async def update_budget_item(project_uuid: str, bi_id: str, body: BudgetItemIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE project_budget_items SET
                category = :c, description = :d, amount = :a, currency = :cur,
                updated_at = NOW()
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {"id": bi_id, "pid": project_uuid, "c": body.category.upper(),
               "d": body.description, "a": body.amount, "cur": body.currency})
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(status_code=404, detail="budget item not found")
    return {"ok": True}


@router.delete("/admin/projects/{project_uuid}/budget-items/{bi_id}", status_code=204)
async def delete_budget_item(project_uuid: str, bi_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await db.execute(text("""
            DELETE FROM project_budget_items
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {"id": bi_id, "pid": project_uuid})
        await db.commit()


# ─── Partners (REUSES crm_accounts) ─────────────────────────────────────────

class PartnerIn(BaseModel):
    account_id: str          # FK to existing crm_accounts.id
    relationship: str = "PARTNER"
    start_date: str | None = None
    end_date: str | None = None
    notes: str = ""


@router.get("/admin/projects/{project_uuid}/partners")
async def list_partners(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Partners + suppliers + grantors etc. — joined to crm_accounts so
    each row carries the account name, type, contact info, charity number."""
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT pp.id::text, pp.account_id::text, pp.relationship,
                   pp.start_date, pp.end_date, pp.notes, pp.created_at,
                   a.name AS account_name, a.account_type, a.email, a.phone,
                   a.charity_number, a.registration_number
            FROM   project_partners pp
            JOIN   crm_accounts a ON a.id = pp.account_id
            WHERE  pp.project_id = CAST(:pid AS UUID) AND pp.removed_at IS NULL
            ORDER  BY pp.created_at DESC
        """), {"pid": project_uuid})).mappings().all()
    return {"items": [_serialise(dict(r)) for r in rows]}


@router.post("/admin/projects/{project_uuid}/partners", status_code=201)
async def add_partner(project_uuid: str, body: PartnerIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO project_partners (id, project_id, account_id, relationship, start_date, end_date, notes)
            VALUES (CAST(:id AS UUID), CAST(:pid AS UUID), CAST(:aid AS UUID), :rel, :sd, :ed, :n)
        """), {"id": new_id, "pid": project_uuid, "aid": body.account_id,
               "rel": body.relationship.upper(),
               "sd": _parse_date(body.start_date), "ed": _parse_date(body.end_date),
               "n": body.notes})
        await _log_activity(db, project_uuid, ctx, "PARTNER", f"Partner ({body.relationship})", "", body.account_id)
        await db.commit()
    return {"id": new_id}


@router.delete("/admin/projects/{project_uuid}/partners/{pp_id}", status_code=204)
async def remove_partner(project_uuid: str, pp_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE project_partners SET removed_at = NOW()
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
        """), {"id": pp_id, "pid": project_uuid})
        await db.commit()


# ─── Vendors rollup (across project_expenses + project_invoices) ────────────

@router.get("/admin/projects/{project_uuid}/vendors-rollup")
async def vendors_rollup(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    """One row per crm_accounts vendor with spend + invoice counts across
    this project. Includes a "(unlinked: free-text)" pseudo-row for legacy
    expenses/invoices whose vendor column is set but vendor_account_id is
    NULL — so the operator can see what hasn't been linked yet."""
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            WITH inv AS (
                SELECT vendor_account_id, COUNT(*) AS invoice_count,
                       COALESCE(SUM(amount),0) AS invoice_total
                FROM   project_invoices
                WHERE  project_id = CAST(:pid AS UUID) AND deleted_at IS NULL
                GROUP  BY vendor_account_id
            ),
            exp AS (
                SELECT vendor_account_id, COUNT(*) AS expense_count,
                       COALESCE(SUM(amount),0) AS expense_total
                FROM   project_expenses
                WHERE  project_id = CAST(:pid AS UUID) AND deleted_at IS NULL
                GROUP  BY vendor_account_id
            )
            SELECT
                a.id::text                                    AS account_id,
                a.name                                        AS account_name,
                a.account_type                                AS account_type,
                COALESCE(inv.invoice_count, 0)                AS invoice_count,
                COALESCE(inv.invoice_total, 0)::numeric       AS invoice_total,
                COALESCE(exp.expense_count, 0)                AS expense_count,
                COALESCE(exp.expense_total, 0)::numeric       AS expense_total,
                (COALESCE(inv.invoice_total,0) + COALESCE(exp.expense_total,0))::numeric AS total_spend
            FROM crm_accounts a
            LEFT JOIN inv ON inv.vendor_account_id = a.id
            LEFT JOIN exp ON exp.vendor_account_id = a.id
            WHERE COALESCE(inv.invoice_count, 0) + COALESCE(exp.expense_count, 0) > 0
            ORDER BY total_spend DESC
        """), {"pid": project_uuid})).mappings().all()
        unlinked = (await db.execute(text("""
            SELECT
                (SELECT COUNT(*) FROM project_invoices
                   WHERE project_id = CAST(:pid AS UUID) AND deleted_at IS NULL
                     AND vendor_account_id IS NULL AND TRIM(vendor) <> '') AS unlinked_invoices,
                (SELECT COUNT(*) FROM project_expenses
                   WHERE project_id = CAST(:pid AS UUID) AND deleted_at IS NULL
                     AND vendor_account_id IS NULL AND TRIM(vendor) <> '') AS unlinked_expenses
        """), {"pid": project_uuid})).mappings().one()
    return {
        "vendors": [_serialise(dict(r)) for r in rows],
        "unlinked_invoices": int(unlinked["unlinked_invoices"]),
        "unlinked_expenses": int(unlinked["unlinked_expenses"]),
    }


# ─── Incoming funds (REUSES donations table — explicit project link) ────────

@router.get("/admin/projects/{project_uuid}/funding")
async def list_funding(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Donations explicitly linked to this project via donations.project_id.
    The Incoming Funds dashboard already aggregates donations org-wide; this
    endpoint scopes them to one project so the detail page can show "money
    raised against this work" alongside actual spend."""
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT d.id::text, d.amount, d.currency, d.purpose, d.source,
                   d.payment_provider, d.payment_ref, d.gift_aid_eligible,
                   d.reference, d.created_at,
                   c.full_name AS donor_name, c.email AS donor_email
            FROM   donations d
            LEFT   JOIN contacts c ON c.id = d.contact_id
            WHERE  d.project_id = CAST(:pid AS UUID) AND d.deleted_at IS NULL
            ORDER  BY d.created_at DESC
            LIMIT  500
        """), {"pid": project_uuid})).mappings().all()
        totals = (await db.execute(text("""
            SELECT COALESCE(SUM(amount), 0)::numeric AS total_raised,
                   COALESCE(SUM(CASE WHEN gift_aid_eligible THEN amount * 0.25 ELSE 0 END), 0)::numeric AS gift_aid_total,
                   COUNT(*) AS txn_count
            FROM   donations
            WHERE  project_id = CAST(:pid AS UUID) AND deleted_at IS NULL
        """), {"pid": project_uuid})).mappings().one()
    return {
        "items": [_serialise(dict(r)) for r in rows],
        "total_raised":    float(totals["total_raised"]),
        "gift_aid_total":  float(totals["gift_aid_total"]),
        "txn_count":       int(totals["txn_count"]),
    }


# ─── Approval workflow ──────────────────────────────────────────────────────

class ApprovalRequestIn(BaseModel):
    kind: str = "START"          # START | CLOSE | CHANGE_BUDGET | CHANGE_SCOPE
    request_reason: str = ""


class ApprovalDecisionIn(BaseModel):
    status: str                  # APPROVED | REJECTED | WITHDRAWN
    decision_reason: str = ""


@router.get("/admin/projects/{project_uuid}/approvals")
async def list_approvals(project_uuid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT ap.id::text, ap.kind, ap.status, ap.request_reason,
                   ap.requested_by::text AS requested_by, ru.name AS requested_by_name,
                   ap.requested_at,
                   ap.approver_id::text   AS approver_id,   au.name AS approver_name,
                   ap.decided_at, ap.decision_reason
            FROM project_approvals ap
            LEFT JOIN users ru ON ru.id = ap.requested_by
            LEFT JOIN users au ON au.id = ap.approver_id
            WHERE ap.project_id = CAST(:pid AS UUID)
            ORDER BY ap.requested_at DESC
        """), {"pid": project_uuid})).mappings().all()
        # Tell the UI whether the project NEEDS an approval before ACTIVE.
        guard = (await db.execute(text("""
            SELECT budget_total, COALESCE(project_type,'GENERAL') AS project_type,
                   COALESCE(fund_type,'UNRESTRICTED') AS fund_type, status
            FROM projects WHERE id = CAST(:pid AS UUID)
        """), {"pid": project_uuid})).mappings().first()
    requires = False
    why = ""
    if guard:
        budget = float(guard["budget_total"] or 0)
        ptype = (guard["project_type"] or "").upper()
        ftype = (guard["fund_type"] or "").upper()
        if budget > APPROVAL_THRESHOLD_GBP:
            requires = True
            why = f"budget {budget:.0f} > {APPROVAL_THRESHOLD_GBP} threshold"
        elif ptype == "CAPITAL":
            requires = True
            why = "capital project"
        elif ftype in ("RESTRICTED", "ENDOWMENT"):
            requires = True
            why = f"{ftype.lower()} fund"
    return {
        "items":             [_serialise(dict(r)) for r in rows],
        "approval_required": requires,
        "approval_reason":   why,
        "threshold_gbp":     APPROVAL_THRESHOLD_GBP,
    }


@router.post("/admin/projects/{project_uuid}/approvals", status_code=201)
async def request_approval(project_uuid: str, body: ApprovalRequestIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO project_approvals (id, project_id, kind, requested_by, request_reason, status)
            VALUES (CAST(:id AS UUID), CAST(:pid AS UUID), :k,
                    CASE WHEN :uid <> '' THEN CAST(:uid AS UUID) ELSE NULL END,
                    :r, 'PENDING')
        """), {"id": new_id, "pid": project_uuid, "k": body.kind.upper(),
               "uid": str(getattr(ctx, "user_id", "") or ""), "r": body.request_reason})
        await _log_activity(db, project_uuid, ctx, "APPROVAL",
                            f"Approval requested ({body.kind})",
                            body.request_reason, new_id)
        # Approval requests notify the business_owner + project_manager so
        # they see the inbound work item.
        owners = (await db.execute(text("""
            SELECT business_owner_id::text AS bo, project_manager_id::text AS pm, name
            FROM   projects WHERE id = CAST(:p AS UUID)
        """), {"p": project_uuid})).mappings().first()
        if owners:
            await notify_many(db, [owners["bo"], owners["pm"]], kind="APPROVAL",
                              title=f"Approval requested: {body.kind} on {owners['name']}",
                              body=body.request_reason,
                              link_url=f"/finance/projects/{project_uuid}",
                              severity="WARNING")
        await db.commit()
    return {"id": new_id}


@router.put("/admin/projects/{project_uuid}/approvals/{ap_id}")
async def decide_approval(project_uuid: str, ap_id: str, body: ApprovalDecisionIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    new_status = body.status.upper()
    if new_status not in {"APPROVED", "REJECTED", "WITHDRAWN"}:
        raise HTTPException(status_code=400, detail="status must be APPROVED | REJECTED | WITHDRAWN")
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE project_approvals SET
                status = :s,
                approver_id = CASE WHEN :uid <> '' THEN CAST(:uid AS UUID) ELSE NULL END,
                decided_at = NOW(),
                decision_reason = :r
            WHERE id = CAST(:id AS UUID) AND project_id = CAST(:pid AS UUID)
              AND status = 'PENDING'
        """), {"id": ap_id, "pid": project_uuid, "s": new_status,
               "uid": str(getattr(ctx, "user_id", "") or ""), "r": body.decision_reason})
        await _log_activity(db, project_uuid, ctx, "APPROVAL",
                            f"Approval {new_status.lower()}",
                            body.decision_reason, ap_id)
        # Notify the original requester of the decision.
        req = (await db.execute(text(
            "SELECT requested_by::text AS rb FROM project_approvals WHERE id = CAST(:i AS UUID)"
        ), {"i": ap_id})).mappings().first()
        if req:
            await notify(db, req["rb"], "APPROVAL",
                         f"Approval {new_status.lower()}",
                         body.decision_reason,
                         f"/finance/projects/{project_uuid}",
                         "SUCCESS" if new_status == "APPROVED" else "ERROR")
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(status_code=404, detail="approval not found or already decided")
    return {"ok": True}


# ─── Project status transition with workflow guard ──────────────────────────

class StatusChangeIn(BaseModel):
    status: str   # DRAFT | ACTIVE | ON_HOLD | COMPLETE | CANCELLED


@router.post("/admin/projects/{project_uuid}/status-change")
async def change_status(project_uuid: str, body: StatusChangeIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Move the project to a new status. Going DRAFT → ACTIVE is gated by
    APPROVAL_THRESHOLD_GBP / CAPITAL / RESTRICTED logic — needs an APPROVED
    'START' row before it lets the move through."""
    _require_admin(ctx)
    new_status = body.status.upper()
    if new_status not in {"DRAFT", "ACTIVE", "ON_HOLD", "COMPLETE", "COMPLETED", "CANCELLED"}:
        raise HTTPException(status_code=400, detail="invalid status")
    async with SessionLocal() as db:
        proj = (await db.execute(text("""
            SELECT status, budget_total,
                   COALESCE(project_type,'GENERAL') AS project_type,
                   COALESCE(fund_type,'UNRESTRICTED') AS fund_type
            FROM projects WHERE id = CAST(:pid AS UUID)
        """), {"pid": project_uuid})).mappings().first()
        if not proj:
            raise HTTPException(status_code=404, detail="project not found")
        budget = float(proj["budget_total"] or 0)
        ptype  = (proj["project_type"] or "").upper()
        ftype  = (proj["fund_type"] or "").upper()
        requires = (budget > APPROVAL_THRESHOLD_GBP) or ptype == "CAPITAL" or ftype in ("RESTRICTED", "ENDOWMENT")
        if new_status == "ACTIVE" and (proj["status"] or "DRAFT").upper() == "DRAFT" and requires:
            ok = (await db.execute(text("""
                SELECT 1 FROM project_approvals
                WHERE project_id = CAST(:pid AS UUID)
                  AND kind = 'START' AND status = 'APPROVED'
                LIMIT 1
            """), {"pid": project_uuid})).first()
            if not ok:
                raise HTTPException(status_code=409, detail={
                    "error": "approval required",
                    "reason": (f"budget {budget:.0f} > {APPROVAL_THRESHOLD_GBP}" if budget > APPROVAL_THRESHOLD_GBP
                               else f"{ptype} / {ftype} requires approval"),
                    "next_step": "POST /admin/projects/{id}/approvals to request, then have an admin PUT it to APPROVED",
                })
        await db.execute(text("""
            UPDATE projects SET status = :s, updated_at = NOW()
            WHERE id = CAST(:pid AS UUID)
        """), {"pid": project_uuid, "s": new_status})
        await _log_activity(db, project_uuid, ctx, "STATUS_CHANGE",
                            f"Status → {new_status}", "")
        await db.commit()
    return {"ok": True, "status": new_status}
