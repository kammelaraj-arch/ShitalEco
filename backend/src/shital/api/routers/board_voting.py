"""PIN-protected magic-link voting for trustees.

Flow:
  1. Chair (admin) opens an OPEN resolution and clicks "Send vote invites".
  2. Server creates a unique token per active trustee (one row per
     (resolution, trustee)) and emails the link.
  3. Trustee taps the link on their phone → opens
     /board/vote/{token} on the admin domain (no auth — token is the
     auth). Page renders the full resolution + their current vote +
     live tally.
  4. Trustee picks FOR / AGAINST / ABSTAIN, optionally adds a comment,
     enters their 4-6 digit PIN. Server verifies PIN, records the vote
     with source=MAGIC_LINK, audit-logs everything.

PIN security:
  - Hashed with bcrypt (passlib).
  - 5 failed attempts → 15-minute lockout per trustee.
  - PIN entry is HTTPS-only (set in nginx).

Endpoints:
  Public (no auth — token in URL):
    GET    /public/board/vote/{token}        load resolution + current vote
    POST   /public/board/vote/{token}        cast / update vote (with PIN)
    POST   /public/board/trustee/set-pin     set or change PIN (token-protected)

  Admin:
    POST   /admin/board/resolutions/{id}/send-vote-invites
                                              email magic-link to all active
                                              trustees. Returns counts.
    POST   /admin/board/trustees/{id}/reset-pin
                                              clear a trustee's PIN (admin
                                              recovery). Trustee must set a
                                              new PIN via the link before
                                              they can vote again.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from passlib.hash import bcrypt
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["board-voting"])

PIN_LOCKOUT_MINUTES = 15
PIN_MAX_FAILS = 5
VALID_VOTE_CHOICES = {"FOR", "AGAINST", "ABSTAIN"}


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
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


async def _audit(
    db: Any, *, action: str, entity_type: str, entity_id: str | None,
    actor_id: str | None, actor_name: str,
    metadata: dict[str, Any] | None = None,
    ip: str = "", ua: str = "",
) -> None:
    """Mirror of board.py's _audit() — duplicated to avoid the import cycle
    that would form if board_voting imported from board.py."""
    import json as _json

    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
            (id, actor_user_id, actor_name, action, entity_type, entity_id,
             metadata, ip_address, user_agent, created_at)
        VALUES (:id, :actor, :actor_name, :action, :etype, :eid,
                CAST(:meta AS jsonb), :ip, :ua, :now)
    """), {
        "id": str(uuid.uuid4()),
        "actor": actor_id if actor_id and _looks_uuid(actor_id) else None,
        "actor_name": (actor_name or "")[:255],
        "action": action,
        "etype": entity_type,
        "eid": entity_id if entity_id and _looks_uuid(entity_id) else None,
        "meta": _json.dumps(metadata or {}),
        "ip": ip[:45], "ua": ua[:500],
        "now": datetime.now(UTC),
    })


# ─── Admin: send invites ──────────────────────────────────────────────────────

@router.post("/admin/board/resolutions/{resolution_id}/send-vote-invites")
async def send_vote_invites(
    resolution_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Generate per-trustee magic-link tokens and email them. Idempotent —
    re-running returns the same tokens (it doesn't rotate)."""
    _require_admin(ctx)
    if not _looks_uuid(resolution_id):
        raise HTTPException(400, detail="resolution_id must be UUID")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        res = (await db.execute(text("""
            SELECT id, title, status FROM resolutions WHERE id::text = :id
        """), {"id": resolution_id})).mappings().one_or_none()
        if not res:
            raise HTTPException(404, detail="Resolution not found")
        if res["status"] != "OPEN":
            raise HTTPException(
                400,
                detail=f"Can only invite on an OPEN resolution; current: {res['status']}",
            )

        trustees = (await db.execute(text("""
            SELECT id, full_name, email, role FROM trustees
            WHERE  is_active = true AND email <> ''
            ORDER  BY role, full_name
        """))).mappings().all()
        if not trustees:
            raise HTTPException(400, detail={"errors": ["No active trustees with an email on file"]})

        sent: list[str] = []
        skipped: list[str] = []
        failed: list[str] = []

        for t in trustees:
            # Get-or-create token for this (resolution, trustee).
            existing = (await db.execute(text("""
                SELECT token FROM resolution_vote_tokens
                WHERE  resolution_id = :rid AND trustee_id = :tid
            """), {"rid": str(res["id"]), "tid": str(t["id"])})).mappings().one_or_none()
            if existing:
                token = existing["token"]
                skipped.append(t["full_name"])
            else:
                token = secrets.token_urlsafe(40)
                await db.execute(text("""
                    INSERT INTO resolution_vote_tokens
                        (id, token, resolution_id, trustee_id, sent_via, sent_at)
                    VALUES (:id, :tok, :rid, :tid, 'EMAIL', :now)
                """), {
                    "id": str(uuid.uuid4()), "tok": token,
                    "rid": str(res["id"]), "tid": str(t["id"]), "now": now,
                })
                sent.append(t["full_name"])

            # Email the link.
            try:
                await _send_invite_email(
                    full_name=t["full_name"], email=t["email"], token=token,
                    resolution_title=res["title"],
                )
            except Exception as exc:
                failed.append(f"{t['full_name']} ({exc})")

        await _audit(
            db, action="VOTE_INVITES_SENT", entity_type="resolutions",
            entity_id=resolution_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            metadata={"sent": len(sent), "reused": len(skipped),
                      "failed": len(failed)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()

    return {
        "resolution_id": resolution_id,
        "trustees_total": len(trustees),
        "tokens_created": len(sent),
        "tokens_reused": len(skipped),
        "email_failed": failed,
        "success": True,
    }


async def _send_invite_email(*, full_name: str, email: str, token: str, resolution_title: str) -> None:
    """Send the magic-link via SendGrid. Falls back to a noop if the API key
    is not configured (so dev / local works without real email)."""
    from shital.core.fabrics.secrets import SecretsManager

    api_key = await SecretsManager.get("SENDGRID_API_KEY") or ""
    if not api_key:
        # Dev fallback: just log it. The token is also visible in the
        # resolution_vote_tokens table for staff testing.
        import structlog
        log = structlog.get_logger()
        log.info("vote_invite_email_skipped", email=email, token=token, reason="no_sendgrid_key")
        return

    admin_base = await SecretsManager.get("ADMIN_BASE_URL") or "https://admin.shital.org.uk"
    # Hash format (#token=…) — the admin app is a static Next.js export,
    # so we can't have a [token] dynamic segment without enumerating tokens
    # at build time. The /board/vote/ page reads the token from
    # window.location.hash on mount.
    link = f"{admin_base.rstrip('/')}/admin/board/vote/#token={token}"

    body_html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #B91C1C;">SHITAL Trustee Vote Required</h2>
      <p>Dear {full_name},</p>
      <p>You have been asked to vote on the following board resolution:</p>
      <div style="background:#f5f5f5;padding:16px;border-radius:8px;border-left:4px solid #D4AF37;">
        <strong>{resolution_title}</strong>
      </div>
      <p style="margin-top:24px;">Click the button below to view the full detail and cast your vote.</p>
      <p style="text-align:center;margin:32px 0;">
        <a href="{link}" style="background:#B91C1C;color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:bold;">
          View &amp; Vote →
        </a>
      </p>
      <p style="color:#666;font-size:12px;">
        This link is unique to you. You will need your 4-6 digit PIN to confirm your vote.
        If you have not yet set a PIN, the page will let you do so.
      </p>
      <p style="color:#666;font-size:12px;">
        SHITAL · UK Registered Charity 1138530<br/>
        If you did not expect this email, please ignore it. The link grants
        no access beyond this single resolution.
      </p>
    </div>
    """

    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "personalizations": [{"to": [{"email": email, "name": full_name}]}],
                "from": {
                    "email": (await SecretsManager.get("EMAIL_FROM") or "info@shital.org.uk"),
                    "name": "SHITAL Trustees",
                },
                "subject": f"Trustee vote required: {resolution_title}",
                "content": [{"type": "text/html", "value": body_html}],
            },
        )
        if r.status_code >= 300:
            raise RuntimeError(f"SendGrid {r.status_code}: {r.text[:200]}")


# ─── Public (token-only): load resolution + cast vote ─────────────────────────

@router.get("/public/board/vote/{token}")
async def public_load_vote(token: str) -> dict[str, Any]:
    """No-auth read endpoint. Returns enough for the trustee to read the
    resolution + see their current vote + the live tally."""
    if not token or len(token) < 20 or len(token) > 80:
        raise HTTPException(404, detail="Invalid token")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        tok = (await db.execute(text("""
            SELECT id, resolution_id, trustee_id FROM resolution_vote_tokens WHERE token = :t
        """), {"t": token})).mappings().one_or_none()
        if not tok:
            raise HTTPException(404, detail="Invalid token")

        res = (await db.execute(text("""
            SELECT id, title, background, recommendation, risk_impact, budget_impact,
                   category, decision_type, status, decision_date, is_retrospective,
                   retrospective_reason, outcome, outcome_summary, tally_for,
                   tally_against, tally_abstain, casting_vote_used,
                   casting_vote_choice, published_at, closed_at
            FROM   resolutions WHERE id = :id
        """), {"id": tok["resolution_id"]})).mappings().one_or_none()
        if not res:
            raise HTTPException(404, detail="Resolution not found")

        trustee = (await db.execute(text("""
            SELECT id, full_name, role, email, pin_hash
            FROM   trustees WHERE id = :id
        """), {"id": tok["trustee_id"]})).mappings().one_or_none()
        if not trustee:
            raise HTTPException(404, detail="Trustee record missing")

        my_vote = (await db.execute(text("""
            SELECT choice, comment, voted_at, updated_at
            FROM   resolution_votes
            WHERE  resolution_id = :rid AND trustee_id = :tid
        """), {"rid": tok["resolution_id"], "tid": tok["trustee_id"]})).mappings().one_or_none()

    return {
        "resolution": _serialise_res(res),
        "trustee": {
            "full_name": trustee["full_name"],
            "role": trustee["role"],
            "email_masked": _mask_email(trustee["email"]),
            "needs_pin_setup": not trustee["pin_hash"],
        },
        "my_vote": _serialise_vote(my_vote) if my_vote else None,
    }


def _serialise_res(r: Any) -> dict[str, Any]:
    d = dict(r)
    d["id"] = str(d["id"])
    for k in ("decision_date", "published_at", "closed_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
    return d


def _serialise_vote(r: Any) -> dict[str, Any]:
    d = dict(r)
    for k in ("voted_at", "updated_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
    return d


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return ""
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        return f"{local[0]}***@{domain}"
    return f"{local[0]}{'*' * max(2, len(local) - 2)}{local[-1]}@{domain}"


class CastVoteBody(BaseModel):
    choice: str
    pin: str
    comment: str = ""


@router.post("/public/board/vote/{token}")
async def public_cast_vote(
    token: str, body: CastVoteBody, request: Request,
) -> dict[str, Any]:
    """Cast or update a vote using the magic-link token + the trustee's PIN."""
    if not token or len(token) < 20:
        raise HTTPException(404, detail="Invalid token")
    if body.choice not in VALID_VOTE_CHOICES:
        raise HTTPException(400, detail="choice must be FOR | AGAINST | ABSTAIN")
    if not body.pin or not body.pin.isdigit() or not (4 <= len(body.pin) <= 6):
        raise HTTPException(400, detail="PIN must be 4-6 digits")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    ip = (request.client.host if request.client else "")[:45]
    ua = (request.headers.get("user-agent") or "")[:500]

    async with SessionLocal() as db:
        tok = (await db.execute(text("""
            SELECT id, resolution_id, trustee_id FROM resolution_vote_tokens WHERE token = :t
        """), {"t": token})).mappings().one_or_none()
        if not tok:
            raise HTTPException(404, detail="Invalid token")

        res = (await db.execute(text("""
            SELECT id, status FROM resolutions WHERE id = :id
        """), {"id": tok["resolution_id"]})).mappings().one_or_none()
        if not res:
            raise HTTPException(404, detail="Resolution not found")
        if res["status"] != "OPEN":
            raise HTTPException(400, detail=(
                f"Voting on this resolution is closed (status={res['status']})."
            ))

        trustee = (await db.execute(text("""
            SELECT id, full_name, pin_hash, pin_failed_attempts, pin_locked_until
            FROM   trustees WHERE id = :id
        """), {"id": tok["trustee_id"]})).mappings().one_or_none()
        if not trustee:
            raise HTTPException(404, detail="Trustee record missing")
        if not trustee["pin_hash"]:
            raise HTTPException(400, detail=(
                "PIN not set yet. Set your PIN first (the page will prompt you)."
            ))
        # Lockout check
        if trustee["pin_locked_until"] and trustee["pin_locked_until"] > now:
            mins = int((trustee["pin_locked_until"] - now).total_seconds() // 60) + 1
            raise HTTPException(429, detail=(
                f"Too many failed PIN attempts. Try again in {mins} minute(s)."
            ))

        # Verify PIN
        if not bcrypt.verify(body.pin, trustee["pin_hash"]):
            new_fails = int(trustee["pin_failed_attempts"]) + 1
            locked_until = (
                now + timedelta(minutes=PIN_LOCKOUT_MINUTES)
                if new_fails >= PIN_MAX_FAILS else None
            )
            await db.execute(text("""
                UPDATE trustees
                SET    pin_failed_attempts = :n,
                       pin_locked_until = :until,
                       updated_at = :now
                WHERE  id = :id
            """), {"n": new_fails, "until": locked_until, "now": now, "id": trustee["id"]})
            await _audit(
                db, action="VOTE_PIN_FAIL", entity_type="resolutions",
                entity_id=str(tok["resolution_id"]),
                actor_id=None, actor_name=trustee["full_name"],
                metadata={"trustee_id": str(trustee["id"]),
                          "failed_attempts": new_fails,
                          "locked": locked_until is not None},
                ip=ip, ua=ua,
            )
            await db.commit()
            remaining = PIN_MAX_FAILS - new_fails
            if remaining <= 0:
                raise HTTPException(429, detail=(
                    f"PIN incorrect. Account locked for {PIN_LOCKOUT_MINUTES} minutes."
                ))
            raise HTTPException(401, detail=(
                f"PIN incorrect. {remaining} attempt(s) remaining before lockout."
            ))

        # PIN OK — reset failure counter
        await db.execute(text("""
            UPDATE trustees SET pin_failed_attempts = 0, pin_locked_until = NULL,
                                updated_at = :now
            WHERE id = :id
        """), {"now": now, "id": trustee["id"]})

        # Upsert the vote
        await db.execute(text("""
            INSERT INTO resolution_votes
                (id, resolution_id, trustee_id, choice, anonymous, comment,
                 voted_at, updated_at)
            VALUES
                (:id, :rid, :tid, :choice, false, :comment, :now, :now)
            ON CONFLICT (resolution_id, trustee_id) DO UPDATE SET
                choice = EXCLUDED.choice,
                comment = EXCLUDED.comment,
                updated_at = :now
        """), {
            "id": str(uuid.uuid4()), "rid": str(tok["resolution_id"]),
            "tid": str(trustee["id"]), "choice": body.choice,
            "comment": body.comment, "now": now,
        })

        # Bump token usage
        await db.execute(text("""
            UPDATE resolution_vote_tokens
            SET    last_used_at = :now, used_count = used_count + 1
            WHERE  id = :id
        """), {"now": now, "id": tok["id"]})

        await _audit(
            db, action="VOTE_CAST_VIA_LINK", entity_type="resolutions",
            entity_id=str(tok["resolution_id"]),
            actor_id=None, actor_name=trustee["full_name"],
            metadata={"trustee_id": str(trustee["id"]),
                      "choice": body.choice,
                      "via": "MAGIC_LINK"},
            ip=ip, ua=ua,
        )
        await db.commit()

        # Return updated tally so the page can render confirmation.
        tally_row = (await db.execute(text("""
            SELECT
              SUM(CASE choice WHEN 'FOR' THEN 1 ELSE 0 END) AS f,
              SUM(CASE choice WHEN 'AGAINST' THEN 1 ELSE 0 END) AS a,
              SUM(CASE choice WHEN 'ABSTAIN' THEN 1 ELSE 0 END) AS b
            FROM resolution_votes WHERE resolution_id = :rid
        """), {"rid": str(tok["resolution_id"])})).mappings().one()
    return {
        "success": True, "choice": body.choice,
        "tally_for": int(tally_row["f"] or 0),
        "tally_against": int(tally_row["a"] or 0),
        "tally_abstain": int(tally_row["b"] or 0),
    }


# ─── Public PIN setup (token-protected) ───────────────────────────────────────

class SetPinBody(BaseModel):
    token: str
    new_pin: str
    confirm_pin: str


@router.post("/public/board/trustee/set-pin")
async def public_set_pin(body: SetPinBody, request: Request) -> dict[str, Any]:
    """Trustee sets / changes their own PIN. The token authenticates them as
    the trustee on a specific resolution; the PIN is stored on the trustee
    record (used across all subsequent resolutions)."""
    if not body.token or len(body.token) < 20:
        raise HTTPException(404, detail="Invalid token")
    if body.new_pin != body.confirm_pin:
        raise HTTPException(400, detail="PINs do not match")
    if not body.new_pin.isdigit() or not (4 <= len(body.new_pin) <= 6):
        raise HTTPException(400, detail="PIN must be 4-6 digits")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    ip = (request.client.host if request.client else "")[:45]
    ua = (request.headers.get("user-agent") or "")[:500]

    async with SessionLocal() as db:
        tok = (await db.execute(text("""
            SELECT trustee_id, resolution_id FROM resolution_vote_tokens WHERE token = :t
        """), {"t": body.token})).mappings().one_or_none()
        if not tok:
            raise HTTPException(404, detail="Invalid token")
        trustee = (await db.execute(text("""
            SELECT id, full_name FROM trustees WHERE id = :id
        """), {"id": tok["trustee_id"]})).mappings().one_or_none()
        if not trustee:
            raise HTTPException(404, detail="Trustee record missing")

        pin_hash = bcrypt.hash(body.new_pin)
        await db.execute(text("""
            UPDATE trustees
            SET    pin_hash = :h, pin_set_at = :now,
                   pin_failed_attempts = 0, pin_locked_until = NULL,
                   updated_at = :now
            WHERE  id = :id
        """), {"h": pin_hash, "now": now, "id": trustee["id"]})
        await _audit(
            db, action="PIN_SET", entity_type="trustees",
            entity_id=str(trustee["id"]),
            actor_id=None, actor_name=trustee["full_name"],
            metadata={"via": "MAGIC_LINK"},
            ip=ip, ua=ua,
        )
        await db.commit()
    return {"success": True}


# ─── Admin: reset PIN ─────────────────────────────────────────────────────────

@router.post("/admin/board/trustees/{trustee_id}/reset-pin")
async def admin_reset_pin(
    trustee_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Admin recovery — clears the trustee's PIN. Trustee will be prompted
    to set a new one the next time they open a magic-link."""
    _require_admin(ctx)
    if not _looks_uuid(trustee_id):
        raise HTTPException(400, detail="trustee_id must be UUID")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE trustees
            SET    pin_hash = '', pin_set_at = NULL,
                   pin_failed_attempts = 0, pin_locked_until = NULL,
                   updated_at = :now
            WHERE  id::text = :id
            RETURNING full_name
        """), {"id": trustee_id, "now": now})
        row = result.mappings().one_or_none()
        if not row:
            raise HTTPException(404, detail="Trustee not found")
        await _audit(
            db, action="PIN_RESET_BY_ADMIN", entity_type="trustees",
            entity_id=trustee_id, actor_id=str(ctx.user_id),
            actor_name=ctx.user_email,
            metadata={"trustee_name": row["full_name"]},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"trustee_id": trustee_id, "success": True}


# ─── Admin: list invites for a resolution (for the resolutions page) ─────────

@router.get("/admin/board/resolutions/{resolution_id}/invites")
async def admin_list_invites(
    resolution_id: str, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    if not _looks_uuid(resolution_id):
        raise HTTPException(400, detail="resolution_id must be UUID")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT t.id, t.full_name, t.role, t.email,
                   tok.sent_at, tok.last_used_at, tok.used_count,
                   v.choice AS my_vote
            FROM   trustees t
            JOIN   resolution_vote_tokens tok ON tok.trustee_id = t.id
            LEFT JOIN resolution_votes v ON v.trustee_id = t.id
                                         AND v.resolution_id = tok.resolution_id
            WHERE  tok.resolution_id::text = :rid
            ORDER  BY t.full_name
        """), {"rid": resolution_id})
        items = [dict(r._mapping) for r in rows]
    for it in items:
        it["id"] = str(it["id"])
        for k in ("sent_at", "last_used_at"):
            if it.get(k) is not None:
                it[k] = it[k].isoformat() if hasattr(it[k], "isoformat") else it[k]
    return {"items": items}
