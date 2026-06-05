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
    # ─ Physical keys (now broken down by what they unlock) ─
    "PHYSICAL_KEY",       # generic (kept for back-compat)
    "PROPERTY_KEY",       # building / main entrance
    "ROOM_KEY",           # internal room
    "OFFICE_KEY",         # office
    "SHRINE_KEY",         # shrine / sanctum
    "DONATION_BOX_KEY",   # collection / hundi box — temple-critical
    "CUPBOARD_KEY",
    "LOCKER_KEY",
    "DRAWER_KEY",
    "SAFE_KEY",
    "VAULT_KEY",
    "CCTV_ROOM_KEY",
    "STORAGE_KEY",
    "GATE_KEY",
    "PADLOCK_KEY",
    "VEHICLE_KEY",
    "MAILBOX_KEY",
    # ─ Digital credentials ─
    "DIGITAL_CREDENTIAL", "DOMAIN", "SSL_CERTIFICATE",
    "HOSTING_ACCOUNT", "SAAS_SUBSCRIPTION", "CRYPTO_KEY", "API_KEY",
    # ─ Catch-all ─
    "OTHER",
}
_VALID_STATUS = {"ACTIVE", "RETURNED", "LOST", "REVOKED", "EXPIRED"}


class KeyIn(BaseModel):
    name: str
    key_type: str = "PHYSICAL_KEY"
    branch_id: str = "main"
    description: str = ""
    holder_employee_id: str = ""
    owner_employee_id: str = ""
    # Physical — set sizing distinguishes "we own 5 sets, 3 with people,
    # 2 in vault" from the older single `copies_count` field which mixed
    # both. copies_count stays for back-compat but new code should use
    # total_sets / sets_in_vault.
    physical_location: str = ""
    serial_number: str = ""
    copies_count: int = 1
    total_sets: int = 1
    sets_in_vault: int = 0
    # Digital
    vault_reference: str = ""
    access_url: str = ""
    username_hint: str = ""
    provider: str = ""
    # Lifecycle
    issued_date: str = ""
    expiry_date: str = ""
    notes: str = ""
    # Undertaking — for physical keys to property / shrines / donation
    # boxes most charities require the holder to sign a brief
    # undertaking. Default ON for any new physical key; OFF for
    # digital credentials where it's typically not applicable.
    undertaking_required: bool = True


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
                   h.full_name      AS holder_name,
                   h.email          AS holder_email,
                   h.phone          AS holder_phone,
                   h.address        AS holder_address,
                   h.employee_number AS holder_employee_number,
                   h.job_title      AS holder_job_title,
                   o.full_name      AS owner_name,
                   o.email          AS owner_email,
                   o.phone          AS owner_phone
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
             total_sets, sets_in_vault,
             vault_reference, access_url, username_hint, provider,
             status, issued_date, expiry_date, notes,
             undertaking_required,
             created_at, updated_at)
            VALUES (:id, :bid, :name, :ktype, :desc,
                    :hid, :oid,
                    :ploc, :serial, :copies,
                    :tsets, :vsets,
                    :vault, :url, :uhint, :prov,
                    'ACTIVE', :issued, :expiry, :notes,
                    :under,
                    :now, :now)
        """), {
            "id": key_id, "bid": (body.branch_id or ctx.branch_id or "main"),
            "name": body.name,
            "ktype": body.key_type, "desc": body.description,
            "hid": _uuid_or_none(body.holder_employee_id),
            "oid": _uuid_or_none(body.owner_employee_id),
            "ploc": body.physical_location, "serial": body.serial_number,
            "copies": max(1, int(body.copies_count or 1)),
            "tsets": max(1, int(body.total_sets or 1)),
            "vsets": max(0, int(body.sets_in_vault or 0)),
            "vault": body.vault_reference, "url": body.access_url,
            "uhint": body.username_hint, "prov": body.provider,
            "issued": _d(body.issued_date), "expiry": _d(body.expiry_date),
            "notes": body.notes, "now": now,
            "under": bool(body.undertaking_required),
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
                   h.full_name      AS holder_name,
                   h.email          AS holder_email,
                   h.phone          AS holder_phone,
                   h.address        AS holder_address,
                   h.employee_number AS holder_employee_number,
                   h.job_title      AS holder_job_title,
                   o.full_name      AS owner_name,
                   o.email          AS owner_email,
                   o.phone          AS owner_phone
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
                name=:name, key_type=:ktype, branch_id=:bid_new,
                description=:desc,
                holder_employee_id=:hid, owner_employee_id=:oid,
                physical_location=:ploc, serial_number=:serial,
                copies_count=:copies, total_sets=:tsets, sets_in_vault=:vsets,
                vault_reference=:vault, access_url=:url, username_hint=:uhint, provider=:prov,
                issued_date=:issued, expiry_date=:expiry, notes=:notes,
                undertaking_required=:under,
                updated_at=:now
            WHERE id=:id AND branch_id=:bid AND deleted_at IS NULL
        """), {
            "id": key_id, "bid": ctx.branch_id,
            "bid_new": (body.branch_id or ctx.branch_id or "main"),
            "name": body.name,
            "ktype": body.key_type, "desc": body.description,
            "hid": new_holder, "oid": _uuid_or_none(body.owner_employee_id),
            "ploc": body.physical_location, "serial": body.serial_number,
            "copies": max(1, int(body.copies_count or 1)),
            "tsets": max(1, int(body.total_sets or 1)),
            "vsets": max(0, int(body.sets_in_vault or 0)),
            "vault": body.vault_reference, "url": body.access_url,
            "uhint": body.username_hint, "prov": body.provider,
            "issued": _d(body.issued_date), "expiry": _d(body.expiry_date),
            "notes": body.notes, "now": now,
            "under": bool(body.undertaking_required),
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


# ── Undertaking flow ────────────────────────────────────────────────────────
# When a physical key is issued, most charity governance requires the holder
# to sign a brief undertaking accepting responsibility for the key, agreeing
# to return it on demand and reporting loss immediately. These endpoints
# render that undertaking as text (PDF generation hooks into the existing
# weasyprint dep if you opt in) and let the operator mark when the holder
# has signed it.

class UndertakingMarkIn(BaseModel):
    signed_by_name: str = ""   # printed name of the holder
    pdf_url: str = ""          # uploaded scan / SharePoint link (optional)


@router.get("/{key_id}/undertaking")
async def get_undertaking(key_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Render the undertaking text for this key. Returns a plain-text body
    the operator can email / print / drop into a Word template. Trustees
    can also adjust wording via the org settings later."""
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT k.id::text AS key_id, k.name, k.key_type, k.serial_number,
                   k.branch_id, k.physical_location, k.issued_date,
                   k.undertaking_required, k.undertaking_signed_at::text AS signed_at,
                   k.undertaking_signed_name, k.undertaking_pdf_url,
                   h.full_name AS holder_name, h.email AS holder_email,
                   h.phone AS holder_phone, h.address AS holder_address,
                   h.employee_number AS holder_emp_no
            FROM key_register k
            LEFT JOIN employees h ON h.id = k.holder_employee_id
            WHERE k.id = :id AND k.branch_id = :bid AND k.deleted_at IS NULL
        """), {"id": key_id, "bid": ctx.branch_id})).mappings().first()
    if not row:
        raise HTTPException(404, detail="Key not found")
    today = date.today().isoformat()
    body = f"""KEY UNDERTAKING

Branch: {row['branch_id']}
Date:   {today}

I, {row['holder_name'] or '________________________'}
of {row['holder_address'] or '________________________'},
employee number {row['holder_emp_no'] or '____'},
acknowledge receipt of the following item from Shital
(Shirdi Sai Temple) and agree to the conditions below.

Item:               {row['name']}
Type:               {row['key_type']}
Serial / number:    {row['serial_number'] or '—'}
Physical location:  {row['physical_location'] or '—'}
Issued on:          {row['issued_date'] or today}

CONDITIONS

1. I will keep this item secure at all times and will not lend it
   to or share it with any unauthorised person.
2. I will not duplicate, copy or modify the item or its codes
   without prior written approval from the trustees.
3. I will return the item promptly on request, when my role ends,
   or when otherwise asked by an authorised trustee.
4. I will report loss, theft or damage of the item to the trustees
   within 24 hours of becoming aware.
5. I understand that misuse of the item may result in
   disciplinary action and/or recovery of replacement / re-keying
   costs from me.

CONTACT ON FILE

Email:   {row['holder_email'] or '____________________'}
Phone:   {row['holder_phone'] or '____________________'}


Signed:   ___________________________________   Date: ____________

Witness:  ___________________________________   Date: ____________
"""
    return {
        "key_id":            row["key_id"],
        "holder_name":       row["holder_name"],
        "undertaking_text":  body,
        "undertaking_required":     bool(row["undertaking_required"]),
        "undertaking_signed_at":    row["signed_at"],
        "undertaking_signed_name":  row["undertaking_signed_name"],
        "undertaking_pdf_url":      row["undertaking_pdf_url"],
    }


@router.post("/{key_id}/undertaking/send")
async def send_undertaking(key_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Mark the undertaking as sent to the holder. Logs an audit event so the
    operator can prove later when it was first dispatched."""
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT undertaking_required FROM key_register "
            "WHERE id = :id AND branch_id = :bid AND deleted_at IS NULL"
        ), {"id": key_id, "bid": ctx.branch_id})).first()
        if not row:
            raise HTTPException(404, detail="Key not found")
        await db.execute(text(
            "UPDATE key_register SET undertaking_sent_at = NOW(), updated_at = NOW() "
            "WHERE id = :id AND branch_id = :bid"
        ), {"id": key_id, "bid": ctx.branch_id})
        await _log_event(db, key_id=key_id, event_type="UNDERTAKING_SENT", ctx=ctx,
                         notes="Undertaking dispatched to holder")
        await db.commit()
    return {"ok": True, "key_id": key_id}


@router.post("/{key_id}/undertaking/mark-signed")
async def mark_undertaking_signed(key_id: str, body: UndertakingMarkIn,
                                  ctx: CurrentSpace) -> dict[str, Any]:
    """Record that the holder has signed the undertaking. Operator types
    the holder's printed name and (optionally) a URL to the signed PDF
    (SharePoint / Drive). Without this confirmation a key shows as
    "Undertaking pending" on the register."""
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE key_register SET
                undertaking_signed_at   = NOW(),
                undertaking_signed_name = :nm,
                undertaking_pdf_url     = COALESCE(NULLIF(:url, ''), undertaking_pdf_url),
                updated_at              = NOW()
            WHERE id = :id AND branch_id = :bid AND deleted_at IS NULL
        """), {"id": key_id, "bid": ctx.branch_id,
               "nm": (body.signed_by_name or "")[:200], "url": body.pdf_url or ""})
        if not getattr(result, "rowcount", 0):
            raise HTTPException(404, detail="Key not found")
        await _log_event(db, key_id=key_id, event_type="UNDERTAKING_SIGNED", ctx=ctx,
                         notes=f"Signed by {body.signed_by_name or 'holder'}")
        await db.commit()
    return {"ok": True, "key_id": key_id}


# ─── Multi-holder / per-set holdings ─────────────────────────────────────────
# A single key (definition) can have multiple physical sets, each held by a
# different person at the same time (e.g. 5 sets of the donation-box key, one
# with each trustee). Each holding has its own undertaking + issue/return
# dates. The parent key_register row stays as the "what this key unlocks"
# definition; key_holdings rows are the per-set custody records.

class HoldingIn(BaseModel):
    holder_employee_id: str
    set_number: int = 1
    issued_date: str = ""
    expected_return_date: str = ""
    undertaking_required: bool = True
    notes: str = ""


class HoldingReturnIn(BaseModel):
    returned_date: str = ""
    notes: str = ""


@router.get("/{key_id}/holdings")
async def list_holdings(key_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """All sets of this key — active + historical. Returns holder contact
    details inline so the operator can email / phone holders directly from
    the list (e.g. for return chasing)."""
    async with SessionLocal() as db:
        # Verify the key exists in this branch first
        owner = (await db.execute(text(
            "SELECT id FROM key_register WHERE id=:id AND branch_id=:bid AND deleted_at IS NULL"
        ), {"id": key_id, "bid": ctx.branch_id})).first()
        if not owner:
            raise HTTPException(404, detail="Key not found")
        rows = (await db.execute(text("""
            SELECT h.id::text, h.key_id::text, h.set_number,
                   h.holder_employee_id::text AS holder_employee_id,
                   h.issued_date::text AS issued_date,
                   h.returned_date::text AS returned_date,
                   h.expected_return_date::text AS expected_return_date,
                   h.status,
                   h.undertaking_required,
                   h.undertaking_sent_at::text AS undertaking_sent_at,
                   h.undertaking_signed_at::text AS undertaking_signed_at,
                   h.undertaking_signed_name,
                   h.undertaking_pdf_url,
                   h.notes, h.created_at, h.updated_at,
                   e.full_name AS holder_name,
                   e.email     AS holder_email,
                   e.phone     AS holder_phone,
                   e.address   AS holder_address,
                   e.employee_number AS holder_employee_number,
                   e.job_title AS holder_job_title
            FROM key_holdings h
            LEFT JOIN employees e ON e.id = h.holder_employee_id
            WHERE h.key_id = CAST(:kid AS UUID)
              AND h.deleted_at IS NULL
            ORDER BY h.status, h.set_number, h.issued_date DESC NULLS LAST
        """), {"kid": key_id})).mappings().all()
    items = []
    for r in rows:
        d = dict(r)
        for k in ("created_at", "updated_at"):
            if d.get(k) is not None and hasattr(d[k], "isoformat"):
                d[k] = d[k].isoformat()
        items.append(d)
    return {"items": items}


@router.post("/{key_id}/holdings", status_code=201)
async def add_holding(key_id: str, body: HoldingIn,
                      ctx: CurrentSpace) -> dict[str, Any]:
    """Assign a new physical set to a holder. Each call creates a separate
    holding so 5 trustees holding 5 sets = 5 calls / 5 rows."""
    if not body.holder_employee_id:
        raise HTTPException(400, detail="holder_employee_id required")
    async with SessionLocal() as db:
        owner = (await db.execute(text(
            "SELECT id FROM key_register WHERE id=:id AND branch_id=:bid AND deleted_at IS NULL"
        ), {"id": key_id, "bid": ctx.branch_id})).first()
        if not owner:
            raise HTTPException(404, detail="Key not found")
        new_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO key_holdings
                (id, key_id, set_number, holder_employee_id,
                 issued_date, expected_return_date,
                 undertaking_required, notes,
                 created_by_user_id)
            VALUES (CAST(:id AS UUID), CAST(:kid AS UUID), :sn,
                    CAST(:hid AS UUID),
                    NULLIF(:iss,'')::date, NULLIF(:exp,'')::date,
                    :req, :notes,
                    NULLIF(:uid,'')::uuid)
        """), {
            "id": new_id, "kid": key_id,
            "sn": max(1, int(body.set_number or 1)),
            "hid": body.holder_employee_id,
            "iss": body.issued_date or date.today().isoformat(),
            "exp": body.expected_return_date or "",
            "req": bool(body.undertaking_required),
            "notes": body.notes or "",
            "uid": (getattr(ctx, "user_id", None) or "")
                if getattr(ctx, "user_id", "") not in ("", "anonymous") else "",
        })
        await _log_event(db, key_id=key_id, event_type="HOLDING_CREATED", ctx=ctx,
                         to_holder_id=body.holder_employee_id,
                         notes=f"Set #{body.set_number} issued")
        await db.commit()
    return {"id": new_id, "ok": True}


@router.post("/{key_id}/holdings/{holding_id}/return", status_code=200)
async def return_holding(key_id: str, holding_id: str, body: HoldingReturnIn,
                         ctx: CurrentSpace) -> dict[str, Any]:
    """Mark a holding as returned. Captures the date and an optional note;
    leaves the row in place so the audit trail stays intact."""
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE key_holdings SET
                returned_date = NULLIF(:rd,'')::date,
                status        = 'RETURNED',
                notes         = CASE WHEN :n <> '' THEN
                    CASE WHEN notes <> '' THEN notes || E'\n' || :n ELSE :n END
                    ELSE notes END,
                updated_at    = NOW()
            WHERE id = CAST(:id AS UUID) AND key_id = CAST(:kid AS UUID)
              AND deleted_at IS NULL
        """), {"id": holding_id, "kid": key_id,
               "rd": body.returned_date or date.today().isoformat(),
               "n": body.notes or ""})
        if not getattr(result, "rowcount", 0):
            raise HTTPException(404, detail="Holding not found")
        await _log_event(db, key_id=key_id, event_type="HOLDING_RETURNED", ctx=ctx,
                         notes=body.notes or "Returned")
        await db.commit()
    return {"ok": True}


@router.post("/{key_id}/holdings/{holding_id}/mark-lost", status_code=200)
async def mark_holding_lost(key_id: str, holding_id: str, body: HoldingReturnIn,
                            ctx: CurrentSpace) -> dict[str, Any]:
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE key_holdings SET status = 'LOST',
                notes = CASE WHEN :n <> '' THEN
                    CASE WHEN notes <> '' THEN notes || E'\n' || :n ELSE :n END
                    ELSE notes END,
                updated_at = NOW()
            WHERE id = CAST(:id AS UUID) AND key_id = CAST(:kid AS UUID)
              AND deleted_at IS NULL
        """), {"id": holding_id, "kid": key_id, "n": body.notes or ""})
        if not getattr(result, "rowcount", 0):
            raise HTTPException(404, detail="Holding not found")
        await _log_event(db, key_id=key_id, event_type="HOLDING_LOST", ctx=ctx,
                         notes=body.notes or "Reported lost")
        await db.commit()
    return {"ok": True}


@router.post("/{key_id}/holdings/{holding_id}/undertaking/mark-signed", status_code=200)
async def mark_holding_undertaking_signed(key_id: str, holding_id: str,
                                          body: UndertakingMarkIn,
                                          ctx: CurrentSpace) -> dict[str, Any]:
    """Per-holding undertaking — each set has its own signed undertaking
    because each holder signs separately."""
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE key_holdings SET
                undertaking_signed_at   = NOW(),
                undertaking_signed_name = :nm,
                undertaking_pdf_url     = COALESCE(NULLIF(:url, ''), undertaking_pdf_url),
                updated_at              = NOW()
            WHERE id = CAST(:id AS UUID) AND key_id = CAST(:kid AS UUID)
              AND deleted_at IS NULL
        """), {"id": holding_id, "kid": key_id,
               "nm": (body.signed_by_name or "")[:200],
               "url": body.pdf_url or ""})
        if not getattr(result, "rowcount", 0):
            raise HTTPException(404, detail="Holding not found")
        await _log_event(db, key_id=key_id, event_type="HOLDING_UNDERTAKING_SIGNED",
                         ctx=ctx, notes=f"Signed by {body.signed_by_name or 'holder'}")
        await db.commit()
    return {"ok": True}


@router.delete("/{key_id}/holdings/{holding_id}", status_code=200)
async def delete_holding(key_id: str, holding_id: str,
                         ctx: CurrentSpace) -> dict[str, Any]:
    """Soft-delete a holding (e.g. created in error). Audit trail preserved."""
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE key_holdings SET deleted_at = NOW()
            WHERE id = CAST(:id AS UUID) AND key_id = CAST(:kid AS UUID)
              AND deleted_at IS NULL
        """), {"id": holding_id, "kid": key_id})
        if not getattr(result, "rowcount", 0):
            raise HTTPException(404, detail="Holding not found")
        await _log_event(db, key_id=key_id, event_type="HOLDING_DELETED", ctx=ctx,
                         notes="Holding row removed")
        await db.commit()
    return {"ok": True}
