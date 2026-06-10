"""
Users & Roles router — admin management of user accounts and role assignment.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import RequiredSpace

router = APIRouter(prefix="/users", tags=["users"])

# Hardcoded system roles — these gate code paths (auth checks, kiosk
# bootstrap, public devotee self-service) so they always exist regardless
# of what's in board_roles. The dynamic list below is the full union.
_SYSTEM_ROLES: set[str] = {
    "SUPER_ADMIN", "TRUSTEE", "ACCOUNTANT", "HR_MANAGER",
    "BRANCH_MANAGER", "STAFF", "VOLUNTEER", "DEVOTEE", "KIOSK", "AUDITOR",
    # Common roles also surfaced through board_roles, listed here too as a
    # safety net in case the table is empty on first-deploy.
    "CHAIR", "CEO", "TREASURER", "SECRETARY",
    "LMC_CHAIR", "LMC_TREASURER", "LMC_MEMBER",
    "EXTERNAL_CONTRACTOR", "TEMP_WORKER",
}


async def _valid_roles() -> set[str]:
    """Return every role assignable on the user form. Union of the static
    system roles + every active row in board_roles (so roles added through
    Admin → Users & Roles flow into validation without a redeploy)."""
    roles = set(_SYSTEM_ROLES)
    try:
        from sqlalchemy import text

        from shital.core.fabrics.database import SessionLocal
        async with SessionLocal() as db:
            rows = (await db.execute(text(
                "SELECT code FROM board_roles WHERE is_active = true"
            ))).all()
        roles.update(r[0] for r in rows if r[0])
    except Exception:  # noqa: BLE001 — table may not exist on first boot
        pass
    return roles


# Kept as a property-style alias so any older imports of `VALID_ROLES`
# still work (mostly tests and admin tooling). The async _valid_roles()
# is the source of truth at request time.
VALID_ROLES = sorted(_SYSTEM_ROLES)


def _row(row: Any) -> dict:
    from decimal import Decimal
    from uuid import UUID as _UUID
    d = dict(row)
    d.pop("password_hash", None)  # never expose password hash
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
        elif isinstance(v, _UUID):
            d[k] = str(v)
        elif isinstance(v, Decimal):
            d[k] = float(v)
    return d


# ─── List ─────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_users(
    ctx: RequiredSpace,
    role: str = "",
    branch_id: str = "",
    search: str = "",
    active_only: bool = True,
):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    conditions = ["deleted_at IS NULL"]
    params: dict[str, Any] = {}

    if active_only:
        conditions.append("is_active = TRUE")
    if role:
        conditions.append("role = :role")
        params["role"] = role
    if branch_id:
        conditions.append("branch_id = :branch_id")
        params["branch_id"] = branch_id
    if search:
        conditions.append("(name ILIKE :search OR email ILIKE :search)")
        params["search"] = f"%{search}%"

    where = " AND ".join(conditions)

    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT id, email, name, phone, role, branch_id,
                       is_active, mfa_enabled, last_login_at,
                       azure_oid, azure_upn, auth_provider,
                       created_at, updated_at
                FROM users
                WHERE {where}
                ORDER BY role, name
            """),
            params,
        )
        rows = result.mappings().all()

    return {"users": [_row(r) for r in rows], "total": len(rows)}


# ─── Get one ──────────────────────────────────────────────────────────────────

@router.get("/{user_id}")
async def get_user(user_id: str, ctx: RequiredSpace):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT id, email, name, phone, role, branch_id,
                       is_active, mfa_enabled, last_login_at,
                       azure_oid, azure_upn, auth_provider,
                       created_at, updated_at
                FROM users WHERE id = :id AND deleted_at IS NULL
            """),
            {"id": user_id},
        )
        row = result.mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return _row(row)


# ─── Create ───────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str
    name: str
    role: str = "STAFF"
    branch_id: str = ""
    phone: str = ""
    password: str = ""   # optional — Azure AD users don't need one


@router.post("/")
async def create_user(body: UserCreate, ctx: RequiredSpace):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    valid = await _valid_roles()
    if body.role not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid role. Choose from: {', '.join(sorted(valid))}")

    user_id = str(uuid.uuid4())
    now = datetime.utcnow()

    password_hash = None
    if body.password:
        import bcrypt
        password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt(12)).decode()

    async with SessionLocal() as db:
        existing = await db.execute(
            text("SELECT id FROM users WHERE email = :email AND deleted_at IS NULL"),
            {"email": body.email.lower()},
        )
        if existing.scalar():
            raise HTTPException(status_code=409, detail="Email already registered")

        await db.execute(
            text("""
                INSERT INTO users
                (id, email, name, phone, role, branch_id,
                 password_hash, is_active, mfa_enabled,
                 auth_provider, created_at, updated_at)
                VALUES
                (:id, :email, :name, :phone, :role, :branch_id,
                 :password_hash, TRUE, FALSE,
                 'local', :now, :now)
            """),
            {
                "id": user_id, "email": body.email.lower(), "name": body.name,
                "phone": body.phone or None, "role": body.role,
                "branch_id": body.branch_id or None,
                "password_hash": password_hash, "now": now,
            },
        )
        await db.commit()

    return {"user_id": user_id, "email": body.email, "role": body.role, "created": True}


# ─── Update role ──────────────────────────────────────────────────────────────

class RoleUpdate(BaseModel):
    role: str
    branch_id: str | None = None


@router.put("/{user_id}/role")
async def update_role(user_id: str, body: RoleUpdate, ctx: RequiredSpace):
    valid = await _valid_roles()
    if body.role not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid role. Choose from: {', '.join(sorted(valid))}")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.utcnow()
    fields: dict[str, Any] = {"role": body.role, "updated_at": now, "id": user_id}
    extra = ""
    if body.branch_id is not None:
        extra = ", branch_id = :branch_id"
        fields["branch_id"] = body.branch_id or None

    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                UPDATE users SET role = :role, updated_at = :updated_at{extra}
                WHERE id = :id AND deleted_at IS NULL
                RETURNING id
            """),
            fields,
        )
        row = result.first()
        await db.commit()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"user_id": user_id, "role": body.role, "updated": True}


# ─── Toggle active ────────────────────────────────────────────────────────────

@router.put("/{user_id}/toggle-active")
async def toggle_active(user_id: str, ctx: RequiredSpace):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.utcnow()
    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                UPDATE users
                SET is_active = NOT is_active, updated_at = :now
                WHERE id = :id AND deleted_at IS NULL
                RETURNING id, is_active
            """),
            {"now": now, "id": user_id},
        )
        row = result.mappings().first()
        await db.commit()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"user_id": user_id, "is_active": row["is_active"]}


# ─── Change password ─────────────────────────────────────────────────────────

class PasswordChange(BaseModel):
    new_password: str


@router.put("/{user_id}/password")
async def change_password(user_id: str, body: PasswordChange, ctx: RequiredSpace):
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    import bcrypt
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    password_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt(12)).decode()
    now = datetime.utcnow()

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                UPDATE users
                SET password_hash = :hash, auth_provider = 'local', updated_at = :now
                WHERE id = :id AND deleted_at IS NULL
                RETURNING id
            """),
            {"hash": password_hash, "now": now, "id": user_id},
        )
        row = result.first()
        await db.commit()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"user_id": user_id, "updated": True}


# ─── Delete (soft) ────────────────────────────────────────────────────────────

@router.delete("/{user_id}")
async def delete_user(user_id: str, ctx: RequiredSpace):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.utcnow()
    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                UPDATE users SET deleted_at = :now, is_active = FALSE, updated_at = :now
                WHERE id = :id AND deleted_at IS NULL
                RETURNING id
            """),
            {"now": now, "id": user_id},
        )
        row = result.first()
        await db.commit()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"user_id": user_id, "deleted": True}
