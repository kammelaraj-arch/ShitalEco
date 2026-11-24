"""Marketing webhooks — AWS SES bounce / complaint ingestion via SNS.

SES posts to an SNS topic on every hard bounce / complaint. SNS in
turn POSTs a JSON envelope to this endpoint. We:
  1. Accept both plaintext SNS JSON and the pre-decoded variant that
     a few proxies produce.
  2. Verify SNS SubscriptionConfirmation by GETting the
     SubscribeURL once (cheap, one-off).
  3. Extract the recipient email + bounce/complaint type and:
       * append a row to `marketing_unsubscribes` (audit trail);
       * set `contact_channel_prefs.opted_in = false` for
         (contact_id, 'email') where the email matches.

A hard bounce = permanently un-deliverable (nonexistent mailbox).
A complaint = recipient hit "mark as spam". Both trigger the same
list-hygiene action — the whole point is to stop sending to them.

Transient / soft bounces are IGNORED on purpose: our retry path in
dispatch_email already handles them.

No boto3. SNS messages are plain JSON; signature verification is
skipped on purpose for Phase 1c — if an attacker finds the webhook
URL and spams opt-outs, the cost is silent — no one is marked opted-in
by this path. We can tighten to full x509-sig verification in a
follow-up when there's real signal to protect.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import text

from shital.core.fabrics.database import SessionLocal
from shital.services.marketing.tracking import (
    TRACKING_PIXEL_GIF,
    decode_token,
    decode_url_param,
)

router = APIRouter(prefix="/webhooks/marketing", tags=["marketing-webhooks"])


async def _mark_unsubscribed(email: str, reason: str, source: str) -> None:
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO marketing_unsubscribes
                (email, channel, reason, source, created_at)
            VALUES
                (:email, 'email', :reason, :source, :now)
        """), {"email": email, "reason": reason[:500], "source": source[:50], "now": now})
        # Flip opt-in off for every matching contact (one row per
        # (contact, channel) upserted).
        await db.execute(text("""
            INSERT INTO contact_channel_prefs
                (contact_id, channel, opted_in, reason, updated_at)
            SELECT c.id, 'email', false, :reason, :now
              FROM contacts c
             WHERE LOWER(c.email) = :email
            ON CONFLICT (contact_id, channel) DO UPDATE SET
                opted_in   = false,
                reason     = EXCLUDED.reason,
                updated_at = EXCLUDED.updated_at
        """), {"email": email, "reason": reason[:100], "now": now})
        await db.commit()


@router.post("/ses")
async def ses_webhook(request: Request) -> dict[str, Any]:
    """Accept SES → SNS bounce/complaint notifications.

    SNS payload shape:
      {
        "Type": "Notification" | "SubscriptionConfirmation",
        "Message": "<stringified JSON of the SES event>",
        "SubscribeURL": "<on SubscriptionConfirmation only>"
      }
    """
    raw = await request.body()
    try:
        envelope = json.loads(raw.decode("utf-8") or "{}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, detail=f"Bad JSON: {exc}") from exc

    msg_type = str(envelope.get("Type") or "").strip()

    # One-time topic subscription handshake. SNS sends a URL that must
    # be GETted exactly once; after that, Notifications start flowing.
    if msg_type == "SubscriptionConfirmation":
        url = envelope.get("SubscribeURL") or ""
        if not url.startswith("https://sns."):
            raise HTTPException(400, detail="Not an SNS SubscribeURL")
        async with httpx.AsyncClient(timeout=15) as cli:
            await cli.get(url)
        return {"confirmed": True}

    if msg_type != "Notification":
        return {"ignored": True, "type": msg_type}

    try:
        ses_event = json.loads(envelope.get("Message") or "{}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, detail=f"SES Message not JSON: {exc}") from exc

    kind = str(ses_event.get("notificationType") or "").strip().lower()
    affected: list[str] = []

    if kind == "bounce":
        bounce = ses_event.get("bounce") or {}
        # We only act on permanent bounces — transient bounces are the
        # SMTP retry's job.
        if str(bounce.get("bounceType") or "").lower() != "permanent":
            return {"ignored": True, "reason": "transient_bounce"}
        for r in (bounce.get("bouncedRecipients") or []):
            email = str(r.get("emailAddress") or "")
            if email:
                affected.append(email)
                await _mark_unsubscribed(
                    email, reason=f"bounce:{bounce.get('bounceSubType', '')}", source="ses_bounce",
                )
    elif kind == "complaint":
        complaint = ses_event.get("complaint") or {}
        for r in (complaint.get("complainedRecipients") or []):
            email = str(r.get("emailAddress") or "")
            if email:
                affected.append(email)
                await _mark_unsubscribed(
                    email, reason=f"complaint:{complaint.get('complaintFeedbackType', '')}", source="ses_complaint",
                )
    else:
        return {"ignored": True, "type": kind}

    return {"applied": True, "count": len(affected), "affected": affected}


# ─── Open tracking pixel ─────────────────────────────────────────────────────
@router.get("/open", include_in_schema=False)
async def track_open(request: Request, t: str = Query(..., description="Signed open-token")) -> Response:
    try:
        campaign_id, contact_id = decode_token(t, "track_open")
    except HTTPException:
        # Never 4xx on a pixel — serve the GIF so mail clients don't
        # show a broken image.
        return Response(content=TRACKING_PIXEL_GIF, media_type="image/gif")

    ip = (request.client.host if request.client else "")[:45]
    ua = (request.headers.get("user-agent") or "")[:500]
    try:
        async with SessionLocal() as db:
            await db.execute(text("""
                INSERT INTO marketing_campaign_events
                    (campaign_id, contact_id, email, kind, url, ip_address, user_agent)
                VALUES
                    (CAST(:cid AS uuid), CAST(:ct AS uuid), '', 'open', '', :ip, :ua)
            """), {
                "cid": campaign_id,
                "ct": contact_id if contact_id else None,
                "ip": ip, "ua": ua,
            })
            await db.commit()
    except Exception:
        # Tracker DB write must never block pixel delivery.
        pass
    return Response(content=TRACKING_PIXEL_GIF, media_type="image/gif",
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate",
                             "Pragma": "no-cache"})


# ─── Click tracking redirect ─────────────────────────────────────────────────
@router.get("/click", include_in_schema=False)
async def track_click(
    request: Request,
    t: str = Query(..., description="Signed click-token"),
    u: str = Query(..., description="url-safe base64 of the target URL"),
) -> RedirectResponse:
    # Safe fallback on any auth failure — still redirect the user to
    # the decoded URL (we'd rather miss a tracking event than a user
    # journey).
    campaign_id: str | None = None
    contact_id: str | None = None
    try:
        campaign_id, contact_id = decode_token(t, "track_click")
    except HTTPException:
        pass

    target = decode_url_param(u)
    # Defence-in-depth: only http/https schemes.
    if not (target.startswith("http://") or target.startswith("https://")):
        raise HTTPException(400, detail="Bad target URL")

    if campaign_id:
        ip = (request.client.host if request.client else "")[:45]
        ua = (request.headers.get("user-agent") or "")[:500]
        try:
            async with SessionLocal() as db:
                await db.execute(text("""
                    INSERT INTO marketing_campaign_events
                        (campaign_id, contact_id, email, kind, url, ip_address, user_agent)
                    VALUES
                        (CAST(:cid AS uuid), CAST(:ct AS uuid), '', 'click', :u, :ip, :ua)
                """), {
                    "cid": campaign_id,
                    "ct": contact_id if contact_id else None,
                    "u": target[:2048], "ip": ip, "ua": ua,
                })
                await db.commit()
        except Exception:
            pass
    return RedirectResponse(url=target, status_code=302)


__all__ = ["router"]
