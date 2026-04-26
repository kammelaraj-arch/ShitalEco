"""CRM Contacts — admin read endpoints for donor contact records."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from shital.api.deps import CurrentSpace

router = APIRouter(prefix="/admin/contacts", tags=["admin-contacts"])


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
