"""Phase B — announcement plan attached to a resolution.

The actual send happens in Phase D after chair sign-off. This router is
the authoring surface:

  GET    /admin/board/resolutions/{rid}/announcement              → plan + audiences
  PUT    /admin/board/resolutions/{rid}/announcement              → upsert plan
  POST   /admin/board/resolutions/{rid}/announcement/audiences    → add audience
  DELETE /admin/board/resolutions/{rid}/announcement/audiences/{aud_id}
  POST   /admin/board/resolutions/{rid}/announcement/preview-count → resolved totals

Audience "kinds" supported:
  all_contacts     — every row in `contacts`
  volunteers       — every active volunteer (joined via contacts.email)
  recent_donors    — contacts with at least one donation in the last N months
  trustees         — every active trustee
  individuals      — specific contact UUIDs chosen by the author
  external_list    — ad-hoc {email, name} pairs the chair has to approve

Nothing in this router fires any email / SMS — Phase D's worker will
iterate the audiences and respect the per-channel opt-in gate from
Phase 1a. We DO precompute the recipient count here so the author sees
the fan-out size before hitting Submit.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal
from shital.services.board.collab import sanitize_html

router = APIRouter(tags=["board-announcement"])

_ALLOWED_CHANNELS = {"email", "sms", "whatsapp"}
_ALLOWED_KINDS = {
    "all_contacts", "volunteers", "recent_donors",
    "trustees", "individuals", "external_list",
}
_EXTERNAL_KINDS = {"external_list"}


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "CHAIR"}:
        raise HTTPException(403, detail="Admin or chair role required")


async def _ensure_resolution(rid: str) -> None:
    async with SessionLocal() as db:
        r = (await db.execute(text(
            "SELECT id FROM resolutions WHERE id = CAST(:id AS uuid)"
        ), {"id": rid})).first()
    if not r:
        raise HTTPException(404, detail="Resolution not found")


async def _get_or_create_plan(db: Any, rid: str, user_id: Any) -> dict[str, Any]:
    row = (await db.execute(text("""
        SELECT id, subject, body_html, channels, requires_chair_approval,
               status, created_at, updated_at
        FROM   resolution_announcements WHERE resolution_id = CAST(:rid AS uuid)
        LIMIT  1
    """), {"rid": rid})).mappings().first()
    if row:
        return dict(row)
    new_id = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO resolution_announcements
            (id, resolution_id, created_by, channels)
        VALUES
            (CAST(:id AS uuid), CAST(:rid AS uuid), CAST(:u AS uuid), '["email"]'::jsonb)
    """), {"id": new_id, "rid": rid, "u": user_id})
    await db.commit()
    row = (await db.execute(text("""
        SELECT id, subject, body_html, channels, requires_chair_approval,
               status, created_at, updated_at
        FROM   resolution_announcements WHERE id = CAST(:id AS uuid)
    """), {"id": new_id})).mappings().first()
    return dict(row)  # type: ignore[arg-type]


async def _refresh_requires_approval(db: Any, ann_id: str) -> bool:
    """Set requires_chair_approval = EXISTS(an external_list audience)."""
    row = (await db.execute(text("""
        SELECT COUNT(*) FROM resolution_announcement_audiences
         WHERE announcement_id = CAST(:a AS uuid) AND kind = 'external_list'
    """), {"a": ann_id})).first()
    needs = bool(row and int(row[0]) > 0)
    await db.execute(text("""
        UPDATE resolution_announcements
           SET requires_chair_approval = :n, updated_at = NOW()
         WHERE id = CAST(:a AS uuid)
    """), {"a": ann_id, "n": needs})
    await db.commit()
    return needs


# ─── GET / PUT plan ──────────────────────────────────────────────────────────
@router.get("/admin/board/resolutions/{rid}/announcement")
async def get_plan(rid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    await _ensure_resolution(rid)
    async with SessionLocal() as db:
        plan = await _get_or_create_plan(db, rid, getattr(ctx, "user_id", None))
        auds = (await db.execute(text("""
            SELECT id, kind, params, added_by_name, created_at
            FROM   resolution_announcement_audiences
            WHERE  announcement_id = CAST(:a AS uuid)
            ORDER  BY created_at ASC
        """), {"a": str(plan["id"])})).mappings().all()
    return {
        "plan": {**plan, "id": str(plan["id"])},
        "audiences": [dict(a) for a in auds],
    }


class PlanUpdate(BaseModel):
    subject:   str | None = None
    body_html: str | None = None
    channels:  list[str] | None = None


@router.put("/admin/board/resolutions/{rid}/announcement")
async def update_plan(rid: str, body: PlanUpdate, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    await _ensure_resolution(rid)

    subject = (body.subject or "").strip()[:500] if body.subject is not None else None
    html = sanitize_html(body.body_html) if body.body_html is not None else None
    channels = None
    if body.channels is not None:
        bad = [c for c in body.channels if c not in _ALLOWED_CHANNELS]
        if bad:
            raise HTTPException(400, detail=f"Unknown channels: {bad}")
        channels = list(dict.fromkeys(body.channels))  # de-dup, keep order

    async with SessionLocal() as db:
        plan = await _get_or_create_plan(db, rid, getattr(ctx, "user_id", None))
        parts = []
        params: dict[str, Any] = {"id": str(plan["id"])}
        if subject is not None:
            parts.append("subject = :subject")
            params["subject"] = subject
        if html is not None:
            parts.append("body_html = :html")
            params["html"] = html
        if channels is not None:
            parts.append("channels = CAST(:ch AS jsonb)")
            params["ch"] = json.dumps(channels)
        if parts:
            parts.append("updated_at = NOW()")
            await db.execute(text(
                f"UPDATE resolution_announcements SET {', '.join(parts)} WHERE id = CAST(:id AS uuid)"
            ), params)
            await db.commit()
    return {"ok": True}


# ─── Audiences ───────────────────────────────────────────────────────────────
class AudienceAdd(BaseModel):
    kind:   str
    params: dict[str, Any] = {}


@router.post("/admin/board/resolutions/{rid}/announcement/audiences")
async def add_audience(rid: str, body: AudienceAdd, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    await _ensure_resolution(rid)
    kind = (body.kind or "").strip()
    if kind not in _ALLOWED_KINDS:
        raise HTTPException(400, detail=f"kind must be one of {sorted(_ALLOWED_KINDS)}")

    # Per-kind params validation — keeps the resolver side simple.
    p = body.params or {}
    if kind == "recent_donors":
        months = int(p.get("months", 12) or 12)
        if months < 1 or months > 60:
            raise HTTPException(400, detail="months must be 1–60")
        p = {"months": months}
    elif kind == "individuals":
        ids = p.get("contact_ids") or []
        if not isinstance(ids, list) or not ids:
            raise HTTPException(400, detail="contact_ids list required")
        if len(ids) > 1000:
            raise HTTPException(400, detail="too many individuals (max 1000)")
        p = {"contact_ids": [str(x) for x in ids]}
    elif kind == "external_list":
        people = p.get("people") or []
        if not isinstance(people, list) or not people:
            raise HTTPException(400, detail="people list required")
        if len(people) > 1000:
            raise HTTPException(400, detail="too many external contacts (max 1000)")
        clean = []
        for row in people:
            email = str(row.get("email") or "").strip().lower()
            name  = str(row.get("name") or "").strip()[:255]
            if not email or "@" not in email:
                continue
            clean.append({"email": email, "name": name})
        if not clean:
            raise HTTPException(400, detail="no valid emails in people")
        p = {"people": clean}
    else:
        p = {}

    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        plan = await _get_or_create_plan(db, rid, getattr(ctx, "user_id", None))
        await db.execute(text("""
            INSERT INTO resolution_announcement_audiences
                (id, announcement_id, kind, params, added_by, added_by_name)
            VALUES
                (CAST(:id AS uuid), CAST(:a AS uuid), :k, CAST(:p AS jsonb),
                 CAST(:u AS uuid), :uname)
        """), {
            "id": new_id, "a": str(plan["id"]), "k": kind, "p": json.dumps(p),
            "u": getattr(ctx, "user_id", None),
            "uname": getattr(ctx, "user_email", "") or "",
        })
        await _refresh_requires_approval(db, str(plan["id"]))
    return {"ok": True, "id": new_id, "requires_chair_approval": kind in _EXTERNAL_KINDS}


@router.delete("/admin/board/resolutions/{rid}/announcement/audiences/{aud_id}")
async def remove_audience(rid: str, aud_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        # Find the announcement for the resolution, then delete only if the
        # audience belongs to it (defence in depth).
        plan_row = (await db.execute(text(
            "SELECT id FROM resolution_announcements WHERE resolution_id = CAST(:r AS uuid)"
        ), {"r": rid})).first()
        if not plan_row:
            raise HTTPException(404, detail="No announcement plan")
        r = await db.execute(text("""
            DELETE FROM resolution_announcement_audiences
            WHERE id = CAST(:id AS uuid) AND announcement_id = CAST(:a AS uuid)
        """), {"id": aud_id, "a": str(plan_row[0])})
        await db.commit()
        await _refresh_requires_approval(db, str(plan_row[0]))
    return {"ok": True, "deleted": r.rowcount}


# ─── Preview recipient counts ────────────────────────────────────────────────
@router.post("/admin/board/resolutions/{rid}/announcement/preview-count")
async def preview_count(rid: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Resolve each audience row to a count without fetching all rows.
    Returns per-audience totals + union estimate (sum, not true unique —
    a true unique needs a join we'll do at send-time in Phase D).
    """
    _require_admin(ctx)
    await _ensure_resolution(rid)
    async with SessionLocal() as db:
        plan_row = (await db.execute(text(
            "SELECT id FROM resolution_announcements WHERE resolution_id = CAST(:r AS uuid)"
        ), {"r": rid})).first()
        if not plan_row:
            return {"total": 0, "per_audience": []}
        auds = (await db.execute(text("""
            SELECT id, kind, params FROM resolution_announcement_audiences
            WHERE  announcement_id = CAST(:a AS uuid)
            ORDER  BY created_at ASC
        """), {"a": str(plan_row[0])})).mappings().all()

        per: list[dict[str, Any]] = []
        total = 0
        for a in auds:
            k = a["kind"]
            p = dict(a["params"] or {})
            n = 0
            if k == "all_contacts":
                n = int((await db.execute(text(
                    "SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email <> ''"
                ))).scalar() or 0)
            elif k == "volunteers":
                n = int((await db.execute(text("""
                    SELECT COUNT(DISTINCT c.id) FROM contacts c
                    JOIN   volunteers v ON LOWER(v.email) = LOWER(c.email)
                    WHERE  v.status IN ('ACTIVE','APPROVED')
                """))).scalar() or 0)
            elif k == "recent_donors":
                months = int(p.get("months", 12) or 12)
                n = int((await db.execute(text(f"""
                    SELECT COUNT(DISTINCT d.contact_id) FROM donations d
                    WHERE  d.deleted_at IS NULL
                      AND  d.contact_id IS NOT NULL
                      AND  d.created_at >= NOW() - INTERVAL '{months} months'
                """))).scalar() or 0)
            elif k == "trustees":
                n = int((await db.execute(text(
                    "SELECT COUNT(*) FROM trustees WHERE is_active = true"
                ))).scalar() or 0)
            elif k == "individuals":
                n = len(p.get("contact_ids") or [])
            elif k == "external_list":
                n = len(p.get("people") or [])
            per.append({"id": str(a["id"]), "kind": k, "count": n})
            total += n
    return {"total": total, "per_audience": per}


__all__ = ["router"]
