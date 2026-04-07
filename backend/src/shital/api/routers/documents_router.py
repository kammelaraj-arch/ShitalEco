"""Documents router — policy and document library."""
from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/documents", tags=["documents"])


class DocumentIn(BaseModel):
    title: str
    category: str = "GENERAL"
    description: str = ""
    file_url: str = ""
    file_name: str = ""
    file_size: int = 0
    mime_type: str = ""
    version: str = "1.0"
    review_due: str = ""
    tags: str = ""


def _serialize(rows: Sequence) -> list:
    out = []
    for r in rows:
        d = dict(r)
        for k in ("review_due", "created_at", "updated_at", "deleted_at"):
            if d.get(k) and hasattr(d[k], "isoformat"):
                d[k] = d[k].isoformat()
        out.append(d)
    return out


@router.get("")
async def list_documents(ctx: CurrentSpace, category: str = ""):
    async with SessionLocal() as db:
        where = "branch_id = :bid AND deleted_at IS NULL"
        params: dict = {"bid": ctx.branch_id}
        if category:
            where += " AND category = :cat"
            params["cat"] = category
        result = await db.execute(
            text(f"SELECT * FROM documents WHERE {where} ORDER BY category, title"),
            params,
        )
        rows = _serialize(result.mappings().all())
    return {"documents": rows, "total": len(rows)}


@router.post("")
async def create_document(body: DocumentIn, ctx: CurrentSpace):
    doc_id = str(uuid.uuid4())
    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO documents
                (id, branch_id, title, description, category, file_url, file_name,
                 file_size, mime_type, version, review_due, tags, uploaded_by, created_at, updated_at)
                VALUES (:id, :bid, :title, :desc, :cat, :url, :fname, :fsize,
                        :mime, :version, :review, :tags, 'admin', :now, :now)
            """),
            {
                "id": doc_id, "bid": ctx.branch_id, "title": body.title,
                "desc": body.description or None, "cat": body.category,
                "url": body.file_url or None, "fname": body.file_name or None,
                "fsize": body.file_size,
                "mime": body.mime_type or None, "version": body.version or "1.0",
                "review": body.review_due or None, "tags": body.tags or None,
                "now": now,
            },
        )
        await db.commit()
    return {"id": doc_id, "title": body.title}


@router.delete("/{doc_id}")
async def delete_document(doc_id: str, ctx: CurrentSpace):
    async with SessionLocal() as db:
        await db.execute(
            text("UPDATE documents SET deleted_at=NOW(), updated_at=NOW() WHERE id=:id AND branch_id=:bid"),
            {"id": doc_id, "bid": ctx.branch_id},
        )
        await db.commit()
    return {"deleted": doc_id}
