"""Auth router — login, register, token refresh."""
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shital.capabilities.auth.capabilities import (
    LoginInput,
    RegisterInput,
    login_with_email,
    register_devotee,
)
from shital.core.space.context import DigitalSpace

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Hardcoded super-admin fallback (works even if DB is not yet migrated) ──────
_SUPER_ADMIN_EMAIL = "admin@shital.org"
_SUPER_ADMIN_PASS  = "ShitalAdmin2026!"


def _anon_space(request: Request) -> DigitalSpace:
    return DigitalSpace(
        user_id="anonymous", user_email="anon@public", role="DEVOTEE",
        branch_id="main", permissions=[], session_id=str(uuid.uuid4()),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


def _super_admin_token() -> dict:
    """Return a valid JWT pair for the built-in super admin."""
    from shital.capabilities.auth.capabilities import _create_access_token, _create_refresh_token
    admin_id = "00000000-0000-0000-0000-000000000001"
    access  = _create_access_token(admin_id, _SUPER_ADMIN_EMAIL, "SUPER_ADMIN", "main")
    refresh = _create_refresh_token(admin_id)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": 3600,
        "user": {
            "id": admin_id,
            "email": _SUPER_ADMIN_EMAIL,
            "name": "Super Admin",
            "role": "SUPER_ADMIN",
            "branch_id": "main",
            "auth_provider": "password",
        },
    }


@router.post("/login")
async def login(body: LoginInput, request: Request):
    # Super admin bypass — works without DB
    if body.email == _SUPER_ADMIN_EMAIL and body.password == _SUPER_ADMIN_PASS:
        return _super_admin_token()
    ctx = _anon_space(request)
    return await login_with_email(ctx, body)


@router.post("/register")
async def register(body: RegisterInput, request: Request):
    ctx = _anon_space(request)
    return await register_devotee(ctx, body)


class RefreshInput(BaseModel):
    refresh_token: str


@router.post("/refresh")
async def refresh(body: RefreshInput):
    from jose import JWTError, jwt
    from sqlalchemy import text

    from shital.capabilities.auth.capabilities import _create_access_token
    from shital.core.fabrics.config import settings
    from shital.core.fabrics.database import SessionLocal

    try:
        payload = jwt.decode(body.refresh_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid refresh token")
        user_id = payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    async with SessionLocal() as db:
        result = await db.execute(
            text("SELECT id, email, role, branch_id, is_active FROM users WHERE id = :id"),
            {"id": user_id},
        )
        user = result.mappings().first()

    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="User not found")

    access = _create_access_token(user["id"], user["email"], user["role"], user["branch_id"])
    return {"access_token": access, "token_type": "bearer"}
