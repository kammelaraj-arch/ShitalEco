"""In-app notifications — per-user fan-out for assignments, risks,
approvals, milestones, invoices, funding events. Other routers call the
exported `notify()` helper to enqueue rows; the bell in the admin header
polls /admin/notifications and renders unread + recent.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(tags=["notifications"])


async def notify(
    db: Any,
    user_id: str | None,
    kind: str,
    title: str,
    body: str = "",
    link_url: str = "",
    severity: str = "INFO",
) -> None:
    """Internal helper — callers pass an open session and commit themselves.
    Silently no-ops if user_id is None / empty so triggers in places without a
    target user don't have to handle that case."""
    if not user_id:
        return
    await db.execute(text("""
        INSERT INTO notifications (id, user_id, kind, title, body, link_url, severity)
        VALUES (gen_random_uuid(), CAST(:uid AS UUID), :k, :t, :b, :url, :sev)
    """), {"uid": user_id, "k": kind.upper(), "t": title[:255], "b": body,
           "url": link_url[:500], "sev": severity.upper()})


async def notify_many(db: Any, user_ids: list[str | None], **kwargs: Any) -> None:
    for uid in user_ids:
        if uid:
            await notify(db, uid, **kwargs)


# ─── API ─────────────────────────────────────────────────────────────────────

@router.get("/admin/notifications")
async def list_notifications(ctx: CurrentSpace, unread_only: bool = False, limit: int = 50) -> dict[str, Any]:
    """Current user's notifications (or all admins' notifications for
    SUPER_ADMIN). Pagination: simple limit; the bell only ever shows the
    most recent 20-50, so no offset needed."""
    user_id = str(getattr(ctx, "user_id", "") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="auth required")
    limit = max(1, min(200, int(limit)))
    where = "user_id = CAST(:uid AS UUID)"
    if unread_only:
        where += " AND read_at IS NULL"
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id::text, kind, title, body, link_url, severity, read_at, created_at
            FROM   notifications
            WHERE  {where}
            ORDER  BY created_at DESC
            LIMIT  :lim
        """), {"uid": user_id, "lim": limit})).mappings().all()
        unread = (await db.execute(text("""
            SELECT COUNT(*) AS c FROM notifications
            WHERE user_id = CAST(:uid AS UUID) AND read_at IS NULL
        """), {"uid": user_id})).mappings().one()
    items = []
    for r in rows:
        d = dict(r)
        for k in ("read_at", "created_at"):
            if d.get(k):
                d[k] = d[k].isoformat()
        items.append(d)
    return {"items": items, "unread_count": int(unread["c"])}


class ReadIn(BaseModel):
    ids: list[str] | None = None   # if None → all current-user unread


@router.post("/admin/notifications/read")
async def mark_read(body: ReadIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Mark specific notification ids as read, or all-unread if ids is None.
    Limited to the current user's rows — no cross-user mutation."""
    user_id = str(getattr(ctx, "user_id", "") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="auth required")
    async with SessionLocal() as db:
        if body.ids:
            # PostgreSQL ARRAY of UUID
            ids = [i for i in body.ids if i]
            result = await db.execute(text("""
                UPDATE notifications SET read_at = NOW()
                WHERE user_id = CAST(:uid AS UUID)
                  AND read_at IS NULL
                  AND id = ANY(CAST(:ids AS UUID[]))
            """), {"uid": user_id, "ids": ids})
        else:
            result = await db.execute(text("""
                UPDATE notifications SET read_at = NOW()
                WHERE user_id = CAST(:uid AS UUID) AND read_at IS NULL
            """), {"uid": user_id})
        await db.commit()
    return {"ok": True, "marked": getattr(result, "rowcount", 0) or 0}
