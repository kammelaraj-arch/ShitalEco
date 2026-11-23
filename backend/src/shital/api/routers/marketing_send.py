"""Marketing send paths — Phase 1b.

Thin layer over `email_templates.send_template` / `send_raw_email` that:
  * Gates on `is_opted_in(contact_id, 'email')`.
  * Appends the compliance footer (unsubscribe + preferences URL).
  * Records the send through the existing `sent_emails` audit table
    (so admin can inspect / resend from the current UI).

Exposes one admin-only endpoint for Phase 1b:

    POST /api/v1/marketing/send-test
    {
        "contact_id": "<uuid>",
        "template_key": "newsletter_welcome",   # or inline subject/body
        "subject":     "Hi there",
        "html":        "<p>Body</p>",
        "text":        "Body",
        "variables":   {"first_name": "Raj"}    # merged into template
    }

Pass either `template_key` (Phase 1c composer picks this) or
`subject + html + text` (lets the operator type a quick test from the
campaigns UI without creating a template first). Either way the
compliance footer is appended and the opt-in gate is honoured.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal
from shital.services.marketing.compliance import wrap_marketing_email

router = APIRouter(prefix="/api/v1/marketing", tags=["marketing"])


def _require_marketing(ctx: CurrentSpace) -> None:
    """Gate marketing endpoints on roles that can act on donor comms.

    Phase 1b accepts SUPER_ADMIN/ADMIN; Phase 1c will add a MARKETING
    role so a comms volunteer can log in without seeing donations."""
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "MARKETING"}:
        raise HTTPException(403, detail="Admin or marketing role required")


class SendTestIn(BaseModel):
    contact_id:   str
    template_key: str = ""
    subject:      str = ""
    html:         str = ""
    text:         str = ""
    variables:    dict[str, Any] = {}


@router.post("/send-test")
async def send_test(body: SendTestIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Send one marketing email through the compliance wrapper.

    Honours the contact's email opt-in; returns a `skipped` result on
    opt-out rather than silently failing. The sent_emails row is the
    audit trail — the UI links to it from /admin/email-templates/sent.
    """
    _require_marketing(ctx)

    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT email, first_name, surname
            FROM   contacts WHERE id = CAST(:id AS uuid) LIMIT 1
        """), {"id": body.contact_id})).mappings().first()

    if not row or not row.get("email"):
        raise HTTPException(404, detail="Contact has no email on file")
    to_email: str = str(row["email"]).strip()

    # Render / resolve subject + bodies. Either template path OR inline.
    subject = (body.subject or "").strip()
    html    = body.html or ""
    plain   = body.text or ""

    if body.template_key:
        # Reuse the same renderer admin uses for /test-send — keeps the
        # template-variable surface identical between campaigns and the
        # existing admin test UI.
        from shital.api.routers.email_templates import _default_vars, render_template
        async with SessionLocal() as db:
            tpl = (await db.execute(text("""
                SELECT subject, html_body, text_body
                FROM   email_templates WHERE template_key = :k
                ORDER  BY is_active DESC LIMIT 1
            """), {"k": body.template_key})).mappings().first()
        if not tpl:
            raise HTTPException(404, detail=f"Template '{body.template_key}' not found")
        merged = {
            **_default_vars(),
            "first_name": row.get("first_name") or "",
            "surname":    row.get("surname") or "",
            **(body.variables or {}),
        }
        subject, html, plain = render_template(dict(tpl), merged)

    if not subject or (not html and not plain):
        raise HTTPException(400, detail="subject + html/text (or template_key) required")

    wrapped = await wrap_marketing_email(
        contact_id=body.contact_id, html=html, text=plain, channel="email",
    )
    if not wrapped["ok"]:
        return {"sent": False, "skipped": True, "reason": wrapped["reason"]}

    # Hand off to the existing audit-logged SMTP path. Flagging
    # related_type='marketing_test' keeps campaign sends separate from
    # transactional rows in /admin/email-templates/sent.
    from shital.api.routers.email_templates import send_raw_email
    result = await send_raw_email(
        to_email=to_email, subject=subject,
        html_body=wrapped["html"], text_body=wrapped["text"],
        related_type="marketing_test", related_id=body.contact_id,
        triggered_by=getattr(ctx, "user_email", "") or "",
        template_key=body.template_key or "",
    )
    result["prefs_url"] = wrapped.get("prefs_url", "")
    return result


__all__ = ["router"]
