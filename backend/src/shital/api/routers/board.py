"""Board of Trustees — Resolutions & Voting (PR 1/6: foundation).

This PR delivers the foundation tables and CRUD only:
  - Trustee directory (full_name, email, role, term, is_active)
  - Meetings (type, mode, scheduled_at, status, minutes status)
  - Governing Rules (singleton — quorum, casting vote, written-resolution
    rules, notice period, retention)

Follows Charity Commission good-practice expectations (CC25, CC29, CC8):
  - Trustees act collectively. Officers (CHAIR / TREASURER / SECRETARY)
    have role markers but no decision-overrides; the board decides.
  - Conflicts of interest get first-class plumbing in PR 5.
  - Audit log row written for every state-changing action.

Endpoints (all admin-gated for now; per-role gating comes in PR 4):
  GET    /admin/board/trustees                list / search / filter
  POST   /admin/board/trustees                create
  GET    /admin/board/trustees/{id}           detail
  PUT    /admin/board/trustees/{id}           update
  DELETE /admin/board/trustees/{id}           soft-delete (set is_active=false)

  GET    /admin/board/governing-rules         read singleton
  PUT    /admin/board/governing-rules         update singleton

  GET    /admin/board/meetings                list / filter
  POST   /admin/board/meetings                create (status=SCHEDULED)
  GET    /admin/board/meetings/{id}           detail
  PUT    /admin/board/meetings/{id}           update
  DELETE /admin/board/meetings/{id}           cancel (status=CANCELLED)
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime
from math import ceil
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi import status as http_status
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["board"])

VALID_ROLES = {"CHAIR", "TREASURER", "SECRETARY", "TRUSTEE"}
VALID_MEETING_TYPES = {"TRUSTEE_MEETING", "COMMITTEE", "AGM", "EMERGENCY"}
VALID_MEETING_MODES = {"IN_PERSON", "VIRTUAL", "HYBRID"}
VALID_MEETING_STATUSES = {"SCHEDULED", "OPENED", "CLOSED", "CANCELLED"}


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )


def _looks_uuid(s: str | None) -> bool:
    if not s:
        return False
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


def _parse_dt(s: str | None, field: str, errs: list[str]) -> datetime | None:
    if not s:
        return None
    # Accept either YYYY-MM-DDTHH:MM(:SS) or YYYY-MM-DD HH:MM
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    errs.append(f"{field} must be ISO datetime (e.g. 2026-05-08T19:30), got '{s}'")
    return None


async def _audit(
    db: Any, *, action: str, entity_type: str, entity_id: str | None,
    actor_id: str, actor_name: str, metadata: dict[str, Any] | None = None,
    ip: str = "", ua: str = "",
) -> None:
    """Write a board_audit_log entry. Caller is inside an async session."""
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
            (id, actor_user_id, actor_name, action, entity_type, entity_id,
             metadata, ip_address, user_agent, created_at)
        VALUES (:id, :actor, :actor_name, :action, :etype, :eid,
                CAST(:meta AS jsonb), :ip, :ua, :now)
    """), {
        "id": str(uuid.uuid4()),
        "actor": actor_id if _looks_uuid(actor_id) else None,
        "actor_name": actor_name[:255],
        "action": action,
        "etype": entity_type,
        "eid": entity_id if _looks_uuid(entity_id) else None,
        "meta": json.dumps(metadata or {}),
        "ip": ip[:45], "ua": ua[:500],
        "now": datetime.now(UTC),
    })


# ─── Trustees ─────────────────────────────────────────────────────────────────

class TrusteeCreate(BaseModel):
    full_name: str
    email: str
    role: str = "TRUSTEE"
    user_id: str | None = None
    phone: str = ""
    address: str = ""
    postcode: str = ""
    term_start: str | None = None
    term_end: str | None = None
    notes: str = ""


class TrusteeUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    role: str | None = None
    user_id: str | None = None
    phone: str | None = None
    address: str | None = None
    postcode: str | None = None
    term_start: str | None = None
    term_end: str | None = None
    notes: str | None = None
    is_active: bool | None = None


def _validate_trustee_role(role: str | None) -> list[str]:
    errs: list[str] = []
    if role and role not in VALID_ROLES:
        errs.append(f"role '{role}' must be one of: {', '.join(sorted(VALID_ROLES))}")
    return errs


def _trustee_row(r: Any) -> dict[str, Any]:
    d = dict(r)
    for k in ("id", "user_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    for k in ("term_start", "term_end", "created_at", "updated_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
    return d


@router.get("/admin/board/trustees")
async def list_trustees(
    ctx: CurrentSpace,
    is_active: bool | None = None, role: str = "", search: str = "",
    limit: int = 100, offset: int = 0,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {"limit": max(1, min(limit, 500)), "offset": max(0, offset)}
    if is_active is not None:
        where.append("is_active = :is_active")
        params["is_active"] = is_active
    if role:
        if role not in VALID_ROLES:
            raise HTTPException(400, detail={"errors": [f"role '{role}' invalid"]})
        where.append("role = :role")
        params["role"] = role
    if search.strip():
        where.append("(LOWER(full_name) LIKE :search OR LOWER(email) LIKE :search)")
        params["search"] = f"%{search.strip().lower()}%"
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT id, user_id, full_name, email, role, phone,
                   address, postcode, term_start, term_end,
                   notes, is_active, created_at, updated_at
            FROM   trustees
            {where_sql}
            ORDER  BY CASE role
                          WHEN 'CHAIR' THEN 1
                          WHEN 'TREASURER' THEN 2
                          WHEN 'SECRETARY' THEN 3
                          ELSE 4
                      END, full_name
            LIMIT  :limit OFFSET :offset
        """), params)
        items = [_trustee_row(r._mapping) for r in rows]
        total = (await db.execute(
            text(f"SELECT COUNT(*) AS n FROM trustees {where_sql}"), params,
        )).scalar_one()
    return {"items": items, "total": total}


@router.post("/admin/board/trustees")
async def create_trustee(
    body: TrusteeCreate, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    errs = _validate_trustee_role(body.role)
    if not body.full_name.strip():
        errs.append("full_name is required")
    if not body.email.strip() or "@" not in body.email:
        errs.append("a valid email is required")
    ts = _parse_date(body.term_start, "term_start", errs)
    te = _parse_date(body.term_end, "term_end", errs)
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    new_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO trustees
                (id, user_id, full_name, email, role, phone, address, postcode,
                 term_start, term_end, notes, is_active, created_at, updated_at)
            VALUES
                (:id, :user_id, :full_name, :email, :role, :phone, :address, :postcode,
                 :term_start, :term_end, :notes, true, :now, :now)
        """), {
            "id": new_id, "user_id": body.user_id if _looks_uuid(body.user_id) else None,
            "full_name": body.full_name.strip(), "email": body.email.strip().lower(),
            "role": body.role, "phone": body.phone, "address": body.address,
            "postcode": body.postcode, "term_start": ts, "term_end": te,
            "notes": body.notes, "now": now,
        })
        await _audit(
            db, action="TRUSTEE_CREATED", entity_type="trustees", entity_id=new_id,
            actor_id=str(ctx.user_id), actor_name=ctx.user_email,
            metadata={"role": body.role, "name": body.full_name},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.get("/admin/board/trustees/{trustee_id}")
async def get_trustee(trustee_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if not _looks_uuid(trustee_id):
        raise HTTPException(400, detail="trustee_id must be UUID")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT * FROM trustees WHERE id::text = :id"),
            {"id": trustee_id},
        )).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Trustee not found")
    return {"trustee": _trustee_row(row)}


@router.put("/admin/board/trustees/{trustee_id}")
async def update_trustee(
    trustee_id: str, body: TrusteeUpdate, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    if not _looks_uuid(trustee_id):
        raise HTTPException(400, detail="trustee_id must be UUID")

    updates = body.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        return {"id": trustee_id, "success": True, "no_op": True}

    errs: list[str] = []
    if "role" in updates:
        errs.extend(_validate_trustee_role(updates["role"]))
    if "term_start" in updates:
        d = _parse_date(updates["term_start"], "term_start", errs)
        updates["term_start"] = d
    if "term_end" in updates:
        d = _parse_date(updates["term_end"], "term_end", errs)
        updates["term_end"] = d
    if "user_id" in updates and updates["user_id"] and not _looks_uuid(updates["user_id"]):
        errs.append("user_id must be UUID")
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = trustee_id
    updates["now"] = datetime.now(UTC)

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        existing = (await db.execute(
            text("SELECT id, role, full_name FROM trustees WHERE id::text = :id"),
            {"id": trustee_id},
        )).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Trustee not found")
        await db.execute(
            text(f"UPDATE trustees SET {set_clauses}, updated_at = :now WHERE id::text = :id"),
            updates,
        )
        await _audit(
            db, action="TRUSTEE_UPDATED", entity_type="trustees", entity_id=trustee_id,
            actor_id=str(ctx.user_id), actor_name=ctx.user_email,
            metadata={"changed_fields": list(body.model_dump(exclude_unset=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": trustee_id, "success": True}


@router.delete("/admin/board/trustees/{trustee_id}")
async def deactivate_trustee(
    trustee_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Soft-delete: flip is_active=false. Trustee is preserved in the audit
    trail; their past votes and meeting attendances stay attributable."""
    _require_admin(ctx)
    if not _looks_uuid(trustee_id):
        raise HTTPException(400, detail="trustee_id must be UUID")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE trustees SET is_active = false, updated_at = :now
            WHERE id::text = :id AND is_active = true
            RETURNING id
        """), {"id": trustee_id, "now": now})
        row = result.mappings().one_or_none()
        if not row:
            raise HTTPException(404, detail="Trustee not found or already inactive")
        await _audit(
            db, action="TRUSTEE_DEACTIVATED", entity_type="trustees",
            entity_id=trustee_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": trustee_id, "success": True}


# ─── Governing rules ──────────────────────────────────────────────────────────

class GoverningRulesUpdate(BaseModel):
    quorum_min: int | None = None
    quorum_fraction_numerator: int | None = None
    quorum_fraction_denominator: int | None = None
    chair_casting_vote_enabled: bool | None = None
    written_resolution_requires_unanimous: bool | None = None
    anonymous_ballot_for_officer_elections: bool | None = None
    notice_period_days: int | None = None
    data_retention_years: int | None = None


def _rules_row(r: Any) -> dict[str, Any]:
    d = dict(r)
    d["id"] = str(d["id"])
    for k in ("created_at", "updated_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
    # Compute effective quorum given current active trustee count, so the UI
    # can show "currently 4 trustees → quorum is 3" without re-implementing
    # the formula client-side.
    return d


@router.get("/admin/board/governing-rules")
async def get_governing_rules(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT * FROM governing_rules WHERE scope = 'DEFAULT'"),
        )).mappings().one_or_none()
        if not row:
            # Defensive — schema seeds this; race-condition fallback only.
            await db.execute(
                text("INSERT INTO governing_rules (scope) VALUES ('DEFAULT') ON CONFLICT DO NOTHING"),
            )
            await db.commit()
            row = (await db.execute(
                text("SELECT * FROM governing_rules WHERE scope = 'DEFAULT'"),
            )).mappings().one_or_none()
            assert row is not None
        active_count = (await db.execute(
            text("SELECT COUNT(*) FROM trustees WHERE is_active = true"),
        )).scalar_one() or 0
    rules = _rules_row(row)
    rules["active_trustees"] = int(active_count)
    rules["effective_quorum"] = max(
        rules["quorum_min"],
        ceil(int(active_count) * rules["quorum_fraction_numerator"]
             / max(1, rules["quorum_fraction_denominator"])),
    )
    return {"rules": rules}


@router.put("/admin/board/governing-rules")
async def update_governing_rules(
    body: GoverningRulesUpdate, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    updates = body.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        return {"success": True, "no_op": True}

    errs: list[str] = []
    if "quorum_min" in updates and updates["quorum_min"] < 1:
        errs.append("quorum_min must be >= 1")
    if "quorum_fraction_denominator" in updates and updates["quorum_fraction_denominator"] < 1:
        errs.append("quorum_fraction_denominator must be >= 1")
    if "quorum_fraction_numerator" in updates and updates["quorum_fraction_numerator"] < 1:
        errs.append("quorum_fraction_numerator must be >= 1")
    if "notice_period_days" in updates and updates["notice_period_days"] < 0:
        errs.append("notice_period_days must be >= 0")
    if "data_retention_years" in updates and updates["data_retention_years"] < 1:
        errs.append("data_retention_years must be >= 1")
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
    updates["now"] = datetime.now(UTC)

    async with SessionLocal() as db:
        await db.execute(
            text(f"UPDATE governing_rules SET {set_clauses}, updated_at = :now WHERE scope = 'DEFAULT'"),
            updates,
        )
        await _audit(
            db, action="GOVERNING_RULES_UPDATED", entity_type="governing_rules",
            entity_id=None, actor_id=str(ctx.user_id), actor_name=ctx.user_email,
            metadata={"changed_fields": list(body.model_dump(exclude_unset=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"success": True}


# ─── Meetings ─────────────────────────────────────────────────────────────────

class MeetingCreate(BaseModel):
    meeting_type: str = "TRUSTEE_MEETING"
    mode: str = "IN_PERSON"
    title: str = ""
    scheduled_at: str  # ISO datetime
    location: str = ""
    video_link: str = ""
    organiser_id: str | None = None
    agenda: str = ""
    notes: str = ""


class MeetingUpdate(BaseModel):
    meeting_type: str | None = None
    mode: str | None = None
    title: str | None = None
    scheduled_at: str | None = None
    location: str | None = None
    video_link: str | None = None
    organiser_id: str | None = None
    agenda: str | None = None
    notes: str | None = None
    minutes_text: str | None = None


def _meeting_row(r: Any) -> dict[str, Any]:
    d = dict(r)
    for k in ("id", "organiser_id", "created_by"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    for k in ("scheduled_at", "opened_at", "closed_at",
              "minutes_approved_at", "created_at", "updated_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
    return d


@router.get("/admin/board/meetings")
async def list_meetings(
    ctx: CurrentSpace,
    status_filter: str = "", meeting_type: str = "",
    upcoming_only: bool = False, limit: int = 50, offset: int = 0,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {"limit": max(1, min(limit, 200)), "offset": max(0, offset)}
    if status_filter:
        if status_filter not in VALID_MEETING_STATUSES:
            raise HTTPException(400, detail={"errors": [f"status '{status_filter}' invalid"]})
        where.append("status = :status")
        params["status"] = status_filter
    if meeting_type:
        if meeting_type not in VALID_MEETING_TYPES:
            raise HTTPException(400, detail={"errors": [f"meeting_type '{meeting_type}' invalid"]})
        where.append("meeting_type = :meeting_type")
        params["meeting_type"] = meeting_type
    if upcoming_only:
        where.append("scheduled_at >= :now AND status = 'SCHEDULED'")
        params["now"] = datetime.now(UTC)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT id, meeting_type, mode, title, scheduled_at, location,
                   video_link, organiser_id, agenda, attendance, quorum_at_open,
                   status, opened_at, closed_at, minutes_status, minutes_text,
                   minutes_approved_at, notes, created_by, created_at, updated_at
            FROM   board_meetings
            {where_sql}
            ORDER  BY scheduled_at DESC
            LIMIT  :limit OFFSET :offset
        """), params)
        items = [_meeting_row(r._mapping) for r in rows]
        total = (await db.execute(
            text(f"SELECT COUNT(*) AS n FROM board_meetings {where_sql}"), params,
        )).scalar_one()
    return {"items": items, "total": total}


@router.post("/admin/board/meetings")
async def create_meeting(
    body: MeetingCreate, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    errs: list[str] = []
    if body.meeting_type not in VALID_MEETING_TYPES:
        errs.append(f"meeting_type must be one of: {', '.join(sorted(VALID_MEETING_TYPES))}")
    if body.mode not in VALID_MEETING_MODES:
        errs.append(f"mode must be one of: {', '.join(sorted(VALID_MEETING_MODES))}")
    sched = _parse_dt(body.scheduled_at, "scheduled_at", errs)
    if not sched:
        errs.append("scheduled_at is required")
    if body.organiser_id and not _looks_uuid(body.organiser_id):
        errs.append("organiser_id must be UUID")
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    new_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO board_meetings (
                id, meeting_type, mode, title, scheduled_at, location,
                video_link, organiser_id, agenda, attendance, status,
                minutes_status, notes, created_by, created_at, updated_at
            ) VALUES (
                :id, :meeting_type, :mode, :title, :scheduled_at, :location,
                :video_link, :organiser_id, :agenda, CAST('[]' AS jsonb), 'SCHEDULED',
                'NOT_STARTED', :notes, :created_by, :now, :now
            )
        """), {
            "id": new_id, "meeting_type": body.meeting_type, "mode": body.mode,
            "title": body.title, "scheduled_at": sched, "location": body.location,
            "video_link": body.video_link,
            "organiser_id": body.organiser_id if _looks_uuid(body.organiser_id) else None,
            "agenda": body.agenda, "notes": body.notes,
            "created_by": str(ctx.user_id) if _looks_uuid(str(ctx.user_id)) else None,
            "now": now,
        })
        await _audit(
            db, action="MEETING_CREATED", entity_type="board_meetings",
            entity_id=new_id, actor_id=str(ctx.user_id), actor_name=ctx.user_email,
            metadata={"type": body.meeting_type, "mode": body.mode,
                      "scheduled_at": body.scheduled_at},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.get("/admin/board/meetings/{meeting_id}")
async def get_meeting(meeting_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if not _looks_uuid(meeting_id):
        raise HTTPException(400, detail="meeting_id must be UUID")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT * FROM board_meetings WHERE id::text = :id"),
            {"id": meeting_id},
        )).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Meeting not found")
    return {"meeting": _meeting_row(row)}


@router.put("/admin/board/meetings/{meeting_id}")
async def update_meeting(
    meeting_id: str, body: MeetingUpdate, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    if not _looks_uuid(meeting_id):
        raise HTTPException(400, detail="meeting_id must be UUID")

    updates = body.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        return {"id": meeting_id, "success": True, "no_op": True}

    errs: list[str] = []
    if "meeting_type" in updates and updates["meeting_type"] not in VALID_MEETING_TYPES:
        errs.append(f"meeting_type '{updates['meeting_type']}' invalid")
    if "mode" in updates and updates["mode"] not in VALID_MEETING_MODES:
        errs.append(f"mode '{updates['mode']}' invalid")
    if "scheduled_at" in updates:
        sched = _parse_dt(updates["scheduled_at"], "scheduled_at", errs)
        updates["scheduled_at"] = sched
    if "organiser_id" in updates and updates["organiser_id"] and not _looks_uuid(updates["organiser_id"]):
        errs.append("organiser_id must be UUID")
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    # If minutes_text is being set on a CLOSED meeting and minutes_status is
    # NOT_STARTED, flip it to DRAFT for the natural workflow.
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        existing = (await db.execute(
            text("SELECT id, status, minutes_status FROM board_meetings WHERE id::text = :id"),
            {"id": meeting_id},
        )).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Meeting not found")

        if "minutes_text" in updates and existing["minutes_status"] == "NOT_STARTED":
            updates["minutes_status"] = "DRAFT"

        set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
        updates["id"] = meeting_id
        updates["now"] = datetime.now(UTC)
        await db.execute(
            text(f"UPDATE board_meetings SET {set_clauses}, updated_at = :now WHERE id::text = :id"),
            updates,
        )
        await _audit(
            db, action="MEETING_UPDATED", entity_type="board_meetings",
            entity_id=meeting_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            metadata={"changed_fields": list(body.model_dump(exclude_unset=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": meeting_id, "success": True}


@router.delete("/admin/board/meetings/{meeting_id}")
async def cancel_meeting(
    meeting_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Soft-cancel a meeting (status = CANCELLED). A meeting that was OPENED
    or CLOSED cannot be cancelled — only SCHEDULED ones; once a vote has
    happened, the record stands."""
    _require_admin(ctx)
    if not _looks_uuid(meeting_id):
        raise HTTPException(400, detail="meeting_id must be UUID")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        existing = (await db.execute(
            text("SELECT id, status FROM board_meetings WHERE id::text = :id"),
            {"id": meeting_id},
        )).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Meeting not found")
        if existing["status"] in {"OPENED", "CLOSED"}:
            raise HTTPException(
                400,
                detail="Cannot cancel a meeting that has already been opened. "
                       "Mark it CLOSED with a note in the minutes if needed.",
            )
        await db.execute(text("""
            UPDATE board_meetings SET status = 'CANCELLED', updated_at = :now
            WHERE id::text = :id
        """), {"id": meeting_id, "now": now})
        await _audit(
            db, action="MEETING_CANCELLED", entity_type="board_meetings",
            entity_id=meeting_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": meeting_id, "success": True}


# ─── Resolutions + Voting (PR 2) ──────────────────────────────────────────────
#
# Lifecycle: DRAFT → OPEN → CLOSED → (optionally) ARCHIVED
#   DRAFT  — created by a trustee (or admin on their behalf). Editable by
#            creator + admin only. Other trustees cannot silently override.
#   OPEN   — voting active. Trustees cast/change their own vote. The
#            resolution text itself is locked — amendments require a new
#            sibling resolution (PR 5 will add structured amendments).
#   CLOSED — voting tallied. Outcome computed against effective_quorum.
#            Tied? If governing_rules.chair_casting_vote_enabled, Chair can
#            cast a separate casting vote via /casting-vote endpoint, which
#            updates the outcome. Otherwise outcome is DEFERRED.
#   ARCHIVED — soft-archive (hidden from default lists). Retains audit trail.
#
# Charity Commission CC25 alignment: trustees vote individually. Officers
# (Chair / Treasurer / Secretary) have NO authority to override the board.
# Even Chair can only cast a *casting* vote on a tie when the rules permit.
# All endpoints write to board_audit_log atomically.

VALID_RESOLUTION_STATUSES = {"DRAFT", "OPEN", "CLOSED", "ARCHIVED"}
VALID_RESOLUTION_CATEGORIES = {
    "OPERATIONAL", "OFFICER_ELECTION", "POLICY", "CONTRACT", "CONSTITUTIONAL",
}
VALID_DECISION_TYPES = {"BOARD_MEETING", "WRITTEN_RESOLUTION", "RETROSPECTIVE"}
VALID_VOTE_CHOICES = {"FOR", "AGAINST", "ABSTAIN"}


class ResolutionCreate(BaseModel):
    title: str
    background: str = ""
    recommendation: str = ""
    risk_impact: str = ""
    budget_impact: str = ""
    category: str = "OPERATIONAL"
    decision_type: str = "BOARD_MEETING"
    meeting_id: str | None = None
    decision_date: str | None = None
    is_retrospective: bool = False
    retrospective_reason: str = ""
    created_by_trustee_id: str | None = None


class ResolutionUpdate(BaseModel):
    title: str | None = None
    background: str | None = None
    recommendation: str | None = None
    risk_impact: str | None = None
    budget_impact: str | None = None
    category: str | None = None
    decision_type: str | None = None
    meeting_id: str | None = None
    decision_date: str | None = None
    is_retrospective: bool | None = None
    retrospective_reason: str | None = None


class VoteCast(BaseModel):
    trustee_id: str
    choice: str
    comment: str = ""
    anonymous: bool = False


class CastingVote(BaseModel):
    """Chair-only — used to break a tie after CLOSED computed outcome=TIED."""
    choice: str  # FOR or AGAINST


def _resolution_row(r: Any) -> dict[str, Any]:
    d = dict(r)
    for k in ("id", "meeting_id", "created_by", "created_by_trustee_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    for k in ("decision_date", "published_at", "closed_at",
              "created_at", "updated_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
    return d


def _vote_row(r: Any, *, redact: bool = False) -> dict[str, Any]:
    d = dict(r)
    for k in ("id", "resolution_id", "trustee_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    for k in ("voted_at", "updated_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
    if redact and d.get("anonymous"):
        # Anonymous ballot — strip identity from the row before returning.
        d["trustee_id"] = None
        d["trustee_name"] = "Anonymous"
        d["comment"] = ""
    return d


def _validate_resolution_payload(
    *, category: str | None, decision_type: str | None,
) -> list[str]:
    errs: list[str] = []
    if category is not None and category not in VALID_RESOLUTION_CATEGORIES:
        cats = ", ".join(sorted(VALID_RESOLUTION_CATEGORIES))
        errs.append(f"category must be one of: {cats}")
    if decision_type is not None and decision_type not in VALID_DECISION_TYPES:
        types = ", ".join(sorted(VALID_DECISION_TYPES))
        errs.append(f"decision_type must be one of: {types}")
    return errs



# ─── Resolution endpoints ─────────────────────────────────────────────────────

async def _compute_outcome(
    db: Any, *, resolution_id: str,
) -> tuple[int, int, int, int, int, str]:
    """Compute (tally_for, tally_against, tally_abstain, total_votes,
    effective_quorum, outcome_label) for a resolution at close time.

    Outcome labels:
      CARRIED       — for > against AND quorum met
      NOT_CARRIED   — against >= for AND quorum met
      DEFERRED      — quorum not met
      TIED          — for == against, quorum met. Caller decides next step
                      (chair casting vote OR DEFERRED).
    """
    from sqlalchemy import text

    tallies = await db.execute(text("""
        SELECT choice, COUNT(*) AS n
        FROM   resolution_votes
        WHERE  resolution_id::text = :id
        GROUP  BY choice
    """), {"id": resolution_id})
    counts = {row._mapping["choice"]: int(row._mapping["n"]) for row in tallies}
    tally_for = counts.get("FOR", 0)
    tally_against = counts.get("AGAINST", 0)
    tally_abstain = counts.get("ABSTAIN", 0)
    total = tally_for + tally_against + tally_abstain

    rules_row = (await db.execute(
        text("""SELECT quorum_min, quorum_fraction_numerator,
                       quorum_fraction_denominator
                FROM governing_rules WHERE scope = 'DEFAULT'"""),
    )).mappings().one_or_none()
    active = (await db.execute(
        text("SELECT COUNT(*) FROM trustees WHERE is_active = true"),
    )).scalar_one() or 0
    if rules_row:
        eq = max(
            int(rules_row["quorum_min"]),
            ceil(int(active) * int(rules_row["quorum_fraction_numerator"])
                 / max(1, int(rules_row["quorum_fraction_denominator"]))),
        )
    else:
        eq = 3  # safe fallback

    if total < eq:
        outcome = "DEFERRED"
    elif tally_for == tally_against:
        outcome = "TIED"
    elif tally_for > tally_against:
        outcome = "CARRIED"
    else:
        outcome = "NOT_CARRIED"
    return (tally_for, tally_against, tally_abstain, total, eq, outcome)


@router.get("/admin/board/resolutions")
async def list_resolutions(
    ctx: CurrentSpace,
    status_filter: str = "", category: str = "",
    meeting_id: str = "", search: str = "",
    limit: int = 50, offset: int = 0,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {"limit": max(1, min(limit, 200)), "offset": max(0, offset)}
    if status_filter:
        if status_filter not in VALID_RESOLUTION_STATUSES:
            raise HTTPException(400, detail={"errors": [f"status '{status_filter}' invalid"]})
        where.append("status = :status")
        params["status"] = status_filter
    if category:
        if category not in VALID_RESOLUTION_CATEGORIES:
            raise HTTPException(400, detail={"errors": [f"category '{category}' invalid"]})
        where.append("category = :category")
        params["category"] = category
    if meeting_id:
        if not _looks_uuid(meeting_id):
            raise HTTPException(400, detail="meeting_id must be UUID")
        where.append("meeting_id::text = :meeting_id")
        params["meeting_id"] = meeting_id
    if search.strip():
        where.append("LOWER(title) LIKE :search")
        params["search"] = f"%{search.strip().lower()}%"
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT id, meeting_id, title, category, decision_type, status,
                   decision_date, is_retrospective, outcome, outcome_summary,
                   tally_for, tally_against, tally_abstain,
                   casting_vote_used, casting_vote_choice,
                   created_by_trustee_id, created_at, updated_at, published_at, closed_at
            FROM   resolutions
            {where_sql}
            ORDER  BY
              CASE status WHEN 'OPEN' THEN 1 WHEN 'DRAFT' THEN 2
                          WHEN 'CLOSED' THEN 3 ELSE 4 END,
              created_at DESC
            LIMIT  :limit OFFSET :offset
        """), params)
        items = [_resolution_row(r._mapping) for r in rows]
        total = (await db.execute(
            text(f"SELECT COUNT(*) FROM resolutions {where_sql}"), params,
        )).scalar_one()
    return {"items": items, "total": total}


@router.post("/admin/board/resolutions")
async def create_resolution(
    body: ResolutionCreate, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    errs = _validate_resolution_payload(category=body.category, decision_type=body.decision_type)
    if not body.title.strip():
        errs.append("title is required")
    dec_dt = _parse_date(body.decision_date, "decision_date", errs)
    if body.meeting_id and not _looks_uuid(body.meeting_id):
        errs.append("meeting_id must be UUID")
    if body.created_by_trustee_id and not _looks_uuid(body.created_by_trustee_id):
        errs.append("created_by_trustee_id must be UUID")
    # Retrospective records can't be Constitutional or Officer Election by
    # policy (per the spec: those decisions can never be back-dated).
    if body.is_retrospective and body.category in {"CONSTITUTIONAL", "OFFICER_ELECTION"}:
        errs.append("Retrospective records are not allowed for Constitutional or Officer Election decisions")
    if body.is_retrospective and not body.retrospective_reason.strip():
        errs.append("retrospective_reason is required for retrospective records")
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    new_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO resolutions (
                id, meeting_id, title, background, recommendation,
                risk_impact, budget_impact, category, decision_type,
                status, decision_date, is_retrospective, retrospective_reason,
                created_by, created_by_trustee_id, created_at, updated_at
            ) VALUES (
                :id, :meeting_id, :title, :background, :recommendation,
                :risk_impact, :budget_impact, :category, :decision_type,
                'DRAFT', :decision_date, :is_retro, :retro_reason,
                :created_by, :created_by_trustee_id, :now, :now
            )
        """), {
            "id": new_id,
            "meeting_id": body.meeting_id if _looks_uuid(body.meeting_id) else None,
            "title": body.title.strip(), "background": body.background,
            "recommendation": body.recommendation, "risk_impact": body.risk_impact,
            "budget_impact": body.budget_impact, "category": body.category,
            "decision_type": body.decision_type, "decision_date": dec_dt,
            "is_retro": body.is_retrospective,
            "retro_reason": body.retrospective_reason,
            "created_by": str(ctx.user_id) if _looks_uuid(str(ctx.user_id)) else None,
            "created_by_trustee_id": body.created_by_trustee_id if _looks_uuid(body.created_by_trustee_id) else None,
            "now": now,
        })
        await _audit(
            db, action="RESOLUTION_DRAFTED", entity_type="resolutions",
            entity_id=new_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            metadata={"title": body.title, "category": body.category,
                      "decision_type": body.decision_type,
                      "is_retrospective": body.is_retrospective},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.get("/admin/board/resolutions/{resolution_id}")
async def get_resolution(resolution_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if not _looks_uuid(resolution_id):
        raise HTTPException(400, detail="resolution_id must be UUID")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        rec = (await db.execute(
            text("SELECT * FROM resolutions WHERE id::text = :id"),
            {"id": resolution_id},
        )).mappings().one_or_none()
        if not rec:
            raise HTTPException(404, detail="Resolution not found")
        votes_rows = await db.execute(text("""
            SELECT v.id, v.resolution_id, v.trustee_id, v.choice, v.anonymous,
                   v.comment, v.voted_at, v.updated_at,
                   t.full_name AS trustee_name, t.role AS trustee_role
            FROM   resolution_votes v
            LEFT JOIN trustees t ON t.id = v.trustee_id
            WHERE  v.resolution_id::text = :id
            ORDER  BY v.voted_at
        """), {"id": resolution_id})
        # For OFFICER_ELECTION resolutions the trustee names are redacted in
        # the response if anonymous-ballot governance is enabled. PR 5 does
        # the full per-rule logic; here we keep names visible.
        votes = [_vote_row(r._mapping) for r in votes_rows]
    return {"resolution": _resolution_row(rec), "votes": votes}


@router.put("/admin/board/resolutions/{resolution_id}")
async def update_resolution(
    resolution_id: str, body: ResolutionUpdate, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Edit a DRAFT resolution. Once OPEN/CLOSED, edits are refused — this is
    the separation-of-duties / decision-integrity guarantee. Amendments to a
    published resolution require a new sibling resolution (PR 5)."""
    _require_admin(ctx)
    if not _looks_uuid(resolution_id):
        raise HTTPException(400, detail="resolution_id must be UUID")

    updates = body.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        return {"id": resolution_id, "success": True, "no_op": True}

    errs = _validate_resolution_payload(
        category=updates.get("category"),
        decision_type=updates.get("decision_type"),
    )
    if "decision_date" in updates:
        d = _parse_date(updates["decision_date"], "decision_date", errs)
        updates["decision_date"] = d
    if "meeting_id" in updates and updates["meeting_id"] and not _looks_uuid(updates["meeting_id"]):
        errs.append("meeting_id must be UUID")
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        existing = (await db.execute(
            text("SELECT id, status FROM resolutions WHERE id::text = :id"),
            {"id": resolution_id},
        )).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Resolution not found")
        if existing["status"] != "DRAFT":
            raise HTTPException(
                400,
                detail=f"Cannot edit a resolution in {existing['status']} status. "
                       "Once published, the text is locked. Create a new "
                       "amendment resolution instead.",
            )
        set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
        updates["id"] = resolution_id
        updates["now"] = datetime.now(UTC)
        await db.execute(
            text(f"UPDATE resolutions SET {set_clauses}, updated_at = :now WHERE id::text = :id"),
            updates,
        )
        await _audit(
            db, action="RESOLUTION_UPDATED", entity_type="resolutions",
            entity_id=resolution_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            metadata={"changed_fields": list(body.model_dump(exclude_unset=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": resolution_id, "success": True}


@router.post("/admin/board/resolutions/{resolution_id}/publish")
async def publish_resolution(
    resolution_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Move DRAFT → OPEN. Trustees can now cast votes. Resolution text is
    locked from this point forward."""
    _require_admin(ctx)
    if not _looks_uuid(resolution_id):
        raise HTTPException(400, detail="resolution_id must be UUID")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        existing = (await db.execute(
            text("SELECT id, status, title FROM resolutions WHERE id::text = :id"),
            {"id": resolution_id},
        )).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Resolution not found")
        if existing["status"] != "DRAFT":
            raise HTTPException(400, detail=f"Cannot publish from status {existing['status']}")
        await db.execute(text("""
            UPDATE resolutions SET status = 'OPEN', published_at = :now,
                                   updated_at = :now
            WHERE id::text = :id
        """), {"id": resolution_id, "now": now})
        await _audit(
            db, action="RESOLUTION_PUBLISHED", entity_type="resolutions",
            entity_id=resolution_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            metadata={"title": existing["title"]},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": resolution_id, "status": "OPEN", "success": True}


@router.post("/admin/board/resolutions/{resolution_id}/votes")
async def cast_vote(
    resolution_id: str, body: VoteCast, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Cast (or update) a vote on behalf of a trustee. Each trustee gets
    exactly one vote per resolution; calling again with the same trustee_id
    updates the existing vote up until the resolution is CLOSED.

    Separation-of-duties: this endpoint is admin-gated for now. Per-trustee
    self-service voting (where a trustee can ONLY change their own vote)
    arrives in PR 4 with role-aware permissions. Until then, every cast is
    audit-logged with actor + chosen trustee_id, so any "cast on behalf of"
    is fully traceable."""
    _require_admin(ctx)
    if not _looks_uuid(resolution_id):
        raise HTTPException(400, detail="resolution_id must be UUID")
    if not _looks_uuid(body.trustee_id):
        raise HTTPException(400, detail={"errors": ["trustee_id must be UUID"]})
    if body.choice not in VALID_VOTE_CHOICES:
        raise HTTPException(400, detail={"errors": [
            f"choice must be FOR | AGAINST | ABSTAIN, got '{body.choice}'",
        ]})

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        res = (await db.execute(
            text("SELECT id, status FROM resolutions WHERE id::text = :id"),
            {"id": resolution_id},
        )).mappings().one_or_none()
        if not res:
            raise HTTPException(404, detail="Resolution not found")
        if res["status"] != "OPEN":
            raise HTTPException(400, detail=f"Cannot vote on a resolution in {res['status']} status")
        trustee = (await db.execute(
            text("SELECT id, full_name, is_active FROM trustees WHERE id::text = :id"),
            {"id": body.trustee_id},
        )).mappings().one_or_none()
        if not trustee:
            raise HTTPException(404, detail="Trustee not found")
        if not trustee["is_active"]:
            raise HTTPException(400, detail="Trustee is inactive — cannot vote")

        # Upsert: one vote per trustee per resolution.
        await db.execute(text("""
            INSERT INTO resolution_votes
                (id, resolution_id, trustee_id, choice, anonymous, comment,
                 voted_at, updated_at)
            VALUES
                (:id, :rid, :tid, :choice, :anonymous, :comment, :now, :now)
            ON CONFLICT (resolution_id, trustee_id) DO UPDATE SET
                choice = EXCLUDED.choice,
                anonymous = EXCLUDED.anonymous,
                comment = EXCLUDED.comment,
                updated_at = :now
        """), {
            "id": str(uuid.uuid4()), "rid": res["id"], "tid": trustee["id"],
            "choice": body.choice, "anonymous": body.anonymous,
            "comment": body.comment, "now": now,
        })
        await _audit(
            db, action="VOTE_CAST", entity_type="resolutions",
            entity_id=resolution_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            metadata={"trustee_id": body.trustee_id,
                      "trustee_name": trustee["full_name"],
                      "choice": body.choice, "anonymous": body.anonymous},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"resolution_id": resolution_id, "trustee_id": body.trustee_id,
            "choice": body.choice, "success": True}


@router.delete("/admin/board/resolutions/{resolution_id}/votes/{trustee_id}")
async def rescind_vote(
    resolution_id: str, trustee_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Remove a trustee's vote (only while OPEN). Audit-logged."""
    _require_admin(ctx)
    if not _looks_uuid(resolution_id) or not _looks_uuid(trustee_id):
        raise HTTPException(400, detail="resolution_id and trustee_id must be UUIDs")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        res = (await db.execute(
            text("SELECT id, status FROM resolutions WHERE id::text = :id"),
            {"id": resolution_id},
        )).mappings().one_or_none()
        if not res:
            raise HTTPException(404, detail="Resolution not found")
        if res["status"] != "OPEN":
            raise HTTPException(400, detail=f"Cannot rescind a vote on a {res['status']} resolution")
        result = await db.execute(text("""
            DELETE FROM resolution_votes
            WHERE resolution_id::text = :rid AND trustee_id::text = :tid
            RETURNING id
        """), {"rid": resolution_id, "tid": trustee_id})
        if not result.mappings().one_or_none():
            raise HTTPException(404, detail="Vote not found")
        await _audit(
            db, action="VOTE_RESCINDED", entity_type="resolutions",
            entity_id=resolution_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            metadata={"trustee_id": trustee_id},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"success": True}


@router.post("/admin/board/resolutions/{resolution_id}/close")
async def close_resolution(
    resolution_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Close voting and compute outcome. Outcome can be CARRIED, NOT_CARRIED,
    DEFERRED (quorum not met) or TIED (split, awaiting Chair casting vote
    if rules permit)."""
    _require_admin(ctx)
    if not _looks_uuid(resolution_id):
        raise HTTPException(400, detail="resolution_id must be UUID")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        existing = (await db.execute(
            text("SELECT id, status FROM resolutions WHERE id::text = :id"),
            {"id": resolution_id},
        )).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Resolution not found")
        if existing["status"] != "OPEN":
            raise HTTPException(400, detail=f"Can only close an OPEN resolution; current: {existing['status']}")

        tally_for, tally_against, tally_abstain, total, eq, outcome = await _compute_outcome(
            db, resolution_id=resolution_id,
        )
        # If TIED and casting vote is enabled, leave status OPEN-but-tied for
        # the Chair to act. Otherwise close immediately with the outcome.
        rules = (await db.execute(
            text("SELECT chair_casting_vote_enabled FROM governing_rules WHERE scope = 'DEFAULT'"),
        )).mappings().one_or_none()
        casting_enabled = bool(rules and rules["chair_casting_vote_enabled"])

        if outcome == "TIED" and casting_enabled:
            # Stay OPEN, set outcome=TIED so UI shows the casting-vote prompt.
            await db.execute(text("""
                UPDATE resolutions
                SET tally_for = :f, tally_against = :a, tally_abstain = :b,
                    quorum_at_close = :total, effective_quorum_at_close = :eq,
                    outcome = 'TIED',
                    outcome_summary = :sum,
                    updated_at = :now
                WHERE id::text = :id
            """), {
                "f": tally_for, "a": tally_against, "b": tally_abstain,
                "total": total, "eq": eq, "id": resolution_id, "now": now,
                "sum": f"Tied {tally_for}-{tally_against}, abstain {tally_abstain}. "
                       f"Awaiting Chair casting vote.",
            })
            outcome_label = "TIED"
        else:
            close_outcome = outcome
            if outcome == "TIED" and not casting_enabled:
                close_outcome = "DEFERRED"
            summary = (
                f"For {tally_for}, against {tally_against}, abstain {tally_abstain}. "
                f"Quorum {total}/{eq} ({'met' if total >= eq else 'NOT MET'}). "
                f"Outcome: {close_outcome}."
            )
            await db.execute(text("""
                UPDATE resolutions
                SET status = 'CLOSED',
                    closed_at = :now,
                    tally_for = :f, tally_against = :a, tally_abstain = :b,
                    quorum_at_close = :total, effective_quorum_at_close = :eq,
                    outcome = :outcome,
                    outcome_summary = :summary,
                    updated_at = :now
                WHERE id::text = :id
            """), {
                "f": tally_for, "a": tally_against, "b": tally_abstain,
                "total": total, "eq": eq, "outcome": close_outcome,
                "summary": summary, "id": resolution_id, "now": now,
            })
            outcome_label = close_outcome

        await _audit(
            db, action="RESOLUTION_CLOSED", entity_type="resolutions",
            entity_id=resolution_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            metadata={
                "tally_for": tally_for, "tally_against": tally_against,
                "tally_abstain": tally_abstain, "quorum_total": total,
                "effective_quorum": eq, "outcome": outcome_label,
            },
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {
        "resolution_id": resolution_id,
        "outcome": outcome_label,
        "tally_for": tally_for, "tally_against": tally_against,
        "tally_abstain": tally_abstain,
        "quorum_total": total, "effective_quorum": eq,
        "success": True,
    }


@router.post("/admin/board/resolutions/{resolution_id}/casting-vote")
async def chair_casting_vote(
    resolution_id: str, body: CastingVote, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Chair-only: cast the deciding vote on a TIED resolution. The casting
    vote is recorded as a separate action (not as an additional regular
    vote) so the audit trail makes its special status explicit."""
    _require_admin(ctx)
    if not _looks_uuid(resolution_id):
        raise HTTPException(400, detail="resolution_id must be UUID")
    if body.choice not in {"FOR", "AGAINST"}:
        raise HTTPException(400, detail={"errors": [
            "casting vote choice must be FOR or AGAINST (not ABSTAIN)",
        ]})

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        existing = (await db.execute(
            text("""SELECT id, status, outcome, tally_for, tally_against,
                           tally_abstain, quorum_at_close, effective_quorum_at_close
                    FROM resolutions WHERE id::text = :id"""),
            {"id": resolution_id},
        )).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Resolution not found")
        if existing["outcome"] != "TIED":
            raise HTTPException(
                400,
                detail=f"Casting vote only applies when outcome=TIED, got {existing['outcome']}",
            )
        rules = (await db.execute(
            text("SELECT chair_casting_vote_enabled FROM governing_rules WHERE scope = 'DEFAULT'"),
        )).mappings().one_or_none()
        if not rules or not rules["chair_casting_vote_enabled"]:
            raise HTTPException(400, detail="Casting vote is not permitted by governing rules")

        # Verify the actor is the Chair. Match via user_id on the trustee row.
        chair = (await db.execute(text("""
            SELECT id, full_name FROM trustees
            WHERE  role = 'CHAIR' AND is_active = true AND user_id::text = :uid
        """), {"uid": str(ctx.user_id)})).mappings().one_or_none()
        if not chair:
            raise HTTPException(403, detail=(
                "Casting vote is restricted to the Chair (matched by user_id "
                "on the trustees record). If you believe this is an error, "
                "ensure your user account is linked to the Chair trustee row."
            ))

        new_outcome = "CARRIED" if body.choice == "FOR" else "NOT_CARRIED"
        summary = (
            f"For {existing['tally_for']}, against {existing['tally_against']}, "
            f"abstain {existing['tally_abstain']}. Tied at close. "
            f"Chair {chair['full_name']} cast a casting vote {body.choice}. "
            f"Outcome: {new_outcome}."
        )
        await db.execute(text("""
            UPDATE resolutions
            SET status = 'CLOSED',
                closed_at = :now,
                outcome = :outcome,
                outcome_summary = :summary,
                casting_vote_used = true,
                casting_vote_choice = :choice,
                updated_at = :now
            WHERE id::text = :id
        """), {
            "outcome": new_outcome, "summary": summary,
            "choice": body.choice, "id": resolution_id, "now": now,
        })
        await _audit(
            db, action="CASTING_VOTE_CAST", entity_type="resolutions",
            entity_id=resolution_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            metadata={
                "chair_trustee_id": str(chair["id"]),
                "chair_name": chair["full_name"],
                "choice": body.choice, "new_outcome": new_outcome,
            },
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"resolution_id": resolution_id, "outcome": new_outcome, "success": True}
