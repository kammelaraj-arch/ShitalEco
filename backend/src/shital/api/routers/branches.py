"""
Branches router — CRUD for temple branch locations.
Requires SUPER_ADMIN or ADMIN role for write operations.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace, OptionalSpace


def _safe(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, UUID):
        return str(v)
    if hasattr(v, 'isoformat'):
        return v.isoformat()
    return v

router = APIRouter(prefix="/branches", tags=["branches"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class BranchIn(BaseModel):
    name: str                       # PUBLIC display name (donors see this)
    internal_ref: str = ""          # INTERNAL reference code (WEM, LEI…) — used everywhere internally
    city: str = ""
    postcode: str = ""
    address: str = ""
    phone: str = ""
    email: str = ""
    established: str = ""
    is_active: bool = True
    manager_name: str = ""
    manager_email: str = ""
    notes: str = ""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="SUPER_ADMIN or ADMIN required")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_branches(ctx: OptionalSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(text(
            "SELECT * FROM branches ORDER BY established ASC, name ASC"
        ))
        rows = result.mappings().all()
    return {"branches": [{k: _safe(v) for k, v in dict(r).items()} for r in rows]}


@router.post("", status_code=201)
async def create_branch(body: BranchIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    import re
    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    # Auto-generate branch_id (DB slug FK) from name if not set
    branch_id = re.sub(r'[^a-z0-9]', '_', body.name.lower())[:30].strip('_')
    # Internal reference: use the supplied code (uppercased) or derive from the
    # slug. Required + unique — the canonical reference for all internal systems.
    internal_ref = (body.internal_ref or branch_id).upper().strip()[:30]
    now = datetime.utcnow()
    async with SessionLocal() as db:
        existing = await db.execute(
            text("SELECT id FROM branches WHERE branch_id = :bid"),
            {"bid": branch_id}
        )
        if existing.first():
            branch_id = f"{branch_id}_{str(uuid.uuid4())[:4]}"
        # Reject a duplicate internal_ref so codes stay unique.
        dup = await db.execute(
            text("SELECT id FROM branches WHERE internal_ref = :ir"),
            {"ir": internal_ref},
        )
        if dup.first():
            raise HTTPException(status_code=409, detail=f"Internal reference '{internal_ref}' already in use")
        await db.execute(text("""
            INSERT INTO branches (id, branch_id, internal_ref, name, city, postcode, address,
                phone, email, established, is_active, manager_name, manager_email,
                notes, created_at, updated_at)
            VALUES (:id, :bid, :iref, :name, :city, :pc, :addr, :ph, :em, :est,
                :active, :mgr, :mgr_em, :notes, :now, :now)
        """), {
            "id": str(uuid.uuid4()), "bid": branch_id, "iref": internal_ref,
            "name": body.name, "city": body.city, "pc": body.postcode,
            "addr": body.address, "ph": body.phone, "em": body.email,
            "est": body.established, "active": body.is_active,
            "mgr": body.manager_name, "mgr_em": body.manager_email,
            "notes": body.notes, "now": now,
        })
        await db.commit()
    return {"ok": True, "branch_id": branch_id, "internal_ref": internal_ref}


@router.put("/{branch_id}")
async def update_branch(branch_id: str, body: BranchIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    async with SessionLocal() as db:
        # If internal_ref is being changed, enforce uniqueness against OTHER rows.
        if body.internal_ref:
            iref = body.internal_ref.upper().strip()[:30]
            dup = await db.execute(
                text("SELECT id FROM branches WHERE internal_ref = :ir AND branch_id <> :bid"),
                {"ir": iref, "bid": branch_id},
            )
            if dup.first():
                raise HTTPException(status_code=409, detail=f"Internal reference '{iref}' already in use")
        else:
            iref = None  # don't overwrite existing internal_ref when blank
        result = await db.execute(text("""
            UPDATE branches SET
                name = :name,
                internal_ref = COALESCE(NULLIF(:iref, ''), internal_ref),
                city = :city, postcode = :pc, address = :addr,
                phone = :ph, email = :em, established = :est, is_active = :active,
                manager_name = :mgr, manager_email = :mgr_em, notes = :notes,
                updated_at = :now
            WHERE branch_id = :bid
        """), {
            "name": body.name, "iref": iref or "", "city": body.city, "pc": body.postcode,
            "addr": body.address, "ph": body.phone, "em": body.email,
            "est": body.established, "active": body.is_active,
            "mgr": body.manager_name, "mgr_em": body.manager_email,
            "notes": body.notes, "now": now, "bid": branch_id,
        })
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Branch not found")
    return {"ok": True}


@router.delete("/{branch_id}", status_code=204)
async def delete_branch(branch_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(
            text("DELETE FROM branches WHERE branch_id = :bid"),
            {"bid": branch_id}
        )
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Branch not found")


# ── Branch Smart Dashboard ────────────────────────────────────────────────────

@router.get("/{branch_id}/dashboard")
async def branch_dashboard(branch_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """One-call operational dashboard for a single branch — everything needed
    to run, build and manage it: identity, live donation metrics, devices +
    card readers with online/offline state, recurring giving, Gift Aid, and
    actionable alerts. Read-only; SUPER_ADMIN / ADMIN only."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async def _one(db: Any, sql: str, params: dict) -> dict:
        r = (await db.execute(text(sql), params)).mappings().first()
        return dict(r) if r else {}

    async with SessionLocal() as db:
        # 1. Identity
        branch = await _one(db, "SELECT * FROM branches WHERE branch_id = :bid", {"bid": branch_id})
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")

        # 2. Donation metrics — totals by window, provider, status.
        #    Money figures count COMPLETED only; counts include all statuses.
        money = await _one(db, """
            SELECT
              COUNT(*)                                                              AS total_count,
              COUNT(*) FILTER (WHERE UPPER(COALESCE(status,'')) = 'COMPLETED')      AS completed_count,
              COUNT(*) FILTER (WHERE UPPER(COALESCE(status,'')) IN ('PENDING',''))  AS pending_count,
              COUNT(*) FILTER (WHERE UPPER(COALESCE(status,'')) = 'FAILED')         AS failed_count,
              COALESCE(SUM(amount) FILTER (WHERE UPPER(COALESCE(status,''))='COMPLETED'), 0)                                              AS total_amount,
              COALESCE(SUM(amount) FILTER (WHERE UPPER(COALESCE(status,''))='COMPLETED' AND created_at >= date_trunc('day',   NOW())),0)  AS today_amount,
              COALESCE(SUM(amount) FILTER (WHERE UPPER(COALESCE(status,''))='COMPLETED' AND created_at >= date_trunc('week',  NOW())),0)  AS week_amount,
              COALESCE(SUM(amount) FILTER (WHERE UPPER(COALESCE(status,''))='COMPLETED' AND created_at >= date_trunc('month', NOW())),0)  AS month_amount,
              COUNT(*) FILTER (WHERE UPPER(COALESCE(status,''))='COMPLETED' AND created_at >= date_trunc('day', NOW()))                   AS today_count
            FROM donations
            WHERE branch_id = :bid AND deleted_at IS NULL
        """, {"bid": branch_id})

        by_provider = [dict(r) for r in (await db.execute(text("""
            SELECT UPPER(COALESCE(payment_provider,'UNKNOWN')) AS provider,
                   COUNT(*) AS count,
                   COALESCE(SUM(amount) FILTER (WHERE UPPER(COALESCE(status,''))='COMPLETED'),0) AS amount
            FROM donations
            WHERE branch_id = :bid AND deleted_at IS NULL
              AND created_at >= date_trunc('month', NOW())
            GROUP BY 1 ORDER BY amount DESC
        """), {"bid": branch_id})).mappings()]

        # 3. Devices at this branch (kiosk_devices.branch_id stores the code)
        devices = [dict(r) for r in (await db.execute(text("""
            SELECT kd.id::text AS id, kd.name, kd.device_type, kd.status,
                   kd.last_seen_at,
                   EXTRACT(EPOCH FROM (NOW() - kd.last_seen_at)) AS seconds_since_seen,
                   td.label AS reader_label, td.provider AS reader_provider, td.status AS reader_status
            FROM kiosk_devices kd
            LEFT JOIN terminal_devices td ON td.id = kd.card_reader_id
            WHERE kd.branch_id = :bid AND kd.deleted_at IS NULL
            ORDER BY kd.device_type, kd.name
        """), {"bid": branch_id})).mappings()]
        for d in devices:
            secs = d.get("seconds_since_seen")
            d["presence"] = (
                "ONLINE"  if secs is not None and secs <= 300 else
                "STALE"   if secs is not None and secs <= 3600 else
                "OFFLINE"
            )
            if d.get("last_seen_at") is not None:
                d["last_seen_at"] = d["last_seen_at"].isoformat()
            d.pop("seconds_since_seen", None)

        # 4. Card readers registered to the branch
        readers = [dict(r) for r in (await db.execute(text("""
            SELECT id::text AS id, label, provider, status,
                   COALESCE(stripe_reader_id,'') AS stripe_reader_id,
                   COALESCE(sumup_reader_serial,'') AS sumup_reader_serial
            FROM terminal_devices
            WHERE branch_id = :bid
            ORDER BY label
        """), {"bid": branch_id})).mappings()]

        # 5. Recurring giving for the branch
        recurring = await _one(db, """
            SELECT COUNT(*) FILTER (WHERE UPPER(COALESCE(status,''))='ACTIVE')           AS active_count,
                   COALESCE(SUM(amount) FILTER (WHERE UPPER(COALESCE(status,''))='ACTIVE'),0) AS active_monthly,
                   COUNT(*) FILTER (WHERE UPPER(COALESCE(status,'')) LIKE 'PENDING%')     AS pending_count
            FROM recurring_giving_subscriptions
            WHERE branch_id = :bid
        """, {"bid": branch_id})

        # 6. Gift Aid (eligible completed donations this financial context)
        gift_aid = await _one(db, """
            SELECT COUNT(*) FILTER (WHERE gift_aid_eligible) AS eligible_count,
                   COALESCE(SUM(amount) FILTER (WHERE gift_aid_eligible AND UPPER(COALESCE(status,''))='COMPLETED'),0) AS eligible_amount
            FROM donations
            WHERE branch_id = :bid AND deleted_at IS NULL
        """, {"bid": branch_id})

        # 7. Staff at the branch
        staff_count = (await db.execute(text("""
            SELECT COUNT(*) FROM users u
            JOIN branches b ON b.id = u.branch_id
            WHERE b.branch_id = :bid AND u.deleted_at IS NULL
        """), {"bid": branch_id})).scalar() or 0

    # 8. Actionable alerts
    alerts: list[dict] = []
    offline_devices = [d for d in devices if d["presence"] == "OFFLINE"]
    if offline_devices:
        alerts.append({"severity": "warning", "kind": "devices_offline",
                       "message": f"{len(offline_devices)} device(s) offline",
                       "items": [d["name"] for d in offline_devices]})
    offline_readers = [r for r in readers if (r.get("status") or "").lower() == "offline"]
    if offline_readers:
        alerts.append({"severity": "warning", "kind": "readers_offline",
                       "message": f"{len(offline_readers)} card reader(s) offline",
                       "items": [r["label"] for r in offline_readers]})
    if (money.get("pending_count") or 0) > 0:
        alerts.append({"severity": "info", "kind": "donations_pending",
                       "message": f"{money['pending_count']} donation(s) PENDING — may need reconciliation"})
    if not readers:
        alerts.append({"severity": "warning", "kind": "no_readers",
                       "message": "No card readers registered to this branch"})

    return {
        "branch": {k: _safe(v) for k, v in branch.items()},
        "donations": {k: _safe(v) for k, v in money.items()},
        "donations_by_provider": [{k: _safe(v) for k, v in r.items()} for r in by_provider],
        "devices": devices,
        "readers": readers,
        "recurring_giving": {k: _safe(v) for k, v in recurring.items()},
        "gift_aid": {k: _safe(v) for k, v in gift_aid.items()},
        "staff_count": int(staff_count),
        "alerts": alerts,
    }
