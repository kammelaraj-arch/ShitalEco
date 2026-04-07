"""
Auth Capabilities — login, register, JWT, MFA, RBAC.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import bcrypt
import structlog
from jose import JWTError, jwt
from pydantic import BaseModel

from shital.core.dna.registry import Fabric, capability
from shital.core.fabrics.config import settings
from shital.core.fabrics.constants import PERMISSIONS
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt(12)).decode()


def _verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _create_access_token(user_id: str, email: str, role: str, branch_id: str | None) -> str:
    exp = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    perms = [p for p, roles in PERMISSIONS.items() if role in roles]
    payload = {
        "sub": user_id, "email": email, "role": role,
        "branch_id": branch_id, "permissions": perms,
        "exp": exp, "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _create_refresh_token(user_id: str) -> str:
    exp = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": user_id, "exp": exp, "type": "refresh"},
                      settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


class LoginInput(BaseModel):
    email: str
    password: str


class RegisterInput(BaseModel):
    email: str
    password: str
    name: str
    phone: str = ""


class VerifyTokenInput(BaseModel):
    token: str


@capability(
    name="login_with_email",
    description="Authenticate a user with email and password. Returns JWT access and refresh tokens.",
    fabric=Fabric.AUTH,
    requires=[],
    idempotent=False,
    tags=["auth"],
)
async def login_with_email(ctx: DigitalSpace, data: LoginInput) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.core.fabrics.errors import UnauthorizedError

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT id, email, name, password_hash, role, branch_id,
                       is_active, mfa_enabled
                FROM users
                WHERE email = :email AND deleted_at IS NULL
            """),
            {"email": data.email.lower()},
        )
        user = result.mappings().first()

    if not user or not user["password_hash"]:
        raise UnauthorizedError("Invalid email or password")
    if not _verify_password(data.password, user["password_hash"]):
        raise UnauthorizedError("Invalid email or password")
    if not user["is_active"]:
        raise UnauthorizedError("Account is deactivated")

    access = _create_access_token(user["id"], user["email"], user["role"], user["branch_id"])
    refresh = _create_refresh_token(user["id"])

    # Update last login
    async with SessionLocal() as db:
        await db.execute(
            text("UPDATE users SET last_login_at = :now WHERE id = :id"),
            {"now": datetime.utcnow(), "id": user["id"]},
        )
        await db.commit()

    logger.info("user_login", user_id=user["id"], email=user["email"])

    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"],
                 "role": user["role"], "branch_id": user["branch_id"]},
    }


@capability(
    name="register_devotee",
    description="Register a new devotee (public user) with email and password.",
    fabric=Fabric.AUTH,
    requires=[],
    idempotent=False,
    tags=["auth", "registration"],
)
async def register_devotee(ctx: DigitalSpace, data: RegisterInput) -> dict[str, Any]:
    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.core.fabrics.errors import ConflictError

    async with SessionLocal() as db:
        existing = await db.execute(
            text("SELECT id FROM users WHERE email = :email AND deleted_at IS NULL"),
            {"email": data.email.lower()},
        )
        if existing.scalar():
            raise ConflictError(f"Email {data.email} already registered")

        user_id = str(uuid.uuid4())
        now = datetime.utcnow()
        hashed = _hash_password(data.password)

        await db.execute(
            text("""
                INSERT INTO users
                (id, email, password_hash, name, phone, role, is_active, mfa_enabled, created_at, updated_at)
                VALUES (:id, :email, :hash, :name, :phone, 'DEVOTEE', true, false, :now, :now)
            """),
            {
                "id": user_id, "email": data.email.lower(), "hash": hashed,
                "name": data.name, "phone": data.phone or None, "now": now,
            },
        )
        await db.commit()

    return {"user_id": user_id, "email": data.email, "role": "DEVOTEE"}


@capability(
    name="verify_token",
    description="Verify and decode a JWT access token. Returns user identity and permissions.",
    fabric=Fabric.AUTH,
    requires=[],
    idempotent=True,
    tags=["auth"],
)
async def verify_token(ctx: DigitalSpace, data: VerifyTokenInput) -> dict[str, Any]:
    from shital.core.fabrics.errors import UnauthorizedError
    try:
        payload = jwt.decode(data.token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return {
            "valid": True,
            "user_id": payload["sub"],
            "email": payload["email"],
            "role": payload["role"],
            "branch_id": payload.get("branch_id"),
            "permissions": payload.get("permissions", []),
        }
    except JWTError as e:
        raise UnauthorizedError(f"Invalid token: {e}")
