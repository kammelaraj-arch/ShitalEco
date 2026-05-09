"""Release notes / build features list.

Backed by the `release_notes` table seeded at startup. Public read endpoint
plus an admin write endpoint for entries that need to be added between
deploys (e.g. config-only changes the team wants to advertise).
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace

router = APIRouter(prefix="/api/v1", tags=["release-notes"])


# ─── Public — anyone can see what changed ─────────────────────────────────────

@router.get("/release-notes")
async def list_release_notes(area: str = "", limit: int = 200) -> dict[str, Any]:
    """Return the canonical changelog. Newest first.

    Optional `area` filter narrows to e.g. 'volunteers' / 'kiosk' / 'infra'.
    No auth required — release notes are public, like a blog.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where = ""
    params: dict[str, Any] = {"limit": min(max(1, limit), 500)}
    if area.strip():
        where = "WHERE area = :area"
        params["area"] = area.strip()

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT id, git_sha, pr_number, title, summary, area, tags,
                   released_at, created_at
            FROM   release_notes
            {where}
            ORDER  BY released_at DESC, pr_number DESC NULLS LAST
            LIMIT  :limit
        """), params)
        items = []
        for r in rows.mappings():
            d = dict(r)
            d["id"] = str(d["id"])
            for k in ("released_at", "created_at"):
                if d.get(k):
                    d[k] = d[k].isoformat()
            items.append(d)
    return {"items": items, "count": len(items)}


# ─── Admin — add / edit / delete entries ──────────────────────────────────────

class ReleaseNoteUpsert(BaseModel):
    title: str
    summary: str = ""
    area: str = ""
    tags: list[str] = Field(default_factory=list)
    pr_number: int | None = None
    git_sha: str = ""
    released_at: str = ""  # ISO 8601; defaults to NOW() if empty


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(403, detail="Admin role required")


@router.post("/admin/release-notes")
async def admin_create_note(body: ReleaseNoteUpsert, ctx: CurrentSpace) -> dict[str, Any]:
    """Create a release-note entry. Admins use this for between-deploy
    announcements (config changes, infra moves) that don't have a PR."""
    _require_admin(ctx)
    if not body.title.strip():
        raise HTTPException(400, detail="title is required")

    import json

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    new_id = str(uuid.uuid4())
    released_at: datetime | None
    if body.released_at.strip():
        try:
            released_at = datetime.fromisoformat(body.released_at.replace("Z", "+00:00"))
        except ValueError as e:
            raise HTTPException(400, detail=f"released_at must be ISO 8601: {e}") from e
    else:
        released_at = datetime.now(UTC)

    async with SessionLocal() as db:
        try:
            await db.execute(text("""
                INSERT INTO release_notes
                    (id, git_sha, pr_number, title, summary, area, tags, released_at)
                VALUES
                    (:id, :sha, :pr, :title, :summary, :area, CAST(:tags AS jsonb), :at)
            """), {
                "id": new_id, "sha": body.git_sha.strip(),
                "pr": body.pr_number,
                "title": body.title.strip(), "summary": body.summary.strip(),
                "area": body.area.strip(), "tags": json.dumps(body.tags),
                "at": released_at,
            })
            await db.commit()
        except Exception as exc:
            # Likely unique constraint on pr_number — point the admin at the edit endpoint.
            raise HTTPException(409, detail=f"Could not insert release note: {exc}") from exc
    return {"id": new_id, "ok": True}


@router.put("/admin/release-notes/{note_id}")
async def admin_update_note(
    note_id: str, body: ReleaseNoteUpsert, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Edit title/summary/area/tags on an existing entry. Pin-down: pr_number
    and released_at stay immutable to keep the changelog honest."""
    _require_admin(ctx)
    import json

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT id FROM release_notes WHERE id::text = :id"),
            {"id": note_id},
        )).mappings().one_or_none()
        if not row:
            raise HTTPException(404, detail="Release note not found")
        await db.execute(text("""
            UPDATE release_notes
            SET    title   = :title,
                   summary = :summary,
                   area    = :area,
                   tags    = CAST(:tags AS jsonb)
            WHERE  id::text = :id
        """), {
            "id": note_id,
            "title": body.title.strip(), "summary": body.summary.strip(),
            "area": body.area.strip(), "tags": json.dumps(body.tags),
        })
        await db.commit()
    return {"ok": True}


@router.delete("/admin/release-notes/{note_id}")
async def admin_delete_note(note_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Remove a release-note entry. Hard delete — these aren't sensitive."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        await db.execute(
            text("DELETE FROM release_notes WHERE id::text = :id"),
            {"id": note_id},
        )
        await db.commit()
    return {"ok": True}
