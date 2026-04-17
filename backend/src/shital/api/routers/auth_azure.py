"""
Azure AD / Microsoft 365 SSO router.

Flow (SPA / MSAL popup approach):
  1. Frontend uses @azure/msal-browser to authenticate the user with Microsoft.
  2. MSAL returns an ID token (a signed JWT from Microsoft).
  3. Frontend posts the ID token to POST /auth/azure/verify-token.
  4. This endpoint validates the token against Microsoft's JWKS endpoint,
     then creates or links the user in our DB and returns our own JWT pair.

Endpoints:
  GET  /auth/azure/config          — return MSAL config (client ID, tenant) for frontend init
  POST /auth/azure/verify-token    — validate MS ID token → return our JWT
  GET  /auth/azure/login           — server-side redirect flow (alternative to MSAL popup)
  GET  /auth/azure/callback        — exchange code → tokens (server-side flow)
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from shital.core.fabrics.config import settings

router = APIRouter(prefix="/auth/azure", tags=["auth-azure"])


# ─── JWKS cache (simple in-process, refreshed if key not found) ──────────────

_jwks_cache: dict[str, Any] = {}
_jwks_fetched_at: datetime | None = None

AZURE_JWKS_URL = (
    f"https://login.microsoftonline.com/{settings.MS_TENANT_ID or 'common'}"
    "/discovery/v2.0/keys"
)


async def _get_jwks() -> dict[str, Any]:
    """Fetch and cache Microsoft's public signing keys."""
    global _jwks_cache, _jwks_fetched_at

    # Refresh at most once per 6 hours
    now = datetime.utcnow()
    if _jwks_cache and _jwks_fetched_at:
        age_hours = (now - _jwks_fetched_at).total_seconds() / 3600
        if age_hours < 6:
            return _jwks_cache

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(AZURE_JWKS_URL)
        resp.raise_for_status()
        data = resp.json()

    # Index by kid
    _jwks_cache = {k["kid"]: k for k in data.get("keys", [])}
    _jwks_fetched_at = now
    return _jwks_cache


def _build_ms_authority() -> str:
    tenant = settings.MS_TENANT_ID or "common"
    return f"https://login.microsoftonline.com/{tenant}"


# ─── Models ───────────────────────────────────────────────────────────────────

class VerifyTokenInput(BaseModel):
    id_token: str
    default_role: str = "STAFF"          # Role to assign if user is brand new


class AzureCallbackInput(BaseModel):
    code: str
    redirect_uri: str = ""


# ─── Config endpoint (frontend reads this to init MSAL) ──────────────────────

@router.get("/config")
async def azure_config():
    """Return MSAL client configuration for the admin frontend."""
    from shital.core.fabrics.secrets import SecretsManager
    client_id = await SecretsManager.get("MS_CLIENT_ID") or settings.MS_CLIENT_ID
    tenant_id = await SecretsManager.get("MS_TENANT_ID") or settings.MS_TENANT_ID
    redirect_uri = await SecretsManager.get("MS_REDIRECT_URI") or ""
    tenant = tenant_id or "common"
    return {
        "client_id": client_id,
        "authority": f"https://login.microsoftonline.com/{tenant}",
        "tenant_id": tenant,
        "scopes": ["openid", "profile", "email", "User.Read"],
        "enabled": bool(client_id and tenant_id),
        "redirect_uri": redirect_uri,  # If set, overrides the frontend-derived redirect URI
    }


# ─── Verify ID token (main SPA flow) ─────────────────────────────────────────

@router.post("/verify-token")
async def verify_azure_token(body: VerifyTokenInput):
    """
    Validate a Microsoft ID token from MSAL, create or link the user in our DB,
    and return our own JWT access + refresh tokens.
    """
    from jose import JWTError
    from jose import jwt as jose_jwt
    from sqlalchemy import text

    from shital.capabilities.auth.capabilities import _create_access_token, _create_refresh_token
    from shital.core.fabrics.database import SessionLocal
    from shital.core.fabrics.secrets import SecretsManager
    ms_client_id = await SecretsManager.get("MS_CLIENT_ID") or settings.MS_CLIENT_ID
    if not ms_client_id:
        raise HTTPException(status_code=501, detail="Azure AD SSO is not configured on this server")

    # ── 1. Decode header to get kid ───────────────────────────────────────────
    try:
        header = jose_jwt.get_unverified_header(body.id_token)
    except JWTError as e:
        raise HTTPException(status_code=400, detail=f"Invalid token header: {e}")

    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=400, detail="Token missing kid header")

    # ── 2. Fetch JWKS and find the matching key ───────────────────────────────
    jwks = await _get_jwks()
    if kid not in jwks:
        # Key might have rotated — force refresh
        global _jwks_fetched_at
        _jwks_fetched_at = None
        jwks = await _get_jwks()

    if kid not in jwks:
        raise HTTPException(status_code=401, detail="Token signing key not found")

    jwk = jwks[kid]

    # ── 3. Build RSA public key from JWK and validate the token ─────────────
    # python-jose can struggle with Microsoft's JWK format (x5c fields etc).
    # We extract the RSA public key directly using the cryptography library
    # (already a dependency) and pass the key object to jose for decoding.
    try:
        import base64 as _b64

        from cryptography.hazmat.backends import default_backend as _backend
        from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers

        def _b64url_to_int(s: str) -> int:
            s += "=" * (-len(s) % 4)
            return int.from_bytes(_b64.urlsafe_b64decode(s), "big")

        public_key = RSAPublicNumbers(
            e=_b64url_to_int(jwk["e"]),
            n=_b64url_to_int(jwk["n"]),
        ).public_key(_backend())
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Failed to build signing key: {e}")

    try:
        payload = jose_jwt.decode(
            body.id_token,
            public_key,
            algorithms=["RS256"],
            audience=ms_client_id,
            options={"verify_iss": False},   # issuer varies by tenant/flow
        )
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Token validation failed: {e}")

    # ── 4. Extract identity claims ────────────────────────────────────────────
    oid: str = payload.get("oid", "")               # Azure Object ID
    upn: str = payload.get("preferred_username", "") or payload.get("email", "")
    name: str = payload.get("name", upn)
    email: str = upn.lower().strip()

    if not oid or not email:
        raise HTTPException(status_code=400, detail="Token missing required claims (oid, preferred_username)")

    # ── 5. Find or create user ────────────────────────────────────────────────
    now = datetime.utcnow()

    async with SessionLocal() as db:
        # Try by azure_oid first (most reliable)
        result = await db.execute(
            text("SELECT id, email, name, role, branch_id, is_active FROM users WHERE azure_oid = :oid"),
            {"oid": oid},
        )
        user = result.mappings().first()

        if not user:
            # Try linking by email
            result = await db.execute(
                text("SELECT id, email, name, role, branch_id, is_active FROM users WHERE email = :email AND deleted_at IS NULL"),
                {"email": email},
            )
            existing = result.mappings().first()

            if existing:
                # Link Azure OID to existing account
                await db.execute(
                    text("""
                        UPDATE users SET azure_oid = :oid, azure_upn = :upn,
                            auth_provider = 'azure_ad', last_login_at = :now,
                            updated_at = :now
                        WHERE id = :id
                    """),
                    {"oid": oid, "upn": upn, "now": now, "id": existing["id"]},
                )
                await db.commit()
                user = existing
            else:
                # Create new user from Azure AD profile
                new_id = str(uuid.uuid4())
                role = body.default_role
                await db.execute(
                    text("""
                        INSERT INTO users
                        (id, email, name, role, azure_oid, azure_upn,
                         auth_provider, is_active, mfa_enabled,
                         last_login_at, created_at, updated_at)
                        VALUES
                        (:id, :email, :name, :role, :oid, :upn,
                         'azure_ad', TRUE, FALSE,
                         :now, :now, :now)
                    """),
                    {
                        "id": new_id, "email": email, "name": name,
                        "role": role, "oid": oid, "upn": upn, "now": now,
                    },
                )
                await db.commit()

                # Re-fetch
                result = await db.execute(
                    text("SELECT id, email, name, role, branch_id, is_active FROM users WHERE id = :id"),
                    {"id": new_id},
                )
                user = result.mappings().first()
        else:
            # Known user — update last login
            if not user["is_active"]:
                raise HTTPException(status_code=403, detail="Account is deactivated")
            await db.execute(
                text("UPDATE users SET last_login_at = :now, updated_at = :now, azure_upn = :upn WHERE id = :id"),
                {"now": now, "upn": upn, "id": user["id"]},
            )
            await db.commit()

    if not user:
        raise HTTPException(status_code=500, detail="Failed to resolve user record")

    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account is deactivated. Contact your administrator.")

    # ── 6. Issue our own JWT ──────────────────────────────────────────────────
    access = _create_access_token(user["id"], user["email"], user["role"], user["branch_id"])
    refresh = _create_refresh_token(user["id"])

    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "branch_id": user["branch_id"],
            "auth_provider": "azure_ad",
        },
    }


# ─── Server-side OAuth redirect flow (alternative to MSAL popup) ─────────────

@router.get("/login")
async def azure_login(request: Request, redirect_uri: str = ""):
    """Redirect the browser to Microsoft's authorization endpoint."""
    if not settings.MS_CLIENT_ID or not settings.MS_TENANT_ID:
        raise HTTPException(status_code=501, detail="Azure AD SSO not configured")

    callback_uri = redirect_uri or f"{request.base_url}api/v1/auth/azure/callback"
    tenant = settings.MS_TENANT_ID
    params = {
        "client_id": settings.MS_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": callback_uri,
        "scope": "openid profile email",
        "response_mode": "query",
    }
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(
        url=f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?{qs}"
    )


@router.get("/callback")
async def azure_callback(request: Request, code: str = "", error: str = "", redirect_uri: str = ""):
    """Exchange authorization code for tokens (server-side flow)."""
    if error:
        raise HTTPException(status_code=400, detail=f"Microsoft auth error: {error}")
    if not code:
        raise HTTPException(status_code=400, detail="No authorization code received")
    if not settings.MS_CLIENT_ID or not settings.MS_TENANT_ID:
        raise HTTPException(status_code=501, detail="Azure AD SSO not configured")

    callback_uri = redirect_uri or f"{request.base_url}api/v1/auth/azure/callback"
    tenant = settings.MS_TENANT_ID

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            data={
                "client_id": settings.MS_CLIENT_ID,
                "client_secret": settings.MS_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": callback_uri,
                "scope": "openid profile email",
            },
        )

    data = resp.json()
    if "error" in data:
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {data.get('error_description', data['error'])}")

    id_token = data.get("id_token", "")
    if not id_token:
        raise HTTPException(status_code=400, detail="No id_token in Microsoft response")

    # Reuse the verify endpoint logic
    return await verify_azure_token(VerifyTokenInput(id_token=id_token))
