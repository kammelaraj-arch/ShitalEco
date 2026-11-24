"""
Reserves policy + monthly snapshots (CC19).

Routes:
  GET  /admin/reserves/policy
  PUT  /admin/reserves/policy
  GET  /admin/reserves/snapshots
  POST /admin/reserves/snapshots
  DELETE /admin/reserves/snapshots/{sid}
  GET  /admin/reserves/summary           dashboard tile — latest + trend
"""
from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["reserves"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "TREASURER", "ACCOUNTANT", "CEO"}:
        raise HTTPException(status_code=403, detail="Admin / trustee / finance role required")


class ReservesPolicyIn(BaseModel):
    target_months: float = 3.0
    target_amount_gbp: float | None = None
    free_reserves_definition: str = ""
    trigger_action_below_months: float = 1.5
    review_period_months: int = 12
    notes: str = ""
    last_reviewed_at: str | None = None


class SnapshotIn(BaseModel):
    as_of_date: str
    unrestricted_balance: float = 0
    restricted_balance: float = 0
    endowment_balance: float = 0
    monthly_run_cost: float
    free_reserves: float | None = None
    note: str = ""


async def _audit(
    db: Any, *, action: str, entity_type: str, entity_id: str,
    ctx: CurrentSpace, metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, :et, CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "et":   entity_type,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


# ── Policy ────────────────────────────────────────────────────────────────

@router.get("/admin/reserves/policy")
async def get_policy(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT * FROM reserves_policy WHERE is_current = true LIMIT 1"
        ))).mappings().one_or_none()
    return {"policy": dict(row) if row else None}


@router.put("/admin/reserves/policy")
async def update_policy(
    body: ReservesPolicyIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    reviewed = body.last_reviewed_at or datetime.now(UTC).date().isoformat()
    # Compute next review date from the last_reviewed_at + review_period_months.
    try:
        d = datetime.fromisoformat(reviewed).date()
        year  = d.year + ((d.month - 1 + int(body.review_period_months)) // 12)
        month = ((d.month - 1 + int(body.review_period_months)) % 12) + 1
        nxt = date(year, month, min(d.day, 28)).isoformat()
    except ValueError:
        nxt = None
    async with SessionLocal() as db:
        existing = (await db.execute(text(
            "SELECT id FROM reserves_policy WHERE is_current = true"
        ))).scalar()
        if existing:
            await db.execute(text("""
                UPDATE reserves_policy SET
                  target_months = :tm,
                  target_amount_gbp = :ta,
                  free_reserves_definition = :frd,
                  trigger_action_below_months = :trg,
                  review_period_months = :rp,
                  notes = :nt,
                  last_reviewed_at = :rv,
                  next_review_date = :nxt,
                  updated_by = :by,
                  updated_at = NOW()
                WHERE id = :id
            """), {
                "tm":  body.target_months,
                "ta":  body.target_amount_gbp,
                "frd": body.free_reserves_definition,
                "trg": body.trigger_action_below_months,
                "rp":  int(body.review_period_months),
                "nt":  body.notes,
                "rv":  reviewed,
                "nxt": nxt,
                "by":  str(ctx.user_id) if ctx.user_id else None,
                "id":  existing,
            })
            policy_id = str(existing)
        else:
            row = (await db.execute(text("""
                INSERT INTO reserves_policy
                (is_current, target_months, target_amount_gbp,
                 free_reserves_definition, trigger_action_below_months,
                 review_period_months, notes, last_reviewed_at,
                 next_review_date, updated_by)
                VALUES (true, :tm, :ta, :frd, :trg, :rp, :nt, :rv, :nxt, :by)
                RETURNING id
            """), {
                "tm":  body.target_months,
                "ta":  body.target_amount_gbp,
                "frd": body.free_reserves_definition,
                "trg": body.trigger_action_below_months,
                "rp":  int(body.review_period_months),
                "nt":  body.notes,
                "rv":  reviewed,
                "nxt": nxt,
                "by":  str(ctx.user_id) if ctx.user_id else None,
            })).first()
            policy_id = str(row[0]) if row else ""
        await _audit(
            db, action="RESERVES_POLICY_UPDATED",
            entity_type="reserves_policy", entity_id=policy_id, ctx=ctx,
            metadata={"target_months": body.target_months,
                      "trigger_months": body.trigger_action_below_months},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": policy_id, "success": True}


# ── Snapshots ─────────────────────────────────────────────────────────────

@router.get("/admin/reserves/snapshots")
async def list_snapshots(
    ctx: CurrentSpace, limit: int = Query(60, ge=1, le=360),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT * FROM reserves_snapshots ORDER BY as_of_date DESC LIMIT :lim"
        ), {"lim": limit})).mappings().all()
    return {"snapshots": [dict(r) for r in rows]}


@router.post("/admin/reserves/snapshots")
async def create_snapshot(
    body: SnapshotIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    unr = Decimal(str(body.unrestricted_balance))
    rst = Decimal(str(body.restricted_balance))
    end = Decimal(str(body.endowment_balance))
    run = Decimal(str(body.monthly_run_cost))
    # If the caller didn't pass an explicit `free_reserves`, use
    # unrestricted — the simple CC19 default. Charities with designated
    # funds should pass an explicit figure.
    free = Decimal(str(body.free_reserves)) if body.free_reserves is not None else unr
    months = (free / run) if run > 0 else Decimal("0")
    # Fetch the current policy to compute triggers_fired.
    async with SessionLocal() as db:
        pol = (await db.execute(text(
            "SELECT target_months, trigger_action_below_months FROM reserves_policy WHERE is_current = true"
        ))).mappings().one_or_none()
        triggers: list[str] = []
        if pol:
            if months < Decimal(str(pol["trigger_action_below_months"])):
                triggers.append("BELOW_TRIGGER")
            if months < Decimal(str(pol["target_months"])):
                triggers.append("BELOW_TARGET")
        row = (await db.execute(text("""
            INSERT INTO reserves_snapshots
            (as_of_date, unrestricted_balance, restricted_balance,
             endowment_balance, free_reserves, monthly_run_cost,
             months_of_cover, triggers_fired, source, note, created_by)
            VALUES (:d, :u, :r, :e, :f, :c, :m,
                    CAST(:tr AS jsonb), 'MANUAL', :nt, :by)
            RETURNING id
        """), {
            "d":  body.as_of_date,
            "u":  str(unr), "r": str(rst), "e": str(end),
            "f":  str(free), "c": str(run), "m": str(months),
            "tr": json.dumps(triggers),
            "nt": body.note.strip(),
            "by": str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="RESERVES_SNAPSHOT_RECORDED",
            entity_type="reserves_snapshots", entity_id=new_id, ctx=ctx,
            metadata={"as_of_date": body.as_of_date,
                      "months_of_cover": float(months),
                      "triggers": triggers},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "months_of_cover": float(months),
            "triggers_fired": triggers, "success": True}


@router.delete("/admin/reserves/snapshots/{snapshot_id}")
async def delete_snapshot(
    snapshot_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "DELETE FROM reserves_snapshots WHERE id::text = :id RETURNING id"
        ), {"id": snapshot_id})
        if not res.first():
            raise HTTPException(404, detail="Snapshot not found")
        await _audit(
            db, action="RESERVES_SNAPSHOT_REMOVED",
            entity_type="reserves_snapshots", entity_id=snapshot_id, ctx=ctx,
            metadata={},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": snapshot_id, "success": True}


@router.get("/admin/reserves/summary")
async def summary(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        pol = (await db.execute(text(
            "SELECT target_months, trigger_action_below_months, next_review_date "
            "FROM reserves_policy WHERE is_current = true"
        ))).mappings().one_or_none()
        snap = (await db.execute(text(
            "SELECT as_of_date, months_of_cover, free_reserves, triggers_fired "
            "FROM reserves_snapshots ORDER BY as_of_date DESC LIMIT 1"
        ))).mappings().one_or_none()
        trend = (await db.execute(text(
            "SELECT as_of_date, months_of_cover FROM reserves_snapshots "
            "ORDER BY as_of_date DESC LIMIT 24"
        ))).mappings().all()
    return {
        "policy": dict(pol) if pol else None,
        "latest": dict(snap) if snap else None,
        "trend": [dict(t) for t in trend],
    }


# Keep these imports used (helpful for callers).
_ = timedelta
