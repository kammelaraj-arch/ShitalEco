from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..db import get_session
from ..models import APIKey, AuditEvent
from ..security.auth import require_scopes


router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=list[schemas.AuditEventOut])
async def query_audit(
    actor: str | None = None,
    action: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(default=200, ge=1, le=2000),
    session: AsyncSession = Depends(get_session),
    _: APIKey = Depends(require_scopes("audit:read")),
):
    stmt = select(AuditEvent).order_by(AuditEvent.at.desc()).limit(limit)
    if actor:
        stmt = stmt.where(AuditEvent.actor == actor)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    if since:
        stmt = stmt.where(AuditEvent.at >= since)
    if until:
        stmt = stmt.where(AuditEvent.at <= until)
    res = await session.execute(stmt)
    return list(res.scalars())
