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
settings_router = APIRouter(prefix="/settings", tags=["settings"])

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
    is_sensitive: bool = True


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

    # Upsert metadata — ensures new custom keys get their group/description even if
    # they weren't pre-seeded into api_keys_store by KNOWN_KEYS.
    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO api_keys_store (key_name, description, group_name, is_sensitive)
                VALUES (:k, :d, :g, :s)
                ON CONFLICT (key_name) DO UPDATE
                  SET description = CASE WHEN :d != '' THEN :d ELSE api_keys_store.description END,
                      group_name  = CASE WHEN :g != '' THEN :g ELSE api_keys_store.group_name  END
            """),
            {"k": key_name, "d": body.description or "", "g": body.group_name or "", "s": body.is_sensitive},
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


# ── Reset PIN to default (SUPER_ADMIN only) ───────────────────────────────────

@router.post("/reset-pin")
async def reset_pin(ctx: CurrentSpace) -> dict[str, Any]:
    if ctx.role != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="SUPER_ADMIN role required to reset PIN")
    from shital.core.fabrics.secrets import SecretsManager
    await SecretsManager.set_pin("1234")
    return {"ok": True, "message": "PIN has been reset to 1234"}


# ── Address provider setting ───────────────────────────────────────────────────

class AddressProviderInput(BaseModel):
    provider: str   # "getaddress" | "ideal_postcodes"


@settings_router.get("/address-provider")
async def get_address_provider(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from shital.core.fabrics.secrets import SecretsManager
    provider = await SecretsManager.get("ADDRESS_LOOKUP_PROVIDER", fallback="getaddress")
    return {"provider": provider or "getaddress"}


@settings_router.post("/address-provider")
async def set_address_provider(body: AddressProviderInput, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if body.provider not in ("getaddress", "ideal_postcodes"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="provider must be 'getaddress' or 'ideal_postcodes'")
    from shital.core.fabrics.secrets import SecretsManager
    await SecretsManager.set("ADDRESS_LOOKUP_PROVIDER", body.provider, updated_by=ctx.user_email)
    return {"ok": True, "provider": body.provider}


# ── Azure Blob Storage backup settings ────────────────────────────────────────

class AzureBackupInput(BaseModel):
    connection_string: str
    container: str


@settings_router.get("/azure-backup")
async def get_azure_backup_config(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from shital.core.fabrics.secrets import SecretsManager
    conn = await SecretsManager.get("AZURE_STORAGE_CONNECTION_STRING")
    container = await SecretsManager.get("AZURE_STORAGE_CONTAINER", fallback="shitaleco-backups")
    return {
        "connection_string_set": bool(conn),
        "container": container or "shitaleco-backups",
    }


@settings_router.post("/azure-backup")
async def set_azure_backup_config(
    body: AzureBackupInput,
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_admin(ctx)
    await _verify_pin_or_raise(x_admin_pin)
    from shital.core.fabrics.secrets import SecretsManager
    if body.connection_string:
        await SecretsManager.set(
            "AZURE_STORAGE_CONNECTION_STRING", body.connection_string,
            updated_by=ctx.user_email,
        )
    if body.container:
        await SecretsManager.set(
            "AZURE_STORAGE_CONTAINER", body.container,
            updated_by=ctx.user_email,
        )
    await _write_azure_creds_env(body.connection_string or "", body.container or "shitaleco-backups")
    return {"ok": True}


@settings_router.delete("/azure-backup")
async def clear_azure_backup_config(
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_admin(ctx)
    await _verify_pin_or_raise(x_admin_pin)
    from shital.core.fabrics.secrets import SecretsManager
    await SecretsManager.delete("AZURE_STORAGE_CONNECTION_STRING")
    await SecretsManager.delete("AZURE_STORAGE_CONTAINER")
    await _write_azure_creds_env("", "")
    return {"ok": True}


@settings_router.post("/azure-backup/test")
async def test_azure_backup_connection(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    import asyncio

    from shital.core.fabrics.secrets import SecretsManager

    conn = await SecretsManager.get("AZURE_STORAGE_CONNECTION_STRING")
    container = await SecretsManager.get("AZURE_STORAGE_CONTAINER", fallback="shitaleco-backups") or "shitaleco-backups"
    if not conn:
        return {"ok": False, "error": "Azure Storage connection string is not configured"}

    def _test_sync() -> dict[str, Any]:
        from azure.storage.blob import BlobServiceClient
        client = BlobServiceClient.from_connection_string(conn)
        cc = client.get_container_client(container)
        if not cc.exists():
            cc.create_container()
        test_blob = "shital-connectivity-test.txt"
        cc.upload_blob(test_blob, b"ShitalEco backup connectivity test", overwrite=True)
        cc.delete_blob(test_blob)
        return {"ok": True, "message": f"Connected successfully to container '{container}'"}

    try:
        return await asyncio.get_event_loop().run_in_executor(None, _test_sync)
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:300]}


_AZURE_CREDS_FILE = "/opt/shitaleco/backups/.azure-creds.env"


async def _write_azure_creds_env(conn_str: str, container: str) -> None:
    """Write (or clear) Azure credentials to a file readable by backup.sh."""
    import asyncio
    import os

    def _write() -> None:
        os.makedirs(os.path.dirname(_AZURE_CREDS_FILE), exist_ok=True)
        with open(_AZURE_CREDS_FILE, "w") as f:
            if conn_str:
                f.write(f"AZURE_STORAGE_CONNECTION_STRING={conn_str}\n")
            if container:
                f.write(f"AZURE_STORAGE_CONTAINER={container}\n")
        os.chmod(_AZURE_CREDS_FILE, 0o600)

    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _write)
    except Exception:
        pass
