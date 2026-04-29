"""CRM Contacts — admin endpoints for donor contact records."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(prefix="/admin/contacts", tags=["admin-contacts"])


class ContactInput(BaseModel):
    email: str = ""
    first_name: str = ""
    surname: str = ""
    full_name: str = ""
    phone: str = ""
    gdpr_consent: bool = False
    tac_consent: bool = False
    first_source: str = "admin"
    first_branch_id: str = ""


@router.get("")
async def list_contacts(
    q: str = "",
    source: str = "",
    page: int = 1,
    per_page: int = 50,
    space: CurrentSpace = None,  # type: ignore[assignment]
) -> dict[str, Any]:
    """List CRM contacts with donation totals. Supports search (q) and source filter."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    per_page = min(per_page, 200)
    offset = (page - 1) * per_page

    where_clauses = []
    params: dict[str, Any] = {"limit": per_page, "offset": offset}

    if q:
        where_clauses.append(
            "(c.email ILIKE :q OR c.full_name ILIKE :q OR c.phone ILIKE :q)"
        )
        params["q"] = f"%{q}%"
    if source:
        where_clauses.append("c.first_source = :source")
        params["source"] = source

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT
                c.id, c.email, c.first_name, c.surname, c.full_name, c.phone,
                c.gdpr_consent, c.gdpr_consented_at,
                c.tac_consent,  c.tac_consented_at,
                c.first_source, c.first_branch_id,
                c.created_at,   c.updated_at,
                COUNT(DISTINCT o.id)          AS order_count,
                COALESCE(SUM(o.total_amount), 0) AS total_donated,
                COUNT(DISTINCT rgs.id) FILTER (WHERE rgs.status = 'ACTIVE') AS active_subscriptions,
                (SELECT a.postcode FROM addresses a WHERE a.contact_id = c.id ORDER BY a.created_at DESC LIMIT 1) AS postcode,
                (SELECT a.uprn     FROM addresses a WHERE a.contact_id = c.id AND a.uprn != '' ORDER BY a.created_at DESC LIMIT 1) AS uprn
            FROM contacts c
            LEFT JOIN orders o   ON o.contact_id = c.id
            LEFT JOIN recurring_giving_subscriptions rgs ON rgs.contact_id = c.id
            {where_sql}
            GROUP BY c.id
            ORDER BY c.created_at DESC
            LIMIT :limit OFFSET :offset
        """), params)
        contacts = [dict(r._mapping) for r in rows]

        total_r = await db.execute(
            text(f"SELECT COUNT(*) FROM contacts c {where_sql}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )
        total = total_r.scalar() or 0

    return {"contacts": contacts, "total": total, "page": page, "per_page": per_page}


@router.get("/{contact_id}")
async def get_contact(contact_id: str, space: CurrentSpace = None) -> dict[str, Any]:  # type: ignore[assignment]
    """Single contact with addresses, orders, and subscriptions."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        c_r = await db.execute(
            text("SELECT * FROM contacts WHERE id = :id"), {"id": contact_id}
        )
        contact = c_r.mappings().first()
        if not contact:
            from fastapi import HTTPException
            raise HTTPException(404, detail="Contact not found")

        addr_r = await db.execute(
            text("SELECT * FROM addresses WHERE contact_id = :id ORDER BY created_at DESC"),
            {"id": contact_id},
        )
        addresses = [dict(r._mapping) for r in addr_r]

        orders_r = await db.execute(
            text("""
                SELECT id, reference, status, total_amount, currency,
                       payment_provider, payment_ref, paypal_capture_id,
                       created_at
                FROM orders WHERE contact_id = :id ORDER BY created_at DESC LIMIT 50
            """),
            {"id": contact_id},
        )
        orders = [dict(r._mapping) for r in orders_r]

        ga_r = await db.execute(
            text("""
                SELECT id, order_ref, full_name, postcode, address, uprn,
                       donation_amount, donation_date, gift_aid_agreed,
                       hmrc_submitted, created_at
                FROM gift_aid_declarations WHERE contact_id = :id ORDER BY created_at DESC LIMIT 50
            """),
            {"id": contact_id},
        )
        gift_aid = [dict(r._mapping) for r in ga_r]

        subs_r = await db.execute(
            text("""
                SELECT s.id, s.paypal_subscription_id, s.amount, s.frequency,
                       s.status, s.approved_at, s.created_at, t.label AS tier_label
                FROM recurring_giving_subscriptions s
                LEFT JOIN recurring_giving_tiers t ON t.id = s.tier_id
                WHERE s.contact_id = :id ORDER BY s.created_at DESC
            """),
            {"id": contact_id},
        )
        subscriptions = [dict(r._mapping) for r in subs_r]

    return {
        "contact": dict(contact),
        "addresses": addresses,
        "orders": orders,
        "gift_aid_declarations": gift_aid,
        "subscriptions": subscriptions,
    }


@router.post("")
async def create_contact(body: ContactInput, space: CurrentSpace = None) -> dict[str, Any]:  # type: ignore[assignment]
    """Create a contact directly from admin (e.g. when linking to an account)."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    full_name = body.full_name.strip() or f"{body.first_name} {body.surname}".strip()
    if not full_name and not body.email:
        raise HTTPException(400, detail="Provide at least a name or email")

    new_id = str(uuid.uuid4())
    now = datetime.utcnow()
    email_key = body.email.strip().lower() or None

    async with SessionLocal() as db:
        # Upsert by email if given — otherwise plain insert
        if email_key:
            r = await db.execute(text("""
                INSERT INTO contacts
                    (id, email, first_name, surname, full_name, phone,
                     gdpr_consent, gdpr_consented_at, tac_consent, tac_consented_at,
                     first_source, first_branch_id, created_at, updated_at)
                VALUES
                    (:id, :email, :first, :surname, :name, :phone,
                     :gdpr, :gdpr_at, :tac, :tac_at,
                     :src, :branch, :now, :now)
                ON CONFLICT (email) DO UPDATE SET
                    first_name = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
                    surname    = COALESCE(NULLIF(EXCLUDED.surname,''),    contacts.surname),
                    full_name  = COALESCE(NULLIF(EXCLUDED.full_name,''),  contacts.full_name),
                    phone      = COALESCE(NULLIF(EXCLUDED.phone,''),      contacts.phone),
                    updated_at = EXCLUDED.updated_at
                RETURNING id
            """), {
                "id": new_id, "email": email_key,
                "first": body.first_name, "surname": body.surname,
                "name": full_name, "phone": body.phone,
                "gdpr": body.gdpr_consent, "gdpr_at": now if body.gdpr_consent else None,
                "tac": body.tac_consent, "tac_at": now if body.tac_consent else None,
                "src": body.first_source, "branch": body.first_branch_id, "now": now,
            })
            row = r.mappings().first()
            contact_id = str(row["id"]) if row else new_id
        else:
            await db.execute(text("""
                INSERT INTO contacts
                    (id, first_name, surname, full_name, phone,
                     gdpr_consent, gdpr_consented_at, tac_consent, tac_consented_at,
                     first_source, first_branch_id, created_at, updated_at)
                VALUES
                    (:id, :first, :surname, :name, :phone,
                     :gdpr, :gdpr_at, :tac, :tac_at,
                     :src, :branch, :now, :now)
            """), {
                "id": new_id, "first": body.first_name, "surname": body.surname,
                "name": full_name, "phone": body.phone,
                "gdpr": body.gdpr_consent, "gdpr_at": now if body.gdpr_consent else None,
                "tac": body.tac_consent, "tac_at": now if body.tac_consent else None,
                "src": body.first_source, "branch": body.first_branch_id, "now": now,
            })
            contact_id = new_id
        await db.commit()

    return {"id": contact_id, "ok": True, "full_name": full_name, "email": email_key or ""}


@router.patch("/{contact_id}")
async def update_contact(contact_id: str, body: ContactInput, space: CurrentSpace = None) -> dict[str, Any]:  # type: ignore[assignment]
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    full_name = body.full_name.strip() or f"{body.first_name} {body.surname}".strip()

    async with SessionLocal() as db:
        r = await db.execute(text("""
            UPDATE contacts SET
                email      = COALESCE(NULLIF(:email, ''), email),
                first_name = :first,
                surname    = :surname,
                full_name  = :name,
                phone      = :phone,
                updated_at = NOW()
            WHERE id = :id
            RETURNING id
        """), {
            "id": contact_id,
            "email": body.email.strip().lower(),
            "first": body.first_name, "surname": body.surname,
            "name": full_name, "phone": body.phone,
        })
        if not r.mappings().first():
            raise HTTPException(404, detail="Contact not found")
        await db.commit()
    return {"ok": True}


@router.delete("/{contact_id}")
async def delete_contact(contact_id: str, space: CurrentSpace = None) -> dict[str, Any]:  # type: ignore[assignment]
    """Hard-delete a contact (CRM cleanup). FK cascades clean addresses + links."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        await db.execute(text("DELETE FROM contacts WHERE id = :id"), {"id": contact_id})
        await db.commit()
    return {"ok": True}
