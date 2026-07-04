"""Donor authentication for the public Service portal.

DELIBERATELY SEPARATE from staff/admin auth (auth.py / auth_azure.py). A donor
account is keyed to a row in ``contacts`` and carries role ``DONOR`` — it can
NEVER reach admin. Supports:

  • Email + password  (POST /auth/donor/register, /auth/donor/login)
  • Social login via one generic OAuth2 engine (Google, Facebook, Apple now;
    Microsoft/LinkedIn/X/WhatsApp are just more entries in _PROVIDERS later).

Each social provider is ENABLED only when its client id/secret is configured, so
the login screen shows only what's set up. On success we mint a short-lived
donor JWT and bounce the browser back to the portal with it in the URL fragment.
"""
from __future__ import annotations

import base64
import hashlib
import os
import time
import uuid
from typing import Any

import httpx
import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from jose import jwt
from pydantic import BaseModel

logger = structlog.get_logger()
router = APIRouter(prefix="/auth/donor", tags=["auth-donor"])

# Public base the OAuth providers must have registered as the redirect. The
# callback lives on the API, which is served under /api/v1 on the portal host.
_DEFAULT_API_BASE = "https://service.shital.org.uk/api/v1"
_PORTAL_ORIGIN = "https://service.shital.org.uk"
_DONOR_TOKEN_TTL = 60 * 60 * 24 * 14  # 14 days


# ── Provider registry — add a provider = add a dict entry ───────────────────────
# secret_keys: (client_id_secret_name, client_secret_name). "scope" is the OAuth
# scope. userinfo pulls email/name. Apple is special (client_secret is a signed
# JWT, and identity comes from the id_token) — handled in _exchange_and_profile.
_PROVIDERS: dict[str, dict[str, Any]] = {
    "google": {
        "label": "Google",
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "userinfo": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
        "id_env": "GOOGLE_CLIENT_ID",
        "secret_env": "GOOGLE_CLIENT_SECRET",
    },
    "facebook": {
        "label": "Facebook",
        "authorize": "https://www.facebook.com/v19.0/dialog/oauth",
        "token": "https://graph.facebook.com/v19.0/oauth/access_token",
        "userinfo": "https://graph.facebook.com/me?fields=id,name,email,first_name,last_name",
        "scope": "email public_profile",
        "id_env": "FACEBOOK_CLIENT_ID",
        "secret_env": "FACEBOOK_CLIENT_SECRET",
    },
    "microsoft": {
        "label": "Microsoft",
        # 'common' tenant → personal + work/school accounts. This is a SEPARATE
        # consumer OAuth app for public donors, NOT the admin MS_* tenant login.
        "authorize": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "userinfo": "https://graph.microsoft.com/oidc/userinfo",
        "scope": "openid email profile",
        "id_env": "DONOR_MS_CLIENT_ID",
        "secret_env": "DONOR_MS_CLIENT_SECRET",
    },
    "apple": {
        "label": "Apple",
        "authorize": "https://appleid.apple.com/auth/authorize",
        "token": "https://appleid.apple.com/auth/token",
        "userinfo": None,  # identity comes from the id_token
        "scope": "name email",
        "id_env": "APPLE_SERVICE_ID",       # the "Services ID" is the client_id
        "secret_env": "APPLE_PRIVATE_KEY",  # .p8 key body; team/key id below
    },
}


async def _secret(name: str) -> str:
    from shital.core.fabrics.secrets import SecretsManager
    # Donor-login config + OAuth credentials come STRICTLY from Admin → API
    # Keys — never from environment variables (env_fallback=False).
    return await SecretsManager.get(name, env_fallback=False) or ""


async def _provider_creds(provider: str) -> tuple[str, str]:
    cfg = _PROVIDERS[provider]
    return await _secret(cfg["id_env"]), await _secret(cfg["secret_env"])


async def _redirect_uri(provider: str) -> str:
    base = (await _secret("DONOR_AUTH_API_BASE")) or _DEFAULT_API_BASE
    return f"{base.rstrip('/')}/auth/donor/{provider}/callback"


# ── Password hashing (stdlib pbkdf2 — no extra deps) ────────────────────────────

def _hash_password(pw: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000)
    return f"pbkdf2$200000${salt.hex()}${dk.hex()}"


def _verify_password(pw: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac_compare(dk.hex(), hash_hex)
    except Exception:
        return False


def hmac_compare(a: str, b: str) -> bool:
    import hmac
    return hmac.compare_digest(a, b)


# ── Donor JWT ───────────────────────────────────────────────────────────────────

def _mint_donor_token(contact_id: str, email: str, name: str) -> str:
    from shital.core.fabrics.config import settings
    now = int(time.time())
    payload = {
        "sub": contact_id, "email": email, "name": name,
        "typ": "donor", "role": "DONOR",
        "iat": now, "exp": now + _DONOR_TOKEN_TTL,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _decode_donor_token(token: str) -> dict[str, Any]:
    from shital.core.fabrics.config import settings
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    if payload.get("typ") != "donor":
        raise HTTPException(401, detail="Not a donor token")
    return payload


def _bearer(request: Request) -> dict[str, Any]:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, detail="Missing donor token")
    try:
        return _decode_donor_token(auth[7:])
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(401, detail="Invalid donor token") from exc


# ── Schema (idempotent; keeps the feature self-contained) ───────────────────────

async def _ensure_schema() -> None:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text(
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)"))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS donor_identities (
                id          VARCHAR(40) PRIMARY KEY,
                provider    VARCHAR(30) NOT NULL,
                subject     VARCHAR(255) NOT NULL,
                contact_id  UUID NOT NULL,
                email       VARCHAR(255) NOT NULL DEFAULT '',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (provider, subject)
            )
        """))
        await db.commit()


async def _upsert_contact(email: str, first: str, surname: str,
                          password_hash: str | None = None) -> str:
    """Insert/find a contact by email, return its id."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    full = f"{first} {surname}".strip()
    now = _now()
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO contacts
                (id, email, first_name, surname, full_name,
                 gdpr_consent, gdpr_consented_at, first_source, created_at, updated_at
                 {pw_col})
            VALUES
                (:id, :email, :first, :surname, :full,
                 true, :now, 'donor-portal', :now, :now {pw_val})
            ON CONFLICT (email) DO UPDATE SET
                first_name = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
                surname    = COALESCE(NULLIF(EXCLUDED.surname,''),    contacts.surname),
                full_name  = COALESCE(NULLIF(EXCLUDED.full_name,''),  contacts.full_name),
                updated_at = EXCLUDED.updated_at
                {pw_update}
            RETURNING id
        """.format(
            pw_col=", password_hash" if password_hash else "",
            pw_val=", :pw" if password_hash else "",
            pw_update=", password_hash = COALESCE(contacts.password_hash, EXCLUDED.password_hash)" if password_hash else "",
        )), {
            "id": str(uuid.uuid4()), "email": email.lower(),
            "first": first or "", "surname": surname or "", "full": full,
            "now": now, **({"pw": password_hash} if password_hash else {}),
        })).mappings().first()
        await db.commit()
        return str(row["id"])


def _now():
    from datetime import datetime
    return datetime.utcnow()


# ── Social OAuth: providers list + login redirect + callback ────────────────────

@router.get("/providers")
async def list_providers() -> dict[str, Any]:
    """Public: which login options are configured (so the UI shows only those)."""
    out = []
    for key, cfg in _PROVIDERS.items():
        cid, sec = await _provider_creds(key)
        if cid and sec:
            out.append({"provider": key, "label": cfg["label"]})
    return {"providers": out, "email_password": True}


def _sign_state(provider: str, return_to: str) -> str:
    from shital.core.fabrics.config import settings
    return jwt.encode(
        {"p": provider, "r": return_to, "n": base64.urlsafe_b64encode(os.urandom(9)).decode(),
         "exp": int(time.time()) + 600},
        settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _read_state(state: str) -> dict[str, Any]:
    from shital.core.fabrics.config import settings
    return jwt.decode(state, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


@router.get("/{provider}/login")
async def social_login(provider: str, request: Request) -> RedirectResponse:
    if provider not in _PROVIDERS:
        raise HTTPException(404, detail="Unknown provider")
    cid, sec = await _provider_creds(provider)
    if not cid or not sec:
        raise HTTPException(503, detail=f"{provider} login is not configured")
    cfg = _PROVIDERS[provider]
    return_to = request.query_params.get("redirect") or _PORTAL_ORIGIN
    state = _sign_state(provider, return_to)
    from urllib.parse import urlencode
    params = {
        "client_id": cid, "redirect_uri": await _redirect_uri(provider),
        "response_type": "code", "scope": cfg["scope"], "state": state,
    }
    if provider == "apple":
        params["response_mode"] = "form_post"  # Apple posts the result
    return RedirectResponse(f"{cfg['authorize']}?{urlencode(params)}")


async def _apple_client_secret(service_id: str, private_key: str) -> str:
    team_id = await _secret("APPLE_TEAM_ID")
    key_id = await _secret("APPLE_KEY_ID")
    now = int(time.time())
    return jwt.encode(
        {"iss": team_id, "iat": now, "exp": now + 3600,
         "aud": "https://appleid.apple.com", "sub": service_id},
        private_key, algorithm="ES256", headers={"kid": key_id})


async def _exchange_and_profile(provider: str, code: str) -> dict[str, str]:
    """Exchange the auth code and return {subject, email, first, surname}."""
    cfg = _PROVIDERS[provider]
    cid, sec = await _provider_creds(provider)
    client_secret = sec
    if provider == "apple":
        client_secret = await _apple_client_secret(cid, sec)

    data = {
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": await _redirect_uri(provider),
        "client_id": cid, "client_secret": client_secret,
    }
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await c.post(cfg["token"], data=data,
                           headers={"Accept": "application/json"})
        tok.raise_for_status()
        tj = tok.json()

        # Apple / Google: identity is in the id_token. Facebook: call /me.
        if provider in ("apple", "google") and tj.get("id_token"):
            claims = jwt.get_unverified_claims(tj["id_token"])
            sub = str(claims.get("sub") or "")
            email = (claims.get("email") or "").lower()
            name = claims.get("name") or ""
            first = (name.split(" ")[0] if name else "") or claims.get("given_name", "")
            surname = claims.get("family_name") or (" ".join(name.split(" ")[1:]) if name else "")
            if email or sub:
                return {"subject": sub, "email": email, "first": first, "surname": surname}

        access = tj.get("access_token") or ""
        if cfg.get("userinfo") and access:
            ui = await c.get(cfg["userinfo"], headers={"Authorization": f"Bearer {access}"})
            ui.raise_for_status()
            uj = ui.json()
            return {
                "subject": str(uj.get("sub") or uj.get("id") or ""),
                "email": (uj.get("email") or "").lower(),
                "first": uj.get("given_name") or uj.get("first_name") or (uj.get("name", "").split(" ")[0]),
                "surname": uj.get("family_name") or uj.get("last_name")
                or " ".join(uj.get("name", "").split(" ")[1:]),
            }
    raise HTTPException(502, detail="Could not read profile from provider")


async def _finish_social(provider: str, code: str, state: str) -> RedirectResponse:
    try:
        st = _read_state(state)
        return_to = st.get("r") or _PORTAL_ORIGIN
    except Exception:
        return_to = _PORTAL_ORIGIN
    try:
        prof = await _exchange_and_profile(provider, code)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("donor_social_exchange_failed", provider=provider, error=str(exc))
        return RedirectResponse(f"{return_to}#donor_error=login_failed")

    email = prof.get("email") or ""
    subject = prof.get("subject") or ""
    if not email and not subject:
        return RedirectResponse(f"{return_to}#donor_error=no_identity")

    await _ensure_schema()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    # If we've seen this provider+subject, reuse its contact; else upsert by email.
    contact_id = ""
    async with SessionLocal() as db:
        if subject:
            r = (await db.execute(text(
                "SELECT contact_id::text AS cid FROM donor_identities WHERE provider=:p AND subject=:s"
            ), {"p": provider, "s": subject})).mappings().first()
            if r:
                contact_id = r["cid"]
    if not contact_id:
        contact_id = await _upsert_contact(email or f"{subject}@{provider}.local",
                                           prof.get("first") or "", prof.get("surname") or "")
        if subject:
            async with SessionLocal() as db:
                await db.execute(text("""
                    INSERT INTO donor_identities (id, provider, subject, contact_id, email)
                    VALUES (:id, :p, :s, CAST(:cid AS uuid), :em)
                    ON CONFLICT (provider, subject) DO NOTHING
                """), {"id": str(uuid.uuid4()), "p": provider, "s": subject,
                       "cid": contact_id, "em": email})
                await db.commit()

    token = _mint_donor_token(contact_id, email, f"{prof.get('first','')} {prof.get('surname','')}".strip())
    return RedirectResponse(f"{return_to}#donor_token={token}")


@router.get("/{provider}/callback")
async def social_callback_get(provider: str, request: Request) -> RedirectResponse:
    code = request.query_params.get("code") or ""
    state = request.query_params.get("state") or ""
    if not code:
        return RedirectResponse(f"{_PORTAL_ORIGIN}#donor_error=cancelled")
    return await _finish_social(provider, code, state)


@router.post("/{provider}/callback")
async def social_callback_post(provider: str, request: Request) -> RedirectResponse:
    # Apple uses response_mode=form_post.
    form = await request.form()
    code = str(form.get("code") or "")
    state = str(form.get("state") or "")
    if not code:
        return RedirectResponse(f"{_PORTAL_ORIGIN}#donor_error=cancelled")
    return await _finish_social(provider, code, state)


# ── Email + password ────────────────────────────────────────────────────────────

class RegisterBody(BaseModel):
    email: str
    password: str
    first_name: str = ""
    surname: str = ""


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/register")
async def register(body: RegisterBody) -> dict[str, Any]:
    email = body.email.strip().lower()
    if "@" not in email or len(body.password) < 8:
        raise HTTPException(400, detail="Valid email and 8+ char password required")
    await _ensure_schema()
    contact_id = await _upsert_contact(email, body.first_name, body.surname,
                                       password_hash=_hash_password(body.password))
    token = _mint_donor_token(contact_id, email, f"{body.first_name} {body.surname}".strip())
    return {"token": token, "email": email}


@router.post("/login")
async def login(body: LoginBody) -> dict[str, Any]:
    email = body.email.strip().lower()
    await _ensure_schema()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        r = (await db.execute(text(
            "SELECT id::text AS id, full_name, password_hash FROM contacts WHERE lower(email)=:e"
        ), {"e": email})).mappings().first()
    if not r or not r["password_hash"] or not _verify_password(body.password, r["password_hash"]):
        raise HTTPException(401, detail="Invalid email or password")
    return {"token": _mint_donor_token(r["id"], email, r["full_name"] or ""), "email": email}


# ── Session + "My Giving" ───────────────────────────────────────────────────────

@router.get("/me")
async def me(request: Request) -> dict[str, Any]:
    claims = _bearer(request)
    return {"contact_id": claims["sub"], "email": claims.get("email"), "name": claims.get("name")}


@router.get("/giving")
async def my_giving(request: Request) -> dict[str, Any]:
    """The logged-in donor's recurring subscriptions + recent donations."""
    claims = _bearer(request)
    cid = claims["sub"]
    email = (claims.get("email") or "").lower()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        subs = (await db.execute(text("""
            SELECT id::text AS id, COALESCE(payment_provider,'paypal') AS provider,
                   amount, frequency, status, branch_id, created_at, last_payment_at
            FROM recurring_giving_subscriptions
            WHERE contact_id = CAST(:cid AS uuid)
               OR (:email <> '' AND lower(donor_email) = :email)
            ORDER BY created_at DESC LIMIT 50
        """), {"cid": cid, "email": email})).mappings().all()
        dons = (await db.execute(text("""
            SELECT id::text AS id, amount, payment_provider, purpose, status,
                   branch_id, created_at
            FROM donations
            WHERE (contact_id = CAST(:cid AS uuid)) AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 100
        """), {"cid": cid})).mappings().all()
    return {
        "subscriptions": [dict(s) for s in subs],
        "donations": [dict(d) for d in dons],
    }


@router.get("/volunteering")
async def my_volunteering(request: Request) -> dict[str, Any]:
    """The logged-in donor's volunteer registration(s) + progress, matched by
    contact or email — so a volunteer who signs in sees their own dashboard."""
    claims = _bearer(request)
    cid = claims["sub"]
    email = (claims.get("email") or "").lower()
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT reference_number AS reference, COALESCE(stage, 0) AS stage,
                   status, branch_id, created_at,
                   first_names, last_name, email, mobile, phone, address, postcode,
                   ec_full_name, ec_mobile, ec_phone,
                   (ec_full_name <> '' AND (ec_mobile <> '' OR ec_phone <> '')) AS has_emergency_contact,
                   (ref1_first_names <> '' AND ref2_first_names <> '' AND confidentiality_agreed) AS has_references
            FROM volunteers
            WHERE (contact_id = CAST(:cid AS uuid))
               OR (:email <> '' AND lower(email) = :email)
            ORDER BY created_at DESC LIMIT 20
        """), {"cid": cid, "email": email})).mappings().all()
    return {"applications": [dict(r) for r in rows]}


# Fields a volunteer may self-edit from the service portal "My Account".
# References + safeguarding data are NOT self-editable here (they go through
# the guided registration ladder); this is just contact + emergency details.
_VOL_EDITABLE = (
    "first_names", "last_name", "mobile", "phone", "address", "postcode",
    "ec_full_name", "ec_mobile", "ec_phone",
)


class VolunteerDetailsUpdate(BaseModel):
    first_names: str | None = None
    last_name: str | None = None
    mobile: str | None = None
    phone: str | None = None
    address: str | None = None
    postcode: str | None = None
    ec_full_name: str | None = None
    ec_mobile: str | None = None
    ec_phone: str | None = None


@router.patch("/volunteer/{reference}")
async def update_my_volunteer_details(reference: str, body: VolunteerDetailsUpdate, request: Request) -> dict[str, Any]:
    """Let a signed-in volunteer update their own contact + emergency-contact
    details. Scoped to the donor's own record (contact or email match). Adding
    an emergency contact here advances them to Stage 1 automatically."""
    claims = _bearer(request)
    cid = claims["sub"]
    email = (claims.get("email") or "").lower()
    updates = {k: (v.strip() if isinstance(v, str) else v)
               for k, v in body.model_dump().items() if v is not None and k in _VOL_EDITABLE}
    if not updates:
        return {"ok": True, "unchanged": True}
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        owned = (await db.execute(text("""
            SELECT id::text AS id FROM volunteers
            WHERE reference_number = :ref
              AND ((contact_id = CAST(:cid AS uuid)) OR (:email <> '' AND lower(email) = :email))
            LIMIT 1
        """), {"ref": reference, "cid": cid, "email": email})).mappings().first()
        if not owned:
            raise HTTPException(status_code=404, detail="Volunteer record not found for your account.")
        set_sql = ", ".join(f"{col} = :{col}" for col in updates)
        await db.execute(text(f"UPDATE volunteers SET {set_sql} WHERE id = CAST(:id AS uuid)"),
                         {**updates, "id": owned["id"]})
        # Recompute the progression stage from the fresh row (emergency contact
        # → Stage 1; two references + confidentiality → Stage 2). Never downgrade
        # someone who already earned references.
        row = (await db.execute(text("""
            SELECT (ec_full_name <> '' AND (ec_mobile <> '' OR ec_phone <> '')) AS ec_ok,
                   (ref1_first_names <> '' AND ref2_first_names <> '' AND confidentiality_agreed) AS refs_ok
            FROM volunteers WHERE id = CAST(:id AS uuid)
        """), {"id": owned["id"]})).mappings().first()
        stage = 2 if (row and row["ec_ok"] and row["refs_ok"]) else (1 if (row and row["ec_ok"]) else 0)
        await db.execute(text("UPDATE volunteers SET stage = :st WHERE id = CAST(:id AS uuid)"),
                         {"st": stage, "id": owned["id"]})
        await db.commit()
    return {"ok": True, "stage": stage}
