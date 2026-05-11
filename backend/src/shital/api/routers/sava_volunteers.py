"""Sava (one-day event) volunteer registration.

Lighter-weight than the long-term Volunteer Registration. For devotees who
want to help at a single event (Shila Pooja, Aarti, Langar, etc.) without
going through references / DBS / health declaration. Mirrors the SHITAL
Liability Event Volunteer Form V1.

Submissions land as PENDING. Trustees confirm or decline via admin. The
form is intentionally short — name, email, mobile, age, event, role
preferences, agreement — to minimise friction for one-off helpers.
"""
from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["sava-volunteers"])


VALID_ROLES = {
    "Queue Management", "Serving Food", "Shoes Handling", "Cleaning",
    "Reading", "Bhajans", "Kitchen Prep", "Traffic Management",
    "Data Entry", "Welcoming Devotees", "First Aid", "Security",
    "Setup / Teardown", "Other",
}

AGE_RANGES = {"Under 18", "18-25", "26-35", "36-45", "46-55", "55+"}


# ─── Models ───────────────────────────────────────────────────────────────────

class SavaRegistration(BaseModel):
    """Public Sava volunteer signup payload."""

    branch_id: str = "main"
    full_name: str
    email: str = ""
    mobile: str = ""
    postcode: str = ""
    age_range: str = ""

    event_name: str = ""           # e.g. "Shila Pooja"
    event_date: str = ""           # ISO yyyy-mm-dd; optional
    event_location: str = ""       # e.g. "The Pavilion Hall, Milton Keynes"

    preferred_roles: list[str] = Field(default_factory=list)
    additional_notes: str = ""

    # Agreement signatures the paper form requires. Both required by the
    # public flow — the green CTA is disabled until both checkboxes are
    # ticked client-side.
    agreement_agreed: bool = False


def _validate(s: SavaRegistration) -> list[str]:
    errs: list[str] = []
    if not s.full_name.strip():
        errs.append("Your full name is required")
    if not s.mobile.strip() and not s.email.strip():
        errs.append("Either email or mobile is required so we can confirm your slot")
    if s.email.strip() and "@" not in s.email:
        errs.append("Please provide a valid email address")
    if s.age_range and s.age_range not in AGE_RANGES:
        errs.append(f"age_range must be one of {sorted(AGE_RANGES)}")
    if not s.agreement_agreed:
        errs.append("You must agree to the volunteer responsibilities to register")
    if not s.preferred_roles:
        errs.append("Please pick at least one role you'd like to help with")
    bad = [r for r in s.preferred_roles if r not in VALID_ROLES]
    if bad:
        errs.append(f"Unknown role(s): {bad} — must be one of {sorted(VALID_ROLES)}")
    return errs


def _gen_reference() -> str:
    """SAVA-NNNNNN — 6 hex digits, scoped + readable on the paper sign-in sheet."""
    return f"SAVA-{uuid.uuid4().hex[:6].upper()}"


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )


def _jsonify(obj: Any) -> str:
    import json
    return json.dumps(obj)


# ─── Public endpoint — registration ───────────────────────────────────────────

@router.post("/service/sava-volunteers/register")
async def register_sava(body: SavaRegistration, request: Request) -> dict[str, Any]:
    """Public Sava signup. Creates a PENDING row, deduplicates the donor onto
    the contacts table by email so future flows (donations, long-term
    volunteer) recognise the same person."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    errs = _validate(body)
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    reference = _gen_reference()
    now = datetime.now(UTC)
    submitted_ip = (request.client.host if request.client else "")[:45]
    user_agent = (request.headers.get("user-agent") or "")[:500]
    email_key = body.email.strip().lower()

    event_date: date | None = None
    if body.event_date.strip():
        try:
            event_date = date.fromisoformat(body.event_date.strip())
        except ValueError:
            event_date = None  # don't reject — events may be open-ended

    full_name = body.full_name.strip()
    parts = full_name.split(maxsplit=1)
    first = parts[0] if parts else ""
    surname = parts[1] if len(parts) > 1 else ""

    async with SessionLocal() as db:
        # Upsert the volunteer onto the CRM contacts table — same pattern as
        # PayPal capture / long-term volunteer registration. Sava signups
        # share the same person record across all SHITAL touchpoints.
        contact_id: str | None = None
        if email_key:
            contact_uuid = str(uuid.uuid4())
            c_result = await db.execute(text("""
                INSERT INTO contacts
                    (id, email, first_name, surname, full_name, phone,
                     gdpr_consent, gdpr_consented_at,
                     first_source, first_branch_id, created_at, updated_at)
                VALUES
                    (:id, :email, :first, :surname, :name, :phone,
                     true, :now, 'sava-volunteer', :branch, :now, :now)
                ON CONFLICT (email) DO UPDATE SET
                    first_name = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
                    surname    = COALESCE(NULLIF(EXCLUDED.surname,''),    contacts.surname),
                    full_name  = COALESCE(NULLIF(EXCLUDED.full_name,''),  contacts.full_name),
                    phone      = COALESCE(NULLIF(EXCLUDED.phone,''),      contacts.phone),
                    updated_at = EXCLUDED.updated_at
                RETURNING id
            """), {
                "id": contact_uuid, "email": email_key,
                "first": first, "surname": surname, "name": full_name,
                "phone": body.mobile.strip(),
                "branch": body.branch_id, "now": now,
            })
            row = c_result.mappings().first()
            contact_id = str(row["id"]) if row else contact_uuid

        new_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO sava_volunteers
                (id, reference_number, branch_id,
                 full_name, email, mobile, postcode, age_range,
                 event_name, event_date, event_location,
                 preferred_roles, additional_notes,
                 agreement_signed_at, status, contact_id,
                 submitted_ip, user_agent, created_at, updated_at)
            VALUES
                (:id, :ref, :branch,
                 :name, :email, :mobile, :postcode, :age,
                 :ename, :edate, :eloc,
                 CAST(:roles AS jsonb), :notes,
                 :now, 'PENDING', :cid,
                 :ip, :ua, :now, :now)
        """), {
            "id": new_id, "ref": reference, "branch": body.branch_id,
            "name": full_name, "email": email_key, "mobile": body.mobile.strip(),
            "postcode": body.postcode.strip().upper(), "age": body.age_range,
            "ename": body.event_name.strip(), "edate": event_date,
            "eloc": body.event_location.strip(),
            "roles": _jsonify(body.preferred_roles),
            "notes": body.additional_notes.strip(),
            "now": now, "cid": contact_id,
            "ip": submitted_ip, "ua": user_agent,
        })
        await db.commit()

    return {
        "success": True,
        "reference_number": reference,
        "message": "Registration received. The event coordinator will contact you to confirm.",
    }


# ─── Admin — list + review ────────────────────────────────────────────────────

@router.get("/admin/sava-volunteers")
async def admin_list_sava(
    ctx: CurrentSpace,
    status_filter: str = "", search: str = "",
    limit: int = 100, offset: int = 0,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {"limit": min(max(1, limit), 500), "offset": max(0, offset)}
    if status_filter.strip():
        where.append("status = :status")
        params["status"] = status_filter.strip().upper()
    if search.strip():
        where.append(
            "(LOWER(full_name) LIKE :search OR LOWER(email) LIKE :search "
            "OR LOWER(reference_number) LIKE :search)"
        )
        params["search"] = f"%{search.strip().lower()}%"
    where_sql = "WHERE " + " AND ".join(where) if where else ""

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT id, reference_number, branch_id,
                   full_name, email, mobile, age_range,
                   event_name, event_date, event_location,
                   preferred_roles, status, created_at
            FROM   sava_volunteers
            {where_sql}
            ORDER  BY created_at DESC
            LIMIT  :limit OFFSET :offset
        """), params)
        items = []
        for r in rows.mappings():
            d = dict(r)
            for k in ("id",):
                d[k] = str(d[k])
            for k in ("created_at",):
                if d.get(k):
                    d[k] = d[k].isoformat()
            if d.get("event_date"):
                d["event_date"] = d["event_date"].isoformat()
            items.append(d)

        total_row = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM sava_volunteers {where_sql}"),
            params,
        )).mappings().one()

    return {"items": items, "total": int(total_row["c"])}


@router.get("/admin/sava-volunteers/{sava_id}")
async def admin_get_sava(sava_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT * FROM sava_volunteers WHERE id::text = :id"),
            {"id": sava_id},
        )).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Sava volunteer not found")
    rec = dict(row)
    for k in ("id", "contact_id"):
        if rec.get(k) is not None:
            rec[k] = str(rec[k])
    for k in ("created_at", "updated_at", "agreement_signed_at"):
        if rec.get(k):
            rec[k] = rec[k].isoformat()
    if rec.get("event_date"):
        rec["event_date"] = rec["event_date"].isoformat()
    return {"sava_volunteer": rec}


class SavaReviewBody(BaseModel):
    note: str = ""


@router.post("/admin/sava-volunteers/{sava_id}/confirm")
async def admin_confirm_sava(
    sava_id: str, body: SavaReviewBody, ctx: CurrentSpace,
) -> dict[str, Any]:
    return await _set_sava_status(sava_id, ctx, "CONFIRMED", body.note)


@router.post("/admin/sava-volunteers/{sava_id}/decline")
async def admin_decline_sava(
    sava_id: str, body: SavaReviewBody, ctx: CurrentSpace,
) -> dict[str, Any]:
    return await _set_sava_status(sava_id, ctx, "DECLINED", body.note)


async def _set_sava_status(
    sava_id: str, ctx: CurrentSpace, new_status: str, note: str,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        existing = (await db.execute(
            text("SELECT id FROM sava_volunteers WHERE id::text = :id"),
            {"id": sava_id},
        )).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Sava volunteer not found")
        await db.execute(text("""
            UPDATE sava_volunteers
            SET    status     = :status,
                   additional_notes = CASE WHEN :note != '' THEN
                       additional_notes || E'\\n\\n[' || :now || ' admin: ' || :actor || ']\\n' || :note
                       ELSE additional_notes END,
                   updated_at = :now
            WHERE  id::text = :id
        """), {
            "status": new_status, "note": note,
            "actor": ctx.user_email, "now": datetime.now(UTC),
            "id": sava_id,
        })
        await db.commit()
    return {"success": True, "status": new_status}
