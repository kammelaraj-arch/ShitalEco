"""Documents — central document management system (DMS).

One table covers everything: governance papers, HR records, signed key
undertakings (auto-generated), policies, contracts, financial reports.
Categories are formal codes (GOVERNANCE / HR / KEY_UNDERTAKINGS / …)
with admin-editable labels and folder names in the document_categories
table. Files land in MEDIA_DIR/documents/{folder_name}/{doc_id}.<ext>
so the on-disk layout mirrors the logical one.

Documents can link to another record via (linked_entity_type,
linked_entity_id) — a signed key undertaking PDF carries
linked_entity_type='key_holding' and the holding ID, letting the key
register surface the PDF inline and letting the DMS show "what does
this document relate to?".
"""
from __future__ import annotations

import glob
import os
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.config import settings
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/documents", tags=["documents"])


# ─── Categories ──────────────────────────────────────────────────────────────

class CategoryIn(BaseModel):
    code: str
    label: str
    description: str = ""
    icon: str = "📄"
    folder_name: str = "general"
    default_review_months: int = 0
    is_confidential_default: bool = False
    sort_order: int = 100


@router.get("/categories")
async def list_categories(ctx: CurrentSpace, include_inactive: bool = False) -> dict[str, Any]:
    """List document categories. Returns each with a usage_count so the
    UI can show "Compliance (12 documents)" at a glance."""
    where = "" if include_inactive else "WHERE is_active = true"
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT c.code, c.label, c.description, c.icon, c.folder_name,
                   c.default_review_months, c.is_confidential_default,
                   c.sort_order, c.is_active,
                   (SELECT COUNT(*) FROM documents d
                     WHERE d.category = c.code AND d.deleted_at IS NULL
                       AND d.branch_id = :bid) AS usage_count
            FROM document_categories c
            {where}
            ORDER BY c.sort_order, c.label
        """), {"bid": ctx.branch_id})).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.post("/categories", status_code=201)
async def upsert_category(body: CategoryIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Add or update a category. UPSERT — same body twice updates the row."""
    if getattr(ctx, "role", "") not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(403, detail="admin only")
    code = body.code.strip().upper()
    if not code or not code.replace("_", "").isalnum():
        raise HTTPException(400, detail="code must be UPPER_SNAKE_CASE letters/digits/underscores")
    folder = body.folder_name.strip().lower() or code.lower().replace("_", "-")
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO document_categories
                (code, label, description, icon, folder_name,
                 default_review_months, is_confidential_default, sort_order, is_active)
            VALUES (:code, :lab, :desc, :icon, :folder, :rev, :conf, :sort, true)
            ON CONFLICT (code) DO UPDATE SET
                label                  = EXCLUDED.label,
                description            = EXCLUDED.description,
                icon                   = EXCLUDED.icon,
                folder_name            = EXCLUDED.folder_name,
                default_review_months  = EXCLUDED.default_review_months,
                is_confidential_default= EXCLUDED.is_confidential_default,
                sort_order             = EXCLUDED.sort_order,
                is_active              = true,
                updated_at             = NOW()
        """), {"code": code, "lab": body.label.strip(), "desc": body.description or "",
               "icon": body.icon[:8] or "📄", "folder": folder,
               "rev": int(body.default_review_months or 0),
               "conf": bool(body.is_confidential_default),
               "sort": int(body.sort_order or 100)})
        await db.commit()
    return {"code": code, "ok": True}


@router.delete("/categories/{code}", status_code=200)
async def deactivate_category(code: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Soft-delete (deactivate). Documents already filed in this category
    keep their assignment; only future uploads can't pick it."""
    if getattr(ctx, "role", "") not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(403, detail="admin only")
    async with SessionLocal() as db:
        result = await db.execute(text(
            "UPDATE document_categories SET is_active = false, updated_at = NOW() WHERE code = :c"
        ), {"c": code.upper()})
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(404, detail="category not found")
    return {"ok": True}


# ─── Documents — list / get / soft-delete ────────────────────────────────────

class DocumentIn(BaseModel):
    title: str
    category: str = "OTHER"
    description: str = ""
    file_url: str = ""
    file_name: str = ""
    file_size: int = 0
    mime_type: str = ""
    version: str = "1.0"
    review_due: str = ""
    tags: str = ""
    linked_entity_type: str = ""
    linked_entity_id: str = ""
    is_confidential: bool = False


def _serialize(rows: Sequence[Any]) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        d = dict(r)
        for k in ("review_due", "created_at", "updated_at", "deleted_at"):
            v = d.get(k)
            if v is not None and hasattr(v, "isoformat"):
                d[k] = v.isoformat()
        out.append(d)
    return out


@router.get("")
async def list_documents(ctx: CurrentSpace, category: str = "",
                         linked_entity_type: str = "", linked_entity_id: str = "",
                         search: str = "", limit: int = 200) -> dict[str, Any]:
    conditions = ["d.branch_id = :bid", "d.deleted_at IS NULL"]
    params: dict[str, Any] = {"bid": ctx.branch_id, "lim": max(1, min(int(limit), 500))}
    if category:
        conditions.append("d.category = :cat")
        params["cat"] = category.upper()
    if linked_entity_type:
        conditions.append("d.linked_entity_type = :let")
        params["let"] = linked_entity_type
    if linked_entity_id:
        conditions.append("d.linked_entity_id = :lei")
        params["lei"] = linked_entity_id
    if search.strip():
        conditions.append("(LOWER(d.title) LIKE :q OR LOWER(d.description) LIKE :q OR LOWER(d.tags) LIKE :q)")
        params["q"] = f"%{search.strip().lower()}%"
    where = " AND ".join(conditions)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT d.*, c.label AS category_label, c.icon AS category_icon
            FROM documents d
            LEFT JOIN document_categories c ON c.code = d.category
            WHERE {where}
            ORDER BY d.created_at DESC
            LIMIT :lim
        """), params)).mappings().all()
    return {"documents": _serialize(rows), "total": len(rows)}


@router.get("/{doc_id}")
async def get_document(doc_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT d.*, c.label AS category_label, c.icon AS category_icon, c.folder_name
            FROM documents d
            LEFT JOIN document_categories c ON c.code = d.category
            WHERE d.id = CAST(:id AS UUID) AND d.branch_id = :bid AND d.deleted_at IS NULL
        """), {"id": doc_id, "bid": ctx.branch_id})).mappings().first()
    if not row:
        raise HTTPException(404, detail="document not found")
    return _serialize([row])[0]


@router.post("")
async def create_document(body: DocumentIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Register a document by URL only (e.g. SharePoint / Drive link).
    For file uploads use POST /upload."""
    doc_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO documents
                (id, branch_id, title, description, category, file_url, file_name,
                 file_size, mime_type, version, review_due, tags, uploaded_by,
                 linked_entity_type, linked_entity_id, is_confidential)
            VALUES (:id, :bid, :title, :desc, :cat, :url, :fname, :fsize,
                    :mime, :version, NULLIF(:review,'')::date, :tags, :by,
                    :let, :lei, :conf)
        """), {
            "id": doc_id, "bid": ctx.branch_id, "title": body.title.strip(),
            "desc": body.description or "", "cat": body.category.upper(),
            "url": body.file_url or "", "fname": body.file_name or "",
            "fsize": int(body.file_size or 0), "mime": body.mime_type or "",
            "version": body.version or "1.0", "review": body.review_due or "",
            "tags": body.tags or "",
            "by": getattr(ctx, "user_email", "") or "admin",
            "let": body.linked_entity_type or "", "lei": body.linked_entity_id or "",
            "conf": bool(body.is_confidential),
        })
        await db.commit()
    return {"id": doc_id, "title": body.title}


@router.post("/upload", status_code=201)
async def upload_document(
    ctx: CurrentSpace,
    file: UploadFile = File(...),
    title: str = Form(""),
    category: str = Form("OTHER"),
    description: str = Form(""),
    linked_entity_type: str = Form(""),
    linked_entity_id: str = Form(""),
    is_confidential: bool = Form(False),
    review_due: str = Form(""),
    tags: str = Form(""),
) -> dict[str, Any]:
    """Upload a file. Stored under MEDIA_DIR/documents/{category-folder}/{doc_id}.<ext>
    and registered in the documents table."""
    if not title.strip():
        title = (file.filename or "document").rsplit(".", 1)[0]
    data = await file.read()
    if not data:
        raise HTTPException(400, detail="empty file")
    if len(data) > 50 * 1024 * 1024:  # 50 MB
        raise HTTPException(413, detail="file too large (50 MB max)")
    # Resolve category → folder
    cat = category.strip().upper() or "OTHER"
    async with SessionLocal() as db:
        cat_row = (await db.execute(text(
            "SELECT folder_name, is_confidential_default, default_review_months "
            "FROM document_categories WHERE code = :c"
        ), {"c": cat})).mappings().first()
    cat_dict: dict[str, Any] = dict(cat_row) if cat_row else {}
    folder = cat_dict.get("folder_name", "other") or "other"
    doc_id = str(uuid.uuid4())
    media_dir = os.path.join(settings.MEDIA_DIR, "documents", folder)
    os.makedirs(media_dir, exist_ok=True)
    ext = ""
    if file.filename and "." in file.filename:
        ext = "." + file.filename.rsplit(".", 1)[1].lower()[:10]
    file_path = os.path.join(media_dir, f"{doc_id}{ext}")
    with open(file_path, "wb") as f:
        f.write(data)
    serve_url = f"/api/v1/documents/{doc_id}/file"
    confidential = bool(is_confidential or cat_dict.get("is_confidential_default", False))
    review = review_due
    if not review and cat_dict.get("default_review_months"):
        from dateutil.relativedelta import relativedelta  # type: ignore[import-untyped]
        try:
            review = (datetime.utcnow() + relativedelta(months=int(cat_dict["default_review_months"]))).date().isoformat()
        except Exception:  # noqa: BLE001
            review = ""
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO documents
                (id, branch_id, title, description, category, file_url, file_name,
                 file_size, mime_type, version, review_due, tags, uploaded_by,
                 linked_entity_type, linked_entity_id, is_confidential, file_path)
            VALUES (:id, :bid, :title, :desc, :cat, :url, :fname, :fsize,
                    :mime, '1.0', NULLIF(:review,'')::date, :tags, :by,
                    :let, :lei, :conf, :fp)
        """), {
            "id": doc_id, "bid": ctx.branch_id, "title": title.strip()[:200],
            "desc": description or "", "cat": cat,
            "url": serve_url, "fname": file.filename or "",
            "fsize": len(data), "mime": file.content_type or "",
            "review": review, "tags": tags or "",
            "by": getattr(ctx, "user_email", "") or "admin",
            "let": linked_entity_type or "", "lei": linked_entity_id or "",
            "conf": confidential, "fp": file_path,
        })
        await db.commit()
    return {"id": doc_id, "file_url": serve_url, "size": len(data), "category": cat}


@router.get("/{doc_id}/file")
async def download_document(doc_id: str, ctx: CurrentSpace):
    """Stream the underlying file. Auth required — confidential documents
    additionally require ADMIN/SUPER_ADMIN."""
    from fastapi.responses import FileResponse
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT file_path, file_name, mime_type, is_confidential
            FROM documents
            WHERE id = CAST(:id AS UUID) AND branch_id = :bid AND deleted_at IS NULL
        """), {"id": doc_id, "bid": ctx.branch_id})).mappings().first()
    if not row:
        raise HTTPException(404, detail="document not found")
    if row["is_confidential"] and getattr(ctx, "role", "") not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(403, detail="confidential — admin only")
    path = row["file_path"] or ""
    if not path or not os.path.exists(path):
        # Fall back: look for any file with this doc_id stem in any docs folder
        matches = glob.glob(os.path.join(settings.MEDIA_DIR, "documents", "*", f"{doc_id}.*"))
        if not matches:
            raise HTTPException(404, detail="file missing on disk")
        path = matches[0]
    return FileResponse(path, filename=row["file_name"] or os.path.basename(path),
                        media_type=row["mime_type"] or "application/octet-stream")


@router.delete("/{doc_id}", status_code=200)
async def delete_document(doc_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Soft-delete. File on disk is left in place so audit can still review."""
    if getattr(ctx, "role", "") not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(403, detail="admin only")
    async with SessionLocal() as db:
        result = await db.execute(text(
            "UPDATE documents SET deleted_at = NOW(), updated_at = NOW() "
            "WHERE id = CAST(:id AS UUID) AND branch_id = :bid AND deleted_at IS NULL"
        ), {"id": doc_id, "bid": ctx.branch_id})
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(404, detail="document not found")
    return {"deleted": doc_id}


# ─── Helper used by other modules to file system-generated documents ─────────

async def store_generated_document(
    *, branch_id: str, title: str, category: str,
    file_bytes: bytes, file_name: str, mime_type: str,
    generated_by: str = "system",
    linked_entity_type: str = "", linked_entity_id: str = "",
    description: str = "", is_confidential: bool | None = None,
) -> dict[str, Any]:
    """Used by the key register (and similar modules) to save a generated
    PDF / file straight into the DMS in the right category folder.

    Returns {doc_id, file_url, file_path}. Never raises — the caller's
    primary flow shouldn't break if DMS writes have a hiccup. Errors are
    logged through structlog at WARNING.
    """
    import logging as _log
    _logger = _log.getLogger("shital.documents")
    try:
        cat = (category or "OTHER").upper()
        async with SessionLocal() as db:
            cat_row = (await db.execute(text(
                "SELECT folder_name, is_confidential_default "
                "FROM document_categories WHERE code = :c"
            ), {"c": cat})).mappings().first()
        cat_dict: dict[str, Any] = dict(cat_row) if cat_row else {}
        folder = cat_dict.get("folder_name", "other") or "other"
        confidential = (is_confidential if is_confidential is not None
                        else bool(cat_dict.get("is_confidential_default", False)))
        doc_id = str(uuid.uuid4())
        media_dir = os.path.join(settings.MEDIA_DIR, "documents", folder)
        os.makedirs(media_dir, exist_ok=True)
        ext = ""
        if "." in file_name:
            ext = "." + file_name.rsplit(".", 1)[1].lower()[:10]
        file_path = os.path.join(media_dir, f"{doc_id}{ext}")
        with open(file_path, "wb") as f:
            f.write(file_bytes)
        serve_url = f"/api/v1/documents/{doc_id}/file"
        async with SessionLocal() as db:
            await db.execute(text("""
                INSERT INTO documents
                    (id, branch_id, title, description, category, file_url, file_name,
                     file_size, mime_type, version, tags, uploaded_by,
                     linked_entity_type, linked_entity_id,
                     is_confidential, is_generated, generated_by, file_path)
                VALUES (CAST(:id AS UUID), :bid, :title, :desc, :cat, :url, :fname,
                        :fsize, :mime, '1.0', '', :by,
                        :let, :lei,
                        :conf, true, :gen, :fp)
            """), {
                "id": doc_id, "bid": branch_id or "main",
                "title": title.strip()[:200], "desc": description or "",
                "cat": cat, "url": serve_url, "fname": file_name,
                "fsize": len(file_bytes), "mime": mime_type or "application/pdf",
                "by": "system",
                "let": linked_entity_type or "", "lei": linked_entity_id or "",
                "conf": confidential, "gen": generated_by[:80] or "system",
                "fp": file_path,
            })
            await db.commit()
        return {"doc_id": doc_id, "file_url": serve_url, "file_path": file_path}
    except Exception as exc:  # noqa: BLE001
        _logger.warning("store_generated_document_failed: %s (title=%s)", exc, title)
        return {"doc_id": "", "file_url": "", "file_path": "", "error": str(exc)}
