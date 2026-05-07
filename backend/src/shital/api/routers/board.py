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
