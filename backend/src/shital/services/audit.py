"""Audit log helper — one call per write, universal across all tables.

Why this exists
---------------
On 23 Oct the Wembley SumUp readers silently flipped to Stripe Terminal
and nobody could tell who did it or when, because `terminal_devices`
had no change history (only `updated_at`). More broadly: the admin
app mutates ~20 tables and until now none of them left an audit trail.
This module is the universal "who changed what" sink.

How to use it from a router
---------------------------
After any successful write, call:

    from shital.services.audit import record_audit, snapshot

    before = await snapshot(db, "terminal_devices", device_id)
    await db.execute(text("UPDATE terminal_devices SET …"), …)
    after = await snapshot(db, "terminal_devices", device_id)
    await record_audit(
        actor_email      = ctx.user_email,
        actor_role       = ctx.role,
        action           = "update",            # free text (create|update|delete|assign|…)
        entity_type      = "terminal_devices",
        entity_id        = device_id,
        branch_id        = ctx.branch_id,
        source_endpoint  = "/api/v1/terminal-devices/{id}",
        before           = before,
        after            = after,
    )

That's it. The helper computes `changed_fields` from the diff of
before/after, writes the row, and never raises — a failing audit write
MUST NOT block the user's actual mutation.

Design notes
------------
- Both `before` and `after` are plain dicts; JSONB storage handles
  nested shapes. Pass `None` on create (before) or delete (after).
- `changed_fields` is derived automatically, so routers don't have to
  track it. If the caller wants a human one-liner on top of the raw
  diff, they can pass `diff_summary="provider changed sumup → stripe"`.
- All failures are swallowed and logged — the audit log is a SECONDARY
  concern that must never crash a primary write.
"""
from __future__ import annotations

import json
from typing import Any

import structlog
from sqlalchemy import text

from shital.core.fabrics.database import SessionLocal

logger = structlog.get_logger()


async def snapshot(db, table: str, entity_id: str) -> dict[str, Any] | None:
    """Return a row as a plain dict, or None if it doesn't exist.

    `table` is interpolated directly — callers must only pass trusted
    constants (never user input). `entity_id` is parameterised normally.
    """
    try:
        r = (await db.execute(
            text(f"SELECT * FROM {table} WHERE id::text = :id LIMIT 1"),
            {"id": str(entity_id)},
        )).mappings().first()
        if not r:
            return None
        # Convert to a plain JSON-serialisable dict (dates → iso strings etc.)
        return _jsonable(dict(r))
    except Exception as exc:  # noqa: BLE001
        logger.warning("audit_snapshot_failed", table=table, id=entity_id, error=str(exc))
        return None


def _jsonable(d: dict[str, Any]) -> dict[str, Any]:
    """Make a row dict JSON-serialisable (handle datetime, UUID, Decimal, …)."""
    out: dict[str, Any] = {}
    for k, v in d.items():
        if v is None or isinstance(v, (str, int, bool, float)):
            out[k] = v
        elif isinstance(v, (list, tuple)):
            out[k] = [_scalar(x) for x in v]
        elif isinstance(v, dict):
            out[k] = _jsonable(v)
        else:
            out[k] = _scalar(v)
    return out


def _scalar(v: Any) -> Any:
    if hasattr(v, "isoformat"):
        return v.isoformat()
    try:
        return str(v)
    except Exception:  # noqa: BLE001
        return None


def _diff(before: dict[str, Any] | None, after: dict[str, Any] | None) -> list[str]:
    """Return the keys whose values changed. Ignores purely-timestamp noise
    (updated_at always ticks on an UPDATE — not interesting)."""
    noise = {"updated_at"}
    if before is None and after is None:
        return []
    if before is None:
        return [k for k in (after or {}).keys() if k not in noise]
    if after is None:
        return [k for k in before.keys() if k not in noise]
    changed = []
    for k in sorted(set(before.keys()) | set(after.keys())):
        if k in noise:
            continue
        if before.get(k) != after.get(k):
            changed.append(k)
    return changed


async def record_audit(
    *,
    actor_email: str,
    actor_role: str | None,
    action: str,
    entity_type: str,
    entity_id: str,
    branch_id: str | None,
    source_endpoint: str | None,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    diff_summary: str | None = None,
    request_id: str | None = None,
) -> None:
    """Write one audit row. Never raises — logs on failure and returns."""
    try:
        changed = _diff(before, after)
        # Opens its own session so a transaction rollback upstream doesn't
        # wipe the audit trail. Trade-off: the audit row commits even if
        # the primary write was later rolled back. For an admin tool used
        # by trustees this is the right trade — we'd rather over-record
        # than lose a mutation that reached the DB.
        async with SessionLocal() as db:
            await db.execute(text("""
                INSERT INTO audit_log
                    (actor_email, actor_role, action, entity_type, entity_id,
                     branch_id, source_endpoint, before_json, after_json,
                     changed_fields, diff_summary, request_id)
                VALUES
                    (:actor, :role, :action, :etype, :eid, :bid, :src,
                     CAST(:before AS jsonb), CAST(:after AS jsonb),
                     :changed, :summary, :rid)
            """), {
                "actor":   actor_email or "",
                "role":    actor_role,
                "action":  action,
                "etype":   entity_type,
                "eid":     str(entity_id),
                "bid":     branch_id,
                "src":     source_endpoint,
                "before":  json.dumps(before) if before is not None else None,
                "after":   json.dumps(after)  if after  is not None else None,
                "changed": changed,
                "summary": diff_summary,
                "rid":     request_id,
            })
            await db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "audit_write_failed", action=action, entity_type=entity_type,
            entity_id=str(entity_id), error=str(exc),
        )
