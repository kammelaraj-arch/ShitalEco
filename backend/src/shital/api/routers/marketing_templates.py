"""Reusable email templates for the marketing composer (Phase 1c).

Distinct from `email_templates` (which holds transactional templates
like receipts / Gift Aid) — those keep Office365 / SMTP paths
unchanged. These carry the preference-centre footer at send time and
are authored in the campaigns app, not the admin portal.
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal
from shital.services.board.collab import sanitize_html

router = APIRouter(prefix="/marketing/templates", tags=["marketing-templates"])

_ALLOWED_STATUSES  = {"DRAFT", "PUBLISHED", "ARCHIVED"}
_ALLOWED_CATEGORIES = {"newsletter", "appeal", "event", "welcome", "thank-you", "general"}

# {{ variable_name }} placeholder — one word of lower / underscore.
_VAR_RE = re.compile(r"\{\{\s*([a-z][a-z0-9_]*)\s*\}\}")


def _require_marketing(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "MARKETING", "CHAIR"}:
        raise HTTPException(403, detail="Marketing / admin role required")


def _extract_variables(subject: str, html: str, text_body: str) -> list[str]:
    names: list[str] = []
    for src in (subject, html, text_body):
        for m in _VAR_RE.finditer(src or ""):
            if m.group(1) not in names:
                names.append(m.group(1))
    return names


def _render(body: str, variables: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return str(variables.get(key, "")) if key in variables else match.group(0)
    return _VAR_RE.sub(replace, body or "")


# ─── CRUD ────────────────────────────────────────────────────────────────────
class TemplateIn(BaseModel):
    name:      str
    subject:   str = ""
    html_body: str = ""
    text_body: str = ""
    category:  str = "general"


class TemplateUpdate(BaseModel):
    name:      str | None = None
    subject:   str | None = None
    html_body: str | None = None
    text_body: str | None = None
    category:  str | None = None
    status:    str | None = None


@router.get("")
async def list_templates(ctx: CurrentSpace, include_archived: bool = False) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id, name, subject, category, status, variables, updated_at
            FROM   marketing_templates
            WHERE  (:include_arch OR status <> 'ARCHIVED')
            ORDER  BY status DESC, name ASC
        """), {"include_arch": include_archived})).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.post("")
async def create_template(body: TemplateIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, detail="name required")
    if body.category not in _ALLOWED_CATEGORIES:
        raise HTTPException(400, detail=f"category must be one of {sorted(_ALLOWED_CATEGORIES)}")
    html = sanitize_html(body.html_body) if body.html_body else ""
    variables = _extract_variables(body.subject, html, body.text_body)

    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        try:
            await db.execute(text("""
                INSERT INTO marketing_templates
                    (id, name, subject, html_body, text_body, variables,
                     status, category, created_by)
                VALUES
                    (CAST(:id AS uuid), :name, :subject, :html, :text,
                     CAST(:vars AS jsonb), 'DRAFT', :cat, CAST(:u AS uuid))
            """), {
                "id": new_id, "name": name[:200], "subject": body.subject[:500],
                "html": html, "text": body.text_body or "",
                "vars": json.dumps(variables), "cat": body.category,
                "u": getattr(ctx, "user_id", None),
            })
            await db.commit()
        except Exception as exc:
            raise HTTPException(409, detail=f"Template with that name exists: {exc}") from exc
    return {"ok": True, "id": new_id, "variables": variables}


@router.get("/{tpl_id}")
async def get_template(tpl_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT id, name, subject, html_body, text_body, variables,
                   status, category, created_at, updated_at
            FROM   marketing_templates WHERE id = CAST(:id AS uuid)
        """), {"id": tpl_id})).mappings().first()
    if not row:
        raise HTTPException(404, detail="Template not found")
    return {"template": dict(row)}


@router.put("/{tpl_id}")
async def update_template(tpl_id: str, body: TemplateUpdate, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    updates: list[str] = []
    params: dict[str, Any] = {"id": tpl_id}
    if body.name is not None:
        updates.append("name = :name")
        params["name"] = body.name.strip()[:200]
    if body.subject is not None:
        updates.append("subject = :subject")
        params["subject"] = body.subject[:500]
    html_resolved = None
    if body.html_body is not None:
        html_resolved = sanitize_html(body.html_body)
        updates.append("html_body = :html")
        params["html"] = html_resolved
    if body.text_body is not None:
        updates.append("text_body = :text")
        params["text"] = body.text_body
    if body.category is not None:
        if body.category not in _ALLOWED_CATEGORIES:
            raise HTTPException(400, detail="bad category")
        updates.append("category = :cat")
        params["cat"] = body.category
    if body.status is not None:
        if body.status not in _ALLOWED_STATUSES:
            raise HTTPException(400, detail="bad status")
        updates.append("status = :status")
        params["status"] = body.status
    # Re-derive variables if any body field changed.
    if any(k in params for k in ("subject", "html", "text")):
        async with SessionLocal() as db:
            cur = (await db.execute(text(
                "SELECT subject, html_body, text_body FROM marketing_templates WHERE id = CAST(:id AS uuid)"
            ), {"id": tpl_id})).mappings().first()
            if not cur:
                raise HTTPException(404, detail="Template not found")
        vars_subject = params.get("subject", cur["subject"] or "")
        vars_html    = params.get("html", cur["html_body"] or "")
        vars_text    = params.get("text", cur["text_body"] or "")
        new_vars = _extract_variables(vars_subject, vars_html, vars_text)
        updates.append("variables = CAST(:vars AS jsonb)")
        params["vars"] = json.dumps(new_vars)

    if not updates:
        return {"ok": True, "unchanged": True}
    updates.append("updated_at = NOW()")
    async with SessionLocal() as db:
        r = await db.execute(text(
            f"UPDATE marketing_templates SET {', '.join(updates)} WHERE id = CAST(:id AS uuid)"
        ), params)
        await db.commit()
    if not r.rowcount:
        raise HTTPException(404, detail="Template not found")
    return {"ok": True}


@router.delete("/{tpl_id}")
async def archive_template(tpl_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        r = await db.execute(text(
            "UPDATE marketing_templates SET status = 'ARCHIVED', updated_at = NOW() WHERE id = CAST(:id AS uuid)"
        ), {"id": tpl_id})
        await db.commit()
    return {"ok": True, "archived": r.rowcount}


# ─── Preview ─────────────────────────────────────────────────────────────────
class PreviewIn(BaseModel):
    variables: dict[str, Any] = {}


@router.post("/{tpl_id}/preview")
async def preview_template(tpl_id: str, body: PreviewIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Render subject + html + text with the given merge variables.
    Unknown variables stay in `{{ name }}` form so the previewer can
    see what's missing. Default variables fall back to a safe example set."""
    _require_marketing(ctx)
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT subject, html_body, text_body, variables
            FROM   marketing_templates WHERE id = CAST(:id AS uuid)
        """), {"id": tpl_id})).mappings().first()
    if not row:
        raise HTTPException(404, detail="Template not found")

    merged = {
        "first_name": "Raj",  "surname": "Example",  "email": "example@shital.org.uk",
        "amount":      "25",   "org_name": "SHITAL",
        **(body.variables or {}),
    }
    subject = _render(row["subject"] or "", merged)
    html    = _render(row["html_body"] or "", merged)
    plain   = _render(row["text_body"] or "", merged)
    return {
        "subject": subject,
        "html_body": html,
        "text_body": plain,
        "declared_variables": list(row["variables"] or []),
    }


__all__ = ["router"]
