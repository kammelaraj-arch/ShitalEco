"""
Terminal Devices router — admin management of Stripe/Square card readers.

Each physical terminal device (WisePOS E, Square reader, etc.) is registered here
and linked to a branch + optionally a specific staff user.  The kiosk app uses
GET /terminal-devices/by-branch/{branch_id} to discover which readers are
available at its location.

All write endpoints require authentication (RequiredSpace).
GET by-branch is public so the kiosk can call it without a token.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import OptionalSpace, RequiredSpace

router = APIRouter(prefix="/terminal-devices", tags=["terminal-devices"])


# ─── Pydantic models ──────────────────────────────────────────────────────────

class DeviceCreate(BaseModel):
    branch_id: str
    branch_name: str = ""
    label: str
    provider: str = "stripe_terminal"   # stripe_terminal | square | clover | sumup | cash
    stripe_reader_id: str = ""
    stripe_location_id: str = ""
    square_device_id: str = ""
    clover_device_id: str = ""
    sumup_reader_serial: str = ""
    device_type: str = ""
    serial_number: str = ""
    user_id: str = ""
    user_name: str = ""
    user_email: str = ""
    notes: str = ""


class DeviceUpdate(BaseModel):
    branch_id: str | None = None
    branch_name: str | None = None
    label: str | None = None
    provider: str | None = None
    stripe_reader_id: str | None = None
    stripe_location_id: str | None = None
    square_device_id: str | None = None
    clover_device_id: str | None = None
    sumup_reader_serial: str | None = None
    device_type: str | None = None
    serial_number: str | None = None
    user_id: str | None = None
    user_name: str | None = None
    user_email: str | None = None
    is_active: bool | None = None
    status: str | None = None
    notes: str | None = None


class AssignUserInput(BaseModel):
    user_id: str
    user_name: str = ""
    user_email: str = ""


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _row_to_dict(row: Any) -> dict:
    d = dict(row)
    # Serialise datetimes
    for k in ("created_at", "updated_at", "last_seen_at", "deleted_at"):
        if d.get(k) and isinstance(d[k], datetime):
            d[k] = d[k].isoformat()
    return d


# ─── List / filter ────────────────────────────────────────────────────────────

@router.get("/")
async def list_devices(
    ctx: RequiredSpace,
    branch_id: str = "",
    provider: str = "",
    active_only: bool = True,
):
    """List all registered terminal devices with optional filters."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    conditions = ["deleted_at IS NULL"]
    params: dict[str, Any] = {}

    if active_only:
        conditions.append("is_active = TRUE")
    if branch_id:
        conditions.append("branch_id = :branch_id")
        params["branch_id"] = branch_id
    if provider:
        conditions.append("provider = :provider")
        params["provider"] = provider

    where = " AND ".join(conditions)

    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT id, branch_id, branch_name, user_id, user_name, user_email,
                       label, provider, stripe_reader_id, stripe_location_id,
                       square_device_id,
                       COALESCE(clover_device_id, '') AS clover_device_id,
                       COALESCE(sumup_reader_serial, '') AS sumup_reader_serial,
                       device_type, serial_number,
                       status, is_active, last_seen_at, notes,
                       created_at, updated_at
                FROM terminal_devices
                WHERE {where}
                ORDER BY branch_id, label
            """),
            params,
        )
        rows = result.mappings().all()

    return {"devices": [_row_to_dict(r) for r in rows], "total": len(rows)}


# ─── By-branch (public — used by kiosk) ──────────────────────────────────────

@router.get("/by-branch/{branch_id}")
async def list_devices_for_branch(branch_id: str, ctx: OptionalSpace):
    """Public endpoint: list active devices for a branch (used by kiosk)."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT id, label, provider, stripe_reader_id, stripe_location_id,
                       square_device_id,
                       COALESCE(clover_device_id, '') AS clover_device_id,
                       COALESCE(sumup_reader_serial, '') AS sumup_reader_serial,
                       device_type, serial_number,
                       status, user_id, user_name
                FROM terminal_devices
                WHERE branch_id = :bid
                  AND is_active = TRUE
                  AND deleted_at IS NULL
                ORDER BY label
            """),
            {"bid": branch_id},
        )
        rows = result.mappings().all()

    return {"devices": [dict(r) for r in rows]}


# ─── Get single device ────────────────────────────────────────────────────────

@router.get("/{device_id}")
async def get_device(device_id: str, ctx: RequiredSpace):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT * FROM terminal_devices
                WHERE id = :id AND deleted_at IS NULL
            """),
            {"id": device_id},
        )
        row = result.mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Device not found")

    return _row_to_dict(row)


# ─── Create ───────────────────────────────────────────────────────────────────

@router.post("/")
async def create_device(body: DeviceCreate, ctx: RequiredSpace):
    """Register a new terminal device and link it to a branch."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    device_id = str(uuid.uuid4())
    now = datetime.utcnow()

    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO terminal_devices (
                    id, branch_id, branch_name, user_id, user_name, user_email,
                    label, provider, stripe_reader_id, stripe_location_id,
                    square_device_id, clover_device_id, sumup_reader_serial,
                    device_type, serial_number,
                    status, is_active, notes, created_at, updated_at
                ) VALUES (
                    :id, :branch_id, :branch_name, :user_id, :user_name, :user_email,
                    :label, :provider, :stripe_reader_id, :stripe_location_id,
                    :square_device_id, :clover_device_id, :sumup_reader_serial,
                    :device_type, :serial_number,
                    'offline', TRUE, :notes, :now, :now
                )
            """),
            {
                "id": device_id,
                "branch_id": body.branch_id,
                "branch_name": body.branch_name,
                "user_id": body.user_id or None,
                "user_name": body.user_name,
                "user_email": body.user_email,
                "label": body.label,
                "provider": body.provider,
                "stripe_reader_id": body.stripe_reader_id,
                "stripe_location_id": body.stripe_location_id,
                "square_device_id": body.square_device_id,
                "clover_device_id": body.clover_device_id,
                "sumup_reader_serial": body.sumup_reader_serial,
                "device_type": body.device_type,
                "serial_number": body.serial_number,
                "notes": body.notes,
                "now": now,
            },
        )
        await db.commit()

    return {"device_id": device_id, "created": True}


# ─── Update ───────────────────────────────────────────────────────────────────

@router.put("/{device_id}")
async def update_device(device_id: str, body: DeviceUpdate, ctx: RequiredSpace):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    fields: dict[str, Any] = {}
    for field in (
        "branch_id", "branch_name", "label", "provider",
        "stripe_reader_id", "stripe_location_id", "square_device_id",
        "clover_device_id", "sumup_reader_serial",
        "device_type", "serial_number", "user_id", "user_name", "user_email",
        "is_active", "status", "notes",
    ):
        val = getattr(body, field)
        if val is not None:
            fields[field] = val

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    fields["updated_at"] = datetime.utcnow()
    fields["id"] = device_id

    set_clause = ", ".join(f"{k} = :{k}" for k in fields if k != "id")

    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                UPDATE terminal_devices
                SET {set_clause}
                WHERE id = :id AND deleted_at IS NULL
                RETURNING id
            """),
            fields,
        )
        row = result.first()
        await db.commit()

    if not row:
        raise HTTPException(status_code=404, detail="Device not found")

    return {"device_id": device_id, "updated": True}


# ─── Assign user ─────────────────────────────────────────────────────────────

@router.post("/{device_id}/assign")
async def assign_user_to_device(device_id: str, body: AssignUserInput, ctx: RequiredSpace):
    """Assign (or reassign) a staff user as the owner of this terminal."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.utcnow()

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                UPDATE terminal_devices
                SET user_id = :uid, user_name = :uname, user_email = :uemail,
                    updated_at = :now
                WHERE id = :id AND deleted_at IS NULL
                RETURNING id
            """),
            {
                "uid": body.user_id,
                "uname": body.user_name,
                "uemail": body.user_email,
                "now": now,
                "id": device_id,
            },
        )
        row = result.first()
        await db.commit()

    if not row:
        raise HTTPException(status_code=404, detail="Device not found")

    return {"device_id": device_id, "assigned_to": body.user_id}


# ─── Delete (soft) ────────────────────────────────────────────────────────────

@router.delete("/{device_id}")
async def delete_device(device_id: str, ctx: RequiredSpace):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.utcnow()

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                UPDATE terminal_devices
                SET deleted_at = :now, is_active = FALSE, updated_at = :now
                WHERE id = :id AND deleted_at IS NULL
                RETURNING id
            """),
            {"now": now, "id": device_id},
        )
        row = result.first()
        await db.commit()

    if not row:
        raise HTTPException(status_code=404, detail="Device not found")

    return {"device_id": device_id, "deleted": True}


# ─── Sync from Stripe ─────────────────────────────────────────────────────────

@router.post("/sync-stripe")
async def sync_from_stripe(ctx: RequiredSpace, branch_id: str = "", location_id: str = ""):
    """
    Pull all readers from the Stripe API and upsert them into terminal_devices.
    Existing rows are matched by stripe_reader_id and updated in-place.
    New readers are inserted with branch_id from the query param (or left blank
    for the admin to fill in later).
    """
    import stripe
    from sqlalchemy import text

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.database import SessionLocal
    from shital.core.fabrics.secrets import SecretsManager

    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY)
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Stripe API key not configured. Set it in Admin → API Keys.")

    try:
        params: dict = {"limit": 100}
        loc = location_id or settings.STRIPE_TERMINAL_LOCATION_ID
        if loc:
            params["location"] = loc

        readers_list = stripe.terminal.Reader.list(**params)
        readers = readers_list.data
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe API error: {e}")

    now = datetime.utcnow()
    created = 0
    updated = 0

    async with SessionLocal() as db:
        for r in readers:
            # Check if already registered
            existing = await db.execute(
                text("SELECT id FROM terminal_devices WHERE stripe_reader_id = :rid"),
                {"rid": r.id},
            )
            row = existing.first()

            if row:
                # Update hardware info + status
                await db.execute(
                    text("""
                        UPDATE terminal_devices
                        SET label = :label,
                            device_type = :dtype,
                            serial_number = :serial,
                            status = :status,
                            stripe_location_id = :loc,
                            last_seen_at = :now,
                            updated_at = :now
                        WHERE stripe_reader_id = :rid
                    """),
                    {
                        "label": r.label or r.id,
                        "dtype": r.device_type or "",
                        "serial": getattr(r, "serial_number", "") or "",
                        "status": r.status or "offline",
                        "loc": r.location or "",
                        "now": now,
                        "rid": r.id,
                    },
                )
                updated += 1
            else:
                # Insert new device (branch_id left for admin to fill if not provided)
                await db.execute(
                    text("""
                        INSERT INTO terminal_devices (
                            id, branch_id, label, provider,
                            stripe_reader_id, stripe_location_id,
                            device_type, serial_number,
                            status, is_active, last_seen_at, created_at, updated_at
                        ) VALUES (
                            :id, :bid, :label, 'stripe_terminal',
                            :rid, :loc, :dtype, :serial,
                            :status, TRUE, :now, :now, :now
                        )
                    """),
                    {
                        "id": str(uuid.uuid4()),
                        "bid": branch_id or "unassigned",
                        "label": r.label or r.id,
                        "rid": r.id,
                        "loc": r.location or "",
                        "dtype": r.device_type or "",
                        "serial": getattr(r, "serial_number", "") or "",
                        "status": r.status or "offline",
                        "now": now,
                    },
                )
                created += 1

        await db.commit()

    return {
        "synced": len(readers),
        "created": created,
        "updated": updated,
    }


# ─── Status refresh (ping Stripe for live reader status) ─────────────────────

@router.post("/{device_id}/refresh-status")
async def refresh_device_status(device_id: str, ctx: RequiredSpace):
    """Fetch the latest status for one device from Stripe and save it."""
    import stripe
    from sqlalchemy import text

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.database import SessionLocal
    from shital.core.fabrics.secrets import SecretsManager

    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY)
    now = datetime.utcnow()

    async with SessionLocal() as db:
        result = await db.execute(
            text("SELECT stripe_reader_id, provider FROM terminal_devices WHERE id = :id"),
            {"id": device_id},
        )
        row = result.mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Device not found")

    if row["provider"] != "stripe_terminal" or not row["stripe_reader_id"]:
        return {"device_id": device_id, "status": "unknown", "note": "Non-Stripe device"}

    try:
        reader = stripe.terminal.Reader.retrieve(row["stripe_reader_id"])
        status = reader.status or "offline"
    except Exception as e:
        return {"device_id": device_id, "status": "error", "error": str(e)}

    async with SessionLocal() as db:
        await db.execute(
            text("""
                UPDATE terminal_devices
                SET status = :status, last_seen_at = :now, updated_at = :now
                WHERE id = :id
            """),
            {"status": status, "now": now, "id": device_id},
        )
        await db.commit()

    return {"device_id": device_id, "status": status}
