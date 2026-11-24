"""
Meeting notices (CC48). One `meeting_notices` row per time a notice email
is dispatched for a meeting. Days-notice is server-computed.

Routes:
  GET  /admin/board/meetings/{mid}/notices
  POST /admin/board/meetings/{mid}/notices/send
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["meeting-notices"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "CEO", "SECRETARY"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


class NoticeIn(BaseModel):
    note: str = ""  # free-text covering message
    bundle_attachment_id: str | None = None  # future: papers-bundle PDF


@router.get("/admin/board/meetings/{meeting_id}/notices")
async def list_notices(meeting_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT * FROM meeting_notices WHERE meeting_id::text = :id "
            "ORDER BY sent_at DESC"
        ), {"id": meeting_id})).mappings().all()
    return {"notices": [dict(r) for r in rows]}


@router.post("/admin/board/meetings/{meeting_id}/notices/send")
async def send_notice(
    meeting_id: str, body: NoticeIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.api.routers.email_templates import send_raw_email
    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        mtg = (await db.execute(text(
            "SELECT id, title, meeting_type, mode, scheduled_at, location, "
            "video_link, agenda FROM board_meetings WHERE id::text = :id"
        ), {"id": meeting_id})).mappings().one_or_none()
        if not mtg:
            raise HTTPException(404, detail="Meeting not found")
        # Pull active trustees.
        trustees = (await db.execute(text(
            "SELECT id, full_name, email FROM trustees "
            "WHERE is_active = true AND email <> '' "
            "ORDER BY full_name"
        ))).mappings().all()
        scheduled_at = mtg["scheduled_at"]
        now_utc = datetime.now(UTC)
        if scheduled_at and scheduled_at.tzinfo is None:
            scheduled_at = scheduled_at.replace(tzinfo=UTC)
        days_notice = max(0, int((scheduled_at - now_utc).days)) if scheduled_at else 0

        subject = f"[Shital Board] Notice of {mtg['meeting_type'].replace('_', ' ')} — {mtg.get('title') or ''}".strip(" —")
        location_line = mtg.get("location") or mtg.get("video_link") or "Hybrid — details to follow"
        agenda_html = (mtg.get("agenda") or "").replace("\n", "<br>") or "<em>(agenda being finalised)</em>"
        when = scheduled_at.strftime("%A %d %B %Y, %H:%M UTC") if scheduled_at else "TBC"

        html = f"""
        <p>Dear trustee,</p>
        <p>Notice is hereby given of the following meeting:</p>
        <table style="border-collapse:collapse" cellpadding="6">
          <tr><td><b>Type</b></td><td>{mtg['meeting_type'].replace('_', ' ')}</td></tr>
          <tr><td><b>Mode</b></td><td>{mtg['mode']}</td></tr>
          <tr><td><b>When</b></td><td>{when}</td></tr>
          <tr><td><b>Where</b></td><td>{location_line}</td></tr>
          <tr><td><b>Notice period</b></td><td>{days_notice} day(s)</td></tr>
        </table>
        <h3>Agenda</h3>
        <div>{agenda_html}</div>
        {('<h3>Note</h3><p>' + body.note + '</p>') if body.note.strip() else ''}
        <p>Kindly RSVP via the Board portal.</p>
        <p>Jay Shri Krishna 🙏<br>Shital Board Secretariat</p>
        """.strip()

        sent_ok = 0
        failed: list[str] = []
        for t in trustees:
            res = await send_raw_email(
                to_email=t["email"], subject=subject, html_body=html, text_body="",
                template_key="board_meeting_notice",
                related_type="board_meeting_notice",
                related_id=meeting_id, triggered_by="meeting_notice",
            )
            if res.get("sent"):
                sent_ok += 1
            else:
                failed.append(t["email"])

        notice_row = (await db.execute(text("""
            INSERT INTO meeting_notices
            (meeting_id, sent_by, recipient_count, days_notice,
             bundle_attachment_id, note)
            VALUES (CAST(:mid AS uuid), :by, :n, :dn,
                    CASE WHEN :bid = '' THEN NULL ELSE CAST(:bid AS uuid) END,
                    :note)
            RETURNING id
        """), {
            "mid": meeting_id,
            "by":  str(ctx.user_id) if ctx.user_id else None,
            "n":   sent_ok,
            "dn":  days_notice,
            "bid": body.bundle_attachment_id or "",
            "note": body.note.strip(),
        })).first()
        new_id = str(notice_row[0]) if notice_row else ""
        await db.execute(text("""
            INSERT INTO board_audit_log
            (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
            VALUES (:uid, :name, 'MEETING_NOTICE_SENT', 'board_meetings', CAST(:eid AS uuid),
                    CAST(:meta AS jsonb), :ip, :ua)
        """), {
            "uid":  str(ctx.user_id) if ctx.user_id else None,
            "name": ctx.user_email or "",
            "eid":  meeting_id,
            "meta": __import__("json").dumps({
                "sent": sent_ok, "failed_count": len(failed),
                "days_notice": days_notice,
            }),
            "ip": request.client.host if request.client else "",
            "ua": request.headers.get("user-agent", ""),
        })
        await db.commit()
    return {
        "id": new_id, "sent": sent_ok, "failed": failed,
        "days_notice": days_notice, "success": True,
    }
