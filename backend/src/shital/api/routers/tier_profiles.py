"""Tier profiles — admin CRUD for the editable Project Donation tier catalog.

A profile is a per-category list of tiers (brick, sqft, material, volunt,
services, business, general). Each tier has: label, price, sub (optional
one-liner), image_url (optional), featured (bool), order (int).

Many kiosk_devices can share one profile — operator asked explicitly:
"a profile that may more than one device use the same profile if required."

Devices without a profile fall back to the client-side defaults in
ProjectTiersScreen. The default catalog remains hardcoded so an unconfigured
kiosk still works out of the box.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/settings/tier-profiles", tags=["tier-profiles"])

_ALLOWED_ROLES = {"SUPER_ADMIN", "ADMIN", "MANAGER"}


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in _ALLOWED_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Requires SUPER_ADMIN, ADMIN or MANAGER role")


# ── Pydantic models ────────────────────────────────────────────────────────────

class TierItem(BaseModel):
    label: str
    price: float
    sub: str = ""
    image_url: str = ""
    featured: bool = False
    order: int = 0


class TierProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    branch_id: str | None = None
    # dict of category id → list of TierItem; validated loosely so a client
    # can post partial categories (empty array = "use defaults")
    config: dict[str, list[TierItem]] = Field(default_factory=dict)


class TierProfileOut(BaseModel):
    id: str
    name: str
    description: str
    branch_id: str | None
    config: dict[str, list[TierItem]]
    device_count: int = 0


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("")
async def list_tier_profiles(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT tp.id, tp.name,
                   COALESCE(tp.description, '') AS description,
                   tp.branch_id,
                   COALESCE(tp.config, '{}'::jsonb) AS config,
                   (SELECT COUNT(*) FROM kiosk_devices kd
                      WHERE kd.tier_profile_id = tp.id
                        AND kd.deleted_at IS NULL) AS device_count
            FROM   tier_profiles tp
            WHERE  tp.deleted_at IS NULL
            ORDER  BY tp.name
        """))
    profiles = []
    for r in rows.mappings():
        cfg_raw = r["config"]
        cfg = cfg_raw if isinstance(cfg_raw, dict) else json.loads(cfg_raw or "{}")
        profiles.append({
            "id":          str(r["id"]),
            "name":        r["name"],
            "description": r["description"],
            "branch_id":   r["branch_id"],
            "config":      cfg,
            "device_count": int(r["device_count"] or 0),
        })
    return {"profiles": profiles}


@router.post("")
async def create_tier_profile(body: TierProfileIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    cfg_json = json.dumps({k: [t.model_dump() for t in v] for k, v in body.config.items()})
    async with SessionLocal() as db:
        res = await db.execute(text("""
            INSERT INTO tier_profiles (name, description, branch_id, config)
            VALUES (:name, :desc, :branch, CAST(:cfg AS JSONB))
            RETURNING id
        """), {
            "name":   body.name.strip(),
            "desc":   body.description.strip(),
            "branch": body.branch_id,
            "cfg":    cfg_json,
        })
        new_id = str(res.scalar_one())
        await db.commit()
    return {"id": new_id}


@router.put("/{profile_id}")
async def update_tier_profile(profile_id: str, body: TierProfileIn,
                              ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    cfg_json = json.dumps({k: [t.model_dump() for t in v] for k, v in body.config.items()})
    async with SessionLocal() as db:
        res = await db.execute(text("""
            UPDATE tier_profiles
               SET name        = :name,
                   description = :desc,
                   branch_id   = :branch,
                   config      = CAST(:cfg AS JSONB),
                   updated_at  = NOW()
             WHERE id = CAST(:id AS UUID)
               AND deleted_at IS NULL
         RETURNING id
        """), {
            "id":     profile_id,
            "name":   body.name.strip(),
            "desc":   body.description.strip(),
            "branch": body.branch_id,
            "cfg":    cfg_json,
        })
        if res.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Profile not found")
        # Bump profile_version on every device attached to this profile so
        # those kiosks re-fetch config on their next heartbeat instead of
        # serving stale tiers until a manual reload.
        await db.execute(text("""
            UPDATE kiosk_devices
               SET profile_version = COALESCE(profile_version, 1) + 1,
                   updated_at      = NOW()
             WHERE tier_profile_id = CAST(:id AS UUID)
               AND deleted_at IS NULL
        """), {"id": profile_id})
        await db.commit()
    return {"ok": True}


@router.delete("/{profile_id}")
async def delete_tier_profile(profile_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        # Detach any devices currently using this profile so they fall back
        # to defaults rather than carrying a dangling FK after the soft delete.
        await db.execute(text("""
            UPDATE kiosk_devices
               SET tier_profile_id = NULL,
                   profile_version = COALESCE(profile_version, 1) + 1,
                   updated_at      = NOW()
             WHERE tier_profile_id = CAST(:id AS UUID)
               AND deleted_at IS NULL
        """), {"id": profile_id})
        await db.execute(text("""
            UPDATE tier_profiles
               SET deleted_at = NOW()
             WHERE id = CAST(:id AS UUID)
        """), {"id": profile_id})
        await db.commit()
    return {"ok": True}
