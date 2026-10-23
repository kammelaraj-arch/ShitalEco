"""Admin audit log reader — three queries the UI needs.

GET /audit-log                     — recent events, scoped to the caller's branch
GET /audit-log/entity/{type}/{id}  — full history of one row (any table)
GET /audit-log/actor/{email}       — everything one user ever did

All read-only, SUPER_ADMIN/ADMIN only. Writes go through
`services.audit.record_audit` from each mutating router, never through
this file.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from shital.api.deps import RequiredSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/audit-log", tags=["audit-log"])


def _require_admin(ctx) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(403, detail="SUPER_ADMIN or ADMIN required")


def _row_to_json(r: dict[str, Any]) -> dict[str, Any]:
    out = dict(r)
    for k, v in list(out.items()):
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


@router.get("/")
async def list_recent(
    ctx: RequiredSpace,
    entity_type: str | None = None,
    actor_email: str | None = None,
    action: str | None = None,
    limit: int = 50,
    offset: int = 0,
    cross_branch: bool = False,
) -> dict[str, Any]:
    """Recent audits for THIS branch. SUPER_ADMIN can pass `cross_branch=true`
    to see every branch. Pageable; defaults to the last 50."""
    _require_admin(ctx)
    limit = max(1, min(200, int(limit)))
    offset = max(0, int(offset))

    where = []
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if not (cross_branch and ctx.role == "SUPER_ADMIN"):
        where.append("(branch_id = :bid OR branch_id IS NULL)")
        params["bid"] = ctx.branch_id
    if entity_type:
        where.append("entity_type = :etype")
        params["etype"] = entity_type
    if actor_email:
        where.append("LOWER(actor_email) = LOWER(:actor)")
        params["actor"] = actor_email
    if action:
        where.append("action = :action")
        params["action"] = action
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id::text, actor_email, actor_role, action, entity_type,
                   entity_id, branch_id, source_endpoint, changed_fields,
                   diff_summary, created_at
            FROM audit_log
            {where_sql}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """), params)).mappings().all()
        count = (await db.execute(text(f"""
            SELECT COUNT(*) FROM audit_log {where_sql}
        """), {k: v for k, v in params.items() if k not in ("limit", "offset")})).scalar() or 0
    return {
        "items": [_row_to_json(r) for r in rows],
        "total": int(count),
        "limit": limit, "offset": offset,
    }


@router.get("/entity/{entity_type}/{entity_id}")
async def list_for_entity(
    entity_type: str, entity_id: str, ctx: RequiredSpace, limit: int = 100,
) -> list[dict[str, Any]]:
    """Full change-history of ONE row. Used by per-row '📜 History' buttons."""
    _require_admin(ctx)
    limit = max(1, min(500, int(limit)))
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text, actor_email, actor_role, action, entity_type,
                   entity_id, branch_id, source_endpoint, changed_fields,
                   diff_summary, before_json, after_json, created_at
            FROM audit_log
            WHERE entity_type = :etype AND entity_id = :eid
            ORDER BY created_at DESC
            LIMIT :limit
        """), {"etype": entity_type, "eid": entity_id, "limit": limit})).mappings().all()
    return [_row_to_json(r) for r in rows]


@router.get("/actor/{actor_email}")
async def list_for_actor(
    actor_email: str, ctx: RequiredSpace, limit: int = 200,
) -> list[dict[str, Any]]:
    """Everything one user did. Incident-response / HR usage."""
    _require_admin(ctx)
    limit = max(1, min(500, int(limit)))
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text, actor_email, actor_role, action, entity_type,
                   entity_id, branch_id, source_endpoint, changed_fields,
                   diff_summary, created_at
            FROM audit_log
            WHERE LOWER(actor_email) = LOWER(:actor)
            ORDER BY created_at DESC
            LIMIT :limit
        """), {"actor": actor_email, "limit": limit})).mappings().all()
    return [_row_to_json(r) for r in rows]
