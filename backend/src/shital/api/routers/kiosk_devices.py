"""
Kiosk Devices router — manage physical device registrations.

Device types:
  KIOSK          — full self-service kiosk (homescreen + donations + shop)
  QUICK_DONATION — tap-and-go donation-only device (7"+ screen)
  SMART_DISPLAY  — lobby/prayer-room screen driven by screen_profiles

Each device gets an auto-generated device_token used by the physical
device to fetch its config without a user session.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace, OptionalSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/kiosk-devices", tags=["kiosk-devices"])

DEVICE_TYPES = {"KIOSK", "QUICK_DONATION", "SMART_DISPLAY"}
STATUSES     = {"ACTIVE", "INACTIVE", "MAINTENANCE"}


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="SUPER_ADMIN or ADMIN required")


def _gen_token() -> str:
    """Generate a secure 48-char device token."""
    return secrets.token_urlsafe(36)[:48]


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class DeviceIn(BaseModel):
    name: str
    description: str = ""
    device_type: str = "KIOSK"          # KIOSK | QUICK_DONATION | SMART_DISPLAY
    branch_id: str = "main"
    location: str = ""
    status: str = "ACTIVE"
    # Smart Display
    screen_profile_id: str | None = None
    peak_start: str = "09:00"
    peak_end: str = "21:00"
    off_peak_playlist_id: str | None = None
    # Quick Donation
    default_donate_amount: float = 5.0
    # Card reader assignment (FK → terminal_devices.id)
    card_reader_id: str | None = None
    # Hardware info
    serial_number: str = ""
    ip_address: str = ""
    notes: str = ""
    # Kiosk branding & appearance
    kiosk_theme: str = "lotus"          # lotus | saffron | royal | peacock | jasmine | crimson
    org_name: str = ""
    org_logo_url: str = ""


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_devices(
    ctx: CurrentSpace,
    device_type: str = "",
    branch_id: str = "",
    status: str = "",
    include_inactive: bool = True,
) -> dict[str, Any]:
    _require_admin(ctx)

    conditions = ["deleted_at IS NULL"]
    params: dict[str, Any] = {}
    if device_type:
        conditions.append("device_type = :dtype")
        params["dtype"] = device_type
    if branch_id:
        conditions.append("branch_id = :bid")
        params["bid"] = branch_id
    if status:
        conditions.append("status = :status")
        params["status"] = status
    if not include_inactive:
        conditions.append("status != 'INACTIVE'")

    where = " AND ".join(conditions)
    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT id, name, description, device_type, branch_id, location,
                       status, screen_profile_id, peak_start, peak_end,
                       off_peak_playlist_id, default_donate_amount, card_reader_id,
                       serial_number, ip_address, device_token,
                       kiosk_theme, org_name, org_logo_url,
                       last_seen_at, notes, created_at, updated_at
                FROM kiosk_devices
                WHERE {where}
                ORDER BY device_type, branch_id, name
            """),
            params,
        )
        rows = result.mappings().all()

    devices = []
    for r in rows:
        d = dict(r)
        for k, v in d.items():
            if hasattr(v, "isoformat"):
                d[k] = v.isoformat()
        devices.append(d)

    return {"devices": devices, "total": len(devices)}


# ── Get single ────────────────────────────────────────────────────────────────

@router.get("/{device_id}")
async def get_device(device_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)

    async with SessionLocal() as db:
        result = await db.execute(
            text("SELECT * FROM kiosk_devices WHERE id = :id AND deleted_at IS NULL"),
            {"id": device_id},
        )
        row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")
    d = dict(row)
    for k, v in d.items():
        if hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d


# ── Public config fetch (device uses its token) ───────────────────────────────

@router.get("/by-token/{token}")
async def get_device_by_token(token: str, ctx: OptionalSpace) -> dict[str, Any]:
    """Public endpoint — device fetches its own config using its token."""
    async with SessionLocal() as db:
        # Update last_seen and return full config including card reader stripe ID
        result = await db.execute(
            text("""
                UPDATE kiosk_devices SET last_seen_at = NOW(), updated_at = NOW()
                WHERE device_token = :token AND deleted_at IS NULL
                RETURNING id, name, device_type, branch_id, location, status,
                          screen_profile_id, peak_start, peak_end,
                          off_peak_playlist_id, default_donate_amount, card_reader_id,
                          kiosk_theme, org_name, org_logo_url
            """),
            {"token": token},
        )
        row = result.mappings().first()
        if not row:
            await db.commit()
            raise HTTPException(status_code=404, detail="Device not found or token invalid")

        # Look up the stripe_reader_id and label from terminal_devices
        stripe_reader_id = None
        reader_label = None
        if row["card_reader_id"]:
            rd = await db.execute(
                text("SELECT stripe_reader_id, label FROM terminal_devices WHERE id = :id"),
                {"id": str(row["card_reader_id"])},
            )
            rd_row = rd.mappings().first()
            if rd_row:
                stripe_reader_id = rd_row["stripe_reader_id"]
                reader_label = rd_row["label"]

        await db.commit()

    return {
        **dict(row),
        "stripe_reader_id": stripe_reader_id,
        "reader_label": reader_label,
    }


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_device(body: DeviceIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if body.device_type not in DEVICE_TYPES:
        raise HTTPException(status_code=400, detail=f"device_type must be one of {DEVICE_TYPES}")
    if body.status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {STATUSES}")

    device_id = str(uuid.uuid4())
    token = _gen_token()
    now = datetime.utcnow()

    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO kiosk_devices
                (id, name, description, device_type, branch_id, location, status,
                 screen_profile_id, peak_start, peak_end, off_peak_playlist_id,
                 default_donate_amount, card_reader_id, serial_number, ip_address,
                 device_token, notes, kiosk_theme, org_name, org_logo_url,
                 created_at, updated_at)
            VALUES
                (:id, :name, :desc, :dtype, :bid, :loc, :status,
                 :prof_id, :peak_s, :peak_e, :offpeak_pl,
                 :dda, :card_rid, :serial, :ip,
                 :token, :notes, :ktheme, :oname, :ologo,
                 :now, :now)
        """), {
            "id": device_id, "name": body.name, "desc": body.description,
            "dtype": body.device_type, "bid": body.branch_id, "loc": body.location,
            "status": body.status, "prof_id": body.screen_profile_id,
            "peak_s": body.peak_start, "peak_e": body.peak_end,
            "offpeak_pl": body.off_peak_playlist_id,
            "dda": body.default_donate_amount,
            "card_rid": body.card_reader_id,
            "serial": body.serial_number, "ip": body.ip_address,
            "token": token, "notes": body.notes,
            "ktheme": body.kiosk_theme, "oname": body.org_name, "ologo": body.org_logo_url,
            "now": now,
        })
        await db.commit()

    return {"ok": True, "id": device_id, "device_token": token}


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{device_id}")
async def update_device(device_id: str, body: DeviceIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if body.device_type not in DEVICE_TYPES:
        raise HTTPException(status_code=400, detail=f"device_type must be one of {DEVICE_TYPES}")
    if body.status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {STATUSES}")

    now = datetime.utcnow()
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE kiosk_devices SET
                name = :name, description = :desc, device_type = :dtype,
                branch_id = :bid, location = :loc, status = :status,
                screen_profile_id = :prof_id, peak_start = :peak_s, peak_end = :peak_e,
                off_peak_playlist_id = :offpeak_pl, default_donate_amount = :dda,
                card_reader_id = :card_rid,
                serial_number = :serial, ip_address = :ip,
                notes = :notes, kiosk_theme = :ktheme,
                org_name = :oname, org_logo_url = :ologo,
                updated_at = :now
            WHERE id = :id AND deleted_at IS NULL
        """), {
            "id": device_id, "name": body.name, "desc": body.description,
            "dtype": body.device_type, "bid": body.branch_id, "loc": body.location,
            "status": body.status, "prof_id": body.screen_profile_id,
            "peak_s": body.peak_start, "peak_e": body.peak_end,
            "offpeak_pl": body.off_peak_playlist_id,
            "dda": body.default_donate_amount,
            "card_rid": body.card_reader_id,
            "serial": body.serial_number, "ip": body.ip_address,
            "notes": body.notes,
            "ktheme": body.kiosk_theme, "oname": body.org_name, "ologo": body.org_logo_url,
            "now": now,
        })
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Device not found")

    return {"ok": True}


# ── Regenerate token ──────────────────────────────────────────────────────────

@router.post("/{device_id}/regen-token")
async def regen_token(device_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Issue a new device token — invalidates the old one immediately."""
    _require_admin(ctx)

    new_token = _gen_token()
    async with SessionLocal() as db:
        result = await db.execute(
            text("UPDATE kiosk_devices SET device_token = :t, updated_at = NOW() WHERE id = :id AND deleted_at IS NULL"),
            {"t": new_token, "id": device_id},
        )
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Device not found")

    return {"ok": True, "device_token": new_token}


# ── Delete (soft) ─────────────────────────────────────────────────────────────

@router.delete("/{device_id}", status_code=204)
async def delete_device(device_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)

    async with SessionLocal() as db:
        result = await db.execute(
            text("UPDATE kiosk_devices SET deleted_at = NOW(), status = 'INACTIVE' WHERE id = :id AND deleted_at IS NULL"),
            {"id": device_id},
        )
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Device not found")
