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


@settings_router.get("/azure-backup/list")
async def list_azure_backups(ctx: CurrentSpace, limit: int = 50) -> dict[str, Any]:
    """List blobs in the Azure container, newest first."""
    _require_admin(ctx)
    import asyncio

    from shital.core.fabrics.secrets import SecretsManager

    conn = await SecretsManager.get("AZURE_STORAGE_CONNECTION_STRING")
    container = await SecretsManager.get("AZURE_STORAGE_CONTAINER", fallback="shitaleco-backups") or "shitaleco-backups"
    if not conn:
        return {"ok": False, "error": "Azure Storage connection string is not configured", "blobs": []}

    def _list_sync() -> dict[str, Any]:
        from azure.storage.blob import BlobServiceClient
        client = BlobServiceClient.from_connection_string(conn)
        cc = client.get_container_client(container)
        if not cc.exists():
            return {"ok": True, "blobs": [], "container": container}
        items = []
        for b in cc.list_blobs():
            items.append({
                "name": b.name,
                "size": int(b.size or 0),
                "last_modified": b.last_modified.isoformat() if b.last_modified else None,
                "tier": getattr(b, "blob_tier", None) or "",
            })
        items.sort(key=lambda x: x["last_modified"] or "", reverse=True)
        return {"ok": True, "blobs": items[:limit], "total": len(items), "container": container}

    try:
        return await asyncio.get_event_loop().run_in_executor(None, _list_sync)
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:300], "blobs": []}


@settings_router.get("/azure-backup/health")
async def azure_backup_health(ctx: CurrentSpace) -> dict[str, Any]:
    """Health summary: latest backup age, Azure config state, recent failures."""
    _require_admin(ctx)
    import asyncio
    import os
    from datetime import datetime, timedelta, timezone

    from shital.core.fabrics.secrets import SecretsManager

    conn = await SecretsManager.get("AZURE_STORAGE_CONNECTION_STRING")
    container = await SecretsManager.get("AZURE_STORAGE_CONTAINER", fallback="shitaleco-backups") or "shitaleco-backups"

    out: dict[str, Any] = {
        "configured": bool(conn),
        "container": container,
        "local": {"daily_count": 0, "latest_local": None, "latest_size": 0},
        "azure": {"latest_blob": None, "latest_at": None, "blob_count": 0},
        "log": {"last_success": None, "last_failure": None, "recent_failures": 0},
        "status": "unknown",
    }

    def _read_local() -> None:
        daily_dir = "/opt/shitaleco/backups/daily"
        if not os.path.isdir(daily_dir):
            return
        files = [
            (f, os.path.getmtime(os.path.join(daily_dir, f)), os.path.getsize(os.path.join(daily_dir, f)))
            for f in os.listdir(daily_dir) if f.endswith(".sql.gz")
        ]
        out["local"]["daily_count"] = len(files)
        if files:
            files.sort(key=lambda x: x[1], reverse=True)
            latest = files[0]
            out["local"]["latest_local"] = datetime.fromtimestamp(latest[1], tz=timezone.utc).isoformat()
            out["local"]["latest_size"] = latest[2]

    def _read_log() -> None:
        log_path = "/opt/shitaleco/backups/backup.log"
        if not os.path.exists(log_path):
            return
        try:
            with open(log_path, errors="ignore") as f:
                # Last ~80 KB is plenty for recent activity
                f.seek(0, os.SEEK_END)
                size = f.tell()
                f.seek(max(0, size - 80_000))
                tail = f.read().splitlines()
        except Exception:
            return
        recent_failures = 0
        last_success = None
        last_failure = None
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        for line in tail:
            ts = line[1:20] if len(line) > 21 and line[0] == "[" else None
            try:
                when = datetime.fromisoformat(ts).replace(tzinfo=timezone.utc) if ts else None
            except Exception:
                when = None
            if "Uploaded to azure" in line:
                last_success = (ts, line)
            elif "Azure upload failed" in line or "ERROR" in line:
                last_failure = (ts, line)
                if when and when > cutoff:
                    recent_failures += 1
        if last_success:
            out["log"]["last_success"] = {"at": last_success[0], "line": last_success[1][-200:]}
        if last_failure:
            out["log"]["last_failure"] = {"at": last_failure[0], "line": last_failure[1][-200:]}
        out["log"]["recent_failures"] = recent_failures

    def _read_azure() -> None:
        if not conn:
            return
        try:
            from azure.storage.blob import BlobServiceClient
            client = BlobServiceClient.from_connection_string(conn)
            cc = client.get_container_client(container)
            if not cc.exists():
                return
            latest = None
            count = 0
            for b in cc.list_blobs():
                count += 1
                if b.last_modified and (latest is None or b.last_modified > latest[1]):
                    latest = (b.name, b.last_modified)
            out["azure"]["blob_count"] = count
            if latest:
                out["azure"]["latest_blob"] = latest[0]
                out["azure"]["latest_at"] = latest[1].isoformat()
        except Exception as exc:
            out["azure"]["error"] = str(exc)[:200]

    def _gather() -> None:
        _read_local()
        _read_log()
        _read_azure()

    try:
        await asyncio.get_event_loop().run_in_executor(None, _gather)
    except Exception as exc:
        out["error"] = str(exc)[:200]

    # Compute overall status
    now = datetime.now(timezone.utc)
    healthy = True
    reasons: list[str] = []
    latest_local = out["local"]["latest_local"]
    latest_at = out["azure"]["latest_at"]

    if not out["local"]["daily_count"]:
        healthy = False
        reasons.append("no local backups present")
    elif latest_local:
        try:
            age_h = (now - datetime.fromisoformat(latest_local.replace("Z", "+00:00"))).total_seconds() / 3600
            if age_h > 30:
                healthy = False
                reasons.append(f"latest local backup is {age_h:.0f}h old (>30h)")
        except Exception:
            pass

    if conn:
        if not latest_at:
            healthy = False
            reasons.append("Azure container has no blobs yet")
        else:
            try:
                age_h = (now - datetime.fromisoformat(latest_at.replace("Z", "+00:00"))).total_seconds() / 3600
                if age_h > 30:
                    healthy = False
                    reasons.append(f"latest Azure upload is {age_h:.0f}h old (>30h)")
            except Exception:
                pass

    if out["log"]["recent_failures"] > 2:
        healthy = False
        reasons.append(f"{out['log']['recent_failures']} upload failures in last 7 days")

    out["status"] = "healthy" if healthy else "degraded"
    out["reasons"] = reasons
    return out


_AZURE_CREDS_FILE = "/opt/shitaleco/backups/.azure-creds.env"


async def _write_azure_creds_env(conn_str: str, container: str) -> None:
    """Write (or clear) Azure credentials to a file readable by backup.sh."""
    import asyncio
    import os

    def _write() -> None:
        os.makedirs(os.path.dirname(_AZURE_CREDS_FILE), exist_ok=True)
        with open(_AZURE_CREDS_FILE, "w") as f:
            if conn_str:
                escaped_conn = conn_str.replace('"', '\\"')
                f.write(f'AZURE_STORAGE_CONNECTION_STRING="{escaped_conn}"\n')
            if container:
                escaped_container = container.replace('"', '\\"')
                f.write(f'AZURE_STORAGE_CONTAINER="{escaped_container}"\n')
        os.chmod(_AZURE_CREDS_FILE, 0o600)

    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _write)
    except Exception:
        pass


# ── Monitor alert recipients ──────────────────────────────────────────────────

_MONITOR_RECIPIENT_DEFAULTS: dict[str, str] = {
    "critical": "rajk@shirdisai.org.uk,vinitl@shirdisai.org.uk,it@shirdisai.org.uk,gtrustees@shirdisai.org.uk",
    "high":     "rajk@shirdisai.org.uk,it@shirdisai.org.uk,gtrustees@shirdisai.org.uk",
    "medium":   "wembley@shirdisai.org.uk,rajk@shirdisai.org.uk",
    "digest":   "gtrustees@shirdisai.org.uk,it@shirdisai.org.uk",
}

_MONITOR_LEVELS = ("critical", "high", "medium", "digest")


class MonitorRecipientsInput(BaseModel):
    critical: str | None = None
    high: str | None = None
    medium: str | None = None
    digest: str | None = None


def _normalize_recipient_list(raw: str) -> str:
    """Parse a comma/space/newline-separated list, dedupe, validate, return CSV."""
    import re
    seen: list[str] = []
    seen_set: set[str] = set()
    parts = re.split(r"[\s,;]+", raw or "")
    for p in parts:
        p = p.strip().lower()
        if not p:
            continue
        if "@" not in p or " " in p or len(p) > 254:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid email address: {p}",
            )
        if p in seen_set:
            continue
        seen_set.add(p)
        seen.append(p)
    return ",".join(seen)


@settings_router.get("/monitor-recipients")
async def get_monitor_recipients(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from shital.core.fabrics.secrets import SecretsManager
    out: dict[str, Any] = {"levels": {}, "defaults": _MONITOR_RECIPIENT_DEFAULTS}
    for level in _MONITOR_LEVELS:
        key = f"MONITOR_RECIPIENTS_{level.upper()}"
        val = await SecretsManager.get(key)
        out["levels"][level] = {
            "value": val or _MONITOR_RECIPIENT_DEFAULTS[level],
            "is_custom": bool(val),
        }
    return out


@settings_router.post("/monitor-recipients")
async def set_monitor_recipients(
    body: MonitorRecipientsInput,
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_admin(ctx)
    await _verify_pin_or_raise(x_admin_pin)
    from shital.core.fabrics.secrets import SecretsManager

    updates = {
        "critical": body.critical,
        "high":     body.high,
        "medium":   body.medium,
        "digest":   body.digest,
    }
    saved: dict[str, str] = {}
    for level, raw in updates.items():
        if raw is None:
            continue
        normalized = _normalize_recipient_list(raw)
        if not normalized:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"At least one email required for {level}",
            )
        await SecretsManager.set(
            f"MONITOR_RECIPIENTS_{level.upper()}",
            normalized,
            updated_by=ctx.user_email,
        )
        saved[level] = normalized
    return {"ok": True, "saved": saved}


@settings_router.delete("/monitor-recipients/{level}")
async def reset_monitor_recipients(
    level: str,
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_admin(ctx)
    await _verify_pin_or_raise(x_admin_pin)
    if level not in _MONITOR_LEVELS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown level")
    from shital.core.fabrics.secrets import SecretsManager
    await SecretsManager.delete(f"MONITOR_RECIPIENTS_{level.upper()}")
    return {"ok": True, "level": level, "value": _MONITOR_RECIPIENT_DEFAULTS[level]}
