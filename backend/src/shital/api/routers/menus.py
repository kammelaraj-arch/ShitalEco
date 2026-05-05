"""
Menus & Menu Profiles router.

Concept:
  - `menus` is a per-app catalog of selectable items (parent/child).
  - `menu_profiles` are named, reusable bundles of menu items.
  - A `kiosk_devices.menu_profile_id` FK selects which profile the device uses.

Public endpoints (no auth):
  GET  /menus?app_id=kiosk                 — list active menus for an app
  GET  /menu-profiles/{id}/menus           — list menu codes for a profile

Admin endpoints:
  GET    /admin/menus
  POST   /admin/menus
  PUT    /admin/menus/{id}
  DELETE /admin/menus/{id}

  GET    /admin/menu-profiles?app_id=
  GET    /admin/menu-profiles/{id}
  POST   /admin/menu-profiles
  PUT    /admin/menu-profiles/{id}
  DELETE /admin/menu-profiles/{id}
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(tags=["menus"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="SUPER_ADMIN or ADMIN required")


# ── Public ─────────────────────────────────────────────────────────────────────

@router.get("/menus")
async def list_menus(app_id: str = "kiosk") -> dict[str, Any]:
    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT id, app_id, code, label, parent_id, icon, display_order, is_active
            FROM   menus
            WHERE  app_id = :app AND is_active = true
            ORDER  BY display_order, label
        """), {"app": app_id})
        menus = [dict(r._mapping) for r in rows]
    return {"menus": menus}


@router.get("/menu-profiles/{profile_id}/menus")
async def menus_for_profile(profile_id: str) -> dict[str, Any]:
    """Public — returns menu codes enabled for a profile (used by kiosk runtime)."""
    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT m.id, m.code, m.label, m.parent_id, m.icon, m.display_order
            FROM   menu_profile_items i
            JOIN   menus m ON m.id = i.menu_id AND m.is_active = true
            WHERE  i.profile_id = :pid
            ORDER  BY m.display_order, m.label
        """), {"pid": profile_id})
        menus = [dict(r._mapping) for r in rows]
    return {"menus": menus, "codes": [m["code"] for m in menus]}


# ── Admin: Menus CRUD ──────────────────────────────────────────────────────────

class MenuIn(BaseModel):
    app_id: str = "kiosk"
    code: str
    label: str
    parent_id: str | None = None
    icon: str = ""
    display_order: int = 0
    is_active: bool = True


@router.get("/admin/menus")
async def admin_list_menus(ctx: CurrentSpace, app_id: str = "") -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        if app_id:
            rows = await db.execute(text("""
                SELECT id, app_id, code, label, parent_id, icon, display_order, is_active
                FROM   menus WHERE app_id = :app
                ORDER  BY display_order, label
            """), {"app": app_id})
        else:
            rows = await db.execute(text("""
                SELECT id, app_id, code, label, parent_id, icon, display_order, is_active
                FROM   menus ORDER BY app_id, display_order, label
            """))
        menus = [dict(r._mapping) for r in rows]
    return {"menus": menus}


@router.post("/admin/menus", status_code=201)
async def admin_create_menu(body: MenuIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        try:
            row = await db.execute(text("""
                INSERT INTO menus (app_id, code, label, parent_id, icon, display_order, is_active)
                VALUES (:app, :code, :label, :pid, :icon, :ord, :active)
                RETURNING id
            """), {
                "app": body.app_id, "code": body.code, "label": body.label,
                "pid": body.parent_id, "icon": body.icon,
                "ord": body.display_order, "active": body.is_active,
            })
            new_id = row.scalar_one()
            await db.commit()
        except Exception as exc:
            await db.rollback()
            raise HTTPException(status_code=400, detail=f"Could not create menu: {exc}")
    return {"id": str(new_id)}


@router.put("/admin/menus/{menu_id}")
async def admin_update_menu(menu_id: str, body: MenuIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE menus SET
                app_id = :app, code = :code, label = :label, parent_id = :pid,
                icon = :icon, display_order = :ord, is_active = :active,
                updated_at = :now
            WHERE id = :id
        """), {
            "id": menu_id, "app": body.app_id, "code": body.code, "label": body.label,
            "pid": body.parent_id, "icon": body.icon,
            "ord": body.display_order, "active": body.is_active,
            "now": datetime.utcnow(),
        })
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Menu not found")
    return {"ok": True}


@router.delete("/admin/menus/{menu_id}", status_code=204)
async def admin_delete_menu(menu_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await db.execute(text("DELETE FROM menus WHERE id = :id"), {"id": menu_id})
        await db.commit()


# ── Admin: Menu Profiles CRUD ──────────────────────────────────────────────────

class MenuProfileIn(BaseModel):
    app_id: str = "kiosk"
    name: str
    description: str = ""
    is_default: bool = False
    menu_ids: list[str] = []


@router.get("/admin/menu-profiles")
async def admin_list_profiles(ctx: CurrentSpace, app_id: str = "") -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        if app_id:
            rows = await db.execute(text("""
                SELECT p.id, p.app_id, p.name, p.description, p.is_default,
                       (SELECT COUNT(*) FROM menu_profile_items i WHERE i.profile_id = p.id) AS item_count
                FROM   menu_profiles p WHERE p.app_id = :app
                ORDER  BY p.is_default DESC, p.name
            """), {"app": app_id})
        else:
            rows = await db.execute(text("""
                SELECT p.id, p.app_id, p.name, p.description, p.is_default,
                       (SELECT COUNT(*) FROM menu_profile_items i WHERE i.profile_id = p.id) AS item_count
                FROM   menu_profiles p ORDER BY p.app_id, p.is_default DESC, p.name
            """))
        profiles = [dict(r._mapping) for r in rows]
    return {"profiles": profiles}


@router.get("/admin/menu-profiles/{profile_id}")
async def admin_get_profile(profile_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        prof_row = await db.execute(text("""
            SELECT id, app_id, name, description, is_default
            FROM   menu_profiles WHERE id = :id
        """), {"id": profile_id})
        prof = prof_row.mappings().first()
        if not prof:
            raise HTTPException(status_code=404, detail="Profile not found")
        items_row = await db.execute(text("""
            SELECT m.id, m.code, m.label, m.icon, m.display_order
            FROM   menu_profile_items i
            JOIN   menus m ON m.id = i.menu_id
            WHERE  i.profile_id = :id
            ORDER  BY m.display_order, m.label
        """), {"id": profile_id})
        items = [dict(r._mapping) for r in items_row]
    return {**dict(prof), "menus": items}


@router.post("/admin/menu-profiles", status_code=201)
async def admin_create_profile(body: MenuProfileIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        try:
            if body.is_default:
                await db.execute(text("UPDATE menu_profiles SET is_default = false WHERE app_id = :app"),
                                 {"app": body.app_id})
            row = await db.execute(text("""
                INSERT INTO menu_profiles (app_id, name, description, is_default)
                VALUES (:app, :name, :desc, :def)
                RETURNING id
            """), {"app": body.app_id, "name": body.name, "desc": body.description, "def": body.is_default})
            new_id = row.scalar_one()
            for mid in body.menu_ids:
                await db.execute(text(
                    "INSERT INTO menu_profile_items (profile_id, menu_id) VALUES (:p, :m) ON CONFLICT DO NOTHING"
                ), {"p": str(new_id), "m": mid})
            await db.commit()
        except Exception as exc:
            await db.rollback()
            raise HTTPException(status_code=400, detail=f"Could not create profile: {exc}")
    return {"id": str(new_id)}


@router.put("/admin/menu-profiles/{profile_id}")
async def admin_update_profile(profile_id: str, body: MenuProfileIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    async with SessionLocal() as db:
        if body.is_default:
            await db.execute(text(
                "UPDATE menu_profiles SET is_default = false WHERE app_id = :app AND id != :id"
            ), {"app": body.app_id, "id": profile_id})
        result = await db.execute(text("""
            UPDATE menu_profiles SET
                app_id = :app, name = :name, description = :desc,
                is_default = :def, updated_at = :now
            WHERE id = :id
        """), {
            "id": profile_id, "app": body.app_id, "name": body.name,
            "desc": body.description, "def": body.is_default, "now": datetime.utcnow(),
        })
        if result.rowcount == 0:  # type: ignore[attr-defined]
            await db.rollback()
            raise HTTPException(status_code=404, detail="Profile not found")
        await db.execute(text("DELETE FROM menu_profile_items WHERE profile_id = :id"),
                         {"id": profile_id})
        for mid in body.menu_ids:
            await db.execute(text(
                "INSERT INTO menu_profile_items (profile_id, menu_id) VALUES (:p, :m) ON CONFLICT DO NOTHING"
            ), {"p": profile_id, "m": mid})
        await db.commit()
    return {"ok": True}


@router.delete("/admin/menu-profiles/{profile_id}", status_code=204)
async def admin_delete_profile(profile_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        # Detach any kiosks using this profile
        await db.execute(text(
            "UPDATE kiosk_devices SET menu_profile_id = NULL WHERE menu_profile_id = :id"
        ), {"id": profile_id})
        await db.execute(text("DELETE FROM menu_profiles WHERE id = :id"), {"id": profile_id})
        await db.commit()
