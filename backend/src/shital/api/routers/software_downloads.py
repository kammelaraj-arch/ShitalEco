"""Admin-editable Software Downloads tiles.

The admin.shital.org.uk/admin/downloads/ page used to be a hardcoded
list of <DownloadTile> entries in page.tsx. Every new link needed a
code change, a Frontend CI run, a Docker image rebuild, and a Vultr
deploy — a 10-minute dance for a hyperlink.

This router stores the tiles in `software_downloads` so a trustee can
add or remove one with a form submission. The admin UI keeps the
hardcoded default list as a fallback for a fresh install (table empty),
so this ships at zero visible risk.

Endpoints:
    GET    /admin/software-downloads           list (public — the Downloads page is behind admin auth already)
    POST   /admin/software-downloads           create (admin role)
    DELETE /admin/software-downloads/{id}      delete (admin role)
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

logger = structlog.get_logger()
router = APIRouter(tags=["software-downloads"])


ALLOWED_CATEGORIES = {"installer", "web"}
MAX_LEN = {
    "title": 120, "subtitle": 240, "icon": 16,
    "href": 2048, "badge": 40, "accent": 80,
}


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )


class DownloadCreate(BaseModel):
    title:      str
    subtitle:   str = ""
    icon:       str = "📦"
    href:       str
    badge:      str = "Link"
    category:   str = "installer"
    accent:     str = "border-l-saffron-500/50"
    sort_order: int = 100


def _validate(body: DownloadCreate) -> None:
    if not body.title.strip():
        raise HTTPException(400, "title is required")
    if not body.href.strip():
        raise HTTPException(400, "href is required")
    if body.category not in ALLOWED_CATEGORIES:
        raise HTTPException(400, f"category must be one of {sorted(ALLOWED_CATEGORIES)}")
    for field, limit in MAX_LEN.items():
        val = getattr(body, field, "")
        if len(val) > limit:
            raise HTTPException(400, f"{field} is longer than {limit} characters")


def _row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id":         str(row["id"]),
        "title":      row["title"],
        "subtitle":   row["subtitle"],
        "icon":       row["icon"],
        "href":       row["href"],
        "badge":      row["badge"],
        "category":   row["category"],
        "accent":     row["accent"],
        "sort_order": row["sort_order"],
    }


@router.get("/admin/software-downloads")
async def list_downloads() -> dict[str, Any]:
    """List all active tiles, sort_order ascending. Public — the admin
    portal is already behind auth; a logged-out visitor just gets the
    same list the trustee sees."""
    async with SessionLocal() as db:
        r = await db.execute(text("""
            SELECT id, title, subtitle, icon, href, badge, category, accent, sort_order
              FROM software_downloads
             WHERE is_active = TRUE
             ORDER BY sort_order, created_at
        """))
        rows = r.mappings().all()
    return {"items": [_row_to_dict(row) for row in rows]}


@router.post("/admin/software-downloads", status_code=201)
async def create_download(body: DownloadCreate, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    _validate(body)
    row_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO software_downloads
                (id, title, subtitle, icon, href, badge, category, accent, sort_order,
                 created_at, updated_at, created_by)
            VALUES (:id, :title, :subtitle, :icon, :href, :badge, :category, :accent, :sort,
                    :now, :now, :actor)
        """), {
            "id": row_id, "title": body.title.strip(), "subtitle": body.subtitle.strip(),
            "icon": body.icon.strip() or "📦", "href": body.href.strip(),
            "badge": body.badge.strip() or "Link", "category": body.category,
            "accent": body.accent.strip() or "border-l-saffron-500/50",
            "sort": body.sort_order, "now": now, "actor": ctx.email or "admin",
        })
        await db.commit()
    logger.info("software_download_created", id=row_id, title=body.title, actor=ctx.email)
    return {"id": row_id}


@router.delete("/admin/software-downloads/{row_id}", status_code=204)
async def delete_download(row_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    try:
        uuid.UUID(row_id)
    except ValueError as exc:
        raise HTTPException(400, "invalid id") from exc
    async with SessionLocal() as db:
        r = await db.execute(
            text("DELETE FROM software_downloads WHERE id = :id"),
            {"id": row_id},
        )
        await db.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Not found")
    logger.info("software_download_deleted", id=row_id, actor=ctx.email)
