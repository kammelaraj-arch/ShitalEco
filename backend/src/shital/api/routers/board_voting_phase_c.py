"""Phase C — trustee review flow additions.

Three surfaces:
  1. Public review endpoints a trustee hits via the magic-link page
     BEFORE casting (or alongside) their vote:
       GET  /public/board/vote/{token}/review     → comments + conditions
       POST /public/board/vote/{token}/comment    → post a review comment
       POST /public/board/vote/{token}/upload     → upload a doc/image/
                                                    video/audio (50 MB,
                                                    doc/img/video/audio
                                                    content type).

  2. Admin endpoints the chair uses to resolve conditions attached to
     FOR_WITH_CONDITIONS votes:
       GET  /admin/board/resolutions/{rid}/conditions
       POST /admin/board/resolutions/{rid}/conditions/{cid}/resolve
            body: { action: 'accept'|'reject'|'defer', reason: str }

  3. SMS invite — reuse the existing /send-vote-invites email flow with
     a parallel Twilio hit. Twilio creds are optional; a missing SID /
     TOKEN / FROM_NUMBER falls back to email-only without 500-ing.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal
from shital.services.board.collab import sanitize_html

router = APIRouter(tags=["board-phase-c"])


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "CHAIR"}:
        raise HTTPException(403, detail="Admin or chair role required")


async def _token_to_context(db: Any, token: str) -> dict[str, Any]:
    """Return {resolution_id, trustee_id, trustee_name} for a valid
    live vote-magic-link token, or raise 404."""
    if not token or len(token) < 20:
        raise HTTPException(404, detail="Invalid token")
    row = (await db.execute(text("""
        SELECT tok.resolution_id, tok.trustee_id, t.full_name AS trustee_name,
               r.status AS res_status, r.title AS res_title
        FROM   resolution_vote_tokens tok
        JOIN   resolutions r ON r.id = tok.resolution_id
        LEFT JOIN trustees  t ON t.id = tok.trustee_id
        WHERE  tok.token = :t
        LIMIT  1
    """), {"t": token})).mappings().first()
    if not row:
        raise HTTPException(404, detail="Invalid token")
    return dict(row)


# ─── Review state (comments + conditions you've made so far) ──────────────────
@router.get("/public/board/vote/{token}/review")
async def public_review_state(token: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        ctx = await _token_to_context(db, token)
        comments = (await db.execute(text("""
            SELECT id, trustee_name, body_html, created_at
            FROM   resolution_review_comments
            WHERE  resolution_id = CAST(:rid AS uuid)
            ORDER  BY created_at ASC
        """), {"rid": str(ctx["resolution_id"])})).mappings().all()
        # Current trustee's vote + its live conditions, if any.
        vote = (await db.execute(text("""
            SELECT id, choice, comment, voted_at
            FROM   resolution_votes
            WHERE  resolution_id = CAST(:rid AS uuid)
              AND  trustee_id    = CAST(:tid AS uuid)
            LIMIT  1
        """), {"rid": str(ctx["resolution_id"]), "tid": str(ctx["trustee_id"])})).mappings().first()
        conditions: list[dict[str, Any]] = []
        if vote:
            conds = (await db.execute(text("""
                SELECT id, text, attachment_id, status, resolution_reason, resolved_at
                FROM   resolution_vote_conditions
                WHERE  vote_id = CAST(:vid AS uuid)
                ORDER  BY created_at ASC
            """), {"vid": str(vote["id"])})).mappings().all()
            conditions = [dict(c) for c in conds]
    return {
        "resolution": {"id": str(ctx["resolution_id"]), "title": ctx["res_title"],
                       "status": ctx["res_status"]},
        "comments":   [dict(c) for c in comments],
        "my_vote":    dict(vote) if vote else None,
        "my_conditions": conditions,
    }


# ─── Post a review comment (trustee, before/alongside voting) ────────────────
class CommentIn(BaseModel):
    body_html: str


@router.post("/public/board/vote/{token}/comment")
async def public_review_comment(token: str, body: CommentIn, request: Request) -> dict[str, Any]:
    html = sanitize_html(body.body_html)
    if not html.strip():
        raise HTTPException(400, detail="Empty comment")
    async with SessionLocal() as db:
        ctx = await _token_to_context(db, token)
        if ctx.get("res_status") != "OPEN":
            raise HTTPException(409, detail="Voting is closed on this resolution")
        new_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO resolution_review_comments
                (id, resolution_id, trustee_id, trustee_name, body_html)
            VALUES
                (CAST(:id AS uuid), CAST(:rid AS uuid), CAST(:tid AS uuid), :name, :html)
        """), {
            "id": new_id, "rid": str(ctx["resolution_id"]),
            "tid": str(ctx["trustee_id"]), "name": ctx.get("trustee_name") or "Trustee",
            "html": html,
        })
        await db.commit()
    return {"ok": True, "id": new_id}


# ─── Upload a supporting doc during review ───────────────────────────────────
_UPLOAD_MAX = 50 * 1024 * 1024
_ALLOWED = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain", "text/csv", "text/markdown",
    "image/png", "image/jpeg", "image/webp", "image/gif",
    "video/mp4", "video/webm", "video/quicktime", "video/ogg",
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/wav", "audio/x-wav",
    "audio/ogg", "audio/webm",
}


@router.post("/public/board/vote/{token}/upload")
async def public_review_upload(
    token: str, file: UploadFile = File(...),
) -> dict[str, Any]:
    """Trustee uploads a file during review. Lives in the existing
    `board_resolution_attachments` table with source='trustee_review' so
    the admin's existing attachments list sees the file. Returns the id
    the public vote-cast endpoint will accept as `conditions[].attachment_id`.
    """
    data = await file.read()
    if not data:
        raise HTTPException(400, detail="Empty file")
    if len(data) > _UPLOAD_MAX:
        raise HTTPException(413, detail=f"File too large (max {_UPLOAD_MAX // (1024*1024)} MB)")
    ct = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if ct not in _ALLOWED:
        raise HTTPException(415, detail=f"Content type not allowed: {ct}")

    async with SessionLocal() as db:
        ctx = await _token_to_context(db, token)
        new_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO board_resolution_attachments
                (id, resolution_id, filename, content_type, size_bytes, source, uploaded_by, data)
            VALUES
                (CAST(:id AS uuid), CAST(:rid AS uuid), :filename, :ct, :size,
                 'trustee_review', NULL, :data)
        """), {
            "id": new_id, "rid": str(ctx["resolution_id"]),
            "filename": (file.filename or "upload.bin")[:255],
            "ct": ct, "size": len(data), "data": data,
        })
        await db.commit()
    return {"attachment_id": new_id}


# ─── Admin: list + resolve conditions attached to FOR_WITH_CONDITIONS ────────
@router.get("/admin/board/resolutions/{rid}/conditions")
async def list_conditions(rid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT c.id, c.text, c.attachment_id, c.status, c.resolution_reason,
                   c.resolved_at, c.created_at,
                   v.trustee_id, t.full_name AS trustee_name
            FROM   resolution_vote_conditions c
            JOIN   resolution_votes v ON v.id = c.vote_id
            LEFT JOIN trustees       t ON t.id = v.trustee_id
            WHERE  c.resolution_id = CAST(:rid AS uuid)
            ORDER  BY c.created_at ASC
        """), {"rid": rid})).mappings().all()
    pending = [dict(r) for r in rows if r["status"] == "PENDING"]
    others  = [dict(r) for r in rows if r["status"] != "PENDING"]
    return {"pending": pending, "resolved": others, "any_pending": bool(pending)}


class ResolveBody(BaseModel):
    action: str  # accept | reject | defer
    reason: str = ""


_RESOLVE_ACTIONS = {"accept": "ACCEPTED", "reject": "REJECTED", "defer": "DEFERRED"}


@router.post("/admin/board/resolutions/{rid}/conditions/{cid}/resolve")
async def resolve_condition(
    rid: str, cid: str, body: ResolveBody, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    status = _RESOLVE_ACTIONS.get((body.action or "").lower())
    if not status:
        raise HTTPException(400, detail="action must be accept|reject|defer")
    reason = (body.reason or "").strip()[:2000]
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        r = await db.execute(text("""
            UPDATE resolution_vote_conditions
               SET status = :st,
                   resolution_reason = :reason,
                   resolved_by = CAST(:u AS uuid),
                   resolved_at = :now,
                   updated_at  = :now
             WHERE id = CAST(:id AS uuid)
               AND resolution_id = CAST(:rid AS uuid)
               AND status = 'PENDING'
        """), {"st": status, "reason": reason,
               "u": getattr(ctx, "user_id", None), "now": now,
               "id": cid, "rid": rid})
        await db.commit()
    if not r.rowcount:
        raise HTTPException(409, detail="Condition not found or already resolved")
    return {"ok": True, "status": status}


# ─── SMS invite (Twilio, optional) ───────────────────────────────────────────
# Keeping the Twilio glue inline — tiny, no dependency on an SDK. Twilio's
# message endpoint accepts a basic-auth POST so we can get by with httpx
# which is already in deps.
async def _send_sms(to_phone: str, body: str) -> dict[str, Any]:
    """Thin wrapper over the shared services.sms.dispatcher. Uses whatever
    SMS_PROVIDER env selects — GOV.UK Notify by default (free for UK
    charities up to 250k msgs/year), Twilio as the fallback. Returns the
    legacy `{sent, sid?, reason?}` shape so the caller's result loop
    stays unchanged."""
    from shital.services.sms import dispatch_sms
    r = await dispatch_sms(to_phone=to_phone, body=body)
    return {
        "sent":  bool(r.get("ok")),
        "sid":   r.get("id", ""),
        "reason": r.get("reason", ""),
        "detail": r.get("detail", ""),
        "provider": r.get("provider", ""),
    }


class SmsInviteBody(BaseModel):
    message: str = ""   # caller may override; default built from resolution title


@router.post("/admin/board/resolutions/{rid}/send-sms-invites")
async def send_sms_invites(
    rid: str, body: SmsInviteBody, ctx: CurrentSpace,
    base_url: str = Query("", description="e.g. https://admin.shital.org.uk"),
) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        res = (await db.execute(text(
            "SELECT id, title, status FROM resolutions WHERE id = CAST(:id AS uuid)"
        ), {"id": rid})).mappings().first()
        if not res:
            raise HTTPException(404, detail="Resolution not found")
        if res["status"] != "OPEN":
            raise HTTPException(409, detail=f"Resolution is {res['status']}, not OPEN")
        rows = (await db.execute(text("""
            SELECT t.id, t.phone, t.full_name, tok.token
            FROM   trustees t
            JOIN   resolution_vote_tokens tok
                   ON tok.trustee_id    = t.id
                  AND tok.resolution_id = CAST(:rid AS uuid)
            WHERE  t.is_active = true
              AND  COALESCE(t.phone, '') <> ''
        """), {"rid": rid})).mappings().all()

    base = (base_url or "https://admin.shital.org.uk").rstrip("/")
    title = res["title"]
    message = (body.message or "").strip()
    sent = []
    skipped = []
    for r in rows:
        link = f"{base}/board/vote?t={r['token']}"
        text_body = message or (
            f"Trustee action: vote on \"{title}\". Open: {link}\n"
            f"Use your SHITAL Board PIN to confirm."
        )
        result = await _send_sms(str(r["phone"]), text_body)
        if result.get("sent"):
            sent.append({"trustee_id": str(r["id"]), "name": r["full_name"], "sid": result.get("sid")})
        else:
            skipped.append({
                "trustee_id": str(r["id"]), "name": r["full_name"],
                "reason": result.get("reason", "unknown"),
            })
    return {
        "attempted": len(rows), "sent": len(sent),
        "skipped": len(skipped),
        "sent_details": sent, "skipped_details": skipped,
    }


__all__ = ["router"]
