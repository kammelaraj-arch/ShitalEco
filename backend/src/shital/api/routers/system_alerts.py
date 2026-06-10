"""System alerts — single source of truth for ops events.

infra/monitor.sh on each host POSTs every check transition here so the
admin can see container restarts, backup failures, certificate expiries
etc. in one place instead of trawling through trustee mailboxes. Auto-
heal outcomes (restart attempts + success/fail) are recorded inline so
the trustee can tell "this self-recovered" vs "still broken".

The monitor remains the source of detection — this is only the
persistence/audit + admin surface for it.
"""
from __future__ import annotations

import os
import uuid
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(tags=["system-alerts"])


class AlertIn(BaseModel):
    host:          str
    check_name:    str
    severity:      str = "critical"
    status:        str = "fail"     # ok / warn / fail
    message:       str = ""
    detail:        str = ""
    heal_attempts: int = 0
    heal_outcome:  str = ""         # restarted / failed / not_attempted


def _check_monitor_token(x_monitor_token: str | None) -> None:
    """The monitor authenticates with the same DEPLOY_SECRET that
    deployer/deploy.sh uses — avoids a separate secret to manage.
    Read straight from env (matches system.py): DEPLOY_SECRET isn't in
    the typed Settings model, so importing it via settings.* breaks mypy."""
    expected = os.environ.get("DEPLOY_SECRET", "").strip().strip('"').strip("'")
    if not expected:
        # If the secret isn't configured, accept (dev environments without
        # the deploy key shouldn't 401 the monitor and lose telemetry).
        return
    if (x_monitor_token or "").strip() != expected:
        raise HTTPException(401, detail="Invalid monitor token")


@router.post("/admin/system-alerts/ingest")
async def ingest_alert(
    body: AlertIn,
    x_monitor_token: str | None = Header(default=None, alias="X-Monitor-Token"),
) -> dict[str, Any]:
    """Endpoint hit by infra/monitor.sh after every transition. No CurrentSpace
    dep — authentication is via X-Monitor-Token (matches DEPLOY_SECRET) so
    cron-driven hosts don't need a user session.

    On status='ok' (recovery), we auto-resolve the most-recent open row for
    the same host+check so the admin counter goes down without manual
    acknowledgement."""
    _check_monitor_token(x_monitor_token)
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO system_alerts
                (id, host, check_name, severity, status, message, detail,
                 heal_attempts, heal_outcome)
            VALUES (CAST(:id AS UUID), :host, :ck, :sev, :st, :m, :d,
                    :att, :out)
        """), {"id": new_id, "host": body.host[:120], "ck": body.check_name[:80],
               "sev": body.severity[:20], "st": body.status[:20],
               "m": body.message, "d": body.detail,
               "att": int(body.heal_attempts or 0), "out": body.heal_outcome[:20]})
        if body.status.lower() == "ok":
            # Recovery → resolve every still-open row for this host+check.
            await db.execute(text("""
                UPDATE system_alerts SET resolved_at = NOW()
                WHERE host = :host AND check_name = :ck
                  AND resolved_at IS NULL AND status <> 'ok'
                  AND id <> CAST(:newid AS UUID)
            """), {"host": body.host, "ck": body.check_name, "newid": new_id})
        await db.commit()
    return {"ok": True, "id": new_id}


def _require_admin(ctx: CurrentSpace) -> None:
    if getattr(ctx, "role", "") not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(403, detail="admin only")


@router.get("/admin/system-alerts")
async def list_alerts(ctx: CurrentSpace, open_only: bool = True,
                      limit: int = 100) -> dict[str, Any]:
    """List system alerts. By default just the open ones so the admin badge
    isn't dominated by historical OK transitions."""
    where = ["1=1"]
    params: dict[str, Any] = {"lim": max(1, min(int(limit), 500))}
    if open_only:
        where.append("resolved_at IS NULL")
        where.append("status <> 'ok'")
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id::text, host, check_name, severity, status, message,
                   detail, heal_attempts, heal_outcome,
                   acknowledged_at, acknowledged_by, resolved_at, created_at
            FROM system_alerts
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
            LIMIT :lim
        """), params)).mappings().all()
        counts = (await db.execute(text("""
            SELECT severity, COUNT(*) AS c
            FROM system_alerts
            WHERE resolved_at IS NULL AND status <> 'ok'
            GROUP BY severity
        """))).mappings().all()
    items = []
    for r in rows:
        d = dict(r)
        for k in ("created_at", "acknowledged_at", "resolved_at"):
            if d.get(k) is not None and hasattr(d[k], "isoformat"):
                d[k] = d[k].isoformat()
        items.append(d)
    return {"items": items, "open_by_severity": {r["severity"]: int(r["c"]) for r in counts}}


@router.post("/admin/system-alerts/{alert_id}/acknowledge")
async def ack_alert(alert_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE system_alerts SET
                acknowledged_at = NOW(),
                acknowledged_by = :by
            WHERE id = CAST(:id AS UUID) AND acknowledged_at IS NULL
        """), {"id": alert_id, "by": getattr(ctx, "user_email", "") or "admin"})
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(404, detail="alert not found or already acknowledged")
    return {"ok": True}


@router.post("/admin/system-alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE system_alerts SET resolved_at = NOW()
            WHERE id = CAST(:id AS UUID) AND resolved_at IS NULL
        """), {"id": alert_id})
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(404, detail="alert not found or already resolved")
    return {"ok": True}
