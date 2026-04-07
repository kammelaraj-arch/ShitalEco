"""
API Keys management router — encrypted secret storage, admin only.

All write/read-value endpoints require:
  1. A valid JWT with role SUPER_ADMIN or ADMIN
  2. The admin PIN in the X-Admin-Pin header

List endpoint (metadata only, no values) requires only a valid admin JWT.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(prefix="/settings/api-keys", tags=["api-keys"])

_ALLOWED_ROLES = {"SUPER_ADMIN", "ADMIN"}


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in _ALLOWED_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Requires SUPER_ADMIN or ADMIN role")


async def _verify_pin_or_raise(pin: str | None) -> None:
    if not pin:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Admin PIN required (X-Admin-Pin header)")
    from shital.core.fabrics.secrets import SecretsManager
    if not await SecretsManager.verify_pin(pin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Incorrect admin PIN")


# ── List all keys (metadata only — no values) ──────────────────────────────────

@router.get("")
async def list_api_keys(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from shital.core.fabrics.secrets import SecretsManager
    keys = await SecretsManager.list_keys()
    return {"keys": keys}


# ── Get a single key value (PIN required) ─────────────────────────────────────

@router.get("/{key_name}/value")
async def get_key_value(
    key_name: str,
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_admin(ctx)
    await _verify_pin_or_raise(x_admin_pin)
    from shital.core.fabrics.secrets import SecretsManager
    value = await SecretsManager.get(key_name)
    return {"key_name": key_name, "value": value}


# ── Set / update a key value (PIN required) ───────────────────────────────────

class SetKeyInput(BaseModel):
    value: str
    description: str = ""
    group_name: str = ""


@router.put("/{key_name}")
async def set_key_value(
    key_name: str,
    body: SetKeyInput,
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_admin(ctx)
    await _verify_pin_or_raise(x_admin_pin)

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.core.fabrics.secrets import SecretsManager

    # Update metadata fields if provided
    if body.description or body.group_name:
        async with SessionLocal() as db:
            if body.description:
                await db.execute(
                    text("UPDATE api_keys_store SET description = :d WHERE key_name = :k"),
                    {"d": body.description, "k": key_name},
                )
            if body.group_name:
                await db.execute(
                    text("UPDATE api_keys_store SET group_name = :g WHERE key_name = :k"),
                    {"g": body.group_name, "k": key_name},
                )
            await db.commit()

    await SecretsManager.set(key_name, body.value, updated_by=ctx.user_email)
    return {"updated": True, "key_name": key_name}


# ── Delete a key (PIN required) ────────────────────────────────────────────────

@router.delete("/{key_name}")
async def delete_key(
    key_name: str,
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_admin(ctx)
    await _verify_pin_or_raise(x_admin_pin)
    from shital.core.fabrics.secrets import SecretsManager
    await SecretsManager.delete(key_name)
    return {"deleted": True, "key_name": key_name}


# ── Verify PIN (returns ok:true/false — no sensitive data leaked) ──────────────

class PinInput(BaseModel):
    pin: str


@router.post("/verify-pin")
async def verify_pin(body: PinInput, ctx: CurrentSpace) -> dict[str, bool]:
    _require_admin(ctx)
    from shital.core.fabrics.secrets import SecretsManager
    ok = await SecretsManager.verify_pin(body.pin)
    return {"ok": ok}


# ── Change PIN (current PIN required) ─────────────────────────────────────────

class ChangePinInput(BaseModel):
    current_pin: str
    new_pin: str


@router.post("/change-pin")
async def change_pin(body: ChangePinInput, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from shital.core.fabrics.secrets import SecretsManager
    if not await SecretsManager.verify_pin(body.current_pin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Current PIN is incorrect")
    if len(body.new_pin) < 4:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="PIN must be at least 4 digits")
    await SecretsManager.set_pin(body.new_pin)
    return {"changed": True}
