"""Contact preference centre — Phase 1a of the marketing stack.

Every marketing email, SMS, WhatsApp, etc. MUST:
  1. Check `is_opted_in(contact_id, channel)` before sending.
  2. Include a signed URL back to `/prefs?t=<jwt>` (preference centre) in
     the footer.

The preference centre lets a donor toggle each channel individually plus
a one-click "unsubscribe from everything". No login required — the
signed token carries the contact_id.

Token design
------------
JWT signed with the shared JWT_SECRET, payload:
    { "sub": "<contact_uuid>",
      "p":   "mkt_prefs",                  # purpose discriminator
      "iat": <unix-ts>,
      "exp": <unix-ts, default 90 days> }
The purpose discriminator means a JWT issued for anything else (login
etc.) can't be replayed here. Default 90-day expiry so a link sent in a
newsletter still works a month later.

Routes
------
GET  /me/prefs?t=<jwt>          returns current per-channel opt state
POST /me/prefs?t=<jwt>          upserts preferences (body {channels: {...}})
POST /me/prefs/unsubscribe?t=<jwt>  one-click unsubscribe-from-all

Schema touched
--------------
contact_channel_prefs  — per-channel bool
marketing_unsubscribes — append-only compliance log

Zero auth coupling — these endpoints do NOT require a login; the JWT is
the only authentication.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import text

from shital.core.fabrics.config import settings
from shital.core.fabrics.database import SessionLocal

router = APIRouter(tags=["marketing"])

# Channels the preference centre offers. Keep alphabetical for a stable
# render order in the UI; add new channels at the end to avoid changing
# existing JSON key orders.
SUPPORTED_CHANNELS = ("email", "phone", "post", "sms", "whatsapp")

# Default opt-state when there's no row in contact_channel_prefs. Email
# defaults true because every donor gave an email at checkout / Gift Aid
# flow — the implicit opt-in for transactional carries over to
# newsletters. Every other channel defaults false and requires an
# explicit opt-in through the preference centre.
DEFAULT_OPT_IN = {
    "email":    True,
    "phone":    False,
    "post":     False,
    "sms":      False,
    "whatsapp": False,
}

TOKEN_PURPOSE = "mkt_prefs"
DEFAULT_EXPIRY_DAYS = 90


# ─── Token helpers ────────────────────────────────────────────────────────────
def mint_prefs_token(contact_id: str, days: int = DEFAULT_EXPIRY_DAYS) -> str:
    """Sign a preference-centre JWT for the given contact id."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(contact_id),
        "p":   TOKEN_PURPOSE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=days)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _decode_prefs_token(token: str) -> str:
    """Return the contact_id payload. Raises HTTPException on any failure."""
    try:
        payload: dict[str, Any] = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid preference token: {exc}") from exc

    if payload.get("p") != TOKEN_PURPOSE:
        # A refresh token / donor-session token is NOT the same thing;
        # refuse to use it as a preference token even if it decodes.
        raise HTTPException(status_code=401, detail="Wrong token purpose")
    sub = str(payload.get("sub") or "").strip()
    if not sub:
        raise HTTPException(status_code=401, detail="Missing subject")
    return sub


def prefs_url(contact_id: str, base: str = "") -> str:
    """Generate a preference-centre URL for a contact. Pass base='' to
    use the host-relative form the service portal routes."""
    tok = mint_prefs_token(contact_id)
    base = (base or settings.SITE_URL or "").rstrip("/")
    return f"{base}/prefs?t={tok}"


# ─── Opt-in gate (import from marketing send paths) ──────────────────────────
async def is_opted_in(contact_id: str | None, channel: str) -> bool:
    """Return True iff the contact has opted in to the given channel. A
    missing contact_id (anonymous donor etc.) returns False so the send
    path has to decide what to do — anonymous donors shouldn't receive
    marketing anyway."""
    if not contact_id:
        return False
    if channel not in SUPPORTED_CHANNELS:
        return False
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT opted_in FROM contact_channel_prefs
            WHERE  contact_id = CAST(:id AS uuid) AND channel = :ch
            LIMIT  1
        """), {"id": contact_id, "ch": channel})).first()
    if row is not None:
        return bool(row[0])
    return DEFAULT_OPT_IN.get(channel, False)


# ─── Request models ──────────────────────────────────────────────────────────
class PrefsIn(BaseModel):
    channels: dict[str, bool]
    reason:   str = ""


# ─── Routes ──────────────────────────────────────────────────────────────────
@router.get("/me/prefs")
async def get_prefs(t: str = Query(..., description="Signed preference token")) -> dict[str, Any]:
    """Return the current per-channel opt state for a token-identified
    contact. Caller renders as a form the donor can edit."""
    contact_id = _decode_prefs_token(t)
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT first_name, surname, email
            FROM   contacts WHERE id = CAST(:id AS uuid) LIMIT 1
        """), {"id": contact_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contact not found")

    prefs: dict[str, bool] = {}
    for ch in SUPPORTED_CHANNELS:
        prefs[ch] = await is_opted_in(contact_id, ch)
    return {
        "contact": {
            "first_name": row.get("first_name") or "",
            "surname":    row.get("surname") or "",
            "email":      row.get("email") or "",
        },
        "channels": prefs,
        "supported_channels": list(SUPPORTED_CHANNELS),
    }


@router.post("/me/prefs")
async def set_prefs(body: PrefsIn, request: Request, t: str = Query(...)) -> dict[str, Any]:
    """Upsert channel preferences for a token-identified contact. The
    request body carries ONLY the channels the donor changed; absent
    keys are left alone."""
    contact_id = _decode_prefs_token(t)
    ip = (request.client.host if request.client else "")[:45]
    now = datetime.utcnow()
    changed = 0
    newly_unsubscribed_email = False

    async with SessionLocal() as db:
        # Confirm the contact exists before writing anything — a dangling
        # row would hide bugs and leak orphan prefs.
        exists = (await db.execute(text(
            "SELECT email FROM contacts WHERE id = CAST(:id AS uuid) LIMIT 1"
        ), {"id": contact_id})).first()
        if not exists:
            raise HTTPException(status_code=404, detail="Contact not found")
        contact_email = str(exists[0] or "").strip().lower()

        for ch, opted in body.channels.items():
            if ch not in SUPPORTED_CHANNELS:
                continue
            prior = (await db.execute(text("""
                SELECT opted_in FROM contact_channel_prefs
                WHERE  contact_id = CAST(:id AS uuid) AND channel = :ch
                LIMIT  1
            """), {"id": contact_id, "ch": ch})).first()
            prior_val = prior[0] if prior is not None else DEFAULT_OPT_IN.get(ch, False)
            if bool(opted) == bool(prior_val):
                continue
            await db.execute(text("""
                INSERT INTO contact_channel_prefs
                    (contact_id, channel, opted_in, reason, source_ip, updated_at)
                VALUES
                    (CAST(:id AS uuid), :ch, :opt, :reason, :ip, :now)
                ON CONFLICT (contact_id, channel) DO UPDATE SET
                    opted_in   = EXCLUDED.opted_in,
                    reason     = EXCLUDED.reason,
                    source_ip  = EXCLUDED.source_ip,
                    updated_at = EXCLUDED.updated_at
            """), {
                "id": contact_id, "ch": ch, "opt": bool(opted),
                "reason": (body.reason or "")[:100], "ip": ip, "now": now,
            })
            changed += 1
            if ch == "email" and not opted:
                newly_unsubscribed_email = True
        # Compliance log — record the unsubscribe event by email too, so
        # bounce / list-hygiene reports work even without the contact row.
        if newly_unsubscribed_email and contact_email:
            await db.execute(text("""
                INSERT INTO marketing_unsubscribes
                    (email, channel, reason, source, created_at)
                VALUES
                    (:email, 'email', :reason, 'prefs_centre', :now)
            """), {"email": contact_email, "reason": (body.reason or "")[:500], "now": now})
        await db.commit()

    return {"ok": True, "changed": changed}


@router.post("/me/prefs/unsubscribe")
async def unsubscribe_all(request: Request, t: str = Query(...), reason: str = "") -> dict[str, Any]:
    """One-click opt-out of every channel — the big 'Unsubscribe from all'
    button. Equivalent to calling /me/prefs with every supported channel
    set to false."""
    body = PrefsIn(
        channels={ch: False for ch in SUPPORTED_CHANNELS},
        reason=reason or "one_click_unsubscribe",
    )
    return await set_prefs(body, request, t)


__all__ = [
    "router",
    "mint_prefs_token",
    "prefs_url",
    "is_opted_in",
    "SUPPORTED_CHANNELS",
]
