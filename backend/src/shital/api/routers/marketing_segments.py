"""Saved audience segments — reusable targets across marketing
campaigns (and, as a nice side-effect, future board announcements that
point at a named segment instead of carrying their own list).

Mirrors the per-kind params the board's announcement audiences use so
the resolver can treat them interchangeably.
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

router = APIRouter(prefix="/marketing/segments", tags=["marketing-segments"])

_ALLOWED_KINDS = {
    "all_contacts", "volunteers", "recent_donors",
    "trustees", "individuals", "external_list",
}


def _require_marketing(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "MARKETING", "CHAIR"}:
        raise HTTPException(403, detail="Marketing / admin role required")


class SegmentCreate(BaseModel):
    name: str
    description: str = ""


class SegmentEntryIn(BaseModel):
    kind: str
    params: dict[str, Any] = {}


@router.get("")
async def list_segments(ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        segs = (await db.execute(text("""
            SELECT s.id, s.name, s.description, s.created_at, s.updated_at,
                   COUNT(e.id) AS entry_count
            FROM   audience_segments s
            LEFT JOIN audience_segment_entries e ON e.segment_id = s.id
            GROUP  BY s.id
            ORDER  BY s.name ASC
        """))).mappings().all()
    return {"items": [dict(r) for r in segs]}


@router.post("")
async def create_segment(body: SegmentCreate, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, detail="name required")
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        try:
            await db.execute(text("""
                INSERT INTO audience_segments (id, name, description, created_by)
                VALUES (CAST(:id AS uuid), :name, :desc, CAST(:u AS uuid))
            """), {"id": new_id, "name": name[:200], "desc": (body.description or "")[:2000],
                   "u": getattr(ctx, "user_id", None)})
            await db.commit()
        except Exception as exc:  # unique(name)
            raise HTTPException(409, detail=f"Segment with that name exists: {exc}") from exc
    return {"ok": True, "id": new_id}


@router.get("/{seg_id}")
async def get_segment(seg_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        seg = (await db.execute(text("""
            SELECT id, name, description, created_at FROM audience_segments
             WHERE id = CAST(:id AS uuid)
        """), {"id": seg_id})).mappings().first()
        if not seg:
            raise HTTPException(404, detail="Segment not found")
        entries = (await db.execute(text("""
            SELECT id, kind, params, created_at FROM audience_segment_entries
             WHERE segment_id = CAST(:id AS uuid) ORDER BY created_at ASC
        """), {"id": seg_id})).mappings().all()
    return {"segment": dict(seg), "entries": [dict(e) for e in entries]}


@router.post("/{seg_id}/entries")
async def add_entry(seg_id: str, body: SegmentEntryIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    kind = (body.kind or "").strip()
    if kind not in _ALLOWED_KINDS:
        raise HTTPException(400, detail=f"kind must be one of {sorted(_ALLOWED_KINDS)}")
    # Reuse the same param validation shape as board announcements.
    p = body.params or {}
    if kind == "recent_donors":
        months = int(p.get("months", 12) or 12)
        if months < 1 or months > 60:
            raise HTTPException(400, detail="months must be 1-60")
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
        clean = []
        for row in people:
            email = str(row.get("email") or "").strip().lower()
            name  = str(row.get("name") or "").strip()[:255]
            if email and "@" in email:
                clean.append({"email": email, "name": name})
        if not clean:
            raise HTTPException(400, detail="no valid emails in people")
        p = {"people": clean}
    else:
        p = {}

    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO audience_segment_entries (id, segment_id, kind, params)
            VALUES (CAST(:id AS uuid), CAST(:sid AS uuid), :k, CAST(:p AS jsonb))
        """), {"id": new_id, "sid": seg_id, "k": kind, "p": json.dumps(p)})
        await db.execute(text(
            "UPDATE audience_segments SET updated_at = NOW() WHERE id = CAST(:id AS uuid)"
        ), {"id": seg_id})
        await db.commit()
    return {"ok": True, "id": new_id}


@router.delete("/{seg_id}/entries/{entry_id}")
async def delete_entry(seg_id: str, entry_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        r = await db.execute(text("""
            DELETE FROM audience_segment_entries
            WHERE id = CAST(:eid AS uuid) AND segment_id = CAST(:sid AS uuid)
        """), {"eid": entry_id, "sid": seg_id})
        await db.commit()
    return {"ok": True, "deleted": r.rowcount}


@router.delete("/{seg_id}")
async def delete_segment(seg_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        r = await db.execute(text(
            "DELETE FROM audience_segments WHERE id = CAST(:id AS uuid)"
        ), {"id": seg_id})
        await db.commit()
    return {"ok": True, "deleted": r.rowcount}


@router.post("/{seg_id}/preview-count")
async def preview_count(seg_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Resolve the segment to per-entry counts (approximate — true unique
    de-dup happens at send time)."""
    _require_marketing(ctx)
    async with SessionLocal() as db:
        entries = (await db.execute(text("""
            SELECT id, kind, params FROM audience_segment_entries
             WHERE segment_id = CAST(:id AS uuid)
        """), {"id": seg_id})).mappings().all()
        per: list[dict[str, Any]] = []
        total = 0
        for e in entries:
            kind = e["kind"]
            params = dict(e["params"] or {})
            n = 0
            if kind == "all_contacts":
                n = int((await db.execute(text(
                    "SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email <> ''"
                ))).scalar() or 0)
            elif kind == "volunteers":
                n = int((await db.execute(text("""
                    SELECT COUNT(DISTINCT c.id) FROM contacts c
                    JOIN   volunteers v ON LOWER(v.email) = LOWER(c.email)
                    WHERE  v.status IN ('ACTIVE','APPROVED')
                """))).scalar() or 0)
            elif kind == "recent_donors":
                months = int(params.get("months", 12) or 12)
                n = int((await db.execute(text(f"""
                    SELECT COUNT(DISTINCT d.contact_id) FROM donations d
                    WHERE  d.deleted_at IS NULL AND d.contact_id IS NOT NULL
                      AND  d.created_at >= NOW() - INTERVAL '{months} months'
                """))).scalar() or 0)
            elif kind == "trustees":
                n = int((await db.execute(text(
                    "SELECT COUNT(*) FROM trustees WHERE is_active = true"
                ))).scalar() or 0)
            elif kind == "individuals":
                n = len(params.get("contact_ids") or [])
            elif kind == "external_list":
                n = len(params.get("people") or [])
            per.append({"entry_id": str(e["id"]), "kind": kind, "count": n})
            total += n
    return {"total": total, "per_entry": per}


__all__ = ["router"]
