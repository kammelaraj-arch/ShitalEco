"""Auth router — login, register, token refresh."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import uuid

from shital.core.space.context import DigitalSpace
from shital.capabilities.auth.capabilities import login_with_email, register_devotee, LoginInput, RegisterInput

router = APIRouter(prefix="/auth", tags=["auth"])


def _anon_space(request: Request) -> DigitalSpace:
    return DigitalSpace(
        user_id="anonymous", user_email="anon@public", role="DEVOTEE",
        branch_id="main", permissions=[], session_id=str(uuid.uuid4()),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


@router.post("/login")
async def login(body: LoginInput, request: Request):
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
    from jose import jwt, JWTError
    from shital.core.fabrics.config import settings
    from shital.capabilities.auth.capabilities import _create_access_token
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

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
