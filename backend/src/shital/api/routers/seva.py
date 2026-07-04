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
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

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
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_seva_shifts_open ON seva_shifts(status, starts_at)"))
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
                   s.starts_at, s.ends_at, s.needed, s.status,
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
    starts_at: datetime
    ends_at: datetime | None = None
    needed: int = 1


@router.post("/admin/seva/shifts")
async def admin_create_shift(body: ShiftBody, space: CurrentSpace) -> dict[str, Any]:
    _require_admin(space)
    await _ensure_schema()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    sid = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO seva_shifts (id, branch_id, title, description, starts_at, ends_at, needed, created_by)
            VALUES (:id, :branch, :title, :desc, :starts, :ends, :needed, :by)
        """), {"id": sid, "branch": body.branch_id, "title": body.title.strip(),
               "desc": body.description.strip(), "starts": body.starts_at,
               "ends": body.ends_at, "needed": max(1, body.needed),
               "by": space.user_email})
        await db.commit()
    return {"ok": True, "id": sid}


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
                   COUNT(b.id) FILTER (WHERE b.status = 'BOOKED') AS booked
            FROM seva_shifts s LEFT JOIN seva_bookings b ON b.shift_id = s.id
            WHERE (:branch = '' OR s.branch_id = :branch)
            GROUP BY s.id ORDER BY s.starts_at DESC LIMIT 200
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
