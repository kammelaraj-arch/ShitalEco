"""
Notifications Capabilities — email (SendGrid), WhatsApp (Meta Cloud API), in-app.
"""
from __future__ import annotations
from datetime import datetime
from typing import Any

import httpx
from pydantic import BaseModel
import structlog

from shital.core.dna.registry import capability, Fabric
from shital.core.space.context import DigitalSpace
from shital.core.fabrics.config import settings

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
    description="Send an email via SendGrid. Used for OTP codes, receipts, payslips, and confirmations.",
    fabric=Fabric.NOTIFICATIONS,
    requires=[],
    idempotent=False,
    tags=["email", "notifications"],
)
async def send_email(ctx: DigitalSpace, data: EmailInput) -> dict[str, Any]:
    if not settings.SENDGRID_API_KEY:
        logger.warning("sendgrid_not_configured")
        return {"sent": False, "reason": "SendGrid not configured"}

    payload = {
        "personalizations": [{"to": [{"email": data.to}]}],
        "from": {"email": settings.SENDGRID_FROM_EMAIL, "name": "Shital Temple"},
        "subject": data.subject,
        "content": [
            {"type": "text/html", "value": data.html_body},
        ],
    }
    if data.text_body:
        payload["content"].append({"type": "text/plain", "value": data.text_body})

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.sendgrid.com/v3/mail/send",
            json=payload,
            headers={"Authorization": f"Bearer {settings.SENDGRID_API_KEY}"},
            timeout=15,
        )

    if resp.status_code in (200, 202):
        logger.info("email_sent", to=data.to, subject=data.subject)
        return {"sent": True, "to": data.to}
    else:
        logger.error("email_failed", status=resp.status_code, body=resp.text)
        from shital.core.fabrics.errors import ExternalServiceError
        raise ExternalServiceError("SendGrid", f"HTTP {resp.status_code}: {resp.text[:200]}")


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
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    import uuid

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
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

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
