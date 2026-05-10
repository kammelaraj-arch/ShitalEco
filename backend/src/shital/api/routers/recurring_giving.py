"""Recurring (monthly) giving — PayPal Subscriptions integration."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
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
    """Get or create a PayPal billing plan for a tier. Returns plan_id.

    `tier_id == 'custom'` is the bespoke-amount path: there's no DB row, so
    skip the cache lookup + cache write and create a fresh plan every call.
    Custom plans are intentionally one-off; PayPal's billing plans API
    handles thousands without issue."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    is_custom = tier_id == "custom"
    if not is_custom:
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

    if not is_custom:
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
    """Return active giving tiers for the donation portal.

    Deduplicated by (amount, label) — the table has historically accumulated
    duplicate rows from re-seeds, and the public flow must show each tier once.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT id, amount, label, description, frequency, is_default, display_order
            FROM (
                SELECT DISTINCT ON (amount, label)
                       id, amount, label, description, frequency, is_default, display_order
                FROM   recurring_giving_tiers
                WHERE  is_active = true
                ORDER  BY amount, label, is_default DESC, display_order, id
            ) t
            ORDER BY display_order, amount
        """))
        tiers = [dict(r._mapping) for r in rows]
    return {"tiers": tiers}


class SubscribeBody(BaseModel):
    tier_id: str
    branch_id: str = "main"
    donor_first_name: str = ""
    donor_surname: str = ""
    donor_email: str = ""
    donor_phone: str = ""
    donor_postcode: str = ""
    donor_address: str = ""
    # Custom amount path — when tier_id == 'custom' the frontend sends a
    # bespoke £/month figure rather than a stored tier. We create an inline
    # PayPal plan for it (no DB pollution from one-offs).
    custom_amount: float | None = None
    custom_label: str = "Custom Monthly Gift"


@router.post("/service/giving/subscribe")
async def get_plan_for_subscription(body: SubscribeBody) -> dict[str, str]:
    """Return the PayPal plan_id for a tier so the frontend can create a subscription.

    Also persists the donor's contact details before the PayPal popup opens, so
    abandoned subscriptions (donor closes PayPal without paying) leave a usable
    CRM record we can email a recovery link to. The subsequent
    `/subscription/approve` call upgrades `first_source` from
    `monthly-giving-pending` to `monthly-giving` to mark it complete.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    # Custom-amount path — no row in recurring_giving_tiers; build a
    # synthetic tier dict so the rest of the flow (plan creation, donor
    # persist, response) is identical to the preset-tier path.
    tier: dict[str, Any]
    if body.tier_id == "custom":
        amount = float(body.custom_amount or 0)
        if amount < 1 or amount > 1000:
            raise HTTPException(400, detail="Custom amount must be between £1 and £1,000")
        tier = {
            "id": "custom",
            "amount": amount,
            "label": (body.custom_label or "Custom Monthly Gift").strip()[:100],
            "frequency": "MONTH",
        }
    else:
        async with SessionLocal() as db:
            row = await db.execute(
                text("SELECT id, amount, label, frequency FROM recurring_giving_tiers WHERE id = :id AND is_active = true"),
                {"id": body.tier_id},
            )
            row_obj = row.mappings().one_or_none()
        if not row_obj:
            raise HTTPException(404, detail="Giving tier not found")
        tier = dict(row_obj)

    plan_id = await _ensure_plan(
        str(tier["id"]),
        float(tier["amount"]),  # type: ignore[arg-type]
        str(tier["label"]),
        str(tier["frequency"]),
    )

    # Persist donor info now (pre-PayPal) so we don't lose abandons. Email is
    # the dedup key — without it we have no recovery channel anyway, so skip
    # the upsert. Wrapped in its own try so a CRM hiccup never blocks the
    # plan_id response (PayPal flow must continue regardless).
    email_key = body.donor_email.strip().lower() if body.donor_email.strip() else None
    if email_key:
        try:
            full_name = f"{body.donor_first_name} {body.donor_surname}".strip()
            now = datetime.utcnow()
            async with SessionLocal() as db:
                c_result = await db.execute(text("""
                    INSERT INTO contacts
                        (id, email, first_name, surname, full_name, phone,
                         gdpr_consent, gdpr_consented_at, tac_consent, tac_consented_at,
                         first_source, first_branch_id, created_at, updated_at)
                    VALUES
                        (:id, :email, :first, :surname, :name, :phone,
                         true, :now, true, :now,
                         'monthly-giving-pending', :branch, :now, :now)
                    ON CONFLICT (email) DO UPDATE SET
                        first_name        = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
                        surname           = COALESCE(NULLIF(EXCLUDED.surname,''),    contacts.surname),
                        full_name         = COALESCE(NULLIF(EXCLUDED.full_name,''),  contacts.full_name),
                        phone             = COALESCE(NULLIF(EXCLUDED.phone,''),      contacts.phone),
                        updated_at        = EXCLUDED.updated_at
                    RETURNING id
                """), {
                    "id": str(uuid.uuid4()), "email": email_key,
                    "first": body.donor_first_name or "", "surname": body.donor_surname or "",
                    "name": full_name, "phone": body.donor_phone or "",
                    "branch": body.branch_id, "now": now,
                })
                c_row = c_result.mappings().first()
                contact_id = str(c_row["id"]) if c_row else None

                if contact_id and body.donor_postcode:
                    await db.execute(text("""
                        INSERT INTO addresses
                            (id, contact_id, formatted, postcode, uprn,
                             is_primary, lookup_source, created_at)
                        VALUES (:id, :cid, :fmt, :pc, '', true, 'monthly-giving-pending', :now)
                        ON CONFLICT DO NOTHING
                    """), {
                        "id": str(uuid.uuid4()), "cid": contact_id,
                        "fmt": body.donor_address or "", "pc": body.donor_postcode, "now": now,
                    })
                await db.commit()
        except Exception:
            pass  # CRM upsert must never block the PayPal plan response

    return {
        "plan_id": plan_id,
        "amount": f"{float(tier['amount']):.2f}",  # type: ignore[arg-type]
        "frequency": str(tier["frequency"]),
    }


class ApproveBody(BaseModel):
    subscription_id: str
    plan_id: str
    tier_id: str | None = None  # optional — kiosk signups have no tier
    amount: float
    frequency: str = "MONTH"
    branch_id: str = "main"
    donor_first_name: str = ""
    donor_surname: str = ""
    donor_email: str = ""
    donor_phone: str = ""
    donor_postcode: str = ""
    donor_address: str = ""


@router.post("/service/giving/subscription/approve")
async def approve_subscription(body: ApproveBody) -> dict[str, Any]:
    """Record a donor-approved PayPal subscription in the database."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    full_name = f"{body.donor_first_name} {body.donor_surname}".strip()
    email_key = body.donor_email.strip().lower() if body.donor_email.strip() else None

    async with SessionLocal() as db:
        # ── Upsert CRM contact ──────────────────────────────────────────────
        contact_id: str | None = None
        if email_key:
            contact_uuid = str(uuid.uuid4())
            c_result = await db.execute(text("""
                INSERT INTO contacts
                    (id, email, first_name, surname, full_name, phone,
                     gdpr_consent, gdpr_consented_at, tac_consent, tac_consented_at,
                     first_source, first_branch_id, created_at, updated_at)
                VALUES
                    (:id, :email, :first, :surname, :name, :phone,
                     true, :now, true, :now,
                     'monthly-giving', :branch, :now, :now)
                ON CONFLICT (email) DO UPDATE SET
                    first_name        = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
                    surname           = COALESCE(NULLIF(EXCLUDED.surname,''),    contacts.surname),
                    full_name         = COALESCE(NULLIF(EXCLUDED.full_name,''),  contacts.full_name),
                    phone             = COALESCE(NULLIF(EXCLUDED.phone,''),      contacts.phone),
                    gdpr_consent      = true,
                    gdpr_consented_at = COALESCE(contacts.gdpr_consented_at, EXCLUDED.gdpr_consented_at),
                    tac_consent       = true,
                    tac_consented_at  = COALESCE(contacts.tac_consented_at,  EXCLUDED.tac_consented_at),
                    updated_at        = EXCLUDED.updated_at
                RETURNING id
            """), {
                "id": contact_uuid, "email": email_key,
                "first": body.donor_first_name or "", "surname": body.donor_surname or "",
                "name": full_name, "phone": body.donor_phone or "",
                "branch": body.branch_id, "now": now,
            })
            row = c_result.mappings().first()
            contact_id = str(row["id"]) if row else contact_uuid

            # ── Upsert address if postcode provided ─────────────────────────
            if body.donor_postcode:
                await db.execute(text("""
                    INSERT INTO addresses
                        (id, contact_id, formatted, postcode, uprn,
                         is_primary, lookup_source, created_at)
                    VALUES (:id, :cid, :fmt, :pc, '', true, 'monthly-giving', :now)
                """), {
                    "id": str(uuid.uuid4()), "cid": contact_id,
                    "fmt": body.donor_address or "", "pc": body.donor_postcode, "now": now,
                })

        # ── Record subscription ─────────────────────────────────────────────
        await db.execute(text("""
            INSERT INTO recurring_giving_subscriptions
                (id, paypal_subscription_id, paypal_plan_id, tier_id, amount, frequency,
                 status, branch_id, donor_name, donor_email,
                 donor_first_name, donor_surname, donor_postcode, donor_address,
                 contact_id, approved_at, created_at, updated_at)
            VALUES
                (:id, :sub_id, :plan_id, :tier_id, :amount, :freq,
                 'ACTIVE', :branch, :name, :email,
                 :first_name, :surname, :postcode, :address,
                 :cid, :now, :now, :now)
            ON CONFLICT (paypal_subscription_id) DO UPDATE
                SET status = 'ACTIVE', approved_at = :now, updated_at = :now,
                    donor_name = :name, donor_email = :email,
                    donor_first_name = :first_name, donor_surname = :surname,
                    donor_postcode = :postcode, donor_address = :address,
                    contact_id = COALESCE(recurring_giving_subscriptions.contact_id, EXCLUDED.contact_id)
        """), {
            "id": str(uuid.uuid4()), "sub_id": body.subscription_id,
            "plan_id": body.plan_id, "tier_id": body.tier_id or None,
            "amount": body.amount, "freq": body.frequency,
            "branch": body.branch_id, "name": full_name, "email": body.donor_email,
            "first_name": body.donor_first_name, "surname": body.donor_surname,
            "postcode": body.donor_postcode, "address": body.donor_address,
            "cid": contact_id, "now": now,
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
                   s.last_payment_at, s.total_payments, s.next_billing_date,
                   t.label AS tier_label
            FROM   recurring_giving_subscriptions s
            LEFT JOIN recurring_giving_tiers t ON t.id = s.tier_id
            ORDER  BY s.created_at DESC
            LIMIT  200
        """))
        subs = [dict(r._mapping) for r in rows]
    return {"subscriptions": subs}


# ── PayPal Webhook ────────────────────────────────────────────────────────────

async def _verify_paypal_webhook(
    transmission_id: str, transmission_time: str, auth_algo: str,
    cert_url: str, transmission_sig: str, webhook_id: str, event: dict,
) -> bool:
    """Call PayPal's verify-webhook-signature endpoint. Returns True if valid."""
    try:
        token = await _token()
        base  = await _base()
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"{base}/v1/notifications/verify-webhook-signature",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={
                    "auth_algo": auth_algo,
                    "cert_url": cert_url,
                    "transmission_id": transmission_id,
                    "transmission_sig": transmission_sig,
                    "transmission_time": transmission_time,
                    "webhook_id": webhook_id,
                    "webhook_event": event,
                },
            )
            return r.json().get("verification_status") == "SUCCESS"
    except Exception:
        return False


async def _ensure_subscription_columns() -> None:
    """Add tracking columns to recurring_giving_subscriptions if not present.

    Belt-and-braces: schema patches in main.py run on startup, but this is
    called from the webhook path so a fresh deploy that receives a webhook
    before main.py finishes won't 500. All ALTERs are IF NOT EXISTS so the
    second call is a no-op.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        for stmt in [
            "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS last_payment_at      TIMESTAMPTZ",
            "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS last_payment_amount  NUMERIC(10,2)",
            "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS next_billing_date    DATE",
            "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS total_payments       INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS failed_payment_count INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS last_failure_at      TIMESTAMPTZ",
            "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS last_failure_reason  VARCHAR(500) NOT NULL DEFAULT ''",
            "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS cancel_reason        VARCHAR(500) NOT NULL DEFAULT ''",
            "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS cancelled_by         VARCHAR(255) NOT NULL DEFAULT ''",
        ]:
            await db.execute(text(stmt))
        await db.commit()


async def _record_webhook_event(event: dict) -> tuple[str, bool]:
    """Persist the raw webhook event idempotently. Returns (row_uuid, is_new).

    Idempotent on PayPal's event id — if the same event is delivered twice
    (which PayPal does on retries) the second insert is a no-op and we
    skip processing. Stored before any business logic so a crash mid-handler
    still leaves a record we can replay.
    """
    import json

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    event_id   = event.get("id") or f"local-{uuid.uuid4()}"
    event_type = event.get("event_type", "")
    resource   = event.get("resource", {}) or {}
    sub_id     = resource.get("id", "") or resource.get("billing_agreement_id", "")
    res_id     = resource.get("id", "")

    new_uuid = str(uuid.uuid4())
    async with SessionLocal() as db:
        result = await db.execute(text("""
            INSERT INTO recurring_giving_webhook_events
                (id, event_id, event_type, subscription_id, resource_id, payload)
            VALUES
                (:id, :eid, :etype, :sid, :rid, CAST(:payload AS jsonb))
            ON CONFLICT (event_id) DO NOTHING
            RETURNING id
        """), {
            "id": new_uuid, "eid": event_id, "etype": event_type,
            "sid": sub_id, "rid": res_id,
            "payload": json.dumps(event),
        })
        row = result.mappings().first()
        await db.commit()
        return (str(row["id"]) if row else new_uuid, row is not None)


async def _mark_event_processed(event_id: str, error: str = "") -> None:
    """Flag the event as processed (or store the error for retry)."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE recurring_giving_webhook_events
            SET    processed    = :ok,
                   processed_at = CASE WHEN :ok THEN NOW() ELSE processed_at END,
                   error        = :err,
                   retry_count  = retry_count + CASE WHEN :ok THEN 0 ELSE 1 END
            WHERE  event_id = :eid
        """), {"ok": not error, "err": error, "eid": event_id})
        await db.commit()


async def _handle_payment_failed(resource: dict) -> None:
    """BILLING.SUBSCRIPTION.PAYMENT.FAILED — donor's funding source declined.

    PayPal will retry on its own schedule (typically 5/7/10 days). We bump
    the counter + remember the reason so admin can see the decline streak
    and reach out before PayPal auto-suspends after the final retry.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    sub_id = resource.get("id", "") or resource.get("billing_agreement_id", "")
    if not sub_id:
        return
    reason = (resource.get("status_change_note", "")
              or resource.get("reason", "")
              or "Payment failed")[:500]

    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE recurring_giving_subscriptions
            SET    failed_payment_count = COALESCE(failed_payment_count, 0) + 1,
                   last_failure_at      = NOW(),
                   last_failure_reason  = :reason,
                   updated_at           = NOW()
            WHERE  paypal_subscription_id = :sid
        """), {"sid": sub_id, "reason": reason})
        await db.commit()


async def _handle_subscription_updated(resource: dict) -> None:
    """BILLING.SUBSCRIPTION.UPDATED — donor changed amount/plan via PayPal.

    PayPal lets subscribers edit the plan without our involvement; we sync
    the new amount + plan id so the admin view doesn't lie.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    sub_id = resource.get("id", "")
    if not sub_id:
        return
    plan_id = resource.get("plan_id", "")
    billing = resource.get("billing_info", {}) or {}
    last_payment = billing.get("last_payment", {}) or {}
    next_billing = billing.get("next_billing_time", "") or ""
    amount_str = last_payment.get("amount", {}).get("value")

    next_billing_date = None
    if next_billing:
        try:
            next_billing_date = datetime.fromisoformat(
                next_billing.replace("Z", "+00:00")
            ).date()
        except Exception:
            next_billing_date = None

    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE recurring_giving_subscriptions
            SET    paypal_plan_id    = COALESCE(NULLIF(:plan,''), paypal_plan_id),
                   amount            = COALESCE(:amount::DECIMAL, amount),
                   next_billing_date = COALESCE(:next_billing, next_billing_date),
                   updated_at        = NOW()
            WHERE  paypal_subscription_id = :sid
        """), {
            "sid": sub_id, "plan": plan_id,
            "amount": amount_str, "next_billing": next_billing_date,
        })
        await db.commit()


async def _handle_sale_refund(resource: dict, event_type: str) -> None:
    """PAYMENT.SALE.REFUNDED / REVERSED — flip the donation row to REFUNDED.

    Doesn't touch the subscription itself (it stays ACTIVE — only this one
    payment was reversed). Total_payments stays as-is so reporting still
    reflects the original capture; finance reads donations.status to net out.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    parent_payment = resource.get("parent_payment", "") or resource.get("sale_id", "")
    if not parent_payment:
        return
    status = "REFUNDED" if event_type == "PAYMENT.SALE.REFUNDED" else "REVERSED"

    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE donations
            SET    status     = :status,
                   updated_at = NOW()
            WHERE  payment_ref = :pref
              AND  payment_provider = 'paypal'
        """), {"status": status, "pref": parent_payment})
        await db.commit()


async def _handle_payment_completed(resource: dict, event_type: str) -> None:
    """
    Handle PAYMENT.SALE.COMPLETED (v1 billing) and
    BILLING.SUBSCRIPTION.PAYMENT.COMPLETED (v2 billing).
    Creates a donations row and updates subscription tracking columns.
    """
    from decimal import Decimal

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    # Extract subscription_id and amount depending on event shape
    if event_type == "PAYMENT.SALE.COMPLETED":
        sub_id = resource.get("billing_agreement_id", "")
        amount_str = resource.get("amount", {}).get("total", "0")
        currency   = resource.get("amount", {}).get("currency", "GBP")
        payment_ref = resource.get("id", "")          # sale ID
        paid_at_str = resource.get("create_time", "")
    else:  # BILLING.SUBSCRIPTION.PAYMENT.COMPLETED
        sub_id = resource.get("id", "")
        amount_obj = resource.get("amount_with_breakdown", {}).get("gross_amount", {})
        amount_str = amount_obj.get("value", "0")
        currency   = amount_obj.get("currency_code", "GBP")
        payment_ref = resource.get("id", "")
        paid_at_str = resource.get("time", "")

    if not sub_id:
        return

    try:
        paid_at = datetime.fromisoformat(paid_at_str.replace("Z", "+00:00"))
    except Exception:
        paid_at = datetime.utcnow()

    amount = float(Decimal(amount_str or "0"))
    idem_key = f"paypal-sub-payment-{payment_ref or uuid.uuid4()}"

    async with SessionLocal() as db:
        # Look up subscription
        row = (await db.execute(
            text("SELECT id, branch_id, contact_id, tier_id, donor_name FROM recurring_giving_subscriptions WHERE paypal_subscription_id = :sid LIMIT 1"),
            {"sid": sub_id},
        )).mappings().first()

        if not row:
            return  # unknown subscription — ignore

        # Insert donation record
        await db.execute(text("""
            INSERT INTO donations
                (id, branch_id, amount, currency, gift_aid_eligible, purpose,
                 reference, payment_provider, payment_ref,
                 status, source, contact_id, idempotency_key, created_at, updated_at)
            VALUES
                (:id, :branch, :amount, :currency, false, 'Monthly Giving',
                 :sub_id, 'paypal', :payment_ref,
                 'COMPLETED', 'monthly-giving', :cid, :idem, :now, :now)
            ON CONFLICT (idempotency_key) DO NOTHING
        """), {
            "id": str(uuid.uuid4()), "branch": row["branch_id"],
            "amount": str(amount), "currency": currency,
            "sub_id": sub_id, "payment_ref": payment_ref,
            "cid": row["contact_id"], "idem": idem_key, "now": paid_at,
        })

        # Update subscription tracking
        await db.execute(text("""
            UPDATE recurring_giving_subscriptions
            SET last_payment_at     = :paid_at,
                last_payment_amount = :amount,
                total_payments      = COALESCE(total_payments, 0) + 1,
                status              = 'ACTIVE',
                updated_at          = NOW()
            WHERE paypal_subscription_id = :sid
        """), {"paid_at": paid_at, "amount": str(amount), "sid": sub_id})

        await db.commit()


async def _handle_subscription_status(sub_id: str, new_status: str, cancelled: bool = False) -> None:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        if cancelled:
            await db.execute(text("""
                UPDATE recurring_giving_subscriptions
                SET status = :status, cancelled_at = NOW(), updated_at = NOW()
                WHERE paypal_subscription_id = :sid
            """), {"status": new_status, "sid": sub_id})
        else:
            await db.execute(text("""
                UPDATE recurring_giving_subscriptions
                SET status = :status, updated_at = NOW()
                WHERE paypal_subscription_id = :sid
            """), {"status": new_status, "sid": sub_id})
        await db.commit()


@router.post("/service/giving/webhook/paypal")
async def paypal_giving_webhook(request: Request) -> dict[str, Any]:
    """PayPal webhook endpoint for recurring giving subscriptions.

    Register this URL in PayPal Developer Dashboard → Webhooks. Subscribed
    events (per developer.paypal.com/api/rest/webhooks/event-names):
      • BILLING.SUBSCRIPTION.CREATED / ACTIVATED / UPDATED /
        SUSPENDED / CANCELLED / EXPIRED / PAYMENT.FAILED
      • PAYMENT.SALE.COMPLETED / REFUNDED / REVERSED

    Pipeline:
      1. Parse body (400 on garbage)
      2. Verify signature against PAYPAL_WEBHOOK_ID (skip if unset, e.g. dev)
      3. Persist the raw event to recurring_giving_webhook_events (idempotent
         on PayPal's event id — duplicate retries become no-ops)
      4. Dispatch to a handler. Errors are caught and logged on the event row
         so a partial failure doesn't lose the event; the row stays
         processed=false for manual replay.
      5. Always return 200 once we've stored the event — PayPal retries on
         non-2xx, so we'd rather take the event in and replay later than
         get hammered by retries while we're broken.
    """
    import json

    from shital.core.fabrics.secrets import SecretsManager

    body_bytes = await request.body()
    try:
        event = json.loads(body_bytes)
    except Exception:
        raise HTTPException(400, detail="Invalid JSON payload")

    # Verify signature if webhook ID is configured
    webhook_id = await SecretsManager.get("PAYPAL_WEBHOOK_ID") or ""
    if webhook_id:
        valid = await _verify_paypal_webhook(
            transmission_id  = request.headers.get("paypal-transmission-id", ""),
            transmission_time= request.headers.get("paypal-transmission-time", ""),
            auth_algo        = request.headers.get("paypal-auth-algo", ""),
            cert_url         = request.headers.get("paypal-cert-url", ""),
            transmission_sig = request.headers.get("paypal-transmission-sig", ""),
            webhook_id       = webhook_id,
            event            = event,
        )
        if not valid:
            raise HTTPException(401, detail="Webhook signature verification failed")

    # Ensure tracking columns exist (idempotent)
    await _ensure_subscription_columns()

    event_type = event.get("event_type", "")
    event_id   = event.get("id", "")
    resource   = event.get("resource", {}) or {}
    sub_id     = resource.get("id", "") or resource.get("billing_agreement_id", "")

    # Persist first — even if dispatch throws, we still have the raw event.
    _row_id, is_new = await _record_webhook_event(event)
    if not is_new:
        # PayPal retried a delivery we already processed. Acknowledge silently.
        return {"received": True, "event_type": event_type, "duplicate": True}

    err = ""
    try:
        if event_type in ("PAYMENT.SALE.COMPLETED", "BILLING.SUBSCRIPTION.PAYMENT.COMPLETED"):
            await _handle_payment_completed(resource, event_type)

        elif event_type == "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
            await _handle_payment_failed(resource)

        elif event_type in ("BILLING.SUBSCRIPTION.ACTIVATED", "BILLING.SUBSCRIPTION.RE-ACTIVATED"):
            await _handle_subscription_status(sub_id, "ACTIVE")

        elif event_type == "BILLING.SUBSCRIPTION.CREATED":
            # Donor approved the popup but webhook arrived before our /approve
            # endpoint did. Leave status as PENDING_APPROVAL — the /approve
            # call (or the next ACTIVATED webhook) will mark it ACTIVE.
            pass

        elif event_type == "BILLING.SUBSCRIPTION.UPDATED":
            await _handle_subscription_updated(resource)

        elif event_type == "BILLING.SUBSCRIPTION.CANCELLED":
            await _handle_subscription_status(sub_id, "CANCELLED", cancelled=True)

        elif event_type == "BILLING.SUBSCRIPTION.SUSPENDED":
            await _handle_subscription_status(sub_id, "SUSPENDED")

        elif event_type == "BILLING.SUBSCRIPTION.EXPIRED":
            await _handle_subscription_status(sub_id, "EXPIRED", cancelled=True)

        elif event_type in ("PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"):
            await _handle_sale_refund(resource, event_type)

        # Anything else (PAYMENT.SALE.PENDING/DENIED, etc.) is recorded but
        # not actioned — surfaces in the audit log for ops review.
    except Exception as e:  # noqa: BLE001 — we deliberately swallow to keep PayPal happy
        err = f"{type(e).__name__}: {e}"[:1000]

    if event_id:
        await _mark_event_processed(event_id, err)

    return {"received": True, "event_type": event_type, "error": err or None}


# ── Admin: server-side cancel / suspend / reactivate ──────────────────────────
# Lets trustees stop a donor's subscription without making them log into the
# PayPal dashboard. Calls PayPal's REST API which is the source of truth —
# the BILLING.SUBSCRIPTION.CANCELLED webhook will arrive ~seconds later and
# update local state via the normal webhook path. We also pre-emptively mark
# the row so the admin UI reflects the intent immediately.

class _SubscriptionActionBody(BaseModel):
    reason: str = "Cancelled by SHITAL administrator"


async def _paypal_subscription_action(
    paypal_sub_id: str, action: str, reason: str,
) -> None:
    """Call PayPal /v1/billing/subscriptions/{id}/{action} where action is
    one of cancel|suspend|activate. PayPal returns 204 on success."""
    if action not in {"cancel", "suspend", "activate"}:
        raise HTTPException(400, detail=f"Unknown action: {action}")
    token = await _token()
    base  = await _base()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{base}/v1/billing/subscriptions/{paypal_sub_id}/{action}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"reason": (reason or "")[:128] or "Action taken by SHITAL admin"},
        )
        if r.status_code not in (204, 422):
            # 422 = "subscription already in target state" — not a real error
            raise HTTPException(
                status_code=502,
                detail=f"PayPal {action} failed: HTTP {r.status_code} {r.text[:200]}",
            )


async def _lookup_paypal_sub_id(local_id: str) -> tuple[str, str]:
    """Resolve our internal UUID → (paypal_subscription_id, current_status).
    Raises 404 if not found."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("""
                SELECT paypal_subscription_id, status
                FROM   recurring_giving_subscriptions
                WHERE  id::text = :id OR paypal_subscription_id = :id
                LIMIT  1
            """),
            {"id": local_id},
        )).mappings().first()
    if not row or not row["paypal_subscription_id"]:
        raise HTTPException(404, detail="Subscription not found")
    return (row["paypal_subscription_id"], row["status"] or "")


@router.post("/admin/giving/subscriptions/{sub_id}/cancel")
async def admin_cancel_subscription(
    sub_id: str, body: _SubscriptionActionBody, space: CurrentSpace,
) -> dict[str, Any]:
    """Trustee-initiated cancel. Hits PayPal's API + marks local row."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    paypal_id, _ = await _lookup_paypal_sub_id(sub_id)
    await _paypal_subscription_action(paypal_id, "cancel", body.reason)

    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE recurring_giving_subscriptions
            SET    status        = 'CANCELLED',
                   cancelled_at  = NOW(),
                   cancel_reason = :reason,
                   cancelled_by  = :actor,
                   updated_at    = NOW()
            WHERE  paypal_subscription_id = :sid
        """), {
            "sid": paypal_id,
            "reason": body.reason[:500],
            "actor": getattr(space, "user_email", "admin") or "admin",
        })
        await db.commit()
    return {"success": True, "action": "cancel", "paypal_subscription_id": paypal_id}


@router.post("/admin/giving/subscriptions/{sub_id}/suspend")
async def admin_suspend_subscription(
    sub_id: str, body: _SubscriptionActionBody, space: CurrentSpace,
) -> dict[str, Any]:
    """Pause without cancelling — donor can be reactivated later."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    paypal_id, _ = await _lookup_paypal_sub_id(sub_id)
    await _paypal_subscription_action(paypal_id, "suspend", body.reason)

    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE recurring_giving_subscriptions
            SET    status     = 'SUSPENDED',
                   updated_at = NOW()
            WHERE  paypal_subscription_id = :sid
        """), {"sid": paypal_id})
        await db.commit()
    return {"success": True, "action": "suspend", "paypal_subscription_id": paypal_id}


@router.post("/admin/giving/subscriptions/{sub_id}/reactivate")
async def admin_reactivate_subscription(
    sub_id: str, body: _SubscriptionActionBody, space: CurrentSpace,
) -> dict[str, Any]:
    """Resume a previously suspended subscription. Cancelled subs cannot be
    revived — donor must subscribe afresh."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    paypal_id, current_status = await _lookup_paypal_sub_id(sub_id)
    if current_status == "CANCELLED":
        raise HTTPException(
            400,
            detail="Cancelled subscriptions cannot be reactivated; ask the donor to subscribe again.",
        )
    await _paypal_subscription_action(paypal_id, "activate", body.reason)

    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE recurring_giving_subscriptions
            SET    status     = 'ACTIVE',
                   updated_at = NOW()
            WHERE  paypal_subscription_id = :sid
        """), {"sid": paypal_id})
        await db.commit()
    return {"success": True, "action": "reactivate", "paypal_subscription_id": paypal_id}


# ── Admin: webhook event audit log ────────────────────────────────────────────

@router.get("/admin/giving/webhook-events")
async def admin_list_webhook_events(
    space: CurrentSpace,
    subscription_id: str = "", event_type: str = "",
    only_unprocessed: bool = False,
    limit: int = 100, offset: int = 0,
) -> dict[str, Any]:
    """Paginated audit log of every PayPal webhook we've received.

    Supports filtering by subscription, event type, and unprocessed status
    so ops can find stuck events that need replay.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {
        "limit": min(max(1, limit), 500),
        "offset": max(0, offset),
    }
    if subscription_id.strip():
        where.append("subscription_id = :sid")
        params["sid"] = subscription_id.strip()
    if event_type.strip():
        where.append("event_type = :etype")
        params["etype"] = event_type.strip()
    if only_unprocessed:
        where.append("processed = false")
    where_sql = "WHERE " + " AND ".join(where) if where else ""

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT id, event_id, event_type, subscription_id, resource_id,
                   processed, processed_at, error, retry_count, created_at
            FROM   recurring_giving_webhook_events
            {where_sql}
            ORDER  BY created_at DESC
            LIMIT  :limit OFFSET :offset
        """), params)
        items: list[dict[str, Any]] = []
        for r in rows.mappings():
            d = dict(r)
            d["id"] = str(d["id"])
            for k in ("created_at", "processed_at"):
                if d.get(k):
                    d[k] = d[k].isoformat()
            items.append(d)

        total = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM recurring_giving_webhook_events {where_sql}"),
            params,
        )).mappings().one()

    return {"items": items, "total": int(total["c"])}


@router.post("/admin/giving/webhook-events/{event_id}/replay")
async def admin_replay_webhook(event_id: str, space: CurrentSpace) -> dict[str, Any]:
    """Re-dispatch a stored webhook event through the handler chain.

    Used when a handler crashed (e.g. database was down) and the event is
    still sitting in the audit table with processed=false. Reads the
    payload from the audit row and routes it through the same dispatch
    block as a live webhook — so the same idempotency guarantees apply
    (donations.idempotency_key prevents double-credit).
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT payload, event_type FROM recurring_giving_webhook_events WHERE event_id = :eid"),
            {"eid": event_id},
        )).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Webhook event not found")

    event = row["payload"]
    if isinstance(event, str):
        import json
        event = json.loads(event)
    event_type = event.get("event_type", "") or row["event_type"]
    resource   = event.get("resource", {}) or {}
    sub_id     = resource.get("id", "") or resource.get("billing_agreement_id", "")

    err = ""
    try:
        if event_type in ("PAYMENT.SALE.COMPLETED", "BILLING.SUBSCRIPTION.PAYMENT.COMPLETED"):
            await _handle_payment_completed(resource, event_type)
        elif event_type == "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
            await _handle_payment_failed(resource)
        elif event_type in ("BILLING.SUBSCRIPTION.ACTIVATED", "BILLING.SUBSCRIPTION.RE-ACTIVATED"):
            await _handle_subscription_status(sub_id, "ACTIVE")
        elif event_type == "BILLING.SUBSCRIPTION.UPDATED":
            await _handle_subscription_updated(resource)
        elif event_type == "BILLING.SUBSCRIPTION.CANCELLED":
            await _handle_subscription_status(sub_id, "CANCELLED", cancelled=True)
        elif event_type == "BILLING.SUBSCRIPTION.SUSPENDED":
            await _handle_subscription_status(sub_id, "SUSPENDED")
        elif event_type == "BILLING.SUBSCRIPTION.EXPIRED":
            await _handle_subscription_status(sub_id, "EXPIRED", cancelled=True)
        elif event_type in ("PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"):
            await _handle_sale_refund(resource, event_type)
    except Exception as e:  # noqa: BLE001
        err = f"{type(e).__name__}: {e}"[:1000]

    await _mark_event_processed(event_id, err)
    return {"success": not err, "event_type": event_type, "error": err or None}
