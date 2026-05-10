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

    from_email = settings.OFFICE365_EMAIL or "noreply@shital.org.uk"
    password   = settings.OFFICE365_PASSWORD

    if not password:
        return {"sent": False, "reason": "Email not configured — add OFFICE365_EMAIL and OFFICE365_PASSWORD in Admin → API Keys", "subject": subject}

    import asyncio
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    def _send() -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = from_email
        msg["To"]      = body.to
        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))
        with smtplib.SMTP("smtp.office365.com", 587, timeout=20) as srv:
            srv.ehlo()
            srv.starttls()
            srv.login(from_email, password)
            srv.sendmail(from_email, body.to, msg.as_string())

    try:
        await asyncio.get_event_loop().run_in_executor(None, _send)
        return {"sent": True, "to": body.to, "subject": subject}
    except Exception as exc:
        return {"sent": False, "error": str(exc), "subject": subject}


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


async def _smtp_send(from_email: str, password: str, to_email: str, subject: str, html_body: str, text_body: str) -> None:
    """SMTP send via Office 365. Synchronous; call via run_in_executor."""
    import asyncio
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    def _send() -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = from_email
        msg["To"]      = to_email
        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))
        with smtplib.SMTP("smtp.office365.com", 587, timeout=20) as srv:
            srv.ehlo()
            srv.starttls()
            srv.login(from_email, password)
            srv.sendmail(from_email, to_email, msg.as_string())

    await asyncio.get_event_loop().run_in_executor(None, _send)


async def _record_pending(
    template_key: str, to_email: str, from_email: str,
    subject: str, html_body: str, text_body: str,
    variables: dict[str, Any],
    related_type: str = "", related_id: str = "", triggered_by: str = "",
) -> str:
    """Insert a sent_emails row with status=PENDING. Returns the row id.

    Done BEFORE the SMTP call so a process crash mid-send still leaves a
    replayable record. Variables are stored verbatim (JSONB) so resend
    can re-render against the live template.
    """
    import json
    import uuid as _uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    new_id = str(_uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO sent_emails
                (id, template_key, to_email, from_email,
                 subject, html_body, text_body, variables,
                 status, attempts, last_attempt_at,
                 related_type, related_id, triggered_by)
            VALUES
                (:id, :tkey, :to, :from,
                 :subj, :html, :text, CAST(:vars AS jsonb),
                 'PENDING', 1, NOW(),
                 :rtype, :rid, :actor)
        """), {
            "id": new_id, "tkey": template_key, "to": to_email, "from": from_email,
            "subj": subject, "html": html_body, "text": text_body,
            "vars": json.dumps(variables, default=str),
            "rtype": related_type, "rid": related_id, "actor": triggered_by,
        })
        await db.commit()
    return new_id


async def _record_result(row_id: str, success: bool, error: str = "") -> None:
    """Update sent_emails row to SENT or FAILED."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE sent_emails
            SET    status     = :status,
                   error      = :error,
                   sent_at    = CASE WHEN :ok THEN NOW() ELSE sent_at END,
                   updated_at = NOW()
            WHERE  id::text = :id
        """), {
            "id": row_id,
            "status": "SENT" if success else "FAILED",
            "ok": success, "error": error[:2000],
        })
        await db.commit()


async def send_template(
    template_key: str, to_email: str, variables: dict[str, Any],
    related_type: str = "", related_id: str = "", triggered_by: str = "",
) -> dict[str, Any]:
    """Render an email_templates row and send it. Always logs the attempt
    to sent_emails so failures can be inspected and resent from admin.

    Returns {sent: bool, ...} — never raises; callers can fire-and-forget
    without breaking the calling flow.
    """
    from sqlalchemy import text

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.database import SessionLocal

    if not template_key or not to_email:
        return {"sent": False, "reason": "missing template_key or to_email"}

    from_email = settings.OFFICE365_EMAIL or "noreply@shital.org.uk"
    password   = settings.OFFICE365_PASSWORD

    # Look up the template. Fall back to the inactive row if no active one
    # exists — we still record the attempt so the failure shows up in admin.
    async with SessionLocal() as db:
        r = await db.execute(text("""
            SELECT subject, html_body, text_body, is_active
            FROM   email_templates WHERE template_key = :key
            ORDER  BY is_active DESC LIMIT 1
        """), {"key": template_key})
        row = r.mappings().first()

    if not row:
        # Record the failure so it shows up in /admin/sent-emails. We can't
        # render a body, so store a placeholder describing the miss.
        reason = f"template '{template_key}' not found or inactive"
        try:
            row_id = await _record_pending(
                template_key, to_email, from_email,
                subject=f"[unsent] {template_key}",
                html_body="", text_body="",
                variables=variables,
                related_type=related_type, related_id=related_id, triggered_by=triggered_by,
            )
            await _record_result(row_id, False, reason)
        except Exception:
            pass
        return {"sent": False, "reason": reason, "template": template_key}

    if not row["is_active"]:
        reason = f"template '{template_key}' exists but is inactive"
        # Continue rendering so the audit row has the body — admin can
        # reactivate the template and resend.
    else:
        reason = ""

    try:
        merged = {**_default_vars(), **variables}
        subject, html_body, text_body = render_template(dict(row), merged)
    except Exception as exc:
        return {"sent": False, "error": f"render failed: {exc}", "template": template_key}

    row_id = await _record_pending(
        template_key, to_email, from_email,
        subject, html_body, text_body, variables,
        related_type=related_type, related_id=related_id, triggered_by=triggered_by,
    )

    if reason:
        await _record_result(row_id, False, reason)
        return {"sent": False, "reason": reason, "template": template_key, "sent_email_id": row_id}

    if not password:
        msg = "OFFICE365_PASSWORD not set"
        await _record_result(row_id, False, msg)
        return {"sent": False, "reason": msg, "template": template_key, "sent_email_id": row_id}

    try:
        await _smtp_send(from_email, password, to_email, subject, html_body, text_body)
        await _record_result(row_id, True)
        return {"sent": True, "to": to_email, "template": template_key, "sent_email_id": row_id}
    except Exception as exc:
        await _record_result(row_id, False, str(exc))
        return {"sent": False, "error": str(exc), "template": template_key, "sent_email_id": row_id}


# ── Admin: outgoing email audit + resend ─────────────────────────────────────

@router.get("/sent")
async def admin_list_sent_emails(
    status_filter: str = "", template_key: str = "", search: str = "",
    related_type: str = "", related_id: str = "",
    limit: int = 100, offset: int = 0,
) -> dict[str, Any]:
    """Paginated audit log of every email send_template() handled.

    Surfaces failures (status=FAILED) so trustees can spot delivery issues
    and resend by id. The same endpoint works for status=SENT review.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {
        "limit": min(max(1, limit), 500),
        "offset": max(0, offset),
    }
    if status_filter.strip():
        where.append("status = :status")
        params["status"] = status_filter.strip().upper()
    if template_key.strip():
        where.append("template_key = :tkey")
        params["tkey"] = template_key.strip()
    if related_type.strip():
        where.append("related_type = :rtype")
        params["rtype"] = related_type.strip()
    if related_id.strip():
        where.append("related_id = :rid")
        params["rid"] = related_id.strip()
    if search.strip():
        where.append("(LOWER(to_email) LIKE :search OR LOWER(subject) LIKE :search)")
        params["search"] = f"%{search.strip().lower()}%"
    where_sql = "WHERE " + " AND ".join(where) if where else ""

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT id, template_key, to_email, subject, status, error,
                   attempts, last_attempt_at, sent_at,
                   related_type, related_id, created_at
            FROM   sent_emails
            {where_sql}
            ORDER  BY created_at DESC
            LIMIT  :limit OFFSET :offset
        """), params)
        items: list[dict[str, Any]] = []
        for r in rows.mappings():
            d = dict(r)
            d["id"] = str(d["id"])
            for k in ("created_at", "last_attempt_at", "sent_at"):
                if d.get(k):
                    d[k] = d[k].isoformat()
            items.append(d)

        total = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM sent_emails {where_sql}"),
            params,
        )).mappings().one()

    return {"items": items, "total": int(total["c"])}


@router.get("/sent/{sent_id}")
async def admin_get_sent_email(sent_id: str) -> dict[str, Any]:
    """Full row including body + variables, for a 'view raw' admin panel."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT * FROM sent_emails WHERE id::text = :id"),
            {"id": sent_id},
        )).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Email not found")
    rec = dict(row)
    rec["id"] = str(rec["id"])
    for k in ("created_at", "updated_at", "last_attempt_at", "sent_at"):
        if rec.get(k):
            rec[k] = rec[k].isoformat()
    return rec


@router.post("/sent/{sent_id}/resend")
async def admin_resend_sent_email(sent_id: str) -> dict[str, Any]:
    """Re-render and re-send a previously-attempted email.

    If the template still exists and is active, we render the CURRENT
    template against the stored variables (so admin edits to the template
    take effect on resend). If not, we fall back to the body we stored on
    the original attempt.

    Resend creates a NEW sent_emails row rather than mutating the original
    so the audit trail remains immutable. The new row's
    related_type='resend' / related_id=<original id> stitches the chain.
    """
    import json

    from sqlalchemy import text

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        original = (await db.execute(
            text("""
                SELECT template_key, to_email, subject, html_body, text_body,
                       variables, related_type, related_id, triggered_by
                FROM   sent_emails
                WHERE  id::text = :id
            """),
            {"id": sent_id},
        )).mappings().one_or_none()
    if not original:
        raise HTTPException(404, detail="Email not found")

    raw_vars = original["variables"] or {}
    if isinstance(raw_vars, str):
        try:
            raw_vars = json.loads(raw_vars)
        except Exception:
            raw_vars = {}

    # Try to re-render against the current template; if missing/inactive,
    # fall back to the stored body so we can still get the email out.
    subject = original["subject"]
    html_body = original["html_body"]
    text_body = original["text_body"]
    if original["template_key"]:
        async with SessionLocal() as db:
            r = await db.execute(text("""
                SELECT subject, html_body, text_body
                FROM   email_templates
                WHERE  template_key = :key AND is_active LIMIT 1
            """), {"key": original["template_key"]})
            tpl = r.mappings().first()
        if tpl:
            merged = {**_default_vars(), **raw_vars}
            subject, html_body, text_body = render_template(dict(tpl), merged)

    from_email = settings.OFFICE365_EMAIL or "noreply@shital.org.uk"
    password   = settings.OFFICE365_PASSWORD

    new_id = await _record_pending(
        original["template_key"] or "", original["to_email"], from_email,
        subject, html_body, text_body, raw_vars,
        related_type="resend", related_id=sent_id,
        triggered_by=original["triggered_by"] or "",
    )

    if not password:
        await _record_result(new_id, False, "OFFICE365_PASSWORD not set")
        return {"sent": False, "reason": "Email not configured", "sent_email_id": new_id}

    try:
        await _smtp_send(from_email, password, original["to_email"], subject, html_body, text_body)
        await _record_result(new_id, True)
        return {"sent": True, "to": original["to_email"], "sent_email_id": new_id}
    except Exception as exc:
        await _record_result(new_id, False, str(exc))
        return {"sent": False, "error": str(exc), "sent_email_id": new_id}
