"""
Notifications Capabilities — email (Office 365 SMTP), WhatsApp (Meta Cloud API), in-app.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx
import structlog
from pydantic import BaseModel

from shital.core.dna.registry import Fabric, capability
from shital.core.fabrics.config import settings
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()


class EmailInput(BaseModel):
    to: str
    subject: str
    html_body: str
    text_body: str = ""


class WhatsAppInput(BaseModel):
    to: str  # E.164 e.g. +447700900000
    message: str


class InAppNotificationInput(BaseModel):
    user_id: str
    title: str
    body: str
    notification_type: str = "INFO"


@capability(
    name="send_email",
    description="Send an email via Office 365 SMTP. Used for OTP codes, receipts, payslips, and confirmations.",
    fabric=Fabric.NOTIFICATIONS,
    requires=[],
    idempotent=False,
    tags=["email", "notifications"],
)
async def send_email(ctx: DigitalSpace, data: EmailInput) -> dict[str, Any]:
    import asyncio
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    from_email = settings.OFFICE365_EMAIL or "noreply@shital.org.uk"
    password   = settings.OFFICE365_PASSWORD

    if not password:
        logger.warning("office365_not_configured")
        return {"sent": False, "reason": "Email not configured — add OFFICE365_EMAIL and OFFICE365_PASSWORD in Admin → API Keys"}

    def _smtp_send() -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = data.subject
        msg["From"]    = from_email
        msg["To"]      = data.to
        if data.text_body:
            msg.attach(MIMEText(data.text_body, "plain"))
        msg.attach(MIMEText(data.html_body, "html"))
        with smtplib.SMTP("smtp.office365.com", 587, timeout=20) as srv:
            srv.ehlo()
            srv.starttls()
            srv.login(from_email, password)
            srv.sendmail(from_email, data.to, msg.as_string())

    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _smtp_send)
        logger.info("email_sent", to=data.to, subject=data.subject, method="office365")
        return {"sent": True, "to": data.to}
    except Exception as exc:
        logger.error("office365_smtp_error", error=str(exc))
        from shital.core.fabrics.errors import ExternalServiceError
        raise ExternalServiceError("Office365 SMTP", str(exc))


@capability(
    name="send_whatsapp",
    description="Send a WhatsApp message via Meta Cloud API (primary, free). Used for booking confirmations, donation receipts, and announcements.",
    fabric=Fabric.NOTIFICATIONS,
    requires=[],
    idempotent=False,
    tags=["whatsapp", "notifications"],
)
async def send_whatsapp(ctx: DigitalSpace, data: WhatsAppInput) -> dict[str, Any]:
    if not settings.META_WHATSAPP_TOKEN:
        logger.warning("whatsapp_not_configured")
        return {"sent": False, "reason": "WhatsApp not configured"}

    phone_id = settings.META_WHATSAPP_PHONE_ID
    url = f"https://graph.facebook.com/v19.0/{phone_id}/messages"

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": data.to,
        "type": "text",
        "text": {"preview_url": False, "body": data.message},
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {settings.META_WHATSAPP_TOKEN}"},
            timeout=15,
        )

    if resp.status_code == 200:
        result = resp.json()
        msg_id = result.get("messages", [{}])[0].get("id", "")
        logger.info("whatsapp_sent", to=data.to, message_id=msg_id)
        return {"sent": True, "to": data.to, "message_id": msg_id}
    else:
        logger.error("whatsapp_failed", status=resp.status_code, body=resp.text)
        from shital.core.fabrics.errors import ExternalServiceError
        raise ExternalServiceError("Meta WhatsApp", f"HTTP {resp.status_code}")


@capability(
    name="create_in_app_notification",
    description="Create an in-app notification for a user. Appears in the notification bell in admin and web portals.",
    fabric=Fabric.NOTIFICATIONS,
    requires=[],
    idempotent=False,
    tags=["notifications", "in-app"],
)
async def create_in_app_notification(ctx: DigitalSpace, data: InAppNotificationInput) -> dict[str, Any]:
    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    notif_id = str(uuid.uuid4())
    now = datetime.utcnow()

    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO notifications
                (id, user_id, title, body, type, channel, read, created_at)
                VALUES (:id, :uid, :title, :body, :type, 'IN_APP', false, :now)
            """),
            {
                "id": notif_id, "uid": data.user_id,
                "title": data.title, "body": data.body,
                "type": data.notification_type, "now": now,
            },
        )
        await db.commit()

    return {"notification_id": notif_id, "user_id": data.user_id}


@capability(
    name="get_unread_notifications",
    description="Retrieve unread notifications for the current user.",
    fabric=Fabric.NOTIFICATIONS,
    requires=[],
    idempotent=True,
    tags=["notifications"],
)
async def get_unread_notifications(
    ctx: DigitalSpace, limit: int = 20, cursor: str = ""
) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    params: dict[str, Any] = {"uid": ctx.user_id, "limit": limit + 1}
    cursor_clause = "AND id > :cursor" if cursor else ""
    if cursor:
        params["cursor"] = cursor

    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT id, title, body, type, channel, read, created_at
                FROM notifications
                WHERE user_id = :uid AND read = false {cursor_clause}
                ORDER BY created_at DESC
                LIMIT :limit
            """),
            params,
        )
        rows = result.mappings().all()

    items = [dict(r) for r in rows[:limit]]
    next_cursor = rows[limit]["id"] if len(rows) > limit else None
    return {"items": items, "next_cursor": next_cursor, "unread_count": len(items)}
