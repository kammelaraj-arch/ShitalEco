"""Board Resolution wizard — attachments + AI draft.

Companion to board.py's /admin/board/resolutions CRUD. Adds the two
features the wizard's Context step needs:

  POST   /admin/board/resolutions/{rid}/attachments           (multipart)
  GET    /admin/board/resolutions/{rid}/attachments
  DELETE /admin/board/resolutions/{rid}/attachments/{aid}
  GET    /admin/board/resolutions/{rid}/attachments/{aid}/download
  POST   /admin/board/resolutions/{rid}/attachments/pull-from-meeting
  POST   /admin/board/resolutions/{rid}/ai-draft

AI model: the unified fabrics/ai client, which prefers Azure OpenAI
(charity's M365 / Azure-for-Nonprofits tenancy) and falls back to
Anthropic. The model only ever returns a JSON object; the human
edits it before publishing. Every run is logged to
board_resolution_ai_drafts for the paper trail.

Size caps: 20 MB per file, 50 attachments per resolution. Content-type
allow-list keeps us off binary surprises.

Guardrails:
  - Attachments mutate only while resolution.status = 'DRAFT'. Once the
    text is locked (status != DRAFT), uploads + deletes return 409 so
    nothing can be slipped past trustees after publication.
  - AI call requires at least one configured provider (Azure OpenAI or
    Anthropic). Returns 503 clearly if neither is set up.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.ai import AIProviderError, AIProviderUnavailable, ai_json_object
from shital.core.fabrics.database import SessionLocal

router = APIRouter(tags=["board", "board-resolutions"])

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_ATTACHMENTS_PER_RESOLUTION = 50
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "text/markdown",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
}

_ALLOWED_CATEGORIES = {"OPERATIONAL", "OFFICER_ELECTION", "POLICY", "CONTRACT", "CONSTITUTIONAL"}
_ALLOWED_DECISION_TYPES = {"BOARD_MEETING", "WRITTEN_RESOLUTION", "RETROSPECTIVE"}


def _only_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="ADMIN required")


async def _ensure_resolution(db: Any, rid: str) -> dict[str, Any]:
    try:
        uuid.UUID(rid)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=404, detail="Resolution not found") from exc
    row = (await db.execute(
        text("SELECT id::text AS id, status, meeting_id::text AS meeting_id FROM resolutions WHERE id = :id"),
        {"id": rid},
    )).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Resolution not found")
    return dict(row)


def _download_url(rid: str, att_id: str) -> str:
    return f"/api/v1/admin/board/resolutions/{rid}/attachments/{att_id}/download"


def _attachment_row(rid: str, r: Any) -> dict[str, Any]:
    d = dict(r)
    return {
        "id":           str(d["id"]),
        "filename":     d["filename"],
        "content_type": d["content_type"],
        "size_bytes":   int(d["size_bytes"] or 0),
        "source":       d["source"],
        "url":          _download_url(rid, str(d["id"])),
        "uploaded_at":  d["created_at"].isoformat() if d.get("created_at") else "",
    }


# ───────────────────────────── Attachments ───────────────────────────────

@router.get("/admin/board/resolutions/{rid}/attachments")
async def list_attachments(ctx: CurrentSpace, rid: str) -> dict[str, Any]:
    _only_admin(ctx)
    async with SessionLocal() as db:
        await _ensure_resolution(db, rid)
        rows = (await db.execute(text("""
            SELECT id, filename, content_type, size_bytes, source, created_at
              FROM board_resolution_attachments
             WHERE resolution_id = :rid AND deleted_at IS NULL
             ORDER BY created_at
        """), {"rid": rid})).mappings().all()
    return {"items": [_attachment_row(rid, r) for r in rows]}


@router.post("/admin/board/resolutions/{rid}/attachments")
async def upload_attachment(
    ctx: CurrentSpace,
    rid: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    _only_admin(ctx)

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_FILE_BYTES // (1024*1024)} MB)")

    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail=f"Content type not allowed: {content_type}")

    async with SessionLocal() as db:
        res = await _ensure_resolution(db, rid)
        if res["status"] != "DRAFT":
            raise HTTPException(status_code=409, detail="Resolution is locked — attachments can only change while DRAFT")

        count = (await db.execute(text("""
            SELECT COUNT(*) FROM board_resolution_attachments
             WHERE resolution_id = :rid AND deleted_at IS NULL
        """), {"rid": rid})).scalar()
        if count and int(count) >= MAX_ATTACHMENTS_PER_RESOLUTION:
            raise HTTPException(status_code=409, detail=f"Attachment limit reached ({MAX_ATTACHMENTS_PER_RESOLUTION})")

        new_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO board_resolution_attachments
                (id, resolution_id, filename, content_type, size_bytes, source, uploaded_by, data)
            VALUES
                (:id, :rid, :filename, :ct, :size, 'upload', :uid, :data)
        """), {
            "id":       new_id,
            "rid":      rid,
            "filename": (file.filename or "attachment")[:255],
            "ct":       content_type,
            "size":     len(data),
            "uid":      ctx.user_id,
            "data":     data,
        })
        await db.commit()

        row = (await db.execute(text("""
            SELECT id, filename, content_type, size_bytes, source, created_at
              FROM board_resolution_attachments WHERE id = :id
        """), {"id": new_id})).mappings().first()

    return {"attachment": _attachment_row(rid, row)}


@router.delete("/admin/board/resolutions/{rid}/attachments/{att_id}")
async def delete_attachment(ctx: CurrentSpace, rid: str, att_id: str) -> dict[str, Any]:
    _only_admin(ctx)
    try:
        uuid.UUID(att_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=404, detail="Attachment not found") from exc
    async with SessionLocal() as db:
        res = await _ensure_resolution(db, rid)
        if res["status"] != "DRAFT":
            raise HTTPException(status_code=409, detail="Resolution is locked — attachments can only change while DRAFT")
        result = await db.execute(text("""
            UPDATE board_resolution_attachments
               SET deleted_at = NOW()
             WHERE id = :id AND resolution_id = :rid AND deleted_at IS NULL
        """), {"id": att_id, "rid": rid})
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Attachment not found")
        await db.commit()
    return {"ok": True}


@router.get("/admin/board/resolutions/{rid}/attachments/{att_id}/download")
async def download_attachment(ctx: CurrentSpace, rid: str, att_id: str):
    _only_admin(ctx)
    from fastapi.responses import Response
    async with SessionLocal() as db:
        await _ensure_resolution(db, rid)
        row = (await db.execute(text("""
            SELECT filename, content_type, data
              FROM board_resolution_attachments
             WHERE id = :id AND resolution_id = :rid AND deleted_at IS NULL
        """), {"id": att_id, "rid": rid})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    safe_name = (row["filename"] or "attachment").replace('"', "")
    return Response(
        content=bytes(row["data"]),
        media_type=row["content_type"] or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
    )


class _PullFromMeetingIn(BaseModel):
    meeting_id: str


@router.post("/admin/board/resolutions/{rid}/attachments/pull-from-meeting")
async def pull_from_meeting(
    ctx: CurrentSpace,
    rid: str,
    body: _PullFromMeetingIn,
) -> dict[str, Any]:
    """Copy a meeting's attached files onto the resolution. If no
    meeting_attachments table yet, return an empty result so the UI
    button is safe to click on partial deployments."""
    _only_admin(ctx)
    try:
        uuid.UUID(body.meeting_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid meeting_id") from exc

    async with SessionLocal() as db:
        res = await _ensure_resolution(db, rid)
        if res["status"] != "DRAFT":
            raise HTTPException(status_code=409, detail="Resolution is locked")

        has_meeting_atts = bool((await db.execute(text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables WHERE table_name = 'meeting_attachments'
            )
        """))).scalar())
        if not has_meeting_atts:
            return {"items": [], "pulled": 0, "note": "No meeting_attachments table yet — nothing to pull."}

        src = (await db.execute(text("""
            SELECT filename, content_type, size_bytes, data
              FROM meeting_attachments
             WHERE meeting_id = :mid
        """), {"mid": body.meeting_id})).mappings().all()

        pulled = 0
        for s in src:
            await db.execute(text("""
                INSERT INTO board_resolution_attachments
                    (id, resolution_id, filename, content_type, size_bytes, source, uploaded_by, data)
                VALUES
                    (gen_random_uuid(), :rid, :filename, :ct, :size, 'meeting', :uid, :data)
            """), {
                "rid":      rid,
                "filename": s["filename"],
                "ct":       s["content_type"] or "application/octet-stream",
                "size":     int(s["size_bytes"] or 0),
                "uid":      ctx.user_id,
                "data":     s["data"],
            })
            pulled += 1
        await db.commit()

        rows = (await db.execute(text("""
            SELECT id, filename, content_type, size_bytes, source, created_at
              FROM board_resolution_attachments
             WHERE resolution_id = :rid AND deleted_at IS NULL
             ORDER BY created_at
        """), {"rid": rid})).mappings().all()

    return {"items": [_attachment_row(rid, r) for r in rows], "pulled": pulled}


# ───────────────────────────── AI draft ──────────────────────────────────

class _AiCurrent(BaseModel):
    title: str = ""
    background: str = ""
    recommendation: str = ""
    risk_impact: str = ""
    budget_impact: str = ""
    category: str = "OPERATIONAL"
    decision_type: str = "BOARD_MEETING"


class _AiDraftIn(BaseModel):
    mode: str = "draft"            # "draft" | "finalise"
    meeting_id: str | None = None
    instruction: str | None = None
    current: _AiCurrent | None = None


async def _gather_context(db: Any, rid: str, meeting_id: str | None) -> tuple[str, list[str]]:
    """Build the context block the model gets: meeting minutes + attached text/docs."""
    excerpts: list[str] = []
    sources: list[str] = []

    if meeting_id:
        try:
            uuid.UUID(meeting_id)
            has_meetings = bool((await db.execute(text("""
                SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'board_meetings')
            """))).scalar())
            if has_meetings:
                m = (await db.execute(text("""
                    SELECT title, meeting_type, scheduled_at,
                           COALESCE(agenda, '') AS agenda,
                           COALESCE(minutes_text, '') AS minutes
                      FROM board_meetings WHERE id = :id
                """), {"id": meeting_id})).mappings().first()
                if m:
                    excerpts.append(
                        f"[MEETING] {m['title'] or m['meeting_type']} on {m['scheduled_at']}\n"
                        f"AGENDA:\n{m['agenda']}\n\nMINUTES:\n{m['minutes']}"
                    )
                    sources.append(f"meeting:{meeting_id}")
        except (ValueError, TypeError):
            pass

    # Inline text/markdown/json attachments the model can actually read.
    atts = (await db.execute(text("""
        SELECT filename, content_type, data
          FROM board_resolution_attachments
         WHERE resolution_id = :rid AND deleted_at IS NULL
    """), {"rid": rid})).mappings().all()
    for a in atts:
        ct = (a["content_type"] or "").lower()
        if ct.startswith("text/") or ct in ("application/json",):
            try:
                body = bytes(a["data"]).decode("utf-8", errors="replace")[:6000]
                excerpts.append(f"[FILE {a['filename']}]\n{body}")
            except Exception:
                excerpts.append(f"[FILE {a['filename']} — could not decode]")
        else:
            excerpts.append(f"[FILE {a['filename']} — {ct}, binary, not inlined]")
        sources.append(f"attachment:{a['filename']}")

    joined = "\n\n---\n\n".join(excerpts) if excerpts else ""
    return joined, sources


def _ai_prompt(mode: str, instruction: str, current: _AiCurrent | None, context_block: str) -> tuple[str, str]:
    cur = current or _AiCurrent()
    sys = (
        "You are the Board Clerk AI for Shital Hindu Temple (UK charity). "
        "You help trustees turn meeting discussions into a well-formed, "
        "Charity-Commission-aligned board resolution. "
        "Reply ONLY with a single JSON object with these string fields: "
        "title, background, recommendation, risk_impact, budget_impact, "
        "category (one of OPERATIONAL/OFFICER_ELECTION/POLICY/CONTRACT/CONSTITUTIONAL), "
        "decision_type (one of BOARD_MEETING/WRITTEN_RESOLUTION/RETROSPECTIVE). "
        "No prose outside the JSON. No markdown fences. "
        "Write in clear British English. Keep each field focused."
    )
    action = (
        "Draft a new resolution from the meeting material below. "
        "The human proposer may give additional guidance in INSTRUCTION."
        if mode == "draft"
        else "Polish and finalise the draft resolution below while preserving the proposer's intent. "
             "Fix tone, structure, and ambiguity. Do not introduce new facts."
    )
    user = (
        f"{action}\n\n"
        f"INSTRUCTION:\n{instruction or '(none)'}\n\n"
        f"CURRENT DRAFT FIELDS:\n"
        f"- title: {cur.title}\n"
        f"- category: {cur.category}\n"
        f"- decision_type: {cur.decision_type}\n"
        f"- background: {cur.background}\n"
        f"- recommendation: {cur.recommendation}\n"
        f"- risk_impact: {cur.risk_impact}\n"
        f"- budget_impact: {cur.budget_impact}\n\n"
        f"CONTEXT (meeting minutes + attached notes):\n{context_block or '(no context provided)'}\n"
    )
    return sys, user


def _validate_draft(parsed: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(parsed, dict):
        return {}
    out: dict[str, Any] = {}
    for key in ("title", "background", "recommendation", "risk_impact", "budget_impact"):
        v = parsed.get(key)
        if isinstance(v, str):
            out[key] = v
    cat = parsed.get("category")
    if isinstance(cat, str) and cat.upper() in _ALLOWED_CATEGORIES:
        out["category"] = cat.upper()
    dt = parsed.get("decision_type")
    if isinstance(dt, str) and dt.upper() in _ALLOWED_DECISION_TYPES:
        out["decision_type"] = dt.upper()
    return out


@router.post("/admin/board/resolutions/{rid}/ai-draft")
async def ai_draft(ctx: CurrentSpace, rid: str, body: _AiDraftIn) -> dict[str, Any]:
    _only_admin(ctx)
    mode = (body.mode or "draft").lower()
    if mode not in ("draft", "finalise"):
        raise HTTPException(status_code=400, detail="mode must be 'draft' or 'finalise'")

    async with SessionLocal() as db:
        res = await _ensure_resolution(db, rid)
        if res["status"] != "DRAFT":
            raise HTTPException(status_code=409, detail="Resolution is locked — AI can only edit a DRAFT")

        context_block, sources = await _gather_context(db, rid, body.meeting_id)
        sys_prompt, user_prompt = _ai_prompt(
            mode=mode,
            instruction=(body.instruction or "").strip(),
            current=body.current,
            context_block=context_block,
        )

        try:
            parsed, model = await ai_json_object(sys_prompt, user_prompt, max_tokens=1500)
        except AIProviderUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except AIProviderError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        draft = _validate_draft(parsed)
        if not draft:
            raise HTTPException(status_code=502, detail="AI returned an unparseable response")

        await db.execute(text("""
            INSERT INTO board_resolution_ai_drafts
                (id, resolution_id, mode, meeting_id, instruction, source_excerpt, output_json, model, run_by)
            VALUES
                (gen_random_uuid(), :rid, :mode, :mid, :instruction, :excerpt, CAST(:out AS JSONB), :model, :uid)
        """), {
            "rid":         rid,
            "mode":        mode,
            "mid":         body.meeting_id if body.meeting_id else None,
            "instruction": (body.instruction or "")[:4000],
            "excerpt":     context_block[:8000],
            "out":         json.dumps(draft),
            "model":       model,
            "uid":         ctx.user_id,
        })
        await db.commit()

    return {"draft": draft, "source": "ai", "model": model, "sources": sources}


__all__ = ["router"]
