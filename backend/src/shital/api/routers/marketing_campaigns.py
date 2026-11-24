"""Phase 1c-γ — campaign composer.

Ties a saved audience segment + a saved template together, schedules
or fires immediately, and drops a per-recipient row into sent_emails
via the mail dispatcher (with provider='ses' when configured; falls
back to Office365 otherwise).
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.api.routers.marketing_prefs import is_opted_in, prefs_url
from shital.core.fabrics.config import settings
from shital.core.fabrics.database import SessionLocal
from shital.services.marketing.audience import resolve_segment
from shital.services.marketing.tracking import rewrite_for_tracking

router = APIRouter(prefix="/marketing/campaigns", tags=["marketing-campaigns"])

# {{ variable }} render — same pattern as marketing_templates.
_VAR_RE = re.compile(r"\{\{\s*([a-z][a-z0-9_]*)\s*\}\}")


def _require_marketing(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "MARKETING", "CHAIR"}:
        raise HTTPException(403, detail="Marketing / admin role required")


def _render(body: str, variables: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return str(variables.get(key, "")) if key in variables else match.group(0)
    return _VAR_RE.sub(replace, body or "")


# ─── CRUD ────────────────────────────────────────────────────────────────────
class CampaignIn(BaseModel):
    name:         str
    segment_id:   str | None = None
    template_id:  str | None = None
    variables:    dict[str, Any] = {}
    scheduled_at: str | None = None


@router.get("")
async def list_campaigns(ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT c.id, c.name, c.status, c.scheduled_at, c.sent_at,
                   c.stats, c.updated_at,
                   s.name AS segment_name, t.name AS template_name
            FROM   marketing_campaigns c
            LEFT JOIN audience_segments  s ON s.id = c.segment_id
            LEFT JOIN marketing_templates t ON t.id = c.template_id
            ORDER  BY c.updated_at DESC
            LIMIT  200
        """))).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.post("")
async def create_campaign(body: CampaignIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, detail="name required")
    scheduled = None
    if body.scheduled_at:
        try:
            scheduled = datetime.fromisoformat(body.scheduled_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, detail="scheduled_at must be ISO-8601") from None

    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO marketing_campaigns
                (id, name, segment_id, template_id, variables, scheduled_at,
                 status, created_by)
            VALUES
                (CAST(:id AS uuid), :name,
                 CAST(:seg AS uuid), CAST(:tpl AS uuid),
                 CAST(:vars AS jsonb), :sched,
                 'DRAFT', CAST(:u AS uuid))
        """), {
            "id": new_id, "name": name[:200],
            "seg": body.segment_id if body.segment_id else None,
            "tpl": body.template_id if body.template_id else None,
            "vars": json.dumps(body.variables or {}),
            "sched": scheduled, "u": getattr(ctx, "user_id", None),
        })
        await db.commit()
    return {"ok": True, "id": new_id}


@router.get("/{cid}")
async def get_campaign(cid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT c.id, c.name, c.segment_id, c.template_id, c.variables,
                   c.scheduled_at, c.sent_at, c.status, c.stats,
                   s.name AS segment_name, t.name AS template_name,
                   t.subject, t.html_body, t.text_body, t.variables AS tpl_vars
            FROM   marketing_campaigns c
            LEFT JOIN audience_segments  s ON s.id = c.segment_id
            LEFT JOIN marketing_templates t ON t.id = c.template_id
            WHERE  c.id = CAST(:id AS uuid)
        """), {"id": cid})).mappings().first()
    if not row:
        raise HTTPException(404, detail="Campaign not found")
    return {"campaign": dict(row)}


class CampaignUpdate(BaseModel):
    name:         str | None = None
    segment_id:   str | None = None
    template_id:  str | None = None
    variables:    dict[str, Any] | None = None
    scheduled_at: str | None = None


@router.put("/{cid}")
async def update_campaign(cid: str, body: CampaignUpdate, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    updates: list[str] = []
    params: dict[str, Any] = {"id": cid}
    if body.name is not None:
        updates.append("name = :name")
        params["name"] = body.name.strip()[:200]
    if body.segment_id is not None:
        updates.append("segment_id = CAST(:seg AS uuid)")
        params["seg"] = body.segment_id if body.segment_id else None
    if body.template_id is not None:
        updates.append("template_id = CAST(:tpl AS uuid)")
        params["tpl"] = body.template_id if body.template_id else None
    if body.variables is not None:
        updates.append("variables = CAST(:vars AS jsonb)")
        params["vars"] = json.dumps(body.variables)
    if body.scheduled_at is not None:
        if body.scheduled_at:
            try:
                params["sched"] = datetime.fromisoformat(body.scheduled_at.replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(400, detail="scheduled_at must be ISO-8601") from None
            updates.append("scheduled_at = :sched")
        else:
            updates.append("scheduled_at = NULL")

    if not updates:
        return {"ok": True, "unchanged": True}
    updates.append("updated_at = NOW()")
    async with SessionLocal() as db:
        r = await db.execute(text(
            f"UPDATE marketing_campaigns SET {', '.join(updates)} WHERE id = CAST(:id AS uuid)"
        ), params)
        await db.commit()
    if not r.rowcount:
        raise HTTPException(404, detail="Campaign not found")
    return {"ok": True}


@router.delete("/{cid}")
async def cancel_campaign(cid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        r = await db.execute(text("""
            UPDATE marketing_campaigns
               SET status = 'CANCELLED', updated_at = NOW()
             WHERE id = CAST(:id AS uuid) AND status IN ('DRAFT','SCHEDULED')
        """), {"id": cid})
        await db.commit()
    if not r.rowcount:
        raise HTTPException(409, detail="Campaign cannot be cancelled in its current state")
    return {"ok": True, "cancelled": r.rowcount}


# ─── Preview recipient count ─────────────────────────────────────────────────
@router.post("/{cid}/preview-count")
async def preview_count(cid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT segment_id FROM marketing_campaigns WHERE id = CAST(:id AS uuid)"
        ), {"id": cid})).first()
    if not row:
        raise HTTPException(404, detail="Campaign not found")
    if not row[0]:
        return {"total_unique": 0}
    recipients = await resolve_segment(str(row[0]))
    return {"total_unique": len(recipients)}


# ─── Shared send implementation ─────────────────────────────────────────────
# Called by both the send-now endpoint (from the UI) and the scheduled
# worker (services/marketing/scheduled_worker.py). Assumes the caller
# has already flipped the row to SENDING (the endpoint does; the worker
# claims via an atomic UPDATE in `_claim_due_campaigns`).
async def _run_campaign_send(cid: str, *, triggered_by: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT c.segment_id, c.template_id, c.variables,
                   t.subject, t.html_body, t.text_body, t.status AS tpl_status
            FROM   marketing_campaigns c
            LEFT JOIN marketing_templates t ON t.id = c.template_id
            WHERE  c.id = CAST(:id AS uuid)
        """), {"id": cid})).mappings().first()
    if not row:
        raise RuntimeError("Campaign not found")
    if not row["segment_id"] or not row["template_id"]:
        raise RuntimeError("Campaign missing segment or template")

    recipients = await resolve_segment(str(row["segment_id"]))
    variables_campaign = dict(row["variables"] or {})

    from shital.api.routers.email_templates import send_raw_email

    attempted = 0
    sent = 0
    skipped = 0
    failed: list[dict[str, str]] = []

    for r in recipients:
        attempted += 1
        email = r["email"]
        contact_id = r.get("contact_id") or None
        if contact_id and not await is_opted_in(contact_id, "email"):
            skipped += 1
            continue

        merged = {
            "first_name": (r.get("name") or "").split(" ")[0] if r.get("name") else "",
            "name":        r.get("name") or "",
            "email":       email,
            "org_name":    "SHITAL",
            **variables_campaign,
        }
        subject = _render(row["subject"] or "", merged)
        html    = _render(row["html_body"] or "", merged)
        plain   = _render(row["text_body"] or "", merged)

        if contact_id:
            footer_url = prefs_url(contact_id)
            html += (
                '<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0 12px 0">'
                '<div style="font-family:system-ui,sans-serif;font-size:11px;color:#6b7280">'
                'SHITAL (UK charity 1138530). '
                f'Update preferences or <a href="{footer_url}">unsubscribe</a>.'
                '</div>'
            )

        # Open + click tracking — rewrite <a href> to the click endpoint
        # and append a pixel. Unsubscribe / prefs links are preserved by
        # the rewriter's skip-fragments. Both rely on SITE_URL resolving
        # to a public host (prod: https://api.shital.org.uk via nginx).
        tracker_base = getattr(settings, "SITE_URL", "") or "https://api.shital.org.uk"
        html = rewrite_for_tracking(
            html, campaign_id=cid, contact_id=contact_id,
            tracker_base=tracker_base,
        )

        result = await send_raw_email(
            to_email=email, subject=subject,
            html_body=html, text_body=plain,
            related_type="marketing_campaign",
            related_id=cid, triggered_by=triggered_by,
            template_key=str(row["template_id"] or ""),
        )
        if result.get("sent"):
            sent += 1
        else:
            failed.append({
                "email": email,
                "reason": str(result.get("reason") or result.get("error") or "unknown")[:200],
            })

    stats = {
        "attempted": attempted, "sent": sent,
        "skipped_opted_out": skipped,
        "failed": len(failed),
        "failed_detail": failed[:100],
    }
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE marketing_campaigns
               SET status='SENT', sent_at=NOW(), stats=CAST(:stats AS jsonb), updated_at=NOW()
             WHERE id = CAST(:id AS uuid)
        """), {"id": cid, "stats": json.dumps(stats)})
        await db.commit()
    return stats


# ─── Fire: send-now ──────────────────────────────────────────────────────────
@router.post("/{cid}/send-now")
async def send_now(cid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    # Preconditions — read before flipping state so we 4xx cleanly.
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT c.status, c.segment_id, c.template_id, t.status AS tpl_status
            FROM   marketing_campaigns c
            LEFT JOIN marketing_templates t ON t.id = c.template_id
            WHERE  c.id = CAST(:id AS uuid)
        """), {"id": cid})).mappings().first()
    if not row:
        raise HTTPException(404, detail="Campaign not found")
    if row["status"] in {"SENDING", "SENT"}:
        raise HTTPException(409, detail=f"Campaign is {row['status']}")
    if not row["segment_id"]:
        raise HTTPException(400, detail="Campaign has no segment — pick one first")
    if not row["template_id"]:
        raise HTTPException(400, detail="Campaign has no template — pick one first")
    if row["tpl_status"] == "ARCHIVED":
        raise HTTPException(400, detail="Template is archived — publish or pick another")

    # Flip to SENDING so a second click can't race us.
    async with SessionLocal() as db:
        await db.execute(text(
            "UPDATE marketing_campaigns SET status='SENDING', updated_at=NOW() WHERE id = CAST(:id AS uuid)"
        ), {"id": cid})
        await db.commit()

    stats = await _run_campaign_send(cid, triggered_by=getattr(ctx, "user_email", "") or "")
    return {"ok": True, "stats": stats}


# ─── Schedule: flip to SCHEDULED so the worker picks it up ───────────────────
class ScheduleBody(BaseModel):
    scheduled_at: str  # ISO-8601


@router.post("/{cid}/schedule")
async def schedule_campaign(cid: str, body: ScheduleBody, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    try:
        when = datetime.fromisoformat(body.scheduled_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, detail="scheduled_at must be ISO-8601") from None
    # Must be in the future (allow a 60s grace for clock skew).
    now = datetime.now(UTC)
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    if (when - now).total_seconds() < -60:
        raise HTTPException(400, detail="scheduled_at is in the past")

    async with SessionLocal() as db:
        # Pre-check: template + segment must be set so the worker doesn't
        # fail on dispatch at the chosen time.
        row = (await db.execute(text("""
            SELECT c.status, c.segment_id, c.template_id, t.status AS tpl_status
            FROM   marketing_campaigns c
            LEFT JOIN marketing_templates t ON t.id = c.template_id
            WHERE  c.id = CAST(:id AS uuid)
        """), {"id": cid})).mappings().first()
        if not row:
            raise HTTPException(404, detail="Campaign not found")
        if row["status"] not in {"DRAFT", "SCHEDULED"}:
            raise HTTPException(409, detail=f"Campaign is {row['status']}")
        if not row["segment_id"] or not row["template_id"]:
            raise HTTPException(400, detail="Pick a segment and a template first")
        if row["tpl_status"] == "ARCHIVED":
            raise HTTPException(400, detail="Template is archived")

        await db.execute(text("""
            UPDATE marketing_campaigns
               SET status = 'SCHEDULED', scheduled_at = :when, updated_at = NOW()
             WHERE id = CAST(:id AS uuid)
        """), {"id": cid, "when": when})
        await db.commit()
    return {"ok": True, "scheduled_at": when.isoformat()}


@router.post("/{cid}/unschedule")
async def unschedule_campaign(cid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_marketing(ctx)
    async with SessionLocal() as db:
        r = await db.execute(text("""
            UPDATE marketing_campaigns
               SET status = 'DRAFT', scheduled_at = NULL, updated_at = NOW()
             WHERE id = CAST(:id AS uuid) AND status = 'SCHEDULED'
        """), {"id": cid})
        await db.commit()
    if not r.rowcount:
        raise HTTPException(409, detail="Not currently scheduled")
    return {"ok": True}


# ─── Open + click tracking stats ─────────────────────────────────────────────
@router.get("/{cid}/tracking")
async def campaign_tracking(cid: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Aggregate opens + clicks. Unique = distinct contact_ids (plus a
    bucket keyed on IP for external-list sends where contact_id is
    NULL, so proxy prefetches don't inflate the number too much)."""
    _require_marketing(ctx)
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT
              COUNT(*) FILTER (WHERE kind='open')  AS opens,
              COUNT(*) FILTER (WHERE kind='click') AS clicks,
              COUNT(DISTINCT COALESCE(contact_id::text, ip_address))
                 FILTER (WHERE kind='open')  AS unique_opens,
              COUNT(DISTINCT COALESCE(contact_id::text, ip_address))
                 FILTER (WHERE kind='click') AS unique_clicks
            FROM marketing_campaign_events
            WHERE campaign_id = CAST(:id AS uuid)
        """), {"id": cid})).mappings().first()
        top_links = (await db.execute(text("""
            SELECT url, COUNT(*) AS clicks,
                   COUNT(DISTINCT COALESCE(contact_id::text, ip_address)) AS unique_clicks
            FROM   marketing_campaign_events
            WHERE  campaign_id = CAST(:id AS uuid) AND kind = 'click' AND url <> ''
            GROUP  BY url
            ORDER  BY clicks DESC
            LIMIT  20
        """), {"id": cid})).mappings().all()
    return {
        "opens":         int((row or {}).get("opens") or 0),
        "clicks":        int((row or {}).get("clicks") or 0),
        "unique_opens":  int((row or {}).get("unique_opens") or 0),
        "unique_clicks": int((row or {}).get("unique_clicks") or 0),
        "top_links":     [dict(r) for r in top_links],
    }


__all__ = ["router", "_run_campaign_send"]
