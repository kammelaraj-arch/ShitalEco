"""Attendance (check-in / check-out) + Activities (named tasks assigned to
staff or volunteers).

Design notes:

- One ``attendance_log`` table covers both employees AND volunteers. The
  ``person_type`` discriminator (plus ``person_id`` UUID) means a single
  "who's on site right now" query doesn't fan out across two tables, and
  the summary "hours this week per person" is one GROUP BY.

- Open sessions are the rows with ``check_out_at IS NULL``. The migration
  puts a PARTIAL UNIQUE INDEX on (person_type, person_id) WHERE
  check_out_at IS NULL so a double-tap check-in gets a clean 409 instead
  of duplicate rows.

- ``activities`` are branch-scoped reusable task templates ("Kitchen prep",
  "Setup for puja", "Welcome desk"). ``activity_assignments`` pins a
  template to a person on a date. A volunteer can have multiple
  assignments per day; one activity can be assigned to many people.

- Everything branch-scoped via CurrentSpace. A trustee only sees + mutates
  attendance / assignments for their own branch (SUPER_ADMIN sees all).
"""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/attendance", tags=["attendance"])


# ── Shared helpers ────────────────────────────────────────────────────────────

PERSON_TYPES = ("employee", "volunteer")


def _check_person_type(pt: str) -> None:
    if pt not in PERSON_TYPES:
        raise HTTPException(400, detail=f"person_type must be one of {PERSON_TYPES}")


async def _resolve_person_name(db, person_type: str, person_id: str) -> str:
    """Human-readable name for the two source tables. Returns '' if the id
    doesn't exist — the UI falls back to the id substring."""
    tbl = "employees" if person_type == "employee" else "volunteers"
    r = (await db.execute(
        text(f"SELECT COALESCE(full_name,'') AS n FROM {tbl} WHERE id = CAST(:id AS uuid) LIMIT 1"),
        {"id": person_id},
    )).first()
    return (r[0] if r else "") or ""


def _actor(ctx: CurrentSpace) -> str:
    return getattr(ctx, "user_email", "") or "admin"


# ── Models ────────────────────────────────────────────────────────────────────

class CheckInBody(BaseModel):
    person_type: str
    person_id: str
    notes: str | None = None


class CheckOutBody(BaseModel):
    attendance_id: str | None = None  # or (person_type, person_id)
    person_type: str | None = None
    person_id: str | None = None
    notes: str | None = None


class ActivityBody(BaseModel):
    name: str
    description: str | None = None
    colour: str | None = None


class AssignBody(BaseModel):
    person_type: str
    person_id: str
    assigned_date: date
    start_time: str | None = None  # "HH:MM"
    end_time: str | None = None
    notes: str | None = None


class AssignmentStatusBody(BaseModel):
    status: str  # assigned | in_progress | done | skipped


ITEM_TYPES = ("checkbox", "text", "number", "photo", "signature")


class ChecklistItemBody(BaseModel):
    label: str
    item_type: str = "checkbox"
    required: bool = True
    help_text: str | None = None
    order_index: int = 0


class ChecklistItemsReorderBody(BaseModel):
    # [{"id": "<uuid>", "order_index": 0}, …]
    items: list[dict[str, Any]]


class ChecklistStateBody(BaseModel):
    # Whichever matches the item's type. Unused ones are ignored server-side.
    is_checked: bool | None = None
    value_text: str | None = None
    value_number: float | None = None
    photo_url: str | None = None
    signature_data: str | None = None


# ── Check-in / check-out ──────────────────────────────────────────────────────

@router.post("/check-in")
async def check_in(body: CheckInBody, ctx: CurrentSpace) -> dict[str, Any]:
    """Open a new attendance session for a person. 409 if they already have
    an open session (double-tap safety — enforced by partial unique index)."""
    _check_person_type(body.person_type)
    async with SessionLocal() as db:
        try:
            r = await db.execute(text("""
                INSERT INTO attendance_log
                    (person_type, person_id, branch_id, notes, checked_in_by)
                VALUES (:pt, CAST(:pid AS uuid), :bid, :notes, :actor)
                RETURNING id::text, check_in_at
            """), {
                "pt": body.person_type, "pid": body.person_id,
                "bid": ctx.branch_id, "notes": body.notes,
                "actor": _actor(ctx),
            })
            row = r.mappings().first()
            await db.commit()
        except Exception as exc:  # noqa: BLE001
            # Partial unique index violation = already checked in.
            if "idx_attendance_one_open_per_person" in str(exc):
                raise HTTPException(409, detail="Already checked in — check out first") from exc
            raise
    return {"id": row["id"], "check_in_at": row["check_in_at"].isoformat()}


@router.post("/check-out")
async def check_out(body: CheckOutBody, ctx: CurrentSpace) -> dict[str, Any]:
    """Close the person's open session. Accepts either the attendance_id
    (preferred — unambiguous) or a (person_type, person_id) pair (looks up
    the open row)."""
    async with SessionLocal() as db:
        if body.attendance_id:
            r = await db.execute(text("""
                UPDATE attendance_log
                SET check_out_at = NOW(), checked_out_by = :actor,
                    notes = COALESCE(NULLIF(:notes,''), notes),
                    updated_at = NOW()
                WHERE id = CAST(:id AS uuid) AND check_out_at IS NULL
                  AND branch_id = :bid
                RETURNING id::text, person_type, person_id::text, check_in_at, check_out_at
            """), {"id": body.attendance_id, "actor": _actor(ctx),
                   "notes": body.notes or "", "bid": ctx.branch_id})
        else:
            if not body.person_type or not body.person_id:
                raise HTTPException(400, detail="Pass attendance_id OR (person_type + person_id)")
            _check_person_type(body.person_type)
            r = await db.execute(text("""
                UPDATE attendance_log
                SET check_out_at = NOW(), checked_out_by = :actor,
                    notes = COALESCE(NULLIF(:notes,''), notes),
                    updated_at = NOW()
                WHERE person_type = :pt AND person_id = CAST(:pid AS uuid)
                  AND check_out_at IS NULL AND branch_id = :bid
                RETURNING id::text, person_type, person_id::text, check_in_at, check_out_at
            """), {"pt": body.person_type, "pid": body.person_id,
                   "actor": _actor(ctx), "notes": body.notes or "",
                   "bid": ctx.branch_id})
        row = r.mappings().first()
        await db.commit()
    if not row:
        raise HTTPException(404, detail="No open session found for that person")
    duration_minutes = int(
        (row["check_out_at"] - row["check_in_at"]).total_seconds() / 60
    )
    return {
        "id": row["id"], "person_type": row["person_type"],
        "person_id": row["person_id"],
        "check_in_at": row["check_in_at"].isoformat(),
        "check_out_at": row["check_out_at"].isoformat(),
        "duration_minutes": duration_minutes,
    }


@router.get("/today")
async def today(ctx: CurrentSpace) -> dict[str, Any]:
    """Who's checked in right now + everyone who checked in today (closed or
    open). Powers the kiosk-screen grid + the daily attendance log view."""
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT a.id::text, a.person_type, a.person_id::text,
                   a.check_in_at, a.check_out_at, a.notes,
                   CASE WHEN a.person_type = 'employee'
                        THEN (SELECT full_name FROM employees  WHERE id = a.person_id)
                        ELSE (SELECT full_name FROM volunteers WHERE id = a.person_id)
                   END AS name,
                   EXTRACT(EPOCH FROM (COALESCE(a.check_out_at, NOW()) - a.check_in_at))/60
                     AS duration_minutes
            FROM attendance_log a
            WHERE a.branch_id = :bid
              AND a.check_in_at::date = CURRENT_DATE
            ORDER BY (a.check_out_at IS NULL) DESC, a.check_in_at DESC
        """), {"bid": ctx.branch_id})).mappings().all()
    present = [dict(r) for r in rows if r["check_out_at"] is None]
    all_today = [dict(r) for r in rows]
    for r in present + all_today:
        if r.get("check_in_at"):
            r["check_in_at"] = r["check_in_at"].isoformat()
        if r.get("check_out_at"):
            r["check_out_at"] = r["check_out_at"].isoformat()
        r["duration_minutes"] = int(r.get("duration_minutes") or 0)
    return {"present_now": present, "all_today": all_today, "date": date.today().isoformat()}


@router.get("/open-for/{person_type}/{person_id}")
async def open_for(person_type: str, person_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Does this person have an open session? Powers the "you are checked in
    since 09:14" badge on their own self-service page."""
    _check_person_type(person_type)
    async with SessionLocal() as db:
        r = (await db.execute(text("""
            SELECT id::text, check_in_at
            FROM attendance_log
            WHERE person_type = :pt AND person_id = CAST(:pid AS uuid)
              AND check_out_at IS NULL AND branch_id = :bid
            LIMIT 1
        """), {"pt": person_type, "pid": person_id, "bid": ctx.branch_id})).mappings().first()
    if not r:
        return {"open": False}
    return {"open": True, "id": r["id"], "check_in_at": r["check_in_at"].isoformat()}


@router.get("/roster")
async def roster(ctx: CurrentSpace) -> dict[str, Any]:
    """Full list of everyone who CAN be checked in — the picker grid on the
    kiosk page. Employees first (active only, this branch), then volunteers.
    Lightweight: id + name + role."""
    async with SessionLocal() as db:
        emps = (await db.execute(text("""
            SELECT id::text AS id, COALESCE(full_name,'') AS name,
                   COALESCE(job_title,'') AS role,
                   COALESCE(photo_url,'') AS photo_url
            FROM employees
            WHERE branch_id = :bid AND is_active = true AND deleted_at IS NULL
            ORDER BY full_name
        """), {"bid": ctx.branch_id})).mappings().all()
        vols = (await db.execute(text("""
            SELECT id::text AS id, COALESCE(full_name,'') AS name,
                   COALESCE(preferred_role,'') AS role,
                   COALESCE(photo_url,'') AS photo_url
            FROM volunteers
            WHERE branch_id = :bid
              AND COALESCE(status,'') NOT IN ('ARCHIVED','INACTIVE','archived','inactive')
            ORDER BY full_name
        """), {"bid": ctx.branch_id})).mappings().all()
    return {
        "employees":  [dict(r) for r in emps],
        "volunteers": [dict(r) for r in vols],
    }


# ── Activities ────────────────────────────────────────────────────────────────

@router.get("/activities")
async def list_activities(ctx: CurrentSpace, include_archived: bool = False) -> list[dict[str, Any]]:
    where = "branch_id = :bid"
    if not include_archived:
        where += " AND archived = false"
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id::text, name, COALESCE(description,'') AS description,
                   COALESCE(colour,'') AS colour, archived, created_at
            FROM activities WHERE {where}
            ORDER BY name
        """), {"bid": ctx.branch_id})).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        d["created_at"] = r["created_at"].isoformat()
        out.append(d)
    return out


@router.post("/activities")
async def create_activity(body: ActivityBody, ctx: CurrentSpace) -> dict[str, Any]:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, detail="Name is required")
    async with SessionLocal() as db:
        try:
            r = (await db.execute(text("""
                INSERT INTO activities (branch_id, name, description, colour)
                VALUES (:bid, :name, :desc, :col)
                RETURNING id::text, name, description, colour, archived, created_at
            """), {"bid": ctx.branch_id, "name": name,
                   "desc": body.description, "col": body.colour})).mappings().first()
            await db.commit()
        except Exception as exc:  # noqa: BLE001
            if "idx_activities_unique_name" in str(exc):
                raise HTTPException(409, detail=f"An activity named '{name}' already exists here") from exc
            raise
    out = dict(r)
    out["created_at"] = r["created_at"].isoformat()
    return out


@router.post("/activities/{activity_id}/archive")
async def archive_activity(activity_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    async with SessionLocal() as db:
        r = (await db.execute(text("""
            UPDATE activities SET archived = true, updated_at = NOW()
            WHERE id = CAST(:id AS uuid) AND branch_id = :bid
            RETURNING id::text
        """), {"id": activity_id, "bid": ctx.branch_id})).first()
        await db.commit()
    if not r:
        raise HTTPException(404, detail="Activity not found")
    return {"id": r[0], "archived": True}


# ── Activity assignments ──────────────────────────────────────────────────────

@router.post("/activities/{activity_id}/assign")
async def assign_activity(activity_id: str, body: AssignBody, ctx: CurrentSpace) -> dict[str, Any]:
    _check_person_type(body.person_type)
    async with SessionLocal() as db:
        # Confirm activity belongs to this branch
        chk = (await db.execute(text(
            "SELECT 1 FROM activities WHERE id = CAST(:id AS uuid) AND branch_id = :bid"
        ), {"id": activity_id, "bid": ctx.branch_id})).first()
        if not chk:
            raise HTTPException(404, detail="Activity not found in this branch")
        r = (await db.execute(text("""
            INSERT INTO activity_assignments
                (activity_id, person_type, person_id, branch_id, assigned_date,
                 start_time, end_time, notes, assigned_by)
            VALUES
                (CAST(:aid AS uuid), :pt, CAST(:pid AS uuid), :bid, :dt,
                 NULLIF(:st,'')::time, NULLIF(:et,'')::time, :notes, :actor)
            RETURNING id::text, assigned_date, status
        """), {
            "aid": activity_id, "pt": body.person_type, "pid": body.person_id,
            "bid": ctx.branch_id, "dt": body.assigned_date,
            "st": body.start_time or "", "et": body.end_time or "",
            "notes": body.notes, "actor": _actor(ctx),
        })).mappings().first()
        await db.commit()
    return {"id": r["id"], "assigned_date": r["assigned_date"].isoformat(),
            "status": r["status"]}


@router.get("/assignments")
async def assignments(ctx: CurrentSpace,
                      person_type: str | None = None,
                      person_id: str | None = None,
                      from_date: date | None = None,
                      to_date: date | None = None) -> list[dict[str, Any]]:
    """List assignments. Filter by person (my-day view) or by date range
    (branch-wide schedule)."""
    where = ["aa.branch_id = :bid"]
    params: dict[str, Any] = {"bid": ctx.branch_id}
    if person_type:
        _check_person_type(person_type)
        where.append("aa.person_type = :pt")
        params["pt"] = person_type
    if person_id:
        where.append("aa.person_id = CAST(:pid AS uuid)")
        params["pid"] = person_id
    if from_date:
        where.append("aa.assigned_date >= :from_dt")
        params["from_dt"] = from_date
    if to_date:
        where.append("aa.assigned_date <= :to_dt")
        params["to_dt"] = to_date
    where_sql = " AND ".join(where)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT aa.id::text, aa.activity_id::text, aa.person_type,
                   aa.person_id::text, aa.assigned_date,
                   aa.start_time::text AS start_time,
                   aa.end_time::text AS end_time,
                   aa.status, COALESCE(aa.notes,'') AS notes,
                   a.name AS activity_name, a.colour AS activity_colour,
                   CASE WHEN aa.person_type = 'employee'
                        THEN (SELECT full_name FROM employees  WHERE id = aa.person_id)
                        ELSE (SELECT full_name FROM volunteers WHERE id = aa.person_id)
                   END AS person_name
            FROM activity_assignments aa
            JOIN activities a ON a.id = aa.activity_id
            WHERE {where_sql}
            ORDER BY aa.assigned_date DESC, aa.start_time NULLS LAST, a.name
            LIMIT 500
        """), params)).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        d["assigned_date"] = r["assigned_date"].isoformat()
        out.append(d)
    return out


@router.post("/assignments/{assignment_id}/status")
async def set_assignment_status(assignment_id: str, body: AssignmentStatusBody,
                                 ctx: CurrentSpace) -> dict[str, Any]:
    """Mark an assignment in_progress / done / skipped. The volunteer
    themselves can do this from their my-day view."""
    allowed = {"assigned", "in_progress", "done", "skipped"}
    if body.status not in allowed:
        raise HTTPException(400, detail=f"status must be one of {allowed}")
    async with SessionLocal() as db:
        r = (await db.execute(text("""
            UPDATE activity_assignments
            SET status = :st,
                completed_at = CASE WHEN :st = 'done'
                                    THEN COALESCE(completed_at, NOW())
                                    ELSE NULL END,
                updated_at = NOW()
            WHERE id = CAST(:id AS uuid) AND branch_id = :bid
            RETURNING id::text, status
        """), {"id": assignment_id, "st": body.status, "bid": ctx.branch_id})).mappings().first()
        await db.commit()
    if not r:
        raise HTTPException(404, detail="Assignment not found")
    return dict(r)


@router.delete("/assignments/{assignment_id}")
async def delete_assignment(assignment_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    async with SessionLocal() as db:
        r = (await db.execute(text("""
            DELETE FROM activity_assignments
            WHERE id = CAST(:id AS uuid) AND branch_id = :bid
            RETURNING id::text
        """), {"id": assignment_id, "bid": ctx.branch_id})).first()
        await db.commit()
    if not r:
        raise HTTPException(404, detail="Assignment not found")
    return {"id": r[0], "deleted": True}


# ── Checklist items (phase 1 custom lists) ────────────────────────────────────

async def _activity_belongs_to_branch(db, activity_id: str, branch_id: str) -> bool:
    """Guard: block cross-branch mutation of someone else's template."""
    r = (await db.execute(text("""
        SELECT 1 FROM activities
        WHERE id = CAST(:id AS uuid) AND branch_id = :bid LIMIT 1
    """), {"id": activity_id, "bid": branch_id})).first()
    return bool(r)


@router.get("/activities/{activity_id}/checklist-items")
async def list_checklist_items(activity_id: str, ctx: CurrentSpace) -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        if not await _activity_belongs_to_branch(db, activity_id, ctx.branch_id):
            raise HTTPException(404, detail="Activity not found")
        rows = (await db.execute(text("""
            SELECT id::text, label, item_type, required,
                   COALESCE(help_text,'') AS help_text, order_index
            FROM activity_checklist_items
            WHERE activity_id = CAST(:aid AS uuid)
            ORDER BY order_index, created_at
        """), {"aid": activity_id})).mappings().all()
    return [dict(r) for r in rows]


@router.post("/activities/{activity_id}/checklist-items")
async def create_checklist_item(activity_id: str, body: ChecklistItemBody,
                                 ctx: CurrentSpace) -> dict[str, Any]:
    if body.item_type not in ITEM_TYPES:
        raise HTTPException(400, detail=f"item_type must be one of {ITEM_TYPES}")
    label = (body.label or "").strip()
    if not label:
        raise HTTPException(400, detail="label is required")
    async with SessionLocal() as db:
        if not await _activity_belongs_to_branch(db, activity_id, ctx.branch_id):
            raise HTTPException(404, detail="Activity not found")
        # If no order_index provided, append at the end
        order_index = body.order_index
        if order_index <= 0:
            next_r = (await db.execute(text("""
                SELECT COALESCE(MAX(order_index), 0) + 1 AS n
                FROM activity_checklist_items
                WHERE activity_id = CAST(:aid AS uuid)
            """), {"aid": activity_id})).first()
            order_index = int(next_r[0]) if next_r else 1
        r = (await db.execute(text("""
            INSERT INTO activity_checklist_items
                (activity_id, label, item_type, required, help_text, order_index)
            VALUES
                (CAST(:aid AS uuid), :label, :it, :req, :help, :ord)
            RETURNING id::text, label, item_type, required,
                      COALESCE(help_text,'') AS help_text, order_index
        """), {
            "aid": activity_id, "label": label, "it": body.item_type,
            "req": body.required, "help": body.help_text, "ord": order_index,
        })).mappings().first()
        await db.commit()
    return dict(r)


@router.patch("/checklist-items/{item_id}")
async def update_checklist_item(item_id: str, body: ChecklistItemBody,
                                 ctx: CurrentSpace) -> dict[str, Any]:
    if body.item_type not in ITEM_TYPES:
        raise HTTPException(400, detail=f"item_type must be one of {ITEM_TYPES}")
    label = (body.label or "").strip()
    if not label:
        raise HTTPException(400, detail="label is required")
    async with SessionLocal() as db:
        # Branch-scope the item via its parent activity
        own = (await db.execute(text("""
            SELECT 1 FROM activity_checklist_items ci
            JOIN activities a ON a.id = ci.activity_id
            WHERE ci.id = CAST(:id AS uuid) AND a.branch_id = :bid LIMIT 1
        """), {"id": item_id, "bid": ctx.branch_id})).first()
        if not own:
            raise HTTPException(404, detail="Checklist item not found")
        r = (await db.execute(text("""
            UPDATE activity_checklist_items
            SET label = :label, item_type = :it, required = :req,
                help_text = :help, order_index = :ord, updated_at = NOW()
            WHERE id = CAST(:id AS uuid)
            RETURNING id::text, label, item_type, required,
                      COALESCE(help_text,'') AS help_text, order_index
        """), {
            "id": item_id, "label": label, "it": body.item_type,
            "req": body.required, "help": body.help_text,
            "ord": body.order_index,
        })).mappings().first()
        await db.commit()
    return dict(r)


@router.delete("/checklist-items/{item_id}")
async def delete_checklist_item(item_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    async with SessionLocal() as db:
        r = await db.execute(text("""
            DELETE FROM activity_checklist_items ci
            USING activities a
            WHERE ci.id = CAST(:id AS uuid)
              AND ci.activity_id = a.id
              AND a.branch_id = :bid
            RETURNING ci.id::text
        """), {"id": item_id, "bid": ctx.branch_id})
        row = r.first()
        await db.commit()
    if not row:
        raise HTTPException(404, detail="Checklist item not found")
    return {"id": row[0], "deleted": True}


@router.post("/activities/{activity_id}/checklist-items/reorder")
async def reorder_checklist_items(activity_id: str, body: ChecklistItemsReorderBody,
                                   ctx: CurrentSpace) -> dict[str, Any]:
    """Bulk-set order_index values after a drag-and-drop reorder in the UI."""
    async with SessionLocal() as db:
        if not await _activity_belongs_to_branch(db, activity_id, ctx.branch_id):
            raise HTTPException(404, detail="Activity not found")
        for item in body.items:
            iid = item.get("id") or ""
            oidx = int(item.get("order_index") or 0)
            if not iid:
                continue
            await db.execute(text("""
                UPDATE activity_checklist_items
                SET order_index = :ord, updated_at = NOW()
                WHERE id = CAST(:id AS uuid)
                  AND activity_id = CAST(:aid AS uuid)
            """), {"id": iid, "ord": oidx, "aid": activity_id})
        await db.commit()
    return {"ok": True, "reordered": len(body.items)}


# ── Checklist state (per-assignment tick-off) ─────────────────────────────────

@router.get("/assignments/{assignment_id}/checklist")
async def get_assignment_checklist(assignment_id: str,
                                    ctx: CurrentSpace) -> dict[str, Any]:
    """Full checklist for an assignment — template items joined with their
    per-instance tick state. UI uses this to render the volunteer-facing
    checklist. If the state row doesn't exist yet it's returned as blank
    (is_checked=false, no values)."""
    async with SessionLocal() as db:
        a = (await db.execute(text("""
            SELECT activity_id::text AS activity_id, status
            FROM activity_assignments
            WHERE id = CAST(:id AS uuid) AND branch_id = :bid LIMIT 1
        """), {"id": assignment_id, "bid": ctx.branch_id})).mappings().first()
        if not a:
            raise HTTPException(404, detail="Assignment not found")
        rows = (await db.execute(text("""
            SELECT ci.id::text AS item_id, ci.label, ci.item_type, ci.required,
                   COALESCE(ci.help_text,'') AS help_text, ci.order_index,
                   COALESCE(st.is_checked, false) AS is_checked,
                   COALESCE(st.value_text,'') AS value_text,
                   st.value_number,
                   COALESCE(st.photo_url,'') AS photo_url,
                   COALESCE(st.signature_data,'') AS signature_data,
                   COALESCE(st.checked_by,'') AS checked_by,
                   st.checked_at
            FROM activity_checklist_items ci
            LEFT JOIN activity_assignment_checklist_state st
                   ON st.item_id = ci.id
                  AND st.assignment_id = CAST(:aid AS uuid)
            WHERE ci.activity_id = CAST(:tid AS uuid)
            ORDER BY ci.order_index, ci.id
        """), {"aid": assignment_id, "tid": a["activity_id"]})).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        if d.get("checked_at"):
            d["checked_at"] = d["checked_at"].isoformat()
        if d.get("value_number") is not None:
            d["value_number"] = float(d["value_number"])
        out.append(d)
    return {"assignment_id": assignment_id, "status": a["status"], "items": out}


@router.post("/assignments/{assignment_id}/checklist/{item_id}")
async def set_assignment_checklist_item(assignment_id: str, item_id: str,
                                         body: ChecklistStateBody,
                                         ctx: CurrentSpace) -> dict[str, Any]:
    """Toggle / set an item's state. UPSERT by (assignment, item). After the
    write, if every REQUIRED item on the template is now satisfied (checked
    for checkbox / non-null value for the others), auto-flip the assignment
    status to 'done'."""
    async with SessionLocal() as db:
        own = (await db.execute(text("""
            SELECT aa.activity_id::text AS activity_id, aa.id::text AS id
            FROM activity_assignments aa
            JOIN activity_checklist_items ci
              ON ci.id = CAST(:item_id AS uuid)
             AND ci.activity_id = aa.activity_id
            WHERE aa.id = CAST(:aid AS uuid) AND aa.branch_id = :bid LIMIT 1
        """), {"aid": assignment_id, "item_id": item_id,
                "bid": ctx.branch_id})).mappings().first()
        if not own:
            raise HTTPException(404, detail="Assignment or item not found in branch")

        await db.execute(text("""
            INSERT INTO activity_assignment_checklist_state
                (assignment_id, item_id, is_checked, value_text,
                 value_number, photo_url, signature_data,
                 checked_by, checked_at)
            VALUES
                (CAST(:aid AS uuid), CAST(:iid AS uuid),
                 COALESCE(:is_checked, false), NULLIF(:value_text,''),
                 :value_number, NULLIF(:photo_url,''),
                 NULLIF(:signature_data,''),
                 :actor, NOW())
            ON CONFLICT (assignment_id, item_id) DO UPDATE SET
                is_checked     = EXCLUDED.is_checked,
                value_text     = COALESCE(EXCLUDED.value_text, activity_assignment_checklist_state.value_text),
                value_number   = COALESCE(EXCLUDED.value_number, activity_assignment_checklist_state.value_number),
                photo_url      = COALESCE(EXCLUDED.photo_url, activity_assignment_checklist_state.photo_url),
                signature_data = COALESCE(EXCLUDED.signature_data, activity_assignment_checklist_state.signature_data),
                checked_by     = EXCLUDED.checked_by,
                checked_at     = NOW(),
                updated_at     = NOW()
        """), {
            "aid": assignment_id, "iid": item_id,
            "is_checked": body.is_checked,
            "value_text": body.value_text or "",
            "value_number": body.value_number,
            "photo_url": body.photo_url or "",
            "signature_data": body.signature_data or "",
            "actor": _actor(ctx),
        })

        # Auto-complete: if every REQUIRED item on the template is satisfied,
        # flip the assignment to 'done'. "Satisfied" means:
        #   checkbox   → is_checked = true
        #   text       → value_text non-empty
        #   number     → value_number non-null
        #   photo      → photo_url non-empty
        #   signature  → signature_data non-empty
        remaining = (await db.execute(text("""
            SELECT COUNT(*) AS n
            FROM activity_checklist_items ci
            LEFT JOIN activity_assignment_checklist_state st
                   ON st.item_id = ci.id
                  AND st.assignment_id = CAST(:aid AS uuid)
            WHERE ci.activity_id = CAST(:tid AS uuid)
              AND ci.required = true
              AND NOT (
                     (ci.item_type = 'checkbox'  AND COALESCE(st.is_checked, false))
                  OR (ci.item_type = 'text'      AND COALESCE(st.value_text,'') <> '')
                  OR (ci.item_type = 'number'    AND st.value_number IS NOT NULL)
                  OR (ci.item_type = 'photo'     AND COALESCE(st.photo_url,'') <> '')
                  OR (ci.item_type = 'signature' AND COALESCE(st.signature_data,'') <> '')
              )
        """), {"aid": assignment_id, "tid": own["activity_id"]})).first()
        remaining_count = int(remaining[0]) if remaining else 0

        if remaining_count == 0:
            await db.execute(text("""
                UPDATE activity_assignments
                SET status = 'done',
                    completed_at = COALESCE(completed_at, NOW()),
                    updated_at = NOW()
                WHERE id = CAST(:aid AS uuid)
                  AND status <> 'done'
            """), {"aid": assignment_id})
        else:
            # Partial progress → bump status to in_progress if it was still 'assigned'
            await db.execute(text("""
                UPDATE activity_assignments
                SET status = 'in_progress', updated_at = NOW()
                WHERE id = CAST(:aid AS uuid)
                  AND status = 'assigned'
            """), {"aid": assignment_id})
        await db.commit()
    return {"ok": True, "remaining_required": remaining_count,
            "status": "done" if remaining_count == 0 else "in_progress"}
