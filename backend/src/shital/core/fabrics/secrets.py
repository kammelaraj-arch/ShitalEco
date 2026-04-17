"""
SecretsManager — encrypted API key storage backed by the database.

Keys are encrypted with Fernet (AES-128-CBC + HMAC-SHA256) using a key
derived from JWT_SECRET via PBKDF2-SHA256.  Values are cached in-process
for 5 minutes to avoid repeated DB round-trips.

Fallback chain: DB → env var → provided default
"""
from __future__ import annotations

import base64
import hashlib
import os
import time
from typing import Any

# Fernet comes from the 'cryptography' package, already a transitive dep
# via python-jose[cryptography].
from cryptography.fernet import Fernet

# ── Lazy singleton ─────────────────────────────────────────────────────────────

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        from shital.core.fabrics.config import settings
        raw = settings.JWT_SECRET.encode()
        key_bytes = hashlib.pbkdf2_hmac(
            "sha256", raw, b"shital-api-keys-v1-salt", 100_000, dklen=32
        )
        _fernet = Fernet(base64.urlsafe_b64encode(key_bytes))
    return _fernet


def _encrypt(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def _decrypt(token: str) -> str:
    return _get_fernet().decrypt(token.encode()).decode()


# ── In-memory TTL cache ────────────────────────────────────────────────────────

_cache: dict[str, str] = {}       # key_name → plaintext value
_cache_ts: float = 0.0            # unix ts of last full reload
_TTL = 300.0                      # 5 minutes


def _cache_expired() -> bool:
    return (time.monotonic() - _cache_ts) > _TTL


def invalidate_cache() -> None:
    global _cache, _cache_ts
    _cache = {}
    _cache_ts = 0.0


# ── Public API ─────────────────────────────────────────────────────────────────

class SecretsManager:
    """
    Usage:
        value = await SecretsManager.get("STRIPE_SECRET_KEY")
        await SecretsManager.set("STRIPE_SECRET_KEY", "sk_live_...")
        keys  = await SecretsManager.list_keys()
    """

    @classmethod
    async def _load_all(cls) -> None:
        """Reload all keys from DB into the in-memory cache."""
        global _cache, _cache_ts
        from sqlalchemy import text

        from shital.core.fabrics.database import SessionLocal
        try:
            async with SessionLocal() as db:
                result = await db.execute(
                    text("SELECT key_name, encrypted_value FROM api_keys_store")
                )
                rows = result.fetchall()
            fresh: dict[str, str] = {}
            for row in rows:
                try:
                    fresh[row[0]] = _decrypt(row[1]) if row[1] else ""
                except Exception:
                    fresh[row[0]] = ""      # bad ciphertext — treat as blank
            _cache = fresh
            _cache_ts = time.monotonic()
        except Exception:
            # Table may not exist yet — just reset timestamp so we retry next call
            _cache_ts = time.monotonic() - _TTL + 10  # retry in 10 s

    @classmethod
    async def get(cls, key_name: str, fallback: str = "") -> str:
        """Return decrypted value from DB, falling back to env, then default."""
        if _cache_expired():
            await cls._load_all()
        db_val = _cache.get(key_name)
        if db_val:
            return db_val
        # Fall back to environment variable
        env_val = os.environ.get(key_name, "")
        return env_val if env_val else fallback

    @classmethod
    async def set(cls, key_name: str, value: str, updated_by: str = "admin") -> None:
        """Encrypt and persist a key to DB; invalidate the cache."""
        from sqlalchemy import text

        from shital.core.fabrics.database import SessionLocal
        encrypted = _encrypt(value)
        async with SessionLocal() as db:
            await db.execute(
                text("""
                    INSERT INTO api_keys_store (key_name, encrypted_value, updated_by, updated_at)
                    VALUES (:k, :v, :by, NOW())
                    ON CONFLICT (key_name)
                    DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                                  updated_by = EXCLUDED.updated_by,
                                  updated_at = NOW()
                """),
                {"k": key_name, "v": encrypted, "by": updated_by},
            )
            await db.commit()
        invalidate_cache()

    @classmethod
    async def list_keys(cls) -> list[dict[str, Any]]:
        """Return key metadata (never plaintext values)."""
        from sqlalchemy import text

        from shital.core.fabrics.database import SessionLocal
        async with SessionLocal() as db:
            result = await db.execute(
                text("""
                    SELECT key_name, description, group_name, is_sensitive,
                           has_value, updated_at, updated_by
                    FROM api_keys_store
                    WHERE LEFT(key_name, 2) != '__'
                    ORDER BY group_name, key_name
                """)
            )
            rows = result.mappings().all()
        return [dict(r) for r in rows]

    @classmethod
    async def delete(cls, key_name: str) -> None:
        """Remove a key from DB; invalidate cache."""
        from sqlalchemy import text

        from shital.core.fabrics.database import SessionLocal
        async with SessionLocal() as db:
            await db.execute(
                text("DELETE FROM api_keys_store WHERE key_name = :k"),
                {"k": key_name},
            )
            await db.commit()
        invalidate_cache()

    # ── PIN management ──────────────────────────────────────────────────────────

    _PIN_KEY = "__admin_pin_hash__"
    _DEFAULT_PIN = "1234"

    @classmethod
    async def verify_pin(cls, pin: str) -> bool:
        import bcrypt as _bcrypt
        if _cache_expired():
            await cls._load_all()
        stored_hash = _cache.get(cls._PIN_KEY, "")
        if not stored_hash:
            # No PIN set yet — accept the default and auto-create it
            if pin == cls._DEFAULT_PIN:
                await cls.set_pin(cls._DEFAULT_PIN)
                return True
            return False
        try:
            return _bcrypt.checkpw(pin.encode(), stored_hash.encode())
        except Exception:
            return False

    @classmethod
    async def set_pin(cls, new_pin: str) -> None:
        import bcrypt as _bcrypt
        hashed = _bcrypt.hashpw(new_pin.encode(), _bcrypt.gensalt(12)).decode()
        await cls.set(cls._PIN_KEY, hashed, "system")
