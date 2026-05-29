"""
FastAPI dependency injection — current user, DigitalSpace context, DB session.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from shital.core.fabrics.config import settings
from shital.core.fabrics.constants import PERMISSIONS
from shital.core.fabrics.database import get_db
from shital.core.space.branches import resolve_branch_code
from shital.core.space.context import DigitalSpace

security = HTTPBearer(auto_error=False)


async def get_current_space(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)] = None,
    db: AsyncSession = Depends(get_db),
) -> DigitalSpace:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    role = payload.get("role", "DEVOTEE")
    # Normalise legacy "ADMIN" role → "SUPER_ADMIN" so all permission checks pass
    if role == "ADMIN":
        role = "SUPER_ADMIN"
    # Old tokens may carry a UUID; canonicalise to the short code so every
    # downstream insert that uses ctx.branch_id writes the right value.
    branch_id = await resolve_branch_code(db, payload.get("branch_id"))
    permissions = [p for p, roles in PERMISSIONS.items() if role in roles]

    import uuid
    return DigitalSpace(
        user_id=payload["sub"],
        user_email=payload["email"],
        role=role,
        branch_id=branch_id,
        permissions=permissions,
        session_id=str(uuid.uuid4()),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


# Optional auth — returns None for unauthenticated
async def get_optional_space(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)] = None,
    db: AsyncSession = Depends(get_db),
) -> DigitalSpace | None:
    if not credentials:
        import uuid
        return DigitalSpace(
            user_id="anonymous",
            user_email="anonymous@kiosk",
            role="KIOSK",
            branch_id="main",
            permissions=[],
            session_id=str(uuid.uuid4()),
            ip_address=request.client.host if request.client else None,
        )
    return await get_current_space(request, credentials, db)


CurrentSpace = Annotated[DigitalSpace, Depends(get_current_space)]
RequiredSpace = Annotated[DigitalSpace, Depends(get_current_space)]
OptionalSpace = Annotated[DigitalSpace | None, Depends(get_optional_space)]
DB = Annotated[AsyncSession, Depends(get_db)]
