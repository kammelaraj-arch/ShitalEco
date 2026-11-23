"""Phase A collaboration endpoints — external links, comments on drafts,
and the information-request contributor flow (admin + public token side).

Admin endpoints live under /admin/board/resolutions/{rid}/... alongside
the existing board.py. Public contributor endpoints live under
/public/board/info/... alongside board_voting.py.

Publish guard: the existing POST /admin/board/resolutions/{rid}/publish
is extended in board.py to reject when any REQUIRED info request is
still OPEN — see `assert_info_requests_fulfilled`.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal
from shital.services.board.collab import (
    content_hash,
    decode_info_request_token,
    hash_pin,
    info_request_url,
    sanitize_html,
    verify_contributor_pin,
)

router = APIRouter(tags=["board-collab"])


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "CHAIR"}:
        raise HTTPException(403, detail="Admin or chair role required")


async def _ensure_resolution_exists(rid: str) -> None:
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT id, status FROM resolutions WHERE id = CAST(:id AS uuid)"
        ), {"id": rid})).first()
    if not row:
        raise HTTPException(404, detail="Resolution not found")


async def assert_info_requests_fulfilled(rid: str) -> None:
    """Raise HTTPException(409) if any REQUIRED info request is still OPEN.

    Called from board.py's publish handler so the publish button on the
    admin UI can gate on this via the /info-requests listing response.
    """
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT COUNT(*) FROM resolution_info_requests
             WHERE resolution_id = CAST(:id AS uuid)
               AND is_required   = true
               AND status        = 'OPEN'
        """), {"id": rid})).first()
    if row and int(row[0]) > 0:
        raise HTTPException(
            409,
            detail=f"{int(row[0])} required information request(s) still open — fulfil before publishing",
        )


# ─── External links ───────────────────────────────────────────────────────────
class ExternalLinkIn(BaseModel):
    label: str
    url:   str


@router.get("/admin/board/resolutions/{rid}/external-links")
async def list_external_links(rid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    await _ensure_resolution_exists(rid)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id, label, url, added_by_name, added_at
            FROM   resolution_external_links
            WHERE  resolution_id = CAST(:id AS uuid)
            ORDER  BY added_at ASC
        """), {"id": rid})).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.post("/admin/board/resolutions/{rid}/external-links")
async def add_external_link(rid: str, body: ExternalLinkIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    await _ensure_resolution_exists(rid)
    label = (body.label or "").strip()
    url   = (body.url or "").strip()
    if not label or not url:
        raise HTTPException(400, detail="label and url are required")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, detail="url must start with http:// or https://")
    if len(url) > 2048 or len(label) > 255:
        raise HTTPException(400, detail="label or url too long")
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO resolution_external_links
                (id, resolution_id, label, url, added_by, added_by_name)
            VALUES
                (CAST(:id AS uuid), CAST(:rid AS uuid), :label, :url, CAST(:u AS uuid), :uname)
        """), {
            "id": new_id, "rid": rid, "label": label, "url": url,
            "u": getattr(ctx, "user_id", None),
            "uname": getattr(ctx, "user_email", "") or "",
        })
        await db.commit()
    return {"ok": True, "id": new_id}


@router.delete("/admin/board/resolutions/{rid}/external-links/{link_id}")
async def delete_external_link(rid: str, link_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        r = await db.execute(text("""
            DELETE FROM resolution_external_links
            WHERE id = CAST(:lid AS uuid) AND resolution_id = CAST(:rid AS uuid)
        """), {"lid": link_id, "rid": rid})
        await db.commit()
    return {"ok": True, "deleted": r.rowcount}


# ─── Comments thread ──────────────────────────────────────────────────────────
class CommentIn(BaseModel):
    body_html: str = Field(..., description="Rich-text HTML from the editor")


@router.get("/admin/board/resolutions/{rid}/comments")
async def list_comments(rid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    await _ensure_resolution_exists(rid)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id, author_name, body_html, created_at
            FROM   resolution_comments
            WHERE  resolution_id = CAST(:id AS uuid)
            ORDER  BY created_at ASC
        """), {"id": rid})).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.post("/admin/board/resolutions/{rid}/comments")
async def add_comment(rid: str, body: CommentIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    await _ensure_resolution_exists(rid)
    html = sanitize_html(body.body_html)
    if not html.strip():
        raise HTTPException(400, detail="Empty comment")
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO resolution_comments
                (id, resolution_id, author_user_id, author_name, body_html)
            VALUES
                (CAST(:id AS uuid), CAST(:rid AS uuid), CAST(:u AS uuid), :uname, :html)
        """), {
            "id": new_id, "rid": rid, "html": html,
            "u": getattr(ctx, "user_id", None),
            "uname": getattr(ctx, "user_email", "") or "",
        })
        await db.commit()
    return {"ok": True, "id": new_id}


@router.delete("/admin/board/resolutions/{rid}/comments/{comment_id}")
async def delete_comment(rid: str, comment_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        r = await db.execute(text("""
            DELETE FROM resolution_comments
            WHERE id = CAST(:cid AS uuid) AND resolution_id = CAST(:rid AS uuid)
        """), {"cid": comment_id, "rid": rid})
        await db.commit()
    return {"ok": True, "deleted": r.rowcount}


# ─── Information requests — admin side ────────────────────────────────────────
_ALLOWED_TYPES = {"text", "document", "image", "video", "audio"}


class InfoRequestIn(BaseModel):
    target_email: str
    target_name:  str = ""
    prompt:       str
    expected_type: str = "text"
    is_required:  bool = False
    due_at:       str | None = None


@router.get("/admin/board/resolutions/{rid}/info-requests")
async def list_info_requests(rid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    await _ensure_resolution_exists(rid)
    async with SessionLocal() as db:
        reqs = (await db.execute(text("""
            SELECT id, target_email, target_name, prompt, expected_type,
                   is_required, due_at, status, requested_by_name, created_at
            FROM   resolution_info_requests
            WHERE  resolution_id = CAST(:id AS uuid)
            ORDER  BY created_at ASC
        """), {"id": rid})).mappings().all()
        resps = (await db.execute(text("""
            SELECT r.request_id, r.id AS response_id, r.body_html, r.attachment_id,
                   r.submitted_by_email, r.submitted_at, r.locked_at, r.content_hash
            FROM   resolution_info_responses r
            JOIN   resolution_info_requests  q ON q.id = r.request_id
            WHERE  q.resolution_id = CAST(:id AS uuid)
        """), {"id": rid})).mappings().all()
    by_req: dict[str, list[dict[str, Any]]] = {}
    for resp in resps:
        by_req.setdefault(str(resp["request_id"]), []).append(dict(resp))
    items = []
    has_open_required = False
    for q in reqs:
        d = dict(q)
        d["responses"] = by_req.get(str(q["id"]), [])
        items.append(d)
        if q["is_required"] and q["status"] == "OPEN":
            has_open_required = True
    return {"items": items, "has_open_required": has_open_required}


@router.post("/admin/board/resolutions/{rid}/info-requests")
async def create_info_request(rid: str, body: InfoRequestIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    await _ensure_resolution_exists(rid)
    email = (body.target_email or "").strip().lower()
    prompt = (body.prompt or "").strip()
    if not email or "@" not in email:
        raise HTTPException(400, detail="target_email required")
    if not prompt:
        raise HTTPException(400, detail="prompt required")
    etype = (body.expected_type or "text").strip().lower()
    if etype not in _ALLOWED_TYPES:
        raise HTTPException(400, detail=f"expected_type must be one of {sorted(_ALLOWED_TYPES)}")
    due_at = None
    if body.due_at:
        try:
            due_at = datetime.fromisoformat(body.due_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, detail="due_at must be ISO-8601") from None

    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO resolution_info_requests
                (id, resolution_id, target_email, target_name, prompt, expected_type,
                 is_required, due_at, requested_by, requested_by_name)
            VALUES
                (CAST(:id AS uuid), CAST(:rid AS uuid), :email, :name, :prompt, :etype,
                 :req, :due, CAST(:u AS uuid), :uname)
        """), {
            "id": new_id, "rid": rid, "email": email, "name": (body.target_name or "").strip()[:255],
            "prompt": prompt, "etype": etype, "req": bool(body.is_required), "due": due_at,
            "u": getattr(ctx, "user_id", None),
            "uname": getattr(ctx, "user_email", "") or "",
        })
        await db.commit()
    return {"ok": True, "id": new_id, "invite_url": info_request_url(new_id, email)}


@router.post("/admin/board/resolutions/{rid}/info-requests/{req_id}/send-invite")
async def send_invite(rid: str, req_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Re-mint a fresh invite URL and send the email. Idempotent — safe to
    call multiple times. Returns the URL so admin UI can also show / copy it."""
    _require_admin(ctx)
    async with SessionLocal() as db:
        req = (await db.execute(text("""
            SELECT q.id, q.target_email, q.target_name, q.prompt, q.status,
                   r.title AS res_title
            FROM   resolution_info_requests q
            JOIN   resolutions r ON r.id = q.resolution_id
            WHERE  q.id = CAST(:id AS uuid) AND q.resolution_id = CAST(:rid AS uuid)
            LIMIT  1
        """), {"id": req_id, "rid": rid})).mappings().first()
    if not req:
        raise HTTPException(404, detail="Info request not found")
    if req["status"] != "OPEN":
        raise HTTPException(409, detail=f"Request is {req['status']}")

    url = info_request_url(req_id, str(req["target_email"]))

    # Fire the invite email through the existing audit-logged path. Fire-
    # and-forget — a mail miss is recoverable via admin → Resend.
    try:
        from shital.api.routers.email_templates import send_raw_email
        subject = f"Information needed: {req['res_title']}"
        html = (
            f"<p>Hi {req['target_name'] or req['target_email']},</p>"
            f"<p>The Board is preparing a resolution and needs your input:</p>"
            f"<blockquote>{req['prompt']}</blockquote>"
            f"<p><a href=\"{url}\">Open the information request</a></p>"
            f"<p>You'll be asked to set / enter a PIN before submitting. "
            f"Your response will be locked once you click Submit — please attach any supporting files before you do.</p>"
            f"<p>— SHITAL Board</p>"
        )
        await send_raw_email(
            to_email=str(req["target_email"]), subject=subject,
            html_body=html, text_body="",
            related_type="info_request", related_id=req_id,
            triggered_by=getattr(ctx, "user_email", "") or "",
        )
    except Exception as exc:  # non-fatal, URL is still in the response
        return {"ok": True, "url": url, "email_error": str(exc)[:200]}
    return {"ok": True, "url": url}


@router.delete("/admin/board/resolutions/{rid}/info-requests/{req_id}")
async def cancel_info_request(rid: str, req_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        r = await db.execute(text("""
            UPDATE resolution_info_requests
               SET status = 'CANCELLED', updated_at = NOW()
             WHERE id = CAST(:id AS uuid) AND resolution_id = CAST(:rid AS uuid)
               AND status = 'OPEN'
        """), {"id": req_id, "rid": rid})
        await db.commit()
    return {"ok": True, "cancelled": r.rowcount}


# ─── Public attachment upload (info-request flow) ───────────────────────────
# Narrower than the admin upload: no auth cookie, but the signed token
# binds the uploader to one specific request. Same table (board_resolution_
# attachments) is reused with source='info_request' so admin's existing
# attachments view sees contributions alongside official files.
_PUBLIC_MAX_BYTES = 50 * 1024 * 1024  # 50 MB — videos / audio
_PUBLIC_ALLOWED_TYPES = {
    # Documents
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain", "text/csv", "text/markdown",
    # Images
    "image/png", "image/jpeg", "image/webp", "image/gif",
    # Video
    "video/mp4", "video/webm", "video/quicktime", "video/ogg",
    # Audio
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/wav", "audio/x-wav",
    "audio/ogg", "audio/webm",
}


@router.post("/public/board/info/upload")
async def public_upload(
    t: str = Query(..., description="Signed info-request token"),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    rid, email = decode_info_request_token(t)
    data = await file.read()
    if not data:
        raise HTTPException(400, detail="Empty file")
    if len(data) > _PUBLIC_MAX_BYTES:
        raise HTTPException(413, detail=f"File too large (max {_PUBLIC_MAX_BYTES // (1024*1024)} MB)")
    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if content_type not in _PUBLIC_ALLOWED_TYPES:
        raise HTTPException(415, detail=f"Content type not allowed: {content_type}")

    async with SessionLocal() as db:
        # Resolve the resolution this request belongs to so we can plant the
        # attachment next to the resolution's own files.
        res = (await db.execute(text("""
            SELECT q.resolution_id FROM resolution_info_requests q
             WHERE q.id = CAST(:id AS uuid) AND LOWER(q.target_email) = :e
             LIMIT 1
        """), {"id": rid, "e": email})).first()
        if not res:
            raise HTTPException(404, detail="Request not found")
        resolution_id = str(res[0])

        new_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO board_resolution_attachments
                (id, resolution_id, filename, content_type, size_bytes, source, uploaded_by, data)
            VALUES
                (CAST(:id AS uuid), CAST(:rid AS uuid), :filename, :ct, :size, 'info_request', NULL, :data)
        """), {
            "id": new_id, "rid": resolution_id,
            "filename": (file.filename or "upload.bin")[:255],
            "ct": content_type, "size": len(data), "data": data,
        })
        await db.commit()
    return {"attachment_id": new_id}


# ─── Information requests — public contributor side ──────────────────────────
class PinSetBody(BaseModel):
    token: str
    pin:   str
    name:  str = ""


class PinVerifyBody(BaseModel):
    token: str
    pin:   str


class ResponseSubmitBody(BaseModel):
    token:          str
    pin:            str
    body_html:      str = ""
    attachment_id:  str | None = None   # attachments uploaded via existing endpoint


async def _load_request_for_token(token: str) -> dict[str, Any]:
    rid, email = decode_info_request_token(token)
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT q.id, q.target_email, q.target_name, q.prompt, q.expected_type,
                   q.is_required, q.due_at, q.status,
                   r.title AS res_title, r.id AS resolution_id
            FROM   resolution_info_requests q
            JOIN   resolutions r ON r.id = q.resolution_id
            WHERE  q.id = CAST(:id AS uuid) AND LOWER(q.target_email) = :e
            LIMIT  1
        """), {"id": rid, "e": email})).mappings().first()
    if not row:
        raise HTTPException(404, detail="Request not found")
    return dict(row)


@router.get("/public/board/info/{token}")
async def public_load_info_request(token: str) -> dict[str, Any]:
    req = await _load_request_for_token(token)
    async with SessionLocal() as db:
        pin_row = (await db.execute(text("""
            SELECT name, (pin_hash <> '')::int AS has_pin
            FROM   info_contributors WHERE email = :e LIMIT 1
        """), {"e": req["target_email"]})).first()
    return {
        "request": {
            "id":            str(req["id"]),
            "target_email":  req["target_email"],
            "target_name":   req["target_name"],
            "prompt":        req["prompt"],
            "expected_type": req["expected_type"],
            "is_required":   req["is_required"],
            "due_at":        req["due_at"].isoformat() if req.get("due_at") else None,
            "status":        req["status"],
        },
        "resolution": {
            "id":    str(req["resolution_id"]),
            "title": req["res_title"],
        },
        "has_pin": bool(pin_row and pin_row[1]),
        "contributor_name": (pin_row[0] if pin_row else "") or req.get("target_name") or "",
    }


@router.post("/public/board/info/set-pin")
async def public_set_pin(body: PinSetBody, request: Request) -> dict[str, Any]:
    """First-time PIN set for a contributor. Requires the signed token so
    an attacker can't set a PIN against an email they don't own."""
    _, email = decode_info_request_token(body.token)
    pin_hash = hash_pin(body.pin)
    name = (body.name or "").strip()[:255]
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT pin_hash FROM info_contributors WHERE email = :e LIMIT 1"
        ), {"e": email})).first()
        if row and row[0]:
            raise HTTPException(409, detail="PIN already set — ask admin to reset if forgotten")
        await db.execute(text("""
            INSERT INTO info_contributors (email, name, pin_hash, updated_at)
            VALUES (:e, :n, :h, NOW())
            ON CONFLICT (email) DO UPDATE SET
                name       = EXCLUDED.name,
                pin_hash   = EXCLUDED.pin_hash,
                updated_at = NOW()
        """), {"e": email, "n": name, "h": pin_hash})
        await db.commit()
    return {"ok": True}


@router.post("/public/board/info/submit")
async def public_submit_response(body: ResponseSubmitBody, request: Request) -> dict[str, Any]:
    """Submit and LOCK the contributor's response. Idempotent against re-
    submit: once a response row carries a locked_at timestamp the request
    status flips to SUBMITTED and this endpoint refuses further writes."""
    rid, email = decode_info_request_token(body.token)
    await verify_contributor_pin(email, body.pin)

    html = sanitize_html(body.body_html)

    async with SessionLocal() as db:
        req = (await db.execute(text("""
            SELECT id, expected_type, status
            FROM   resolution_info_requests
            WHERE  id = CAST(:id AS uuid) AND LOWER(target_email) = :e
            LIMIT  1
        """), {"id": rid, "e": email})).mappings().first()
        if not req:
            raise HTTPException(404, detail="Request not found")
        if req["status"] != "OPEN":
            raise HTTPException(409, detail=f"Request is {req['status']}")

        # Validate media expectation: a non-text request must carry an
        # attachment; a text request can go body-only.
        if req["expected_type"] != "text" and not body.attachment_id:
            raise HTTPException(
                400, detail=f"An attachment ({req['expected_type']}) is required for this request",
            )
        if not html and not body.attachment_id:
            raise HTTPException(400, detail="Nothing to submit — add text or an attachment")

        chash = content_hash(html)
        now = datetime.now(UTC)
        new_id = str(uuid.uuid4())

        ip = (request.client.host if request.client else "")[:45]
        ua = (request.headers.get("user-agent") or "")[:500]

        await db.execute(text("""
            INSERT INTO resolution_info_responses
                (id, request_id, body_html, attachment_id, submitted_by_email,
                 submitted_at, locked_at, content_hash, source_ip, user_agent)
            VALUES
                (CAST(:id AS uuid), CAST(:rid AS uuid), :html,
                 CAST(:att AS uuid), :e, :now, :now, :h, :ip, :ua)
        """), {
            "id": new_id, "rid": rid, "html": html,
            "att": body.attachment_id if body.attachment_id else None,
            "e": email, "now": now, "h": chash, "ip": ip, "ua": ua,
        })
        await db.execute(text("""
            UPDATE resolution_info_requests
               SET status = 'SUBMITTED', updated_at = NOW()
             WHERE id = CAST(:id AS uuid)
        """), {"id": rid})
        await db.commit()

    return {"ok": True, "response_id": new_id, "content_hash": chash, "locked_at": now.isoformat()}


__all__ = ["router", "assert_info_requests_fulfilled"]
