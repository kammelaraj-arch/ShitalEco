"""
Media Library router — admin image upload / list / delete, served publicly.

Admins upload images here; each gets a stable public URL
(``/api/v1/media/library/{id}``) they can paste into any web page (e.g. the
monthly-giving hub pages). Files live on the persistent media volume
(``MEDIA_DIR/library``); lightweight metadata lives in the ``media_library``
table. The serve endpoint is public (no auth) so embedded <img> tags load.
"""
from __future__ import annotations

import glob
import os
import uuid
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["media-library"])

_IMAGE_EXT_BY_MIME = {
    "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg",
}
_MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB upload cap
_CACHE_CONTROL = "public, max-age=86400"  # 1 day — library images rarely change


def _require_admin(ctx: Any) -> None:
    if getattr(ctx, "role", "") not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(status_code=403, detail="Requires SUPER_ADMIN or ADMIN role")


def _library_dir() -> str:
    from shital.core.fabrics.config import settings
    d = os.path.join(settings.MEDIA_DIR, "library")
    os.makedirs(d, exist_ok=True)
    return d


def _find_file(image_id: str) -> str | None:
    matches = glob.glob(os.path.join(_library_dir(), f"{image_id}.*"))
    return matches[0] if matches and os.path.isfile(matches[0]) else None


async def _ensure_table() -> None:
    """Idempotent table create — keeps this feature self-contained (no central
    migration needed). Cheap: CREATE TABLE IF NOT EXISTS is a no-op once made."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS media_library (
                id            VARCHAR(40)  PRIMARY KEY,
                original_name VARCHAR(300) NOT NULL DEFAULT '',
                ext           VARCHAR(10)  NOT NULL DEFAULT '',
                mime          VARCHAR(80)  NOT NULL DEFAULT '',
                size_bytes    BIGINT       NOT NULL DEFAULT 0,
                created_by    VARCHAR(200) NOT NULL DEFAULT '',
                created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        """))
        await db.commit()


def _row_to_dict(r: Any) -> dict[str, Any]:
    return {
        "id": r["id"],
        "url": f"/api/v1/media/library/{r['id']}",
        "original_name": r["original_name"],
        "mime": r["mime"],
        "size_bytes": int(r["size_bytes"] or 0),
        "created_by": r["created_by"],
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
    }


@router.post("/admin/media/library")
async def upload_image(ctx: CurrentSpace, file: UploadFile = File(...)) -> dict[str, Any]:
    """Admin: upload an image to the library. Returns its stable public URL."""
    _require_admin(ctx)

    media_type = (file.content_type or "").lower()
    if media_type not in _IMAGE_EXT_BY_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported image type: {media_type}")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 8 MB limit")

    await _ensure_table()
    image_id = str(uuid.uuid4())
    ext = _IMAGE_EXT_BY_MIME[media_type]
    path = os.path.join(_library_dir(), f"{image_id}{ext}")
    with open(path, "wb") as f:
        f.write(data)

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO media_library (id, original_name, ext, mime, size_bytes, created_by)
            VALUES (:id, :nm, :ext, :mime, :sz, :by)
        """), {
            "id": image_id, "nm": (file.filename or "")[:300], "ext": ext,
            "mime": media_type, "sz": len(data), "by": getattr(ctx, "email", "") or "",
        })
        await db.commit()

    return {
        "id": image_id, "url": f"/api/v1/media/library/{image_id}",
        "original_name": file.filename or "", "size_bytes": len(data), "mime": media_type,
    }


@router.get("/admin/media/library")
async def list_images(ctx: CurrentSpace) -> dict[str, Any]:
    """Admin: list every library image (newest first)."""
    _require_admin(ctx)
    await _ensure_table()

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id, original_name, ext, mime, size_bytes, created_by, created_at
            FROM media_library ORDER BY created_at DESC
        """))).mappings().all()
    return {"images": [_row_to_dict(r) for r in rows]}


@router.delete("/admin/media/library/{image_id}")
async def delete_image(image_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Admin: delete a library image (file + metadata row)."""
    _require_admin(ctx)
    await _ensure_table()

    for p in glob.glob(os.path.join(_library_dir(), f"{image_id}.*")):
        try:
            os.remove(p)
        except OSError:
            pass

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("DELETE FROM media_library WHERE id = :id"), {"id": image_id})
        await db.commit()
    return {"ok": True, "id": image_id}


@router.get("/media/library/{image_id}")
async def serve_image(image_id: str) -> FileResponse:
    """Public: stream a library image from the media volume (browser-cached)."""
    path = _find_file(image_id)
    if not path:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, headers={"Cache-Control": _CACHE_CONTROL})
