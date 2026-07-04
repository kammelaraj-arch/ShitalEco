"""Seva shifts & volunteer booking — the temple publishes a need ("4 people at
12:30 to fill the food containers"), volunteers browse open slots and book;
volunteers can also post their own availability for trustees to match.

Web-first (service portal) but the same endpoints back the native Seva app.
Booking works for a signed-in donor (contact linked) or as a guest with
name + email. All writes idempotent where it matters (one booking per
email per shift).
"""
from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from datetime import time as dtime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["seva"])

_schema_ready = False


async def _ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS seva_shifts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                branch_id   VARCHAR(64)  NOT NULL DEFAULT 'main',
                title       VARCHAR(200) NOT NULL,
                description TEXT         NOT NULL DEFAULT '',
                starts_at   TIMESTAMPTZ  NOT NULL,
                ends_at     TIMESTAMPTZ,
                needed      SMALLINT     NOT NULL DEFAULT 1,
                status      VARCHAR(20)  NOT NULL DEFAULT 'OPEN',
                created_by  VARCHAR(120) NOT NULL DEFAULT '',
                created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        """))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS seva_bookings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shift_id   UUID NOT NULL REFERENCES seva_shifts(id) ON DELETE CASCADE,
                contact_id UUID,
                name       VARCHAR(200) NOT NULL DEFAULT '',
                email      VARCHAR(255) NOT NULL DEFAULT '',
                phone      VARCHAR(40)  NOT NULL DEFAULT '',
                status     VARCHAR(20)  NOT NULL DEFAULT 'BOOKED',
                checked_in_at  TIMESTAMPTZ,
                checked_out_at TIMESTAMPTZ,
                booked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (shift_id, email)
            )
        """))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS volunteer_availability (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                contact_id UUID,
                name      VARCHAR(200) NOT NULL DEFAULT '',
                email     VARCHAR(255) NOT NULL DEFAULT '',
                branch_id VARCHAR(64)  NOT NULL DEFAULT 'main',
                note      TEXT         NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        # Groups (Palki group, cooking help, …) with staff + volunteer members.
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS seva_groups (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                branch_id   VARCHAR(64)  NOT NULL DEFAULT 'main',
                name        VARCHAR(160) NOT NULL,
                description TEXT         NOT NULL DEFAULT '',
                status      VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
                created_by  VARCHAR(120) NOT NULL DEFAULT '',
                created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        """))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS seva_group_members (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                group_id    UUID NOT NULL REFERENCES seva_groups(id) ON DELETE CASCADE,
                member_type VARCHAR(20)  NOT NULL DEFAULT 'volunteer',
                name        VARCHAR(200) NOT NULL DEFAULT '',
                email       VARCHAR(255) NOT NULL DEFAULT '',
                phone       VARCHAR(40)  NOT NULL DEFAULT '',
                contact_id  UUID,
                added_by    VARCHAR(120) NOT NULL DEFAULT '',
                added_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                UNIQUE (group_id, email)
            )
        """))
        # Recurrence + festival tagging (added after the first release).
        await db.execute(text("ALTER TABLE seva_shifts ADD COLUMN IF NOT EXISTS series_id UUID"))
        await db.execute(text("ALTER TABLE seva_shifts ADD COLUMN IF NOT EXISTS recurrence VARCHAR(20) NOT NULL DEFAULT 'ONCE'"))
        await db.execute(text("ALTER TABLE seva_shifts ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'regular'"))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_seva_shifts_open ON seva_shifts(status, starts_at)"))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_seva_shifts_series ON seva_shifts(series_id)"))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_seva_group_members_group ON seva_group_members(group_id)"))
        await db.commit()
    _schema_ready = True


def _donor(request: Request) -> dict[str, str]:
    """Best-effort: if a donor bearer token is present, return its identity so
    a booking is linked to the account. Never raises — guests can still book."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return {}
    try:
        from shital.api.routers.donor_auth import _decode_donor_token
        c = _decode_donor_token(auth[7:])
        return {"contact_id": c.get("sub") or "", "email": (c.get("email") or "").lower(),
                "name": c.get("name") or ""}
    except Exception:  # noqa: BLE001
        return {}


# ── Public / volunteer ──────────────────────────────────────────────────────────

@router.get("/seva/shifts")
async def list_open_shifts(branch_id: str = "") -> dict[str, Any]:
    """Open, upcoming seva needs with how many are still wanted."""
    await _ensure_schema()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT s.id::text AS id, s.branch_id, s.title, s.description,
                   s.starts_at, s.ends_at, s.needed, s.status, s.kind,
                   COUNT(b.id) FILTER (WHERE b.status = 'BOOKED') AS booked
            FROM seva_shifts s
            LEFT JOIN seva_bookings b ON b.shift_id = s.id
            WHERE s.status = 'OPEN' AND s.starts_at >= NOW() - INTERVAL '2 hours'
              AND (:branch = '' OR s.branch_id = :branch)
            GROUP BY s.id
            ORDER BY s.starts_at ASC
            LIMIT 100
        """), {"branch": branch_id})).mappings().all()
    return {"shifts": [dict(r) | {"spots_left": max(0, int(r["needed"]) - int(r["booked"]))} for r in rows]}


class BookBody(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""


@router.post("/seva/shifts/{shift_id}/book")
async def book_shift(shift_id: str, body: BookBody, request: Request) -> dict[str, Any]:
    await _ensure_schema()
    who = _donor(request)
    name = (body.name or who.get("name") or "").strip()
    email = (body.email or who.get("email") or "").strip().lower()
    if not name or "@" not in email:
        raise HTTPException(400, detail="Your name and a valid email are required to book.")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        shift = (await db.execute(text("""
            SELECT s.needed, s.status,
                   COUNT(b.id) FILTER (WHERE b.status = 'BOOKED') AS booked
            FROM seva_shifts s LEFT JOIN seva_bookings b ON b.shift_id = s.id
            WHERE s.id = CAST(:id AS uuid) GROUP BY s.id
        """), {"id": shift_id})).mappings().first()
        if not shift or shift["status"] != "OPEN":
            raise HTTPException(404, detail="That seva is no longer open.")
        # Already booked by this email? Treat as success (idempotent).
        already = (await db.execute(text(
            "SELECT 1 FROM seva_bookings WHERE shift_id = CAST(:id AS uuid) AND lower(email) = :em AND status='BOOKED'"
        ), {"id": shift_id, "em": email})).first()
        if already:
            return {"ok": True, "already_booked": True}
        if int(shift["booked"]) >= int(shift["needed"]):
            raise HTTPException(409, detail="This seva is now full — thank you!")
        cid = who.get("contact_id") or None
        await db.execute(text("""
            INSERT INTO seva_bookings (id, shift_id, contact_id, name, email, phone)
            VALUES (:id, CAST(:sid AS uuid), CAST(:cid AS uuid), :name, :em, :ph)
            ON CONFLICT (shift_id, email) DO UPDATE SET status='BOOKED', name=EXCLUDED.name
        """), {"id": str(uuid.uuid4()), "sid": shift_id, "cid": cid,
               "name": name, "em": email, "ph": body.phone.strip()})
        await db.commit()
    return {"ok": True}


@router.get("/seva/my-bookings")
async def my_seva_bookings(request: Request, email: str = "") -> dict[str, Any]:
    """The caller's own seva bookings (upcoming + recent). Matched by the donor
    token if present, otherwise by the email query param. Never raises."""
    await _ensure_schema()
    who = _donor(request)
    em = (who.get("email") or email or "").strip().lower()
    cid = who.get("contact_id") or None
    if not em and not cid:
        return {"bookings": []}
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    # Build the identity match conditionally — only bind :cid (and its uuid
    # cast) when we actually have a contact id. Casting a NULL param to uuid
    # errors on asyncpg, which was 500ing the email-only path.
    ident: list[str] = []
    params: dict[str, Any] = {}
    if em:
        ident.append("lower(b.email) = :em")
        params["em"] = em
    if cid:
        ident.append("b.contact_id = CAST(:cid AS uuid)")
        params["cid"] = cid
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT b.id::text AS id, s.id::text AS shift_id, s.title, s.description,
                   s.branch_id, s.starts_at, s.kind, b.status, b.booked_at
            FROM seva_bookings b JOIN seva_shifts s ON s.id = b.shift_id
            WHERE b.status = 'BOOKED'
              AND ({" OR ".join(ident)})
              AND s.starts_at >= NOW() - INTERVAL '1 day'
            ORDER BY s.starts_at ASC
            LIMIT 100
        """), params)).mappings().all()
    return {"bookings": [dict(r) for r in rows]}


class AvailabilityBody(BaseModel):
    name: str = ""
    email: str = ""
    branch_id: str = "main"
    note: str = ""


@router.post("/seva/availability")
async def offer_availability(body: AvailabilityBody, request: Request) -> dict[str, Any]:
    await _ensure_schema()
    who = _donor(request)
    name = (body.name or who.get("name") or "").strip()
    email = (body.email or who.get("email") or "").strip().lower()
    if not name or "@" not in email:
        raise HTTPException(400, detail="Your name and a valid email are required.")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO volunteer_availability (id, contact_id, name, email, branch_id, note)
            VALUES (:id, CAST(:cid AS uuid), :name, :em, :branch, :note)
        """), {"id": str(uuid.uuid4()), "cid": who.get("contact_id") or None,
               "name": name, "em": email, "branch": body.branch_id, "note": body.note.strip()})
        await db.commit()
    return {"ok": True}


# ── Admin ───────────────────────────────────────────────────────────────────────

def _require_admin(space: CurrentSpace) -> None:
    if space.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(403, detail="SUPER_ADMIN or ADMIN required")


class ShiftBody(BaseModel):
    branch_id: str = "main"
    title: str
    description: str = ""
    needed: int = 1
    kind: str = "regular"                 # regular | festival
    recurrence: str = "once"              # once | daily | weekly
    starts_at: datetime | None = None     # for 'once'
    time: str = ""                        # 'HH:MM' for daily / weekly
    weekdays: list[int] = Field(default_factory=list)  # 0=Mon..6=Sun (weekly)
    weeks: int = 8                        # horizon for weekly
    days: int = 30                        # horizon for daily
    start_date: str = ""                  # 'YYYY-MM-DD' start for recurring


def _occurrences(body: ShiftBody) -> list[datetime]:
    """Expand a recurrence spec into concrete dated start times (cap 60)."""
    rec = (body.recurrence or "once").lower()
    if rec == "once":
        return [body.starts_at] if body.starts_at else []
    try:
        hh, mm = (body.time or "09:00").split(":")[:2]
        tod = dtime(int(hh), int(mm))
    except Exception:  # noqa: BLE001
        tod = dtime(9, 0)
    base = date.fromisoformat(body.start_date) if body.start_date else datetime.now(UTC).date()
    out: list[datetime] = []
    if rec == "daily":
        for d in range(min(max(1, body.days), 60)):
            out.append(datetime.combine(base + timedelta(days=d), tod))
    elif rec == "weekly":
        wds = {int(w) for w in (body.weekdays or [])}
        for d in range(min(max(1, body.weeks), 12) * 7):
            day = base + timedelta(days=d)
            if day.weekday() in wds:
                out.append(datetime.combine(day, tod))
    return out[:60]


@router.post("/admin/seva/shifts")
async def admin_create_shift(body: ShiftBody, space: CurrentSpace) -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    occ = _occurrences(body)
    if not occ:
        raise HTTPException(400, detail="Pick a date (one-off) or day(s) + time for a repeating seva.")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    series_id = str(uuid.uuid4()) if (body.recurrence or "once").lower() != "once" else None
    kind = "festival" if body.kind == "festival" else "regular"
    rec = (body.recurrence or "once").upper()
    async with SessionLocal() as db:
        for starts in occ:
            await db.execute(text("""
                INSERT INTO seva_shifts
                    (id, branch_id, title, description, starts_at, needed, kind, recurrence, series_id, created_by)
                VALUES (:id, :branch, :title, :desc, :starts, :needed, :kind, :rec,
                        CAST(:series AS uuid), :by)
            """), {"id": str(uuid.uuid4()), "branch": body.branch_id, "title": body.title.strip(),
                   "desc": body.description.strip(), "starts": starts, "needed": max(1, body.needed),
                   "kind": kind, "rec": rec, "series": series_id, "by": space.user_email})
        await db.commit()
    return {"ok": True, "created": len(occ), "series_id": series_id}


@router.patch("/admin/seva/series/{series_id}")
async def admin_update_series(series_id: str, space: CurrentSpace, status: str = "CLOSED") -> dict[str, Any]:
    """Close/reopen/cancel every upcoming shift in a recurring series at once."""
    _require_admin(space)
    await _ensure_schema()
    if status.upper() not in ("OPEN", "CLOSED", "CANCELLED"):
        raise HTTPException(400, detail="status must be OPEN, CLOSED or CANCELLED")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        r = await db.execute(text("""
            UPDATE seva_shifts SET status=:st, updated_at=NOW()
            WHERE series_id = CAST(:sid AS uuid) AND starts_at >= NOW()
        """), {"st": status.upper(), "sid": series_id})
        await db.commit()
    return {"ok": True, "updated": r.rowcount or 0}


@router.get("/admin/seva/shifts")
async def admin_list_shifts(space: CurrentSpace, branch_id: str = "") -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT s.id::text AS id, s.branch_id, s.title, s.description, s.starts_at,
                   s.ends_at, s.needed, s.status, s.created_at,
                   s.kind, s.recurrence, s.series_id::text AS series_id,
                   COUNT(b.id) FILTER (WHERE b.status = 'BOOKED') AS booked
            FROM seva_shifts s LEFT JOIN seva_bookings b ON b.shift_id = s.id
            WHERE (:branch = '' OR s.branch_id = :branch)
            GROUP BY s.id ORDER BY s.starts_at ASC LIMIT 300
        """), {"branch": branch_id})).mappings().all()
    return {"shifts": [dict(r) for r in rows]}


@router.get("/admin/seva/shifts/{shift_id}/bookings")
async def admin_shift_bookings(shift_id: str, space: CurrentSpace) -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text AS id, name, email, phone, status,
                   checked_in_at, checked_out_at, booked_at
            FROM seva_bookings WHERE shift_id = CAST(:id AS uuid)
            ORDER BY booked_at ASC
        """), {"id": shift_id})).mappings().all()
    return {"bookings": [dict(r) for r in rows]}


@router.patch("/admin/seva/shifts/{shift_id}")
async def admin_update_shift(shift_id: str, space: CurrentSpace, status: str = "") -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    if status.upper() not in ("OPEN", "CLOSED", "CANCELLED"):
        raise HTTPException(400, detail="status must be OPEN, CLOSED or CANCELLED")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text(
            "UPDATE seva_shifts SET status=:st, updated_at=NOW() WHERE id = CAST(:id AS uuid)"
        ), {"st": status.upper(), "id": shift_id})
        await db.commit()
    return {"ok": True}


@router.get("/admin/seva/availability")
async def admin_list_availability(space: CurrentSpace) -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text AS id, name, email, branch_id, note, created_at
            FROM volunteer_availability ORDER BY created_at DESC LIMIT 200
        """))).mappings().all()
    return {"availability": [dict(r) for r in rows]}


# ── Admin: groups (Palki group, cooking help, …) ─────────────────────────────────

class GroupBody(BaseModel):
    name: str
    description: str = ""
    branch_id: str = "main"


class GroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None       # ACTIVE | ARCHIVED


class MemberBody(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    member_type: str = "volunteer"  # staff | volunteer


@router.post("/admin/seva/groups")
async def admin_create_group(body: GroupBody, space: CurrentSpace) -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    if not body.name.strip():
        raise HTTPException(400, detail="Group name is required.")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    gid = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO seva_groups (id, branch_id, name, description, created_by)
            VALUES (:id, :branch, :name, :desc, :by)
        """), {"id": gid, "branch": body.branch_id, "name": body.name.strip(),
               "desc": body.description.strip(), "by": space.user_email})
        await db.commit()
    return {"ok": True, "id": gid}


@router.get("/admin/seva/groups")
async def admin_list_groups(space: CurrentSpace, branch_id: str = "") -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT g.id::text AS id, g.branch_id, g.name, g.description, g.status, g.created_at,
                   COUNT(m.id) AS members,
                   COUNT(m.id) FILTER (WHERE m.member_type = 'staff') AS staff,
                   COUNT(m.id) FILTER (WHERE m.member_type = 'volunteer') AS volunteers
            FROM seva_groups g LEFT JOIN seva_group_members m ON m.group_id = g.id
            WHERE (:branch = '' OR g.branch_id = :branch)
            GROUP BY g.id ORDER BY g.status ASC, g.name ASC
        """), {"branch": branch_id})).mappings().all()
    return {"groups": [dict(r) for r in rows]}


@router.patch("/admin/seva/groups/{group_id}")
async def admin_update_group(group_id: str, body: GroupUpdate, space: CurrentSpace) -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    sets: list[str] = []
    params: dict[str, Any] = {"id": group_id}
    if body.name is not None and body.name.strip():
        sets.append("name = :name")
        params["name"] = body.name.strip()
    if body.description is not None:
        sets.append("description = :desc")
        params["desc"] = body.description.strip()
    if body.status is not None:
        st = body.status.upper()
        if st not in ("ACTIVE", "ARCHIVED"):
            raise HTTPException(400, detail="status must be ACTIVE or ARCHIVED")
        sets.append("status = :st")
        params["st"] = st
    if not sets:
        return {"ok": True, "unchanged": True}
    sets.append("updated_at = NOW()")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(
            text(f"UPDATE seva_groups SET {', '.join(sets)} WHERE id = CAST(:id AS uuid)"), params)
        await db.commit()
    return {"ok": True}


@router.get("/admin/seva/groups/{group_id}/members")
async def admin_list_members(group_id: str, space: CurrentSpace) -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text AS id, member_type, name, email, phone, added_at
            FROM seva_group_members WHERE group_id = CAST(:id AS uuid)
            ORDER BY member_type ASC, name ASC
        """), {"id": group_id})).mappings().all()
    return {"members": [dict(r) for r in rows]}


@router.post("/admin/seva/groups/{group_id}/members")
async def admin_add_member(group_id: str, body: MemberBody, space: CurrentSpace) -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    name = body.name.strip()
    email = body.email.strip().lower()
    if not name or "@" not in email:
        raise HTTPException(400, detail="Member name and a valid email are required.")
    mtype = "staff" if body.member_type == "staff" else "volunteer"
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        exists = (await db.execute(text(
            "SELECT 1 FROM seva_groups WHERE id = CAST(:id AS uuid)"), {"id": group_id})).first()
        if not exists:
            raise HTTPException(404, detail="Group not found.")
        await db.execute(text("""
            INSERT INTO seva_group_members (id, group_id, member_type, name, email, phone, added_by)
            VALUES (:id, CAST(:gid AS uuid), :mt, :name, :em, :ph, :by)
            ON CONFLICT (group_id, email) DO UPDATE
              SET member_type = EXCLUDED.member_type, name = EXCLUDED.name, phone = EXCLUDED.phone
        """), {"id": str(uuid.uuid4()), "gid": group_id, "mt": mtype, "name": name,
               "em": email, "ph": body.phone.strip(), "by": space.user_email})
        await db.commit()
    return {"ok": True}


@router.delete("/admin/seva/groups/{group_id}/members/{member_id}")
async def admin_remove_member(group_id: str, member_id: str, space: CurrentSpace) -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text(
            "DELETE FROM seva_group_members WHERE id = CAST(:mid AS uuid) AND group_id = CAST(:gid AS uuid)"
        ), {"mid": member_id, "gid": group_id})
        await db.commit()
    return {"ok": True}
