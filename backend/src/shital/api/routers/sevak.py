"""Sevak — volunteer mobile/web app API (Tier 1 foundation).

Powers the Sevak hybrid app (Flutter, web + Android) for volunteers, on top of
the existing long-term Volunteer Registration (`volunteers` table) and Sava
one-day signups. Tier 1 covers the app-facing layer that did not exist yet:

  • Volunteer sign-in   — email one-time code → JWT (also password + set-password)
  • Push devices        — register/remove FCM tokens
  • Help requests       — coordinators post "volunteers needed", volunteers respond
  • Notification inbox  — in-app notifications + unread counts

Identity reuses the existing `volunteers` rows (status='APPROVED'); only
*approved* volunteers can sign in. JWTs are minted with the same helper and
secret as staff auth, so `shital.api.deps.get_current_space` validates them.

Later tiers (rota, chat, events, attendance, community, safeguarding) extend
this same router family. New tables are created idempotently in
`main.py:_patch_schema()` — see the `# ── Sevak app ──` block there.
"""
from __future__ import annotations

import json
import os
import random
import time
import uuid
from datetime import UTC, date, datetime, time as dtime, timedelta
from typing import Any, Literal

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr

logger = structlog.get_logger()

from shital.api.deps import CurrentSpace
from shital.capabilities.auth.capabilities import (
    _create_access_token,
    _hash_password,
    _verify_password,
)
from shital.capabilities.notifications.capabilities import EmailInput, send_email
from shital.core.space.context import DigitalSpace

router = APIRouter(tags=["sevak"])

CODE_TTL_MINUTES = 10
COORDINATOR_ROLES = {"COORDINATOR", "BRANCH_ADMIN", "SUPER_ADMIN", "ADMIN"}


# ─── Helpers ────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(UTC)


async def _approved_volunteer_by_email(db, email: str) -> dict[str, Any] | None:
    """Return an APPROVED volunteer row (with app_role) for this email, or None."""
    from sqlalchemy import text
    res = await db.execute(text("""
        SELECT id, first_names, last_name, email, branch_id, preferred_branches,
               COALESCE(app_role, 'volunteer') AS app_role
        FROM   volunteers
        WHERE  LOWER(email) = :email AND UPPER(status) = 'APPROVED'
        ORDER  BY created_at DESC
        LIMIT  1
    """), {"email": email.strip().lower()})
    row = res.mappings().first()
    return dict(row) if row else None


def _branch_ids(vol: dict[str, Any]) -> list[str]:
    pb = vol.get("preferred_branches") or []
    if isinstance(pb, str):
        import json
        try:
            pb = json.loads(pb)
        except ValueError:
            pb = []
    ids = [str(b) for b in pb if b]
    if vol.get("branch_id") and vol["branch_id"] not in ids:
        ids.insert(0, str(vol["branch_id"]))
    return ids or ["main"]


def _volunteer_payload(vol: dict[str, Any]) -> dict[str, Any]:
    name = f"{vol.get('first_names', '')} {vol.get('last_name', '')}".strip()
    return {
        "id": str(vol["id"]),
        "name": name or "Volunteer",
        "email": vol["email"],
        "role": vol.get("app_role", "volunteer"),
        "branch_ids": _branch_ids(vol),
    }


def _session(vol: dict[str, Any]) -> dict[str, Any]:
    payload = _volunteer_payload(vol)
    token = _create_access_token(
        payload["id"], payload["email"],
        payload["role"].upper(), payload["branch_ids"][0],
    )
    return {"token": token, "volunteer": payload}


_fcm_token_cache: dict[str, Any] = {}


async def _fcm_access_token() -> str | None:
    """OAuth token for FCM HTTP v1 from a service-account JSON. Returns None
    (push disabled) unless GOOGLE_APPLICATION_CREDENTIALS + FCM_PROJECT_ID are set."""
    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not path or not os.environ.get("FCM_PROJECT_ID") or not os.path.exists(path):
        return None
    if _fcm_token_cache.get("exp", 0) > time.time() + 60:
        return _fcm_token_cache["token"]
    import httpx
    from jose import jwt as jose_jwt
    with open(path) as f:
        sa = json.load(f)
    now = int(time.time())
    assertion = jose_jwt.encode(
        {"iss": sa["client_email"],
         "scope": "https://www.googleapis.com/auth/firebase.messaging",
         "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 3600},
        sa["private_key"], algorithm="RS256")
    async with httpx.AsyncClient() as client:
        r = await client.post("https://oauth2.googleapis.com/token", data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion}, timeout=15)
    if r.status_code != 200:
        return None
    body = r.json()
    _fcm_token_cache.update(token=body["access_token"],
                            exp=time.time() + body.get("expires_in", 3600))
    return body["access_token"]


async def _send_push(db, volunteer_ids: list[str], title: str, body: str,
                     data: dict[str, str] | None = None) -> None:
    """Best-effort FCM push to a set of volunteers' devices. Never raises —
    push must never break the request that triggered it. No-op if FCM unconfigured."""
    try:
        if not volunteer_ids:
            return
        access = await _fcm_access_token()
        if not access:
            return  # push not configured — silently skip
        from sqlalchemy import text
        rows = await db.execute(text(
            "SELECT fcm_token FROM volunteer_devices WHERE volunteer_id = ANY(:ids)"),
            {"ids": volunteer_ids})
        tokens = [r["fcm_token"] for r in rows.mappings().all()]
        if not tokens:
            return
        import httpx
        project = os.environ["FCM_PROJECT_ID"]
        url = f"https://fcm.googleapis.com/v1/projects/{project}/messages:send"
        headers = {"Authorization": f"Bearer {access}"}
        async with httpx.AsyncClient(timeout=15) as client:
            for tk in tokens:
                msg = {"message": {"token": tk,
                                   "notification": {"title": title, "body": body},
                                   "data": data or {},
                                   "android": {"priority": "high"}}}
                await client.post(url, headers=headers, json=msg)
    except Exception as exc:  # noqa: BLE001 — push is best-effort
        logger.warning("sevak_push_failed", error=str(exc))


async def _current_volunteer(db, ctx: DigitalSpace) -> dict[str, Any]:
    """Load the signed-in volunteer's row from the JWT subject."""
    from sqlalchemy import text
    res = await db.execute(text("""
        SELECT id, first_names, last_name, email, branch_id, preferred_branches,
               COALESCE(app_role, 'volunteer') AS app_role
        FROM volunteers WHERE id = :id
    """), {"id": ctx.user_id})
    row = res.mappings().first()
    if not row:
        raise HTTPException(401, "Volunteer not found")
    return dict(row)


# ─── 14a. Auth — email one-time code, password, JWT ─────────────────────────

class RequestCodeBody(BaseModel):
    email: EmailStr


@router.post("/service/auth/request-code")
async def request_code(body: RequestCodeBody) -> dict[str, Any]:
    """Email a 6-digit sign-in code to an approved volunteer. Always returns
    ok (no account enumeration)."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        vol = await _approved_volunteer_by_email(db, body.email)
        if vol is not None:
            code = f"{random.SystemRandom().randint(0, 999999):06d}"
            await db.execute(text("""
                INSERT INTO volunteer_auth_codes (id, email, code, expires_at, created_at)
                VALUES (:id, :email, :code, :exp, :now)
            """), {
                "id": str(uuid.uuid4()), "email": body.email.strip().lower(),
                "code": code, "exp": _now() + timedelta(minutes=CODE_TTL_MINUTES),
                "now": _now(),
            })
            await db.commit()
            anon = DigitalSpace(
                user_id="sevak", user_email=body.email, role="DEVOTEE",
                branch_id="main", permissions=[], session_id=str(uuid.uuid4()),
            )
            await send_email(anon, EmailInput(
                to=body.email,
                subject="Your SHITAL Sevak sign-in code",
                html_body=(
                    f"<p>Your SHITAL Sevak sign-in code is "
                    f"<strong style='font-size:20px'>{code}</strong>.</p>"
                    f"<p>It expires in {CODE_TTL_MINUTES} minutes. "
                    f"If you didn't request this, please ignore this email.</p>"),
                text_body=f"Your SHITAL Sevak sign-in code is {code} "
                          f"(expires in {CODE_TTL_MINUTES} minutes).",
            ))
    return {"ok": True}


class VerifyBody(BaseModel):
    email: EmailStr
    code: str


@router.post("/service/auth/verify")
async def verify_code(body: VerifyBody) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text("""
            SELECT id FROM volunteer_auth_codes
            WHERE email = :email AND code = :code
              AND used_at IS NULL AND expires_at > :now
            ORDER BY created_at DESC LIMIT 1
        """), {"email": body.email.strip().lower(),
               "code": body.code.strip(), "now": _now()})
        row = res.mappings().first()
        if not row:
            raise HTTPException(400, "Invalid or expired code")
        await db.execute(
            text("UPDATE volunteer_auth_codes SET used_at = :now WHERE id = :id"),
            {"now": _now(), "id": row["id"]})
        vol = await _approved_volunteer_by_email(db, body.email)
        await db.commit()
        if vol is None:
            raise HTTPException(403, "No approved volunteer for this email")
        return _session(vol)


class PasswordLoginBody(BaseModel):
    email: EmailStr
    password: str


@router.post("/service/auth/login")
async def password_login(body: PasswordLoginBody) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        vol = await _approved_volunteer_by_email(db, body.email)
        if vol is None:
            raise HTTPException(401, "Invalid email or password")
        res = await db.execute(
            text("SELECT password_hash FROM volunteer_credentials WHERE volunteer_id = :id"),
            {"id": str(vol["id"])})
        cred = res.mappings().first()
        if not cred:
            raise HTTPException(409, "password_not_set")
        if not _verify_password(body.password, cred["password_hash"]):
            raise HTTPException(401, "Invalid email or password")
        return _session(vol)


class SetPasswordBody(BaseModel):
    password: str


@router.post("/service/auth/set-password")
async def set_password(body: SetPasswordBody, ctx: CurrentSpace) -> dict[str, Any]:
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO volunteer_credentials (volunteer_id, password_hash, updated_at)
            VALUES (:id, :hash, :now)
            ON CONFLICT (volunteer_id)
            DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = EXCLUDED.updated_at
        """), {"id": ctx.user_id, "hash": _hash_password(body.password), "now": _now()})
        await db.commit()
    return {"ok": True}


@router.get("/service/auth/me")
async def me(ctx: CurrentSpace) -> dict[str, Any]:
    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        return _volunteer_payload(await _current_volunteer(db, ctx))


# ─── 14b. Devices (push targets) ────────────────────────────────────────────

class DeviceBody(BaseModel):
    platform: Literal["android", "web"]
    fcm_token: str


@router.post("/service/devices")
async def register_device(body: DeviceBody, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO volunteer_devices (id, volunteer_id, platform, fcm_token, created_at, last_seen_at)
            VALUES (:id, :vid, :platform, :token, :now, :now)
            ON CONFLICT (fcm_token)
            DO UPDATE SET volunteer_id = EXCLUDED.volunteer_id, last_seen_at = EXCLUDED.last_seen_at
        """), {"id": str(uuid.uuid4()), "vid": ctx.user_id,
               "platform": body.platform, "token": body.fcm_token, "now": _now()})
        await db.commit()
    return {"ok": True}


@router.delete("/service/devices/{fcm_token}")
async def remove_device(fcm_token: str, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(
            text("DELETE FROM volunteer_devices WHERE fcm_token = :t AND volunteer_id = :v"),
            {"t": fcm_token, "v": ctx.user_id})
        await db.commit()
    return {"ok": True}


# ─── 14c. Help requests ─────────────────────────────────────────────────────

async def _request_dict(db, row: dict[str, Any], volunteer_id: str) -> dict[str, Any]:
    from sqlalchemy import text
    counts = await db.execute(text("""
        SELECT status, count(*) AS n FROM request_responses
        WHERE request_id = :rid GROUP BY status
    """), {"rid": row["id"]})
    by = {r["status"]: r["n"] for r in counts.mappings().all()}
    mine = await db.execute(text(
        "SELECT status FROM request_responses WHERE request_id = :rid AND volunteer_id = :vid"),
        {"rid": row["id"], "vid": volunteer_id})
    mine_row = mine.mappings().first()
    return {
        "id": str(row["id"]),
        "branch_id": row["branch_id"],
        "title": row["title"],
        "description": row["description"],
        "location": row["location"],
        "starts_at": row["starts_at"].isoformat() if row["starts_at"] else None,
        "needed_count": row["needed_count"],
        "status": row["status"],
        "accepted_count": by.get("accept", 0),
        "maybe_count": by.get("maybe", 0),
        "my_response": mine_row["status"] if mine_row else None,
    }


@router.get("/service/requests")
async def list_requests(ctx: CurrentSpace, status: str = "open") -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        vol = await _current_volunteer(db, ctx)
        branches = _branch_ids(vol)
        if status == "mine":
            q = """SELECT * FROM help_requests
                   WHERE branch_id = ANY(:branches)
                     AND id IN (SELECT request_id FROM request_responses
                                WHERE volunteer_id = :vid AND status = 'accept')
                   ORDER BY starts_at"""
        elif status == "past":
            q = """SELECT * FROM help_requests
                   WHERE branch_id = ANY(:branches) AND starts_at <= :now
                   ORDER BY starts_at DESC LIMIT 50"""
        else:
            q = """SELECT * FROM help_requests
                   WHERE branch_id = ANY(:branches) AND status = 'open' AND starts_at > :now
                   ORDER BY starts_at"""
        res = await db.execute(text(q),
                               {"branches": branches, "vid": ctx.user_id, "now": _now()})
        rows = res.mappings().all()
        return {"requests": [await _request_dict(db, dict(r), ctx.user_id) for r in rows]}


@router.get("/service/requests/{req_id}")
async def get_request(req_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text("SELECT * FROM help_requests WHERE id = :id"), {"id": req_id})
        row = res.mappings().first()
        if not row:
            raise HTTPException(404, "Not found")
        return await _request_dict(db, dict(row), ctx.user_id)


class CreateRequestBody(BaseModel):
    title: str
    description: str = ""
    branch_id: str
    starts_at: datetime
    location: str = ""
    needed_count: int


@router.post("/service/requests", status_code=201)
async def create_request(body: CreateRequestBody, ctx: CurrentSpace) -> dict[str, Any]:
    if ctx.role not in COORDINATOR_ROLES:
        raise HTTPException(403, "Coordinator role required")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        req_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO help_requests
                (id, branch_id, title, description, location, starts_at,
                 needed_count, status, created_by, created_at)
            VALUES (:id, :branch, :title, :desc, :loc, :starts,
                    :needed, 'open', :by, :now)
        """), {"id": req_id, "branch": body.branch_id, "title": body.title,
               "desc": body.description, "loc": body.location,
               "starts": body.starts_at, "needed": body.needed_count,
               "by": ctx.user_id, "now": _now()})
        # Fan-out: in-app notification rows for every approved volunteer of the branch.
        vols = await db.execute(text(
            "SELECT id FROM volunteers WHERE UPPER(status)='APPROVED' AND branch_id = :b"),
            {"b": body.branch_id})
        vol_ids = [str(v["id"]) for v in vols.mappings().all()]
        title = f"Volunteers needed: {body.title}"
        sub = f"{body.location or body.branch_id} · {body.needed_count} needed"
        for vid in vol_ids:
            await db.execute(text("""
                INSERT INTO app_notifications
                    (id, volunteer_id, type, title, body, request_id, read, created_at)
                VALUES (:id, :vid, 'request', :title, :body, :rid, false, :now)
            """), {"id": str(uuid.uuid4()), "vid": vid, "title": title,
                   "body": sub, "rid": req_id, "now": _now()})
        await db.commit()
        # Best-effort FCM push (no-op if push not configured).
        await _send_push(db, vol_ids, title, sub,
                         data={"type": "request", "request_id": req_id})
    return {"ok": True, "id": req_id}


class RespondBody(BaseModel):
    status: Literal["accept", "decline", "maybe"]


@router.post("/service/requests/{req_id}/respond")
async def respond(req_id: str, body: RespondBody, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text("SELECT status FROM help_requests WHERE id = :id"), {"id": req_id})
        row = res.mappings().first()
        if not row:
            raise HTTPException(404, "Not found")
        if row["status"] != "open":
            raise HTTPException(409, "This request is closed")
        await db.execute(text("""
            INSERT INTO request_responses (id, request_id, volunteer_id, status, responded_at)
            VALUES (:id, :rid, :vid, :status, :now)
            ON CONFLICT (request_id, volunteer_id)
            DO UPDATE SET status = EXCLUDED.status, responded_at = EXCLUDED.responded_at
        """), {"id": str(uuid.uuid4()), "rid": req_id, "vid": ctx.user_id,
               "status": body.status, "now": _now()})
        await db.commit()
        detail = await db.execute(text("SELECT * FROM help_requests WHERE id = :id"), {"id": req_id})
        return await _request_dict(db, dict(detail.mappings().first()), ctx.user_id)


# ─── 14d. Notification inbox ────────────────────────────────────────────────

@router.get("/service/notifications")
async def list_notifications(ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text("""
            SELECT id, type, title, body, request_id, read, created_at
            FROM app_notifications WHERE volunteer_id = :vid
            ORDER BY created_at DESC LIMIT 100
        """), {"vid": ctx.user_id})
        return {"notifications": [
            {"id": str(r["id"]), "type": r["type"], "title": r["title"],
             "body": r["body"],
             "request_id": str(r["request_id"]) if r["request_id"] else None,
             "read": r["read"], "created_at": r["created_at"].isoformat()}
            for r in res.mappings().all()]}


@router.post("/service/notifications/{notif_id}/read")
async def mark_read(notif_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text(
            "UPDATE app_notifications SET read = true WHERE id = :id AND volunteer_id = :vid"),
            {"id": notif_id, "vid": ctx.user_id})
        await db.commit()
    return {"ok": True}


@router.post("/service/notifications/read-all")
async def mark_all_read(ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text(
            "UPDATE app_notifications SET read = true WHERE volunteer_id = :vid"),
            {"vid": ctx.user_id})
        await db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# Tier 2 — weekly rota, attendance/hours, events, documents, reports
# ═══════════════════════════════════════════════════════════════════════════

def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


# ─── Rota (weekly recurring slots; book per occurrence) ─────────────────────

class SlotBody(BaseModel):
    branch_id: str
    weekday: int          # 0=Mon .. 6=Sun
    start_time: str       # "18:00"
    end_time: str
    title: str
    area: str = ""
    capacity: int


@router.get("/service/slots")
async def list_slots(ctx: CurrentSpace, week: str = "") -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    week_start = _monday(date.fromisoformat(week)) if week else _monday(date.today())
    async with SessionLocal() as db:
        vol = await _current_volunteer(db, ctx)
        branches = _branch_ids(vol)
        rows = await db.execute(text("""
            SELECT id, branch_id, weekday, start_time, end_time, title, area, capacity
            FROM schedule_slots
            WHERE active AND branch_id = ANY(:branches)
            ORDER BY weekday, start_time
        """), {"branches": branches})
        out = []
        for s in rows.mappings().all():
            occ = week_start + timedelta(days=int(s["weekday"]))
            booked = await db.execute(text(
                "SELECT count(*) AS n FROM slot_bookings WHERE slot_id=:sid AND date=:d"),
                {"sid": s["id"], "d": occ})
            mine = await db.execute(text(
                "SELECT 1 FROM slot_bookings WHERE slot_id=:sid AND date=:d AND volunteer_id=:vid"),
                {"sid": s["id"], "d": occ, "vid": ctx.user_id})
            out.append({
                "slot_id": str(s["id"]), "date": occ.isoformat(),
                "weekday": int(s["weekday"]),
                "start_time": str(s["start_time"])[:5], "end_time": str(s["end_time"])[:5],
                "title": s["title"], "area": s["area"], "capacity": s["capacity"],
                "booked_count": booked.mappings().first()["n"],
                "my_booking": mine.first() is not None,
            })
    return {"slots": out}


@router.post("/service/slots", status_code=201)
async def create_slot(body: SlotBody, ctx: CurrentSpace) -> dict[str, Any]:
    if ctx.role not in COORDINATOR_ROLES:
        raise HTTPException(403, "Admin role required")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        sid = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO schedule_slots
                (id, branch_id, weekday, start_time, end_time, title, area, capacity, active, created_by, created_at)
            VALUES (:id, :b, :wd, :st, :et, :title, :area, :cap, true, :by, :now)
        """), {"id": sid, "b": body.branch_id, "wd": body.weekday,
               "st": body.start_time, "et": body.end_time, "title": body.title,
               "area": body.area, "cap": body.capacity, "by": ctx.user_id, "now": _now()})
        await db.commit()
    return {"ok": True, "id": sid}


@router.delete("/service/slots/{slot_id}")
async def deactivate_slot(slot_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    if ctx.role not in COORDINATOR_ROLES:
        raise HTTPException(403, "Admin role required")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("UPDATE schedule_slots SET active=false WHERE id=:id"),
                         {"id": slot_id})
        await db.commit()
    return {"ok": True}


class BookBody(BaseModel):
    date: date


@router.post("/service/slots/{slot_id}/book")
async def book_slot(slot_id: str, body: BookBody, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        cap = await db.execute(text(
            "SELECT capacity FROM schedule_slots WHERE id=:id AND active"), {"id": slot_id})
        cap_row = cap.mappings().first()
        if not cap_row:
            raise HTTPException(404, "Slot not found")
        booked = await db.execute(text(
            "SELECT count(*) AS n FROM slot_bookings WHERE slot_id=:id AND date=:d"),
            {"id": slot_id, "d": body.date})
        if booked.mappings().first()["n"] >= cap_row["capacity"]:
            raise HTTPException(409, "This slot is full")
        await db.execute(text("""
            INSERT INTO slot_bookings (id, slot_id, volunteer_id, date, booked_at)
            VALUES (:id, :sid, :vid, :d, :now)
            ON CONFLICT (slot_id, volunteer_id, date) DO NOTHING
        """), {"id": str(uuid.uuid4()), "sid": slot_id, "vid": ctx.user_id,
               "d": body.date, "now": _now()})
        await db.commit()
    return {"ok": True}


@router.post("/service/slots/{slot_id}/cancel")
async def cancel_slot(slot_id: str, body: BookBody, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text(
            "DELETE FROM slot_bookings WHERE slot_id=:sid AND volunteer_id=:vid AND date=:d"),
            {"sid": slot_id, "vid": ctx.user_id, "d": body.date})
        await db.commit()
    return {"ok": True}


# ─── Attendance & hours ─────────────────────────────────────────────────────

@router.post("/service/slots/{slot_id}/checkin")
async def checkin_slot(slot_id: str, body: BookBody, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        slot = await db.execute(text(
            "SELECT start_time, end_time FROM schedule_slots WHERE id=:id"), {"id": slot_id})
        srow = slot.mappings().first()
        if not srow:
            raise HTTPException(404, "Slot not found")
        booked = await db.execute(text(
            "SELECT 1 FROM slot_bookings WHERE slot_id=:id AND volunteer_id=:vid AND date=:d"),
            {"id": slot_id, "vid": ctx.user_id, "d": body.date})
        if booked.first() is None:
            raise HTTPException(409, "You have not booked this slot")
        st, et = srow["start_time"], srow["end_time"]
        if isinstance(st, str):
            st = dtime.fromisoformat(st)
        if isinstance(et, str):
            et = dtime.fromisoformat(et)
        hours = (datetime.combine(body.date, et) - datetime.combine(body.date, st)).seconds / 3600
        await db.execute(text("""
            INSERT INTO slot_attendance (id, slot_id, volunteer_id, date, hours, checked_in_at)
            VALUES (:id, :sid, :vid, :d, :h, :now)
            ON CONFLICT (slot_id, volunteer_id, date) DO NOTHING
        """), {"id": str(uuid.uuid4()), "sid": slot_id, "vid": ctx.user_id,
               "d": body.date, "h": hours, "now": _now()})
        await db.commit()
    return {"ok": True, "hours_logged": hours}


@router.get("/service/me/hours")
async def my_hours(ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        total = await db.execute(text(
            "SELECT COALESCE(sum(hours),0) AS h FROM slot_attendance WHERE volunteer_id=:v"),
            {"v": ctx.user_id})
        month = await db.execute(text("""
            SELECT COALESCE(sum(hours),0) AS h FROM slot_attendance
            WHERE volunteer_id=:v AND date >= date_trunc('month', now())
        """), {"v": ctx.user_id})
        return {"hours_total": float(total.mappings().first()["h"]),
                "hours_this_month": float(month.mappings().first()["h"])}


# ─── Events & festivals ─────────────────────────────────────────────────────

async def _event_dict(db, row: dict[str, Any], vid: str) -> dict[str, Any]:
    from sqlalchemy import text
    cnt = await db.execute(text(
        "SELECT count(*) AS n FROM event_rsvps WHERE event_id=:e AND going"), {"e": row["id"]})
    mine = await db.execute(text(
        "SELECT going FROM event_rsvps WHERE event_id=:e AND volunteer_id=:v"),
        {"e": row["id"], "v": vid})
    mrow = mine.mappings().first()
    return {
        "id": str(row["id"]), "branch_id": row["branch_id"], "title": row["title"],
        "description": row["description"], "location": row["location"],
        "starts_at": row["starts_at"].isoformat() if row["starts_at"] else None,
        "ends_at": row["ends_at"].isoformat() if row["ends_at"] else None,
        "image_url": row["image_url"],
        "rsvp_count": cnt.mappings().first()["n"],
        "my_rsvp": bool(mrow and mrow["going"]),
    }


@router.get("/service/events")
async def list_events(ctx: CurrentSpace, scope: str = "upcoming") -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    cmp_, order = (">", "ASC") if scope == "upcoming" else ("<=", "DESC")
    async with SessionLocal() as db:
        vol = await _current_volunteer(db, ctx)
        rows = await db.execute(text(f"""
            SELECT id, branch_id, title, description, location, starts_at, ends_at, image_url
            FROM events WHERE branch_id = ANY(:b) AND starts_at {cmp_} :now
            ORDER BY starts_at {order} LIMIT 100
        """), {"b": _branch_ids(vol), "now": _now()})
        return {"events": [await _event_dict(db, dict(r), ctx.user_id)
                           for r in rows.mappings().all()]}


@router.get("/service/events/{event_id}")
async def get_event(event_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        r = await db.execute(text("""
            SELECT id, branch_id, title, description, location, starts_at, ends_at, image_url
            FROM events WHERE id=:id
        """), {"id": event_id})
        row = r.mappings().first()
        if not row:
            raise HTTPException(404, "Not found")
        return await _event_dict(db, dict(row), ctx.user_id)


class AutoRequest(BaseModel):
    title: str
    needed_count: int
    starts_at: datetime


class CreateEventBody(BaseModel):
    branch_id: str
    title: str
    description: str = ""
    location: str = ""
    starts_at: datetime
    ends_at: datetime | None = None
    auto_requests: list[AutoRequest] = []


@router.post("/service/events", status_code=201)
async def create_event(body: CreateEventBody, ctx: CurrentSpace) -> dict[str, Any]:
    if ctx.role not in COORDINATOR_ROLES:
        raise HTTPException(403, "Coordinator role required")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        eid = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO events (id, branch_id, title, description, location, starts_at, ends_at, created_by, created_at)
            VALUES (:id, :b, :title, :desc, :loc, :starts, :ends, :by, :now)
        """), {"id": eid, "b": body.branch_id, "title": body.title,
               "desc": body.description, "loc": body.location,
               "starts": body.starts_at, "ends": body.ends_at,
               "by": ctx.user_id, "now": _now()})
        for ar in body.auto_requests:
            rid = str(uuid.uuid4())
            await db.execute(text("""
                INSERT INTO help_requests
                    (id, branch_id, title, description, location, starts_at, needed_count, status, created_by, created_at)
                VALUES (:id, :b, :title, :desc, :loc, :starts, :needed, 'open', :by, :now)
            """), {"id": rid, "b": body.branch_id,
                   "title": f"Volunteers for {body.title}",
                   "desc": f"For event: {body.title}", "loc": body.location,
                   "starts": ar.starts_at, "needed": ar.needed_count,
                   "by": ctx.user_id, "now": _now()})
        await db.commit()
    return {"ok": True, "id": eid}


class RsvpBody(BaseModel):
    going: bool


@router.post("/service/events/{event_id}/rsvp")
async def rsvp_event(event_id: str, body: RsvpBody, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO event_rsvps (id, event_id, volunteer_id, going)
            VALUES (:id, :e, :v, :g)
            ON CONFLICT (event_id, volunteer_id) DO UPDATE SET going = EXCLUDED.going
        """), {"id": str(uuid.uuid4()), "e": event_id, "v": ctx.user_id, "g": body.going})
        await db.commit()
    return {"ok": True}


# ─── Documents (reuse the existing `documents` table) ────────────────────────

@router.get("/service/documents")
async def list_documents(ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        vol = await _current_volunteer(db, ctx)
        rows = await db.execute(text("""
            SELECT id, title, category, branch_id, file_url, file_size, updated_at
            FROM documents
            WHERE deleted_at IS NULL AND (branch_id = ANY(:b) OR branch_id = 'main')
            ORDER BY category, title
        """), {"b": _branch_ids(vol)})
        return {"documents": [
            {"id": str(r["id"]), "title": r["title"],
             "category": (r["category"] or "other").lower(),
             "branch_id": r["branch_id"], "url": r["file_url"],
             "size_bytes": r["file_size"],
             "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None}
            for r in rows.mappings().all()]}


# ─── Reports (admin) ────────────────────────────────────────────────────────

@router.get("/service/reports/summary")
async def reports_summary(ctx: CurrentSpace, branch_id: str = "") -> dict[str, Any]:
    if ctx.role not in COORDINATOR_ROLES:
        raise HTTPException(403, "Admin role required")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        vol = await _current_volunteer(db, ctx)
        branches = [branch_id] if branch_id else _branch_ids(vol)

        async def scalar(sql, params):
            r = await db.execute(text(sql), params)
            return r.mappings().first()["n"]

        active = await scalar(
            "SELECT count(*) AS n FROM volunteers WHERE UPPER(status)='APPROVED' AND branch_id = ANY(:b)",
            {"b": branches})
        pending = await scalar(
            "SELECT count(*) AS n FROM volunteers WHERE UPPER(status)='PENDING' AND branch_id = ANY(:b)",
            {"b": branches})
        open_reqs = await scalar(
            "SELECT count(*) AS n FROM help_requests WHERE status='open' AND branch_id = ANY(:b)",
            {"b": branches})
        accepts = await scalar(
            "SELECT count(*) AS n FROM request_responses WHERE status='accept'", {})
        total_resp = await scalar("SELECT count(*) AS n FROM request_responses", {})
        hrs_total = await scalar("""
            SELECT COALESCE(sum(a.hours),0) AS n FROM slot_attendance a
            JOIN schedule_slots s ON s.id=a.slot_id WHERE s.branch_id = ANY(:b)""", {"b": branches})
        hrs_month = await scalar("""
            SELECT COALESCE(sum(a.hours),0) AS n FROM slot_attendance a
            JOIN schedule_slots s ON s.id=a.slot_id
            WHERE s.branch_id = ANY(:b) AND a.date >= date_trunc('month', now())""", {"b": branches})
        rate = round(accepts * 100 / total_resp) if total_resp else 0
        return {
            "active_volunteers": active, "pending_applications": pending,
            "open_requests": open_reqs, "response_rate_pct": rate,
            "hours_this_month": float(hrs_month), "hours_total": float(hrs_total),
        }
