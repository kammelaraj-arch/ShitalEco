"""
Meeting Minutes versioning (CC48). Minutes are a legal record — treat
each save as a new version in a tracked lifecycle:

  DRAFT → CIRCULATED → APPROVED

Routes:
  GET  /admin/board/meetings/{mid}/minutes               list all versions
  POST /admin/board/meetings/{mid}/minutes               new draft
  PUT  /admin/board/meetings/{mid}/minutes/{vid}         update draft
  POST /admin/board/meetings/{mid}/minutes/{vid}/circulate
  POST /admin/board/meetings/{mid}/minutes/{vid}/approve
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["meeting-minutes"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "SECRETARY", "CEO"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


class MinutesIn(BaseModel):
    content_html: str = ""


class MinutesApproveIn(BaseModel):
    approved_at_meeting_id: str


async def _audit(
    db: Any, *, action: str, entity_id: str, ctx: CurrentSpace,
    metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, 'meeting_minutes_versions', CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


@router.get("/admin/board/meetings/{meeting_id}/minutes")
async def list_minutes(meeting_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT * FROM meeting_minutes_versions WHERE meeting_id::text = :id "
            "ORDER BY version_number DESC"
        ), {"id": meeting_id})).mappings().all()
    return {"versions": [dict(r) for r in rows]}


@router.post("/admin/board/meetings/{meeting_id}/minutes")
async def create_draft(
    meeting_id: str, body: MinutesIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        # Next version number for this meeting.
        n = (await db.execute(text(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM "
            "meeting_minutes_versions WHERE meeting_id::text = :id"
        ), {"id": meeting_id})).scalar() or 1
        row = (await db.execute(text("""
            INSERT INTO meeting_minutes_versions
            (meeting_id, version_number, content_html, status, created_by)
            VALUES (CAST(:mid AS uuid), :vn, :c, 'DRAFT', :by)
            RETURNING id
        """), {
            "mid": meeting_id,
            "vn":  int(n),
            "c":   body.content_html,
            "by":  str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="MINUTES_DRAFT_CREATED", entity_id=new_id, ctx=ctx,
            metadata={"meeting_id": meeting_id, "version": int(n)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "version_number": int(n), "success": True}


@router.put("/admin/board/meetings/{meeting_id}/minutes/{version_id}")
async def update_draft(
    meeting_id: str, version_id: str, body: MinutesIn,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        existing = (await db.execute(text(
            "SELECT status FROM meeting_minutes_versions "
            "WHERE id::text = :id AND meeting_id::text = :mid"
        ), {"id": version_id, "mid": meeting_id})).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Minutes version not found")
        if existing["status"] != "DRAFT":
            raise HTTPException(400, detail=f"Only DRAFT versions can be edited; status: {existing['status']}")
        await db.execute(text(
            "UPDATE meeting_minutes_versions SET content_html = :c, updated_at = :now "
            "WHERE id::text = :id"
        ), {"c": body.content_html, "id": version_id, "now": datetime.now(UTC)})
        await _audit(
            db, action="MINUTES_DRAFT_UPDATED", entity_id=version_id, ctx=ctx,
            metadata={"meeting_id": meeting_id, "chars": len(body.content_html)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": version_id, "success": True}


@router.post("/admin/board/meetings/{meeting_id}/minutes/{version_id}/circulate")
async def circulate(
    meeting_id: str, version_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.api.routers.email_templates import send_raw_email
    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        existing = (await db.execute(text(
            "SELECT mmv.content_html, mmv.status, bm.title, bm.scheduled_at "
            "FROM meeting_minutes_versions mmv "
            "JOIN board_meetings bm ON bm.id = mmv.meeting_id "
            "WHERE mmv.id::text = :id AND mmv.meeting_id::text = :mid"
        ), {"id": version_id, "mid": meeting_id})).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Minutes version not found")
        if existing["status"] != "DRAFT":
            raise HTTPException(400, detail=f"Only DRAFT minutes can be circulated; status: {existing['status']}")
        trustees = (await db.execute(text(
            "SELECT email, full_name FROM trustees "
            "WHERE is_active = true AND email <> ''"
        ))).mappings().all()
        subject = f"[Shital Board] Draft minutes for review — {existing.get('title') or 'meeting'}"
        html = f"""
        <p>Dear trustee,</p>
        <p>Draft minutes for your review:</p>
        <hr>{existing['content_html']}<hr>
        <p>Please reply with amendments. Minutes will be presented for approval at the next meeting.</p>
        <p>Jay Shri Krishna 🙏</p>
        """.strip()
        sent_ok = 0
        for t in trustees:
            res = await send_raw_email(
                to_email=t["email"], subject=subject, html_body=html, text_body="",
                template_key="meeting_minutes_circulate",
                related_type="meeting_minutes",
                related_id=version_id, triggered_by="minutes_circulate",
            )
            if res.get("sent"):
                sent_ok += 1
        await db.execute(text("""
            UPDATE meeting_minutes_versions
            SET status = 'CIRCULATED', circulated_at = NOW(), circulated_by = :by,
                updated_at = NOW()
            WHERE id::text = :id
        """), {"by": str(ctx.user_id) if ctx.user_id else None, "id": version_id})
        await _audit(
            db, action="MINUTES_CIRCULATED", entity_id=version_id, ctx=ctx,
            metadata={"meeting_id": meeting_id, "recipients": sent_ok},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": version_id, "recipients": sent_ok, "success": True}


@router.post("/admin/board/meetings/{meeting_id}/minutes/{version_id}/approve")
async def approve(
    meeting_id: str, version_id: str, body: MinutesApproveIn,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        existing = (await db.execute(text(
            "SELECT status FROM meeting_minutes_versions "
            "WHERE id::text = :id AND meeting_id::text = :mid"
        ), {"id": version_id, "mid": meeting_id})).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Minutes version not found")
        if existing["status"] not in ("DRAFT", "CIRCULATED"):
            raise HTTPException(400, detail=f"Cannot approve from status {existing['status']}")
        # Supersede any prior APPROVED version on this meeting.
        await db.execute(text(
            "UPDATE meeting_minutes_versions SET status = 'SUPERSEDED', updated_at = NOW() "
            "WHERE meeting_id::text = :mid AND status = 'APPROVED'"
        ), {"mid": meeting_id})
        await db.execute(text("""
            UPDATE meeting_minutes_versions
            SET status = 'APPROVED', approved_at = NOW(), approved_by = :by,
                approved_at_meeting_id = CAST(:aid AS uuid),
                updated_at = NOW()
            WHERE id::text = :id
        """), {
            "by":  str(ctx.user_id) if ctx.user_id else None,
            "aid": body.approved_at_meeting_id,
            "id":  version_id,
        })
        await _audit(
            db, action="MINUTES_APPROVED", entity_id=version_id, ctx=ctx,
            metadata={"meeting_id": meeting_id,
                      "approved_at_meeting_id": body.approved_at_meeting_id},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": version_id, "success": True}
