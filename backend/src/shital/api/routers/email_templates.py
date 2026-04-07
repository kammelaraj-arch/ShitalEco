"""
Email Templates — CRUD API for admin-editable email templates.
Templates use Jinja2 syntax with variables like {{ order_ref }}, {{ customer_name }}.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/admin/email-templates", tags=["email-templates"])


class TemplateUpdate(BaseModel):
    name: str | None = None
    subject: str | None = None
    html_body: str | None = None
    text_body: str | None = None
    is_active: bool | None = None


class TemplateSendTest(BaseModel):
    to: str
    template_key: str
    variables: dict[str, Any] = {}


@router.get("")
async def list_templates():
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(text(
            "SELECT id, template_key, name, subject, variables, is_active, created_at, updated_at "
            "FROM email_templates ORDER BY template_key"
        ))
        rows = result.mappings().all()
    return {"templates": [dict(r) for r in rows]}


@router.get("/{template_key}")
async def get_template(template_key: str):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(
            text("SELECT * FROM email_templates WHERE template_key = :key"),
            {"key": template_key},
        )
        row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    return dict(row)


@router.put("/{template_key}")
async def update_template(template_key: str, body: TemplateUpdate):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    updates: dict[str, Any] = {"key": template_key, "now": datetime.now(UTC)}
    set_parts: list[str] = ["updated_at = :now"]

    if body.name is not None:
        set_parts.append("name = :name")
        updates["name"] = body.name
    if body.subject is not None:
        set_parts.append("subject = :subject")
        updates["subject"] = body.subject
    if body.html_body is not None:
        set_parts.append("html_body = :html_body")
        updates["html_body"] = body.html_body
    if body.text_body is not None:
        set_parts.append("text_body = :text_body")
        updates["text_body"] = body.text_body
    if body.is_active is not None:
        set_parts.append("is_active = :is_active")
        updates["is_active"] = body.is_active

    async with SessionLocal() as db:
        result = await db.execute(
            text(f"UPDATE email_templates SET {', '.join(set_parts)} WHERE template_key = :key RETURNING *"),
            updates,
        )
        row = result.mappings().first()
        await db.commit()

    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    return dict(row)


@router.post("/test-send")
async def send_test_email(body: TemplateSendTest):
    """Render a template with provided variables and send a test email."""
    from sqlalchemy import text

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            text("SELECT subject, html_body, text_body FROM email_templates WHERE template_key = :key AND is_active"),
            {"key": body.template_key},
        )
        row = result.mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Template not found or inactive")

    subject, html_body, text_body = render_template(
        dict(row), {**_default_vars(), **body.variables}
    )

    if not settings.SENDGRID_API_KEY:
        return {"sent": False, "reason": "SendGrid not configured", "subject": subject}

    import httpx
    resp = await httpx.AsyncClient().post(
        "https://api.sendgrid.com/v3/mail/send",
        headers={"Authorization": f"Bearer {settings.SENDGRID_API_KEY}"},
        json={
            "personalizations": [{"to": [{"email": body.to}]}],
            "from": {"email": settings.SENDGRID_FROM_EMAIL, "name": "Shital Temple"},
            "subject": subject,
            "content": [{"type": "text/html", "value": html_body}]
            + ([{"type": "text/plain", "value": text_body}] if text_body else []),
        },
        timeout=15,
    )
    return {"sent": resp.status_code in (200, 202), "to": body.to, "subject": subject}


def render_template(template: dict[str, Any], variables: dict[str, Any]) -> tuple[str, str, str]:
    """Render subject, html_body, text_body using Jinja2."""
    from jinja2 import Environment, Undefined

    env = Environment(undefined=Undefined)
    subject   = env.from_string(template["subject"]).render(**variables)
    html_body = env.from_string(template["html_body"]).render(**variables)
    text_body = env.from_string(template.get("text_body") or "").render(**variables)
    return subject, html_body, text_body


def _default_vars() -> dict[str, Any]:
    from datetime import date
    return {
        "order_ref": "ORD-EXAMPLE",
        "customer_name": "Test User",
        "total": 25.00,
        "items": [{"name": "General Donation", "quantity": 1, "unitPrice": 25.00}],
        "branch_name": "Shital Temple",
        "date": date.today().strftime("%-d %B %Y"),
    }
