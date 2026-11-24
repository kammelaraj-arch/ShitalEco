"""Phase D announcement fan-out — resolve audiences to unique recipient
emails, respect per-channel opt-in gates (Phase 1a), and send through
the existing audit-logged send_raw_email path.

Called from the sign-off endpoint once the chair has approved the
plan. External-audience plans gate on requires_chair_approval AND
approved_at being set. The worker is idempotent-ish: it checks the
plan's status before sending and marks it SENT at the end.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from shital.api.routers.marketing_prefs import is_opted_in, prefs_url
from shital.core.fabrics.database import SessionLocal
from shital.services.marketing.audience import resolve_entries


async def _resolve_audiences(resolution_id: str) -> list[dict[str, Any]]:
    """Return a de-duplicated list of {email, name, contact_id} across
    every audience row on the plan.

    Thin wrapper over services/marketing/audience.resolve_entries so
    board announcements and marketing campaigns resolve through the
    same six-kind resolver. Keeps this file's signature stable so the
    chair-signoff caller doesn't need to change."""
    async with SessionLocal() as db:
        plan = (await db.execute(text(
            "SELECT id FROM resolution_announcements WHERE resolution_id = CAST(:r AS uuid)"
        ), {"r": resolution_id})).first()
    if not plan:
        return []
    async with SessionLocal() as db:
        auds = (await db.execute(text("""
            SELECT kind, params FROM resolution_announcement_audiences
             WHERE announcement_id = CAST(:a AS uuid)
        """), {"a": str(plan[0])})).mappings().all()
    return await resolve_entries([dict(e) for e in auds])


async def fanout_announcement(resolution_id: str, triggered_by: str = "") -> dict[str, Any]:
    """Run the announcement send. Honors the plan's chair-approval gate.
    Returns {attempted, sent, skipped_opted_out, failed}."""
    async with SessionLocal() as db:
        plan = (await db.execute(text("""
            SELECT id, subject, body_html, channels,
                   requires_chair_approval, approved_at, status
            FROM   resolution_announcements WHERE resolution_id = CAST(:r AS uuid)
            LIMIT  1
        """), {"r": resolution_id})).mappings().first()
    if not plan:
        return {"attempted": 0, "reason": "no_plan"}
    if plan["requires_chair_approval"] and not plan["approved_at"]:
        return {"attempted": 0, "reason": "awaiting_chair_approval"}
    if plan["status"] == "SENT":
        return {"attempted": 0, "reason": "already_sent"}
    if not (plan["subject"] or "").strip() and not (plan["body_html"] or "").strip():
        return {"attempted": 0, "reason": "empty_message"}

    channels = list(plan["channels"] or [])
    if "email" not in channels:
        # SMS / WhatsApp fan-out is Phase D-next — keep this PR focused on email.
        return {"attempted": 0, "reason": "no_email_channel"}

    recipients = await _resolve_audiences(resolution_id)
    attempted = 0
    sent = 0
    skipped = 0
    failed: list[dict[str, str]] = []

    # Import inside the fn — `send_raw_email` imports the full SMTP stack.
    from shital.api.routers.email_templates import send_raw_email

    for r in recipients:
        attempted += 1
        contact_id = r.get("contact_id") or None
        email = r["email"]
        if contact_id:
            # Known contact: honour the opt-in gate exactly like a marketing send.
            if not await is_opted_in(contact_id, "email"):
                skipped += 1
                continue
            footer_url = prefs_url(contact_id)
        else:
            # External contact with no ID — no prefs link, but still safe to
            # send because the chair explicitly approved the external list.
            footer_url = ""
        html = (plan["body_html"] or "")
        if footer_url:
            html += (
                '<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0 12px 0">'
                '<div style="font-family:system-ui,sans-serif;font-size:11px;color:#6b7280">'
                'SHITAL (UK charity 1138530). '
                f'Update preferences or <a href="{footer_url}">unsubscribe</a>.'
                '</div>'
            )
        result = await send_raw_email(
            to_email=email,
            subject=(plan["subject"] or "SHITAL — board resolution"),
            html_body=html,
            text_body="",
            related_type="resolution_announcement",
            related_id=resolution_id,
            triggered_by=triggered_by,
        )
        if result.get("sent"):
            sent += 1
        else:
            failed.append({"email": email, "reason": str(result.get("reason") or result.get("error") or "unknown")[:200]})

    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE resolution_announcements
               SET status = 'SENT', sent_at = :now, updated_at = :now
             WHERE resolution_id = CAST(:r AS uuid)
        """), {"r": resolution_id, "now": datetime.now(UTC)})
        await db.commit()

    return {"attempted": attempted, "sent": sent,
            "skipped_opted_out": skipped, "failed": failed}


__all__ = ["fanout_announcement"]
