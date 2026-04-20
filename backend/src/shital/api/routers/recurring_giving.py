"""Recurring (monthly) giving — PayPal Subscriptions integration."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["recurring-giving"])

_LIVE    = "https://api-m.paypal.com"
_SANDBOX = "https://api-m.sandbox.paypal.com"

_PAYPAL_PRODUCT_ID_KEY = "__paypal_giving_product_id__"


# ── Shared PayPal helpers ────────────────────────────────────────────────────

async def _base() -> str:
    from shital.core.fabrics.secrets import SecretsManager
    env = await SecretsManager.get("PAYPAL_ENV") or "live"
    return _LIVE if env == "live" else _SANDBOX


async def _token() -> str:
    from shital.core.fabrics.secrets import SecretsManager
    client_id = await SecretsManager.get("PAYPAL_CLIENT_ID") or ""
    secret    = await SecretsManager.get("PAYPAL_CLIENT_SECRET") or ""
    if not client_id or not secret:
        raise HTTPException(503, detail="PayPal credentials not configured")
    base = await _base()
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            f"{base}/v1/oauth2/token",
            auth=(client_id, secret),
            data={"grant_type": "client_credentials"},
        )
        r.raise_for_status()
        return r.json()["access_token"]


async def _ensure_product(token: str, base: str) -> str:
    """Get or create the PayPal product for temple giving. Cached in api_keys_store."""
    from shital.core.fabrics.secrets import SecretsManager
    existing = await SecretsManager.get(_PAYPAL_PRODUCT_ID_KEY)
    if existing:
        return existing
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{base}/v1/catalogs/products",
            headers=headers,
            json={
                "name": "Shital Temple Monthly Giving",
                "type": "SERVICE",
                "category": "CHARITY",
                "description": "Regular monthly support for Shri Shirdi Saibaba Temple (SHITAL)",
            },
        )
        r.raise_for_status()
        product_id = r.json()["id"]
    await SecretsManager.set(_PAYPAL_PRODUCT_ID_KEY, product_id, "system")
    return product_id


async def _ensure_plan(tier_id: str, amount: float, label: str, frequency: str) -> str:
    """Get or create a PayPal billing plan for a tier. Returns plan_id."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = await db.execute(
            text("SELECT paypal_plan_id FROM recurring_giving_tiers WHERE id = :id"),
            {"id": tier_id},
        )
        existing = row.scalar_one_or_none()
    if existing:
        return existing

    token = await _token()
    base  = await _base()
    product_id = await _ensure_product(token, base)

    interval_unit = {"MONTH": "MONTH", "WEEK": "WEEK", "YEAR": "YEAR"}.get(frequency, "MONTH")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{base}/v1/billing/plans",
            headers=headers,
            json={
                "product_id": product_id,
                "name": f"£{amount:.2f}/{frequency.lower()} — {label}",
                "status": "ACTIVE",
                "billing_cycles": [{
                    "frequency": {"interval_unit": interval_unit, "interval_count": 1},
                    "tenure_type": "REGULAR",
                    "sequence": 1,
                    "total_cycles": 0,
                    "pricing_scheme": {
                        "fixed_price": {"value": f"{amount:.2f}", "currency_code": "GBP"},
                    },
                }],
                "payment_preferences": {
                    "auto_bill_outstanding": True,
                    "payment_failure_threshold": 3,
                },
            },
        )
        r.raise_for_status()
        plan_id = r.json()["id"]

    async with SessionLocal() as db:
        await db.execute(
            text("UPDATE recurring_giving_tiers SET paypal_plan_id = :pid, updated_at = NOW() WHERE id = :id"),
            {"pid": plan_id, "id": tier_id},
        )
        await db.commit()
    return plan_id


# ── Public endpoints ─────────────────────────────────────────────────────────

@router.get("/service/giving/tiers")
async def list_giving_tiers() -> dict[str, Any]:
    """Return active giving tiers for the donation portal."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT id, amount, label, description, frequency, is_default, display_order
            FROM   recurring_giving_tiers
            WHERE  is_active = true
            ORDER  BY display_order, amount
        """))
        tiers = [dict(r._mapping) for r in rows]
    return {"tiers": tiers}


class SubscribeBody(BaseModel):
    tier_id: str
    branch_id: str = "main"
    donor_first_name: str = ""
    donor_surname: str = ""
    donor_email: str = ""
    donor_postcode: str = ""
    donor_address: str = ""


@router.post("/service/giving/subscribe")
async def get_plan_for_subscription(body: SubscribeBody) -> dict[str, str]:
    """Return the PayPal plan_id for a tier so the frontend can create a subscription."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = await db.execute(
            text("SELECT id, amount, label, frequency FROM recurring_giving_tiers WHERE id = :id AND is_active = true"),
            {"id": body.tier_id},
        )
        tier = row.mappings().one_or_none()
    if not tier:
        raise HTTPException(404, detail="Giving tier not found")

    plan_id = await _ensure_plan(str(tier["id"]), float(tier["amount"]), tier["label"], tier["frequency"])
    return {"plan_id": plan_id, "amount": f"{tier['amount']:.2f}", "frequency": tier["frequency"]}


class ApproveBody(BaseModel):
    subscription_id: str
    plan_id: str
    tier_id: str
    amount: float
    frequency: str = "MONTH"
    branch_id: str = "main"
    donor_first_name: str = ""
    donor_surname: str = ""
    donor_email: str = ""
    donor_postcode: str = ""
    donor_address: str = ""


@router.post("/service/giving/subscription/approve")
async def approve_subscription(body: ApproveBody) -> dict[str, Any]:
    """Record a donor-approved PayPal subscription in the database."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    full_name = f"{body.donor_first_name} {body.donor_surname}".strip()
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO recurring_giving_subscriptions
                (id, paypal_subscription_id, paypal_plan_id, tier_id, amount, frequency,
                 status, branch_id, donor_name, donor_email,
                 donor_first_name, donor_surname, donor_postcode, donor_address,
                 approved_at, created_at, updated_at)
            VALUES
                (:id, :sub_id, :plan_id, :tier_id, :amount, :freq,
                 'ACTIVE', :branch, :name, :email,
                 :first_name, :surname, :postcode, :address,
                 :now, :now, :now)
            ON CONFLICT (paypal_subscription_id) DO UPDATE
                SET status = 'ACTIVE', approved_at = :now, updated_at = :now,
                    donor_name = :name, donor_email = :email,
                    donor_first_name = :first_name, donor_surname = :surname,
                    donor_postcode = :postcode, donor_address = :address
        """), {
            "id": str(uuid.uuid4()), "sub_id": body.subscription_id,
            "plan_id": body.plan_id, "tier_id": body.tier_id,
            "amount": body.amount, "freq": body.frequency,
            "branch": body.branch_id, "name": full_name, "email": body.donor_email,
            "first_name": body.donor_first_name, "surname": body.donor_surname,
            "postcode": body.donor_postcode, "address": body.donor_address,
            "now": now,
        })
        await db.commit()
    return {"success": True, "subscription_id": body.subscription_id}


# ── Admin endpoints ──────────────────────────────────────────────────────────

@router.get("/admin/giving/tiers")
async def admin_list_tiers(space: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT t.id, t.amount, t.label, t.description, t.frequency,
                   t.is_active, t.is_default, t.display_order, t.paypal_plan_id,
                   t.created_at, t.updated_at,
                   COUNT(s.id) FILTER (WHERE s.status = 'ACTIVE') AS active_subscribers
            FROM   recurring_giving_tiers t
            LEFT JOIN recurring_giving_subscriptions s ON s.tier_id = t.id
            GROUP  BY t.id
            ORDER  BY t.display_order, t.amount
        """))
        tiers = [dict(r._mapping) for r in rows]
    return {"tiers": tiers}


class TierBody(BaseModel):
    amount: float
    label: str
    description: str = ""
    frequency: str = "MONTH"
    is_active: bool = True
    is_default: bool = False
    display_order: int = 0


@router.post("/admin/giving/tiers")
async def admin_create_tier(body: TierBody, space: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    tier_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        if body.is_default:
            await db.execute(text("UPDATE recurring_giving_tiers SET is_default = false"))
        await db.execute(text("""
            INSERT INTO recurring_giving_tiers
                (id, amount, label, description, frequency, is_active, is_default, display_order)
            VALUES (:id, :amt, :label, :desc, :freq, :active, :default, :order)
        """), {
            "id": tier_id, "amt": body.amount, "label": body.label,
            "desc": body.description, "freq": body.frequency,
            "active": body.is_active, "default": body.is_default, "order": body.display_order,
        })
        await db.commit()
    return {"id": tier_id}


@router.put("/admin/giving/tiers/{tier_id}")
async def admin_update_tier(tier_id: str, body: TierBody, space: CurrentSpace) -> dict[str, str]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        if body.is_default:
            await db.execute(text("UPDATE recurring_giving_tiers SET is_default = false WHERE id != :id"), {"id": tier_id})
        await db.execute(text("""
            UPDATE recurring_giving_tiers
            SET amount=:amt, label=:label, description=:desc, frequency=:freq,
                is_active=:active, is_default=:default, display_order=:order,
                paypal_plan_id='', updated_at=NOW()
            WHERE id=:id
        """), {
            "id": tier_id, "amt": body.amount, "label": body.label,
            "desc": body.description, "freq": body.frequency,
            "active": body.is_active, "default": body.is_default, "order": body.display_order,
        })
        await db.commit()
    return {"status": "updated"}


@router.delete("/admin/giving/tiers/{tier_id}")
async def admin_delete_tier(tier_id: str, space: CurrentSpace) -> dict[str, str]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(
            text("UPDATE recurring_giving_tiers SET is_active = false, updated_at = NOW() WHERE id = :id"),
            {"id": tier_id},
        )
        await db.commit()
    return {"status": "deactivated"}


@router.get("/admin/giving/subscriptions")
async def admin_list_subscriptions(space: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT s.id, s.paypal_subscription_id, s.amount, s.frequency, s.status,
                   s.donor_name, s.donor_email, s.branch_id, s.approved_at, s.created_at,
                   t.label AS tier_label
            FROM   recurring_giving_subscriptions s
            LEFT JOIN recurring_giving_tiers t ON t.id = s.tier_id
            ORDER  BY s.created_at DESC
            LIMIT  200
        """))
        subs = [dict(r._mapping) for r in rows]
    return {"subscriptions": subs}
