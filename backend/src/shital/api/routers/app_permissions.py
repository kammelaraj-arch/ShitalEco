"""
App Permissions router — manage which user roles can access which platform apps.
Permissions are stored as a JSON config in app_settings (key: app_permissions).
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import RequiredSpace

router = APIRouter(prefix="/settings/app-permissions", tags=["settings"])

# All platform apps with their metadata
PLATFORM_APPS: list[dict[str, Any]] = [
    {"slug": "admin",       "name": "Business App",       "description": "Full ERP — finance, HR, payroll, Gift Aid, catalog, compliance, AI tools.", "url": "/admin/", "icon": "⚙️", "color": "#3B82F6"},
    {"slug": "kiosk",       "name": "Kiosk",              "description": "Touch-screen kiosk — donations, services, shop & bookings in 3 languages.", "url": "/kiosk/", "icon": "🖥️", "color": "#FF9933"},
    {"slug": "donate",      "name": "Quick Donation",     "description": "Fast walk-up donation terminal. Card payments with Gift Aid capture.",       "url": "/donate/","icon": "🙏", "color": "#F59E0B"},
    {"slug": "screen",      "name": "Smart Screen",       "description": "Digital display board — announcements, events and live donation totals.",    "url": "/screen/","icon": "📺", "color": "#8B5CF6"},
    {"slug": "service",     "name": "Service Portal",     "description": "Online donations, shop & temple services with PayPal. Mobile-friendly.",     "url": "https://service.shital.org.uk", "icon": "🙏", "color": "#FF9933"},
    {"slug": "api-docs",    "name": "API Docs",           "description": "Interactive REST API documentation. Browse and test all backend endpoints.", "url": "/api/v1/docs", "icon": "📡", "color": "#10B981"},
    {"slug": "api-keys",    "name": "API Keys",           "description": "Manage encrypted secrets — Stripe, SendGrid, Azure AD, AI and more.",       "url": "/admin/settings/api-keys", "icon": "🔑", "color": "#EF4444"},
    {"slug": "volunteers",  "name": "Volunteers App",     "description": "Volunteer scheduling, hours tracking, and communications.",                  "url": None, "icon": "🙋", "color": "#10B981", "coming_soon": True},
    {"slug": "tv",          "name": "TV App",             "description": "Online TV channel — live bhajans / aarti / festivals + scheduled archive. Devotees watch from any browser.", "url": "https://shital.org.uk/tv", "icon": "📺", "color": "#6366F1"},
    {"slug": "smart-branch","name": "Smart Branch",       "description": "Branch-level dashboard for managers — KPIs, events, operations.",            "url": None, "icon": "🌿", "color": "#059669", "coming_soon": True},
    {"slug": "marketing",   "name": "Marketing Companion","description": "AI-powered marketing tools — newsletters, social, campaigns.",               "url": None, "icon": "📣", "color": "#F59E0B", "coming_soon": True},
    {"slug": "staff-app",   "name": "Staff App",          "description": "Mobile-first staff portal — tasks, shifts, communications.",                 "url": None, "icon": "👤", "color": "#3B82F6", "coming_soon": True},
    {"slug": "finance-companion", "name": "Finance Companion", "description": "AI finance assistant — forecasting, analysis, reporting.",              "url": None, "icon": "💰", "color": "#EF4444", "coming_soon": True},
]

ALL_ROLES = ["SUPER_ADMIN", "TRUSTEE", "ACCOUNTANT", "HR_MANAGER", "AUDITOR",
             "BRANCH_MANAGER", "STAFF", "VOLUNTEER", "DEVOTEE", "KIOSK"]

DEFAULT_PERMISSIONS: dict[str, list[str]] = {
    "admin":       ["SUPER_ADMIN", "TRUSTEE", "ACCOUNTANT", "HR_MANAGER", "AUDITOR", "BRANCH_MANAGER", "STAFF"],
    "kiosk":       ["SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER", "STAFF", "KIOSK"],
    "donate":      ["SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER", "STAFF", "KIOSK"],
    "screen":      ["SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER", "STAFF"],
    "service":     [],  # public — no restriction
    "api-docs":    ["SUPER_ADMIN", "TRUSTEE", "ACCOUNTANT"],
    "api-keys":    ["SUPER_ADMIN"],
    "volunteers":  ["SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER", "STAFF"],
    "tv":          ["SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER"],
    "smart-branch":["SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER"],
    "marketing":   ["SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER", "STAFF"],
    "staff-app":   ["SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER", "STAFF"],
    "finance-companion": ["SUPER_ADMIN", "TRUSTEE", "ACCOUNTANT"],
}


async def _load_permissions(db: Any) -> dict[str, list[str]]:
    row = await db.execute(
        text("SELECT value FROM app_settings WHERE key = 'app_permissions' LIMIT 1")
    )
    value: str | None = row.scalar()
    if value is not None:
        try:
            return json.loads(value)
        except Exception:
            pass
    return dict(DEFAULT_PERMISSIONS)


async def _save_permissions(db: Any, perms: dict[str, list[str]]) -> None:
    value = json.dumps(perms)
    await db.execute(text("""
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('app_permissions', :v, NOW())
        ON CONFLICT (key) DO UPDATE SET value = :v, updated_at = NOW()
    """), {"v": value})
    await db.commit()


@router.get("")
async def get_permissions(ctx: RequiredSpace) -> dict[str, Any]:
    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        perms = await _load_permissions(db)
    return {
        "apps": PLATFORM_APPS,
        "roles": ALL_ROLES,
        "permissions": perms,
    }


class UpdatePermissionsBody(BaseModel):
    permissions: dict[str, list[str]]


@router.put("")
async def update_permissions(body: UpdatePermissionsBody, ctx: RequiredSpace) -> dict[str, Any]:
    # Validate
    valid_slugs = {a["slug"] for a in PLATFORM_APPS}
    for slug in body.permissions:
        if slug not in valid_slugs:
            raise HTTPException(status_code=400, detail=f"Unknown app slug: {slug}")
        for role in body.permissions[slug]:
            if role not in ALL_ROLES:
                raise HTTPException(status_code=400, detail=f"Unknown role: {role}")

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await _save_permissions(db, body.permissions)

    return {"saved": True}


# ── Per-user app access overrides ────────────────────────────────────────────
# The role→app matrix above is the platform default. On top of it, an admin can
# grant or revoke a specific app for a specific user — so every app effectively
# has its own admin-managed user list. Overrides live in a second app_settings
# blob (key: app_user_overrides) => { user_id: { app_slug: bool } }. Reusing the
# existing settings store keeps this a thin layer over what already exists (no
# new table, no migration).

async def _load_overrides(db: Any) -> dict[str, dict[str, bool]]:
    row = await db.execute(
        text("SELECT value FROM app_settings WHERE key = 'app_user_overrides' LIMIT 1")
    )
    value: str | None = row.scalar()
    if value is not None:
        try:
            return json.loads(value)
        except Exception:
            pass
    return {}


async def _save_overrides(db: Any, ov: dict[str, dict[str, bool]]) -> None:
    value = json.dumps(ov)
    await db.execute(text("""
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('app_user_overrides', :v, NOW())
        ON CONFLICT (key) DO UPDATE SET value = :v, updated_at = NOW()
    """), {"v": value})
    await db.commit()


def _role_allows(app_slug: str, role: str, perms: dict[str, list[str]]) -> bool:
    """Access from the role→app matrix alone (empty allow-list = public)."""
    allowed = perms.get(app_slug, DEFAULT_PERMISSIONS.get(app_slug, []))
    if not allowed:
        return True
    return role in allowed


@router.get("/users")
async def list_app_access(ctx: RequiredSpace) -> dict[str, Any]:
    """Every user with their per-app access: the role default plus any admin
    grant/revoke override, so admins manage each app's user list from one page."""
    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        perms = await _load_permissions(db)
        overrides = await _load_overrides(db)
        rows = (await db.execute(text("""
            SELECT id::text AS id, email, name, role, branch_id, is_active
            FROM users
            WHERE deleted_at IS NULL
            ORDER BY role, name
        """))).mappings().all()

    slugs = [a["slug"] for a in PLATFORM_APPS]
    users = []
    for r in rows:
        role = r["role"] or ""
        uov = overrides.get(r["id"], {}) or {}
        role_default = {s: _role_allows(s, role, perms) for s in slugs}
        effective = {s: (bool(uov[s]) if s in uov else role_default[s]) for s in slugs}
        users.append({
            "id": r["id"], "email": r["email"], "name": r["name"],
            "role": role, "branch_id": r["branch_id"], "is_active": r["is_active"],
            "role_default": role_default,
            "overrides": uov,
            "effective": effective,
        })
    return {"apps": PLATFORM_APPS, "roles": ALL_ROLES, "users": users}


class UpdateUserAccessBody(BaseModel):
    overrides: dict[str, bool]   # { app_slug: allowed } — only the explicit grants/revokes


@router.put("/users/{user_id}")
async def update_user_access(user_id: str, body: UpdateUserAccessBody, ctx: RequiredSpace) -> dict[str, Any]:
    valid_slugs = {a["slug"] for a in PLATFORM_APPS}
    for slug in body.overrides:
        if slug not in valid_slugs:
            raise HTTPException(status_code=400, detail=f"Unknown app slug: {slug}")

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        overrides = await _load_overrides(db)
        clean = {k: bool(v) for k, v in body.overrides.items()}
        if clean:
            overrides[user_id] = clean
        else:
            overrides.pop(user_id, None)   # back to pure role defaults
        await _save_overrides(db, overrides)
    return {"saved": True, "user_id": user_id, "overrides": clean}


@router.get("/check")
async def check_access(app_slug: str, role: str, user_id: str = "") -> dict[str, Any]:
    """Quick check — is this role (and optional user) allowed to access app_slug?
    A per-user override, when present, wins over the role default."""
    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        perms = await _load_permissions(db)
        overrides = await _load_overrides(db) if user_id else {}
    uov = overrides.get(user_id, {}) if user_id else {}
    if app_slug in uov:
        return {"allowed": bool(uov[app_slug]), "public": False, "override": True}
    allowed_roles = perms.get(app_slug, DEFAULT_PERMISSIONS.get(app_slug, []))
    # Empty list = public (no restriction)
    if not allowed_roles:
        return {"allowed": True, "public": True}
    return {"allowed": role in allowed_roles, "public": False}
