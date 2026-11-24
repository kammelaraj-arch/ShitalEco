"""
Delegations register (Charities Act 2011 §280, SORP §9.17).

Routes:
  GET  /admin/board/delegations                   list (filters: area, status, expiring)
  POST /admin/board/delegations                   create
  GET  /admin/board/delegations/{did}             detail
  PUT  /admin/board/delegations/{did}             edit
  POST /admin/board/delegations/{did}/revoke      mark REVOKED + reason
  DELETE /admin/board/delegations/{did}           hard-delete (DRAFT only)
  GET  /admin/board/delegations/expiring?days=60  due-soon tile
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["delegations"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "TREASURER", "SECRETARY", "CEO"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


class DelegationIn(BaseModel):
    title: str
    area: str = "OTHER"
    delegate_user_id: str | None = None
    delegate_name: str = ""
    delegate_role: str = ""
    scope_description: str = ""
    limit_amount_gbp: float | None = None
    limit_period: str = "YEAR"
    conditions: str = ""
    start_date: str | None = None
    end_date: str | None = None
    review_date: str | None = None
    status: str = "ACTIVE"
    source_resolution_id: str | None = None


class DelegationPatch(BaseModel):
    title: str | None = None
    area: str | None = None
    delegate_user_id: str | None = None
    delegate_name: str | None = None
    delegate_role: str | None = None
    scope_description: str | None = None
    limit_amount_gbp: float | None = None
    limit_period: str | None = None
    conditions: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    review_date: str | None = None
    status: str | None = None


class RevokeIn(BaseModel):
    reason: str = ""
    revoked_by_resolution_id: str | None = None


async def _audit(
    db: Any, *, action: str, entity_id: str, ctx: CurrentSpace,
    metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, 'delegations', CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


@router.get("/admin/board/delegations")
async def list_delegations(
    ctx: CurrentSpace,
    area: str | None = Query(None),
    status: str | None = Query(None),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    conds: list[str] = []
    params: dict[str, Any] = {}
    if area:
        conds.append("area = :a")
        params["a"] = area
    if status:
        conds.append("status = :s")
        params["s"] = status
    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            f"SELECT * FROM delegations{where} ORDER BY area, title"
        ), params)).mappings().all()
    return {"delegations": [dict(r) for r in rows]}


@router.get("/admin/board/delegations/expiring")
async def expiring(
    ctx: CurrentSpace, days: int = Query(60, ge=1, le=365),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id, title, area, delegate_name, delegate_role,
                   review_date, end_date, status
            FROM   delegations
            WHERE  status = 'ACTIVE'
              AND  (
                (review_date IS NOT NULL
                 AND review_date <= CURRENT_DATE + make_interval(days => :d))
                OR
                (end_date IS NOT NULL
                 AND end_date <= CURRENT_DATE + make_interval(days => :d))
              )
            ORDER BY LEAST(COALESCE(review_date, end_date),
                           COALESCE(end_date, review_date))
        """), {"d": days})).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.post("/admin/board/delegations")
async def create_delegation(
    body: DelegationIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO delegations
            (title, area, delegate_user_id, delegate_name, delegate_role,
             scope_description, limit_amount_gbp, limit_period, conditions,
             start_date, end_date, review_date, status,
             source_resolution_id, created_by)
            VALUES (:t, :a,
                    CASE WHEN :du = '' THEN NULL ELSE CAST(:du AS uuid) END,
                    :dn, :dr,
                    :sd, :la, :lp, :cn,
                    :st, :ed, :rv, :s,
                    CASE WHEN :sr = '' THEN NULL ELSE CAST(:sr AS uuid) END,
                    :by)
            RETURNING id
        """), {
            "t":  body.title.strip()[:255],
            "a":  body.area,
            "du": body.delegate_user_id or "",
            "dn": body.delegate_name.strip()[:255],
            "dr": body.delegate_role.strip()[:40],
            "sd": body.scope_description.strip(),
            "la": body.limit_amount_gbp,
            "lp": body.limit_period,
            "cn": body.conditions.strip(),
            "st": body.start_date,
            "ed": body.end_date,
            "rv": body.review_date,
            "s":  body.status,
            "sr": body.source_resolution_id or "",
            "by": str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="DELEGATION_CREATED", entity_id=new_id, ctx=ctx,
            metadata={"title": body.title, "area": body.area,
                      "delegate": body.delegate_name or body.delegate_role,
                      "limit_gbp": body.limit_amount_gbp,
                      "limit_period": body.limit_period},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.get("/admin/board/delegations/{delegation_id}")
async def get_delegation(delegation_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT * FROM delegations WHERE id::text = :id"
        ), {"id": delegation_id})).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Delegation not found")
    return {"delegation": dict(row)}


@router.put("/admin/board/delegations/{delegation_id}")
async def update_delegation(
    delegation_id: str, body: DelegationPatch,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    data = body.model_dump(exclude_none=True)
    if not data:
        return {"id": delegation_id, "success": True, "noop": True}
    sets = [f"{k} = :{k}" for k in data]
    data["id"]  = delegation_id
    data["now"] = datetime.now(UTC)
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        res = await db.execute(text(
            f"UPDATE delegations SET {', '.join(sets)} WHERE id::text = :id RETURNING id"
        ), data)
        if not res.first():
            raise HTTPException(404, detail="Delegation not found")
        await _audit(
            db, action="DELEGATION_UPDATED", entity_id=delegation_id, ctx=ctx,
            metadata={"fields": list(body.model_dump(exclude_none=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": delegation_id, "success": True}


@router.post("/admin/board/delegations/{delegation_id}/revoke")
async def revoke(
    delegation_id: str, body: RevokeIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text("""
            UPDATE delegations SET
              status = 'REVOKED',
              revoked_at = NOW(),
              revoked_reason = :r,
              revoked_by_resolution_id = CASE WHEN :rid = '' THEN NULL ELSE CAST(:rid AS uuid) END,
              updated_at = NOW()
            WHERE id::text = :id RETURNING id
        """), {
            "r":   body.reason.strip()[:2000],
            "rid": body.revoked_by_resolution_id or "",
            "id":  delegation_id,
        })
        if not res.first():
            raise HTTPException(404, detail="Delegation not found")
        await _audit(
            db, action="DELEGATION_REVOKED", entity_id=delegation_id, ctx=ctx,
            metadata={"reason": body.reason,
                      "resolution_id": body.revoked_by_resolution_id},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": delegation_id, "success": True}


@router.delete("/admin/board/delegations/{delegation_id}")
async def delete_delegation(
    delegation_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Hard-delete — only allowed from DRAFT. ACTIVE rows must be
    revoked via /revoke so the audit trail is preserved."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "DELETE FROM delegations WHERE id::text = :id "
            "AND status = 'DRAFT' RETURNING id"
        ), {"id": delegation_id})
        if not res.first():
            raise HTTPException(400, detail="Only DRAFT delegations can be deleted; revoke instead")
        await _audit(
            db, action="DELEGATION_DELETED", entity_id=delegation_id, ctx=ctx,
            metadata={},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": delegation_id, "success": True}
