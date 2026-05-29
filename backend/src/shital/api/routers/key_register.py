"""Key Register — custody tracking for physical keys and digital access.

One table covers eight key_types: PHYSICAL_KEY, DIGITAL_CREDENTIAL, DOMAIN,
SSL_CERTIFICATE, HOSTING_ACCOUNT, SAAS_SUBSCRIPTION, CRYPTO_KEY, API_KEY,
OTHER. The common questions for any of them are the same — who holds it,
who's accountable, when does it expire, where does the actual secret live.

Hybrid storage model: this register never stores plaintext secrets. For
digital items it records `vault_reference` ("1Password: PayPal Admin",
"Bitwarden item id xxx", "Sealed envelope in trustees' safe") so a holder
can be sent to the right place — but the secret itself stays in whichever
external vault the org actually uses. Keeps blast radius bounded if the DB
or a .env file ever leaks.

Audit: every state change (issue, return, mark-lost, rotate, edit) appends
a row to key_register_events so we can answer "when did Anil get the
front-door key and who authorised it" in one query.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/key-register", tags=["key-register"])

_VALID_TYPES = {
    "PHYSICAL_KEY", "DIGITAL_CREDENTIAL", "DOMAIN", "SSL_CERTIFICATE",
    "HOSTING_ACCOUNT", "SAAS_SUBSCRIPTION", "CRYPTO_KEY", "API_KEY", "OTHER",
}
_VALID_STATUS = {"ACTIVE", "RETURNED", "LOST", "REVOKED", "EXPIRED"}


class KeyIn(BaseModel):
    name: str
    key_type: str = "PHYSICAL_KEY"
    description: str = ""
    holder_employee_id: str = ""
    owner_employee_id: str = ""
    # Physical
    physical_location: str = ""
    serial_number: str = ""
    copies_count: int = 1
    # Digital
    vault_reference: str = ""
    access_url: str = ""
    username_hint: str = ""
    provider: str = ""
    # Lifecycle
    issued_date: str = ""
    expiry_date: str = ""
    notes: str = ""


class EventIn(BaseModel):
    notes: str = ""
    # For ISSUED/TRANSFER actions:
    to_holder_id: str = ""


def _d(s: str) -> date | None:
    return date.fromisoformat(s) if s else None


def _uuid_or_none(s: str) -> str | None:
    return s if s else None


def _serialize(row: dict[str, Any]) -> dict[str, Any]:
    d = dict(row)
    for k in ("issued_date", "returned_date", "expiry_date", "last_rotated_date",
              "created_at", "updated_at", "deleted_at"):
        v = d.get(k)
        if v is not None and hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    # UUID → str
    for k in ("id", "holder_employee_id", "owner_employee_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    return d


async def _log_event(
    db: Any,
    *,
    key_id: str,
    event_type: str,
    ctx: CurrentSpace,
    from_holder_id: str | None = None,
    to_holder_id: str | None = None,
    notes: str = "",
) -> None:
    """Append an audit row. Called inside the same transaction as the mutation
    so audit gaps are impossible — if the mutation rolls back, so does the log."""
    await db.execute(text("""
        INSERT INTO key_register_events
        (id, key_id, event_type, actor_user_id, actor_name,
         from_holder_id, to_holder_id, notes, created_at)
        VALUES (:id, :kid, :etype, :actor_id, :actor_name,
                :from_id, :to_id, :notes, :now)
    """), {
        "id": str(uuid.uuid4()),
        "kid": key_id,
        "etype": event_type,
        # user_id may be "anonymous" for kiosk callers — store NULL in that case
        # so the FK-shaped column stays clean. Identity is preserved in actor_name.
        "actor_id": (getattr(ctx, "user_id", None)
                     if getattr(ctx, "user_id", "") not in ("", "anonymous") else None),
        "actor_name": getattr(ctx, "user_email", "") or "system",
        "from_id": from_holder_id,
        "to_id": to_holder_id,
        "notes": notes or "",
        "now": datetime.utcnow(),
    })


# ── List ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_keys(
    ctx: CurrentSpace,
    key_type: str = "",
    status: str = "",
    holder_id: str = "",
    expiring_within_days: int = 0,
) -> dict[str, Any]:
    """Return the key register, optionally filtered. Always scoped to caller's
    branch. Joins employees twice so the response carries holder + owner names
    for display (frontend doesn't need a second round-trip)."""
    conditions = ["k.branch_id = :bid", "k.deleted_at IS NULL"]
    params: dict[str, Any] = {"bid": ctx.branch_id}

    if key_type:
        if key_type not in _VALID_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid key_type: {key_type}")
        conditions.append("k.key_type = :ktype")
        params["ktype"] = key_type
    if status:
        if status not in _VALID_STATUS:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
        conditions.append("k.status = :kstatus")
        params["kstatus"] = status
    if holder_id:
        conditions.append("k.holder_employee_id = :hid")
        params["hid"] = holder_id
    if expiring_within_days > 0:
        conditions.append("k.expiry_date IS NOT NULL AND k.expiry_date <= :exp_cutoff")
        params["exp_cutoff"] = date.today().fromordinal(
            date.today().toordinal() + expiring_within_days
        )

    where = " AND ".join(conditions)
    async with SessionLocal() as db:
        result = await db.execute(text(f"""
            SELECT k.*,
                   h.full_name AS holder_name,
                   o.full_name AS owner_name
            FROM key_register k
            LEFT JOIN employees h ON h.id = k.holder_employee_id
            LEFT JOIN employees o ON o.id = k.owner_employee_id
            WHERE {where}
            ORDER BY k.key_type, k.name
        """), params)
        rows = [_serialize(dict(r)) for r in result.mappings().all()]

    # Aggregate by type for the page header
    by_type: dict[str, int] = {}
    expiring_soon = 0
    today = date.today()
    for r in rows:
        by_type[r["key_type"]] = by_type.get(r["key_type"], 0) + 1
        exp = r.get("expiry_date")
        if exp:
            try:
                exp_d = date.fromisoformat(exp)
                if 0 <= (exp_d - today).days <= 30:
                    expiring_soon += 1
            except ValueError:
                pass

    return {
        "keys": rows,
        "total": len(rows),
        "by_type": by_type,
        "expiring_soon": expiring_soon,
    }


# ── Create ─────────────────────────────────────────────────────────────────

@router.post("")
async def create_key(body: KeyIn, ctx: CurrentSpace) -> dict[str, Any]:
    if body.key_type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid key_type: {body.key_type}")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")

    key_id = str(uuid.uuid4())
    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO key_register
            (id, branch_id, name, key_type, description,
             holder_employee_id, owner_employee_id,
             physical_location, serial_number, copies_count,
             vault_reference, access_url, username_hint, provider,
             status, issued_date, expiry_date, notes,
             created_at, updated_at)
            VALUES (:id, :bid, :name, :ktype, :desc,
                    :hid, :oid,
                    :ploc, :serial, :copies,
                    :vault, :url, :uhint, :prov,
                    'ACTIVE', :issued, :expiry, :notes,
                    :now, :now)
        """), {
            "id": key_id, "bid": ctx.branch_id, "name": body.name,
            "ktype": body.key_type, "desc": body.description,
            "hid": _uuid_or_none(body.holder_employee_id),
            "oid": _uuid_or_none(body.owner_employee_id),
            "ploc": body.physical_location, "serial": body.serial_number,
            "copies": max(1, int(body.copies_count or 1)),
            "vault": body.vault_reference, "url": body.access_url,
            "uhint": body.username_hint, "prov": body.provider,
            "issued": _d(body.issued_date), "expiry": _d(body.expiry_date),
            "notes": body.notes, "now": now,
        })
        await _log_event(db, key_id=key_id, event_type="CREATED", ctx=ctx,
                         to_holder_id=_uuid_or_none(body.holder_employee_id),
                         notes=f"Created {body.key_type}: {body.name}")
        await db.commit()
    return {"id": key_id, "name": body.name}


# ── Single + events ────────────────────────────────────────────────────────

@router.get("/{key_id}")
async def get_key(key_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    async with SessionLocal() as db:
        result = await db.execute(text("""
            SELECT k.*,
                   h.full_name AS holder_name,
                   o.full_name AS owner_name
            FROM key_register k
            LEFT JOIN employees h ON h.id = k.holder_employee_id
            LEFT JOIN employees o ON o.id = k.owner_employee_id
            WHERE k.id = :id AND k.branch_id = :bid AND k.deleted_at IS NULL
        """), {"id": key_id, "bid": ctx.branch_id})
        row = result.mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Key not found")

        events_result = await db.execute(text("""
            SELECT e.*, fh.full_name AS from_holder_name, th.full_name AS to_holder_name
            FROM key_register_events e
            LEFT JOIN employees fh ON fh.id = e.from_holder_id
            LEFT JOIN employees th ON th.id = e.to_holder_id
            WHERE e.key_id = :id
            ORDER BY e.created_at DESC
            LIMIT 100
        """), {"id": key_id})
        events = []
        for ev in events_result.mappings().all():
            ed = dict(ev)
            for k in ("created_at",):
                v = ed.get(k)
                if v is not None and hasattr(v, "isoformat"):
                    ed[k] = v.isoformat()
            for k in ("id", "key_id", "actor_user_id", "from_holder_id", "to_holder_id"):
                if ed.get(k) is not None:
                    ed[k] = str(ed[k])
            events.append(ed)

    return {"key": _serialize(dict(row)), "events": events}


# ── Update ─────────────────────────────────────────────────────────────────

@router.patch("/{key_id}")
async def update_key(key_id: str, body: KeyIn, ctx: CurrentSpace) -> dict[str, Any]:
    if body.key_type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid key_type: {body.key_type}")
    now = datetime.utcnow()
    async with SessionLocal() as db:
        # Fetch old holder so we can log a transfer if the holder changed
        old = (await db.execute(text(
            "SELECT holder_employee_id FROM key_register "
            "WHERE id = :id AND branch_id = :bid AND deleted_at IS NULL"
        ), {"id": key_id, "bid": ctx.branch_id})).first()
        if not old:
            raise HTTPException(status_code=404, detail="Key not found")
        old_holder = str(old[0]) if old[0] else None
        new_holder = _uuid_or_none(body.holder_employee_id)

        await db.execute(text("""
            UPDATE key_register SET
                name=:name, key_type=:ktype, description=:desc,
                holder_employee_id=:hid, owner_employee_id=:oid,
                physical_location=:ploc, serial_number=:serial, copies_count=:copies,
                vault_reference=:vault, access_url=:url, username_hint=:uhint, provider=:prov,
                issued_date=:issued, expiry_date=:expiry, notes=:notes,
                updated_at=:now
            WHERE id=:id AND branch_id=:bid AND deleted_at IS NULL
        """), {
            "id": key_id, "bid": ctx.branch_id, "name": body.name,
            "ktype": body.key_type, "desc": body.description,
            "hid": new_holder, "oid": _uuid_or_none(body.owner_employee_id),
            "ploc": body.physical_location, "serial": body.serial_number,
            "copies": max(1, int(body.copies_count or 1)),
            "vault": body.vault_reference, "url": body.access_url,
            "uhint": body.username_hint, "prov": body.provider,
            "issued": _d(body.issued_date), "expiry": _d(body.expiry_date),
            "notes": body.notes, "now": now,
        })
        if old_holder != new_holder:
            await _log_event(db, key_id=key_id,
                             event_type="ISSUED" if new_holder else "RETURNED",
                             ctx=ctx, from_holder_id=old_holder,
                             to_holder_id=new_holder,
                             notes="Holder changed via edit")
        else:
            await _log_event(db, key_id=key_id, event_type="EDITED", ctx=ctx,
                             notes="Details updated")
        await db.commit()
    return {"id": key_id}


# ── Quick actions ──────────────────────────────────────────────────────────

@router.post("/{key_id}/issue")
async def issue_key(key_id: str, body: EventIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Assign a holder. Idempotent w.r.t. status — always sets ACTIVE."""
    if not body.to_holder_id:
        raise HTTPException(status_code=400, detail="to_holder_id is required")
    async with SessionLocal() as db:
        old = (await db.execute(text(
            "SELECT holder_employee_id FROM key_register "
            "WHERE id = :id AND branch_id = :bid AND deleted_at IS NULL"
        ), {"id": key_id, "bid": ctx.branch_id})).first()
        if not old:
            raise HTTPException(status_code=404, detail="Key not found")
        from_holder = str(old[0]) if old[0] else None

        await db.execute(text("""
            UPDATE key_register SET
                holder_employee_id=:hid, status='ACTIVE',
                issued_date=COALESCE(issued_date, :today),
                returned_date=NULL, updated_at=:now
            WHERE id=:id AND branch_id=:bid
        """), {
            "id": key_id, "bid": ctx.branch_id,
            "hid": body.to_holder_id, "today": date.today(),
            "now": datetime.utcnow(),
        })
        await _log_event(db, key_id=key_id, event_type="ISSUED", ctx=ctx,
                         from_holder_id=from_holder, to_holder_id=body.to_holder_id,
                         notes=body.notes)
        await db.commit()
    return {"id": key_id, "status": "ACTIVE"}


@router.post("/{key_id}/return")
async def return_key(key_id: str, body: EventIn, ctx: CurrentSpace) -> dict[str, Any]:
    async with SessionLocal() as db:
        old = (await db.execute(text(
            "SELECT holder_employee_id FROM key_register "
            "WHERE id = :id AND branch_id = :bid AND deleted_at IS NULL"
        ), {"id": key_id, "bid": ctx.branch_id})).first()
        if not old:
            raise HTTPException(status_code=404, detail="Key not found")
        from_holder = str(old[0]) if old[0] else None

        await db.execute(text("""
            UPDATE key_register SET
                holder_employee_id=NULL, status='RETURNED',
                returned_date=:today, updated_at=:now
            WHERE id=:id AND branch_id=:bid
        """), {"id": key_id, "bid": ctx.branch_id,
               "today": date.today(), "now": datetime.utcnow()})
        await _log_event(db, key_id=key_id, event_type="RETURNED", ctx=ctx,
                         from_holder_id=from_holder, notes=body.notes)
        await db.commit()
    return {"id": key_id, "status": "RETURNED"}


@router.post("/{key_id}/mark-lost")
async def mark_lost(key_id: str, body: EventIn, ctx: CurrentSpace) -> dict[str, Any]:
    async with SessionLocal() as db:
        old = (await db.execute(text(
            "SELECT holder_employee_id FROM key_register "
            "WHERE id = :id AND branch_id = :bid AND deleted_at IS NULL"
        ), {"id": key_id, "bid": ctx.branch_id})).first()
        if not old:
            raise HTTPException(status_code=404, detail="Key not found")
        from_holder = str(old[0]) if old[0] else None
        await db.execute(text(
            "UPDATE key_register SET status='LOST', updated_at=:now "
            "WHERE id=:id AND branch_id=:bid"
        ), {"id": key_id, "bid": ctx.branch_id, "now": datetime.utcnow()})
        await _log_event(db, key_id=key_id, event_type="LOST", ctx=ctx,
                         from_holder_id=from_holder, notes=body.notes)
        await db.commit()
    return {"id": key_id, "status": "LOST"}


@router.post("/{key_id}/rotate")
async def rotate_key(key_id: str, body: EventIn, ctx: CurrentSpace) -> dict[str, Any]:
    """For digital keys — caller has just rotated the password/secret in the
    external vault. We record the rotation date and reset expiry if asked."""
    async with SessionLocal() as db:
        await db.execute(text(
            "UPDATE key_register SET last_rotated_date=:today, updated_at=:now "
            "WHERE id=:id AND branch_id=:bid AND deleted_at IS NULL"
        ), {"id": key_id, "bid": ctx.branch_id,
            "today": date.today(), "now": datetime.utcnow()})
        await _log_event(db, key_id=key_id, event_type="ROTATED", ctx=ctx,
                         notes=body.notes)
        await db.commit()
    return {"id": key_id, "last_rotated_date": date.today().isoformat()}


# ── Soft delete ────────────────────────────────────────────────────────────

@router.delete("/{key_id}")
async def delete_key(key_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    async with SessionLocal() as db:
        await db.execute(text(
            "UPDATE key_register SET deleted_at=NOW(), updated_at=NOW() "
            "WHERE id=:id AND branch_id=:bid"
        ), {"id": key_id, "bid": ctx.branch_id})
        await _log_event(db, key_id=key_id, event_type="DELETED", ctx=ctx,
                         notes="Soft-deleted from register")
        await db.commit()
    return {"deleted": key_id}
