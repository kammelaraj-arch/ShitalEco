"""Phase A collaboration helpers: HTML sanitization, signed info-request
tokens, Argon2id contributor PIN hashing, and the lockout accounting that
goes with it.

All of this is designed so a single file controls the security surface of
Phase A — the router stays free of crypto detail.
"""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

import bleach
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy import text

from shital.core.fabrics.config import settings
from shital.core.fabrics.database import SessionLocal

# ─── HTML sanitization ───────────────────────────────────────────────────────
# Tiptap can emit <ul>, <ol>, <li>, <p>, <strong>, <em>, <u>, <s>, <a>,
# headings, blockquote and code. Everything else is stripped. Attribute
# allow-list is ultra-narrow so we don't accept inline style / event
# handlers / data: URIs.
_ALLOWED_TAGS = {
    "p", "br", "strong", "em", "u", "s", "code", "pre",
    "ul", "ol", "li", "blockquote",
    "h1", "h2", "h3", "h4",
    "a",
}
_ALLOWED_ATTRS = {"a": ["href", "title", "rel", "target"]}
_ALLOWED_PROTOCOLS = ("http", "https", "mailto")


def sanitize_html(body: str, *, max_len: int = 100_000) -> str:
    """Strip disallowed tags / attrs / protocols, return the safe HTML.

    `body` arrives from the admin's Tiptap editor (or the contributor's
    response page). We never trust it — a drafter with rich-text access
    is still subject to the same output-encoding rules a comment box
    would be.
    """
    if not body:
        return ""
    if len(body) > max_len:
        raise HTTPException(400, detail=f"HTML body over {max_len} chars")
    cleaned = bleach.clean(
        body,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        protocols=_ALLOWED_PROTOCOLS,
        strip=True,
    )
    return cleaned


# ─── Argon2id PIN hashing + lockout ──────────────────────────────────────────
# Argon2id with default parameters at Argon2 time_cost=2, memory=19MiB —
# RFC 9106's "second recommended" set, fine for a 2GB VPS.
_PH = PasswordHasher()
_MAX_PIN_ATTEMPTS = 5
_LOCKOUT_MINUTES = 30


def hash_pin(pin: str) -> str:
    """Return the Argon2id hash of the pin. Callers should validate pin
    format (4-10 digits) BEFORE hashing to keep the lockout counters
    focused on real guesses."""
    if not pin or len(pin) < 4 or len(pin) > 10:
        raise HTTPException(400, detail="PIN must be 4–10 digits")
    if not pin.isdigit():
        raise HTTPException(400, detail="PIN must be digits only")
    return _PH.hash(pin)


async def verify_contributor_pin(email: str, pin: str) -> None:
    """Verify a contributor's PIN. Enforces per-email rate limit:
    5 failed attempts triggers a 30-minute lockout. Successful verification
    resets the counter. Raises HTTPException on anything other than OK."""
    email = (email or "").strip().lower()
    if not email:
        raise HTTPException(400, detail="Missing email")

    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT pin_hash, failed_attempts, lockout_until
            FROM   info_contributors WHERE email = :e LIMIT 1
        """), {"e": email})).mappings().first()
    if not row or not row["pin_hash"]:
        raise HTTPException(403, detail="No PIN set — set a PIN first")

    now = datetime.now(UTC)
    if row["lockout_until"] and row["lockout_until"] > now:
        raise HTTPException(
            429, detail=f"Locked until {row['lockout_until'].isoformat()} after too many failed PINs",
        )

    try:
        _PH.verify(row["pin_hash"], pin)
    except (VerifyMismatchError, InvalidHashError):
        async with SessionLocal() as db:
            new_fail = int(row["failed_attempts"]) + 1
            lockout = now + timedelta(minutes=_LOCKOUT_MINUTES) if new_fail >= _MAX_PIN_ATTEMPTS else None
            await db.execute(text("""
                UPDATE info_contributors
                   SET failed_attempts = :f,
                       lockout_until   = :l,
                       updated_at      = NOW()
                 WHERE email = :e
            """), {"f": new_fail, "l": lockout, "e": email})
            await db.commit()
        raise HTTPException(403, detail="Invalid PIN") from None

    # Success — clear counters.
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE info_contributors
               SET failed_attempts = 0, lockout_until = NULL, updated_at = NOW()
             WHERE email = :e
        """), {"e": email})
        await db.commit()


# ─── Signed info-request tokens ──────────────────────────────────────────────
# Single-purpose JWT bound to the info_request id + target email. 72-hour
# TTL; rotatable (by re-issuing from the admin invite endpoint). Uses the
# same JWT_SECRET as every other magic-link flow.

_TOKEN_PURPOSE = "info_request"
_TOKEN_TTL_HOURS = 72


def mint_info_request_token(request_id: str, target_email: str,
                            hours: int = _TOKEN_TTL_HOURS) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub":    str(request_id),
        "email":  (target_email or "").strip().lower(),
        "p":      _TOKEN_PURPOSE,
        "iat":    int(now.timestamp()),
        "exp":    int((now + timedelta(hours=hours)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_info_request_token(token: str) -> tuple[str, str]:
    """Return (request_id, target_email). Raises on bad / wrong-purpose /
    expired tokens."""
    try:
        payload: dict[str, Any] = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError as exc:
        raise HTTPException(401, detail=f"Invalid info-request token: {exc}") from exc
    if payload.get("p") != _TOKEN_PURPOSE:
        raise HTTPException(401, detail="Wrong token purpose")
    rid = str(payload.get("sub") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    if not rid or not email:
        raise HTTPException(401, detail="Token missing subject / email")
    return rid, email


def info_request_url(request_id: str, target_email: str, base: str = "") -> str:
    tok = mint_info_request_token(request_id, target_email)
    base = (base or getattr(settings, "SITE_URL", "") or "").rstrip("/")
    return f"{base}/board/info?t={tok}"


# ─── Content hashing (integrity receipt) ─────────────────────────────────────
def content_hash(body_html: str, attachment_bytes: bytes = b"") -> str:
    """SHA-256 of the response content. Printed in the PDF appendix so the
    record proves integrity offline."""
    h = hashlib.sha256()
    h.update((body_html or "").encode("utf-8"))
    if attachment_bytes:
        h.update(b"\x00")
        h.update(attachment_bytes)
    return h.hexdigest()


__all__ = [
    "sanitize_html",
    "hash_pin", "verify_contributor_pin",
    "mint_info_request_token", "decode_info_request_token", "info_request_url",
    "content_hash",
]
