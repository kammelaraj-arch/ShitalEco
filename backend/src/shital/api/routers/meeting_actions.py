"""
Meeting action items (Charity Governance Code principle 6.5).

Routes:
  GET  /admin/board/meetings/{mid}/actions                   list
  POST /admin/board/meetings/{mid}/actions                   create
  PUT  /admin/board/meetings/{mid}/actions/{aid}             edit / close
  DELETE /admin/board/meetings/{mid}/actions/{aid}           remove
  POST /admin/board/meetings/{mid}/actions/carry-forward     copy every OPEN
       action from `from_meeting_id` into this meeting, linking via
       `carried_from_action_id`.
  GET  /admin/board/my-actions                               actions owned by caller
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["meeting-actions"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "SECRETARY", "CEO"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


class ActionIn(BaseModel):
    title: str
    description: str = ""
    owner_user_id: str | None = None
    owner_name: str = ""
    due_date: str | None = None
    priority: str = "MEDIUM"      # LOW | MEDIUM | HIGH
    resolution_id: str | None = None


class ActionPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    owner_user_id: str | None = None
    owner_name: str | None = None
    due_date: str | None = None
    priority: str | None = None
    status: str | None = None     # OPEN | IN_PROGRESS | DONE | CANCELLED
    done_note: str | None = None


class CarryForwardIn(BaseModel):
    from_meeting_id: str


async def _audit(
    db: Any, *, action: str, entity_id: str, ctx: CurrentSpace,
    metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, 'meeting_actions', CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


@router.get("/admin/board/meetings/{meeting_id}/actions")
async def list_actions(meeting_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT * FROM meeting_actions
            WHERE  meeting_id::text = :id
            ORDER  BY status = 'DONE', due_date NULLS LAST, created_at
        """), {"id": meeting_id})).mappings().all()
    return {"actions": [dict(r) for r in rows]}


@router.post("/admin/board/meetings/{meeting_id}/actions")
async def create_action(
    meeting_id: str, body: ActionIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO meeting_actions
            (meeting_id, resolution_id, title, description, owner_user_id,
             owner_name, due_date, priority, status, created_by)
            VALUES (CAST(:mid AS uuid),
                    CASE WHEN :rid = '' THEN NULL ELSE CAST(:rid AS uuid) END,
                    :t, :d,
                    CASE WHEN :ou = '' THEN NULL ELSE CAST(:ou AS uuid) END,
                    :onm, :dd, :pr, 'OPEN', :by)
            RETURNING id
        """), {
            "mid": meeting_id,
            "rid": body.resolution_id or "",
            "t":   body.title.strip()[:500],
            "d":   body.description.strip(),
            "ou":  body.owner_user_id or "",
            "onm": body.owner_name.strip()[:255],
            "dd":  body.due_date,
            "pr":  body.priority,
            "by":  str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="ACTION_CREATED", entity_id=new_id, ctx=ctx,
            metadata={"meeting_id": meeting_id, "owner": body.owner_name,
                      "priority": body.priority},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.put("/admin/board/meetings/{meeting_id}/actions/{action_id}")
async def update_action(
    meeting_id: str, action_id: str, body: ActionPatch,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    data = body.model_dump(exclude_none=True)
    if not data:
        return {"id": action_id, "success": True, "noop": True}
    # When marking DONE, stamp done_at + done_by.
    if data.get("status") == "DONE":
        data["done_at"] = datetime.now(UTC)
        data["done_by"] = str(ctx.user_id) if ctx.user_id else None
    sets = [f"{k} = :{k}" for k in data]
    data["id"]  = action_id
    data["mid"] = meeting_id
    data["now"] = datetime.now(UTC)
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        res = await db.execute(text(
            f"UPDATE meeting_actions SET {', '.join(sets)} "
            "WHERE id::text = :id AND meeting_id::text = :mid RETURNING id"
        ), data)
        if not res.first():
            raise HTTPException(404, detail="Action not found")
        await _audit(
            db, action="ACTION_UPDATED", entity_id=action_id, ctx=ctx,
            metadata={"meeting_id": meeting_id,
                      "fields": list(body.model_dump(exclude_none=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": action_id, "success": True}


@router.delete("/admin/board/meetings/{meeting_id}/actions/{action_id}")
async def delete_action(
    meeting_id: str, action_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "DELETE FROM meeting_actions WHERE id::text = :id "
            "AND meeting_id::text = :mid RETURNING id"
        ), {"id": action_id, "mid": meeting_id})
        if not res.first():
            raise HTTPException(404, detail="Action not found")
        await _audit(
            db, action="ACTION_REMOVED", entity_id=action_id, ctx=ctx,
            metadata={"meeting_id": meeting_id},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": action_id, "success": True}


@router.post("/admin/board/meetings/{meeting_id}/actions/carry-forward")
async def carry_forward(
    meeting_id: str, body: CarryForwardIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Copy every OPEN / IN_PROGRESS action from `from_meeting_id` into
    this meeting, linking each copy back via `carried_from_action_id`.
    The source rows are flipped to CARRIED_FORWARD. Idempotent — rows
    already carried into this meeting are skipped."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT * FROM meeting_actions
            WHERE  meeting_id::text = :from_id
              AND  status IN ('OPEN', 'IN_PROGRESS')
              AND  NOT EXISTS (
                      SELECT 1 FROM meeting_actions ma2
                      WHERE  ma2.meeting_id::text = :to_id
                        AND  ma2.carried_from_action_id = meeting_actions.id
                   )
        """), {"from_id": body.from_meeting_id, "to_id": meeting_id})).mappings().all()
        copied: list[str] = []
        for r in rows:
            ins = (await db.execute(text("""
                INSERT INTO meeting_actions
                (meeting_id, resolution_id, title, description, owner_user_id,
                 owner_name, due_date, priority, status,
                 carried_from_action_id, created_by)
                VALUES (CAST(:mid AS uuid), :res, :t, :d, :ou, :on, :dd, :pr,
                        'OPEN', :src, :by)
                RETURNING id
            """), {
                "mid": meeting_id,
                "res": r["resolution_id"],
                "t":   r["title"],
                "d":   r["description"],
                "ou":  r["owner_user_id"],
                "on":  r["owner_name"],
                "dd":  r["due_date"],
                "pr":  r["priority"],
                "src": r["id"],
                "by":  str(ctx.user_id) if ctx.user_id else None,
            })).first()
            if ins:
                copied.append(str(ins[0]))
                await db.execute(text(
                    "UPDATE meeting_actions SET status = 'CARRIED_FORWARD', "
                    "updated_at = NOW() WHERE id = :id"
                ), {"id": r["id"]})
        await _audit(
            db, action="ACTIONS_CARRIED_FORWARD", entity_id=meeting_id, ctx=ctx,
            metadata={"from_meeting_id": body.from_meeting_id, "count": len(copied)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"copied": len(copied), "ids": copied, "success": True}


@router.get("/admin/board/my-actions")
async def my_actions(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT ma.*, bm.title AS meeting_title, bm.scheduled_at
            FROM   meeting_actions ma
            JOIN   board_meetings bm ON bm.id = ma.meeting_id
            WHERE  ma.owner_user_id::text = :uid
              AND  ma.status IN ('OPEN', 'IN_PROGRESS')
            ORDER  BY ma.due_date NULLS LAST, ma.created_at
        """), {"uid": str(ctx.user_id) if ctx.user_id else ""})).mappings().all()
    return {"actions": [dict(r) for r in rows]}
