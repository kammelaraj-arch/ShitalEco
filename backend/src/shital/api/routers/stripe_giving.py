"""Stripe Billing — recurring (monthly) card giving.

A second recurring provider alongside PayPal, sharing the
``recurring_giving_subscriptions`` table (distinguished by ``payment_provider``).
Uses **Stripe Checkout in subscription mode** — a hosted card page with no
"create an account" nag that captures name/email/address (so Gift Aid works and
donors aren't recorded as "Anonymous"). The webhook is the source of truth for
recording the subscription and each monthly charge, mirroring the PayPal flow.

Endpoints (all reached by BOTH the Service app and the kiosk, which embeds it):
  GET  /service/stripe/config                     → publishable key + enabled flag
  POST /service/giving/stripe/create-checkout     → hosted Checkout URL
  POST /service/giving/stripe/confirm             → record immediately on return
  POST /stripe/webhook                            → record subscription + charges
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = structlog.get_logger()
router = APIRouter(tags=["stripe-giving"])

# Where the donor lands after a successful/cancelled Checkout. The thank-you
# page is the static hub page; ?provider=stripe&session_id lets it call the
# confirm endpoint so the first record happens even before the webhook.
_DEFAULT_ORIGIN = "https://shital.org.uk"


async def _stripe():
    import stripe

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager
    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY) or ""
    return stripe


# ── Config ────────────────────────────────────────────────────────────────────

@router.get("/service/stripe/config")
async def stripe_config() -> dict[str, Any]:
    """Public: whether Stripe recurring is available (+ publishable key, unused by
    the hosted-Checkout flow but returned for parity with the PayPal config)."""
    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager
    sk = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY) or ""
    pk = await SecretsManager.get("STRIPE_PUBLISHABLE_KEY", settings.STRIPE_PUBLISHABLE_KEY) or ""
    whsec = await SecretsManager.get("STRIPE_WEBHOOK_SECRET", settings.STRIPE_WEBHOOK_SECRET) or ""
    # Only advertise Stripe recurring once it's FULLY configured — the webhook
    # secret is required so ongoing monthly charges (months 2+) are recorded.
    # The kiosk already sets STRIPE_SECRET_KEY, so gating on that alone would
    # surface the button before the webhook is ready. The button self-activates
    # the moment STRIPE_WEBHOOK_SECRET is added.
    return {"publishable_key": pk, "currency": "GBP", "enabled": bool(sk and whsec)}


# ── Create Checkout Session ─────────────────────────────────────────────────────

class CheckoutBody(BaseModel):
    amount: float
    branch_id: str = "main"
    donor_first_name: str = ""
    donor_surname: str = ""
    donor_email: str = ""
    donor_phone: str = ""
    donor_postcode: str = ""
    donor_address: str = ""
    gift_aid_declared: bool = False
    tier_id: str = "custom"
    tier_label: str = "Monthly Giving"
    return_origin: str = ""  # e.g. https://service.shital.org.uk (for success/cancel)


@router.post("/service/giving/stripe/create-checkout")
async def create_checkout(body: CheckoutBody) -> dict[str, Any]:
    """Create a Stripe Checkout Session (subscription mode) and return its URL.

    Also inserts a PENDING subscription row up front so the webhook/confirm can
    link back by the ``rgs_id`` metadata. Best-effort on the DB write — the
    Checkout is what matters to the donor.
    """
    amount = float(body.amount or 0)
    if amount < 1 or amount > 10000:
        raise HTTPException(400, detail="Amount must be between £1 and £10,000")

    stripe = await _stripe()
    if not stripe.api_key:
        raise HTTPException(503, detail="Card giving is not configured yet.")

    now = datetime.utcnow()
    rgs_id = str(uuid.uuid4())
    full_name = f"{body.donor_first_name} {body.donor_surname}".strip()
    email = body.donor_email.strip()

    # Pre-insert the PENDING row (linked later by rgs_id metadata).
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    contact_id: str | None = None
    try:
        async with SessionLocal() as db:
            if email:
                c = await db.execute(text("""
                    INSERT INTO contacts
                        (id, email, first_name, surname, full_name, phone,
                         gdpr_consent, gdpr_consented_at, tac_consent, tac_consented_at,
                         first_source, first_branch_id, created_at, updated_at)
                    VALUES (:id, :email, :first, :surname, :name, :phone,
                            true, :now, true, :now, 'monthly-giving', :branch, :now, :now)
                    ON CONFLICT (email) DO UPDATE SET
                        first_name = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
                        surname    = COALESCE(NULLIF(EXCLUDED.surname,''),    contacts.surname),
                        full_name  = COALESCE(NULLIF(EXCLUDED.full_name,''),  contacts.full_name),
                        updated_at = EXCLUDED.updated_at
                    RETURNING id
                """), {
                    "id": str(uuid.uuid4()), "email": email.lower(),
                    "first": body.donor_first_name or "", "surname": body.donor_surname or "",
                    "name": full_name, "phone": body.donor_phone or "",
                    "branch": body.branch_id, "now": now,
                })
                row = c.mappings().first()
                contact_id = str(row["id"]) if row else None

            await db.execute(text("""
                INSERT INTO recurring_giving_subscriptions
                    (id, payment_provider, amount, frequency, status, branch_id,
                     donor_name, donor_email, donor_first_name, donor_surname,
                     donor_postcode, donor_address, contact_id,
                     gift_aid_declared, gift_aid_declared_at, created_at, updated_at)
                VALUES
                    (:id, 'stripe', :amount, 'MONTH', 'PENDING_APPROVAL', :branch,
                     :name, :email, :first, :surname, :postcode, :address, :cid,
                     :ga, :ga_at, :now, :now)
            """), {
                "id": rgs_id, "amount": amount, "branch": body.branch_id,
                "name": full_name, "email": email,
                "first": body.donor_first_name or "", "surname": body.donor_surname or "",
                "postcode": body.donor_postcode or "", "address": body.donor_address or "",
                "cid": contact_id, "ga": body.gift_aid_declared,
                "ga_at": now if body.gift_aid_declared else None, "now": now,
            })
            await db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("stripe_giving_prerow_failed", error=str(exc), rgs_id=rgs_id)

    origin = (body.return_origin or _DEFAULT_ORIGIN).rstrip("/")
    meta = {
        "rgs_id": rgs_id, "branch_id": body.branch_id,
        "gift_aid": "1" if body.gift_aid_declared else "0", "source": "monthly-giving",
    }

    # Pre-fill the donor's email + phone on the Stripe page. Passing a Customer
    # (with phone) lets Checkout pre-fill BOTH email and phone; a bare
    # customer_email only pre-fills the email. Falls back gracefully.
    prefill: dict[str, Any] = {}
    if email:
        try:
            cust = stripe.Customer.create(
                email=email, name=(full_name or None),
                phone=(body.donor_phone or None) if body.donor_phone else None,
            )
            prefill = {"customer": cust.id}
        except Exception:  # noqa: BLE001
            prefill = {"customer_email": email}

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            # This is the CARD path — Monthly Giving has its own separate PayPal
            # button, so don't let Stripe Checkout also surface PayPal / Link
            # here (that was confusing donors who picked "Pay by card"). Card only.
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "gbp",
                    "product_data": {"name": f"Monthly Temple Support — {body.tier_label or 'Monthly Giving'}"},
                    "unit_amount": int(round(amount * 100)),
                    "recurring": {"interval": "month"},
                },
                "quantity": 1,
            }],
            **prefill,
            client_reference_id=rgs_id,
            metadata=meta,
            subscription_data={"metadata": meta},
            # Collect the full home address (Gift Aid needs it) + phone, and ask
            # the Gift Aid question right on the Stripe page so card monthlies are
            # Gift-Aid claimable (+25%). We read these back on completion.
            billing_address_collection="required",
            phone_number_collection={"enabled": True},
            custom_fields=[{
                "key": "giftaid",
                "label": {"type": "custom",
                          "custom": "Gift Aid — I am a UK taxpayer (reclaim 25% at no cost)"},
                "type": "dropdown",
                "dropdown": {"options": [
                    {"label": "Yes, claim Gift Aid on my gift", "value": "yes"},
                    {"label": "No", "value": "no"},
                ]},
                "optional": False,
            }],
            allow_promotion_codes=False,
            # Return to the SAME shape the PayPal flow uses (?screen=monthly-giving
            # &status=approved). Critically, do NOT pass a bare `amount` param — the
            # SPA treats `?amount=…` (without `status`) as a PayPal quick-link and
            # would redirect a just-paid Stripe donor into a PayPal subscription.
            # Pass the amount as `amt` (display only) so nothing collides.
            success_url=f"{origin}/?screen=monthly-giving&status=approved&provider=stripe&amt={amount}&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{origin}/?screen=monthly-giving&status=cancelled",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("stripe_checkout_create_failed", error=str(exc), rgs_id=rgs_id)
        raise HTTPException(502, detail="Could not start card checkout. Please try again.") from exc

    return {"url": session.url, "id": session.id, "rgs_id": rgs_id}


# ── Recording helpers ───────────────────────────────────────────────────────────

async def _link_subscription_row(*, rgs_id: str | None, stripe_sub_id: str,
                                  customer_id: str | None, checkout_id: str | None,
                                  name: str, email: str, branch_id: str,
                                  gift_aid: bool, amount: float | None,
                                  phone: str = "", address: str = "", postcode: str = "") -> None:
    """Attach a Stripe subscription to its pre-created PENDING row (by rgs_id),
    or INSERT a fresh ACTIVE row if the pre-insert was lost. Idempotent.
    Also backfills the donor contact details Stripe collected (phone, home
    address, postcode) and the Gift Aid answer so the gift is claimable."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    first, _, surname = name.partition(" ")
    async with SessionLocal() as db:
        updated = None
        if rgs_id:
            r = await db.execute(text("""
                UPDATE recurring_giving_subscriptions
                SET stripe_subscription_id = :sub, stripe_customer_id = :cust,
                    stripe_checkout_id = :cko, status = 'ACTIVE', approved_at = :now,
                    updated_at = :now,
                    donor_name       = COALESCE(NULLIF(donor_name,''), :name),
                    donor_email      = COALESCE(NULLIF(donor_email,''), :email),
                    donor_first_name = COALESCE(NULLIF(donor_first_name,''), :first),
                    donor_surname    = COALESCE(NULLIF(donor_surname,''), :surname),
                    donor_phone      = COALESCE(NULLIF(donor_phone,''), :phone),
                    donor_address    = COALESCE(NULLIF(donor_address,''), :address),
                    donor_postcode   = COALESCE(NULLIF(donor_postcode,''), :postcode),
                    gift_aid_declared    = (gift_aid_declared OR :ga),
                    gift_aid_declared_at = CASE WHEN :ga THEN COALESCE(gift_aid_declared_at, :now) ELSE gift_aid_declared_at END
                WHERE id = CAST(:id AS uuid)
                RETURNING id
            """), {
                "sub": stripe_sub_id, "cust": customer_id, "cko": checkout_id, "now": now,
                "name": name, "email": email, "first": first, "surname": surname,
                "phone": phone, "address": address, "postcode": postcode, "ga": bool(gift_aid),
                "id": rgs_id,
            })
            updated = r.first()
        if not updated:
            # Match an already-linked row (idempotent replay) or insert fresh.
            r2 = await db.execute(text(
                "SELECT id FROM recurring_giving_subscriptions WHERE stripe_subscription_id = :sub LIMIT 1"
            ), {"sub": stripe_sub_id})
            if not r2.first():
                await db.execute(text("""
                    INSERT INTO recurring_giving_subscriptions
                        (id, payment_provider, stripe_subscription_id, stripe_customer_id,
                         stripe_checkout_id, amount, frequency, status, branch_id,
                         donor_name, donor_email, donor_first_name, donor_surname,
                         donor_phone, donor_address, donor_postcode,
                         gift_aid_declared, gift_aid_declared_at, approved_at, created_at, updated_at)
                    VALUES
                        (:id, 'stripe', :sub, :cust, :cko, :amount, 'MONTH', 'ACTIVE', :branch,
                         :name, :email, :first, :surname, :phone, :address, :postcode,
                         :ga, :ga_at, :now, :now, :now)
                    ON CONFLICT DO NOTHING
                """), {
                    "id": str(uuid.uuid4()), "sub": stripe_sub_id, "cust": customer_id,
                    "cko": checkout_id, "amount": amount or 0, "branch": branch_id,
                    "name": name, "email": email, "first": first, "surname": surname,
                    "phone": phone, "address": address, "postcode": postcode,
                    "ga": gift_aid, "ga_at": now if gift_aid else None, "now": now,
                })
        await db.commit()

    # ── Confirmation email (idempotent) ───────────────────────────────────────
    # Send the temple's own recurring-giving confirmation for Stripe subs too
    # (donors otherwise only get Stripe's receipt). We "claim" the send with a
    # guarded UPDATE on confirmation_sent_at so webhook + confirm + sync all
    # firing for the same subscription only ever send ONE email. Non-fatal.
    try:
        async with SessionLocal() as db:
            claim = (await db.execute(text("""
                UPDATE recurring_giving_subscriptions
                SET confirmation_sent_at = :now
                WHERE stripe_subscription_id = :sub
                  AND confirmation_sent_at IS NULL
                  AND COALESCE(donor_email,'') <> ''
                RETURNING donor_email, donor_first_name, donor_name, amount,
                          COALESCE(gift_aid_declared, false) AS ga
            """), {"now": now, "sub": stripe_sub_id})).mappings().first()
            await db.commit()
        if claim:
            from shital.api.routers.email_templates import send_template
            from shital.core.fabrics.config import settings
            await send_template(
                "recurring_giving_confirmation",
                claim["donor_email"],
                {
                    "donor_first_name": claim["donor_first_name"] or claim["donor_name"] or "Friend",
                    "amount": f"{float(claim['amount'] or amount or 0):.2f}",
                    "frequency": "month",
                    "tier_label": "Monthly Gift",
                    "subscription_id": stripe_sub_id,
                    "gift_aid_declared": bool(claim["ga"]),
                    "logo_url": "https://shirdisai.org.uk/Cnt/img/shital-logo-new.png",
                    "charity_number": settings.CHARITY_NUMBER or "1138530",
                    "manage_url": "https://service.shital.org.uk/?screen=my-giving",
                    "support_email": "info@shirdisai.org.uk",
                },
                related_type="recurring_giving_subscription",
            )
    except Exception as exc:  # noqa: BLE001 — email is non-fatal
        logger.warning("stripe_confirmation_email_failed", sub=stripe_sub_id, error=str(exc))


async def _handle_checkout_completed(session: dict[str, Any]) -> None:
    meta = session.get("metadata") or {}
    details = session.get("customer_details") or {}
    amount_total = session.get("amount_total")

    # Gift Aid answer from the Stripe custom field (falls back to the metadata
    # flag set at checkout-create time).
    gift_aid = meta.get("gift_aid") == "1"
    for cf in (session.get("custom_fields") or []):
        if cf.get("key") == "giftaid":
            gift_aid = ((cf.get("dropdown") or {}).get("value") == "yes")

    # Home address (for Gift Aid) + phone from what Stripe collected.
    addr = details.get("address") or {}
    address = ", ".join(p for p in [
        addr.get("line1"), addr.get("line2"), addr.get("city"),
    ] if p) if isinstance(addr, dict) else ""
    postcode = (addr.get("postal_code") or "") if isinstance(addr, dict) else ""

    await _link_subscription_row(
        rgs_id=meta.get("rgs_id") or session.get("client_reference_id"),
        stripe_sub_id=str(session.get("subscription") or ""),
        customer_id=(str(session.get("customer")) if session.get("customer") else None),
        checkout_id=str(session.get("id") or ""),
        name=(details.get("name") or "").strip(),
        email=(details.get("email") or "").strip(),
        phone=(details.get("phone") or "").strip(),
        address=address, postcode=postcode,
        branch_id=meta.get("branch_id") or "main",
        gift_aid=gift_aid,
        amount=(float(amount_total) / 100.0 if amount_total else None),
    )


async def _record_invoice_donation(invoice: dict[str, Any]) -> None:
    """Insert a COMPLETED donation for a paid subscription invoice (idempotent
    by payment_ref) and bump the subscription's payment counters."""
    sub_id = str(invoice.get("subscription") or "")
    if not sub_id:
        return
    amount_paid = invoice.get("amount_paid") or invoice.get("amount_due") or 0
    value = float(amount_paid) / 100.0
    ref = str(invoice.get("charge") or invoice.get("payment_intent") or invoice.get("id") or "")
    if not ref or value <= 0:
        return

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    async with SessionLocal() as db:
        sub = (await db.execute(text("""
            SELECT id::text AS id, branch_id, contact_id::text AS contact_id,
                   COALESCE(gift_aid_declared,false) AS ga
            FROM recurring_giving_subscriptions WHERE stripe_subscription_id = :sub LIMIT 1
        """), {"sub": sub_id})).mappings().first()
        if not sub:
            return  # subscription row not linked yet — webhook ordering; skip
        exists = (await db.execute(text(
            "SELECT 1 FROM donations WHERE payment_ref = :ref LIMIT 1"
        ), {"ref": ref})).first()
        if not exists:
            await db.execute(text("""
                INSERT INTO donations
                    (id, branch_id, amount, currency, purpose, payment_provider,
                     payment_ref, status, source, contact_id, gift_aid_eligible,
                     created_at, updated_at)
                VALUES
                    (gen_random_uuid(), :bid, :amt, 'GBP', 'Monthly Giving', 'STRIPE',
                     :ref, 'COMPLETED', 'monthly-giving', CAST(:cid AS uuid), :ga, :now, :now)
            """), {
                "bid": sub["branch_id"], "amt": value, "ref": ref,
                "cid": sub["contact_id"], "ga": bool(sub["ga"]), "now": now,
            })
        await db.execute(text("""
            UPDATE recurring_giving_subscriptions
            SET status = 'ACTIVE', last_payment_at = :now, last_payment_amount = :amt,
                total_payments = COALESCE(total_payments,0) + 1, updated_at = :now
            WHERE id = CAST(:id AS uuid)
        """), {"now": now, "amt": value, "id": sub["id"]})
        await db.commit()


async def _handle_invoice_failed(invoice: dict[str, Any]) -> None:
    sub_id = str(invoice.get("subscription") or "")
    if not sub_id:
        return
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE recurring_giving_subscriptions
            SET failed_payment_count = COALESCE(failed_payment_count,0) + 1,
                last_failure_at = NOW(),
                last_failure_reason = 'stripe invoice payment failed',
                updated_at = NOW()
            WHERE stripe_subscription_id = :sub
        """), {"sub": sub_id})
        await db.commit()


async def _handle_subscription_cancelled(sub: dict[str, Any]) -> None:
    sub_id = str(sub.get("id") or "")
    if not sub_id:
        return
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE recurring_giving_subscriptions
            SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
            WHERE stripe_subscription_id = :sub
        """), {"sub": sub_id})
        await db.commit()


# ── Admin reconcile (mirror of the PayPal monthly-giving sync) ──────────────────

_STRIPE_SUB_STATUS_MAP = {
    "active": "ACTIVE", "trialing": "ACTIVE", "past_due": "ACTIVE",
    "canceled": "CANCELLED", "unpaid": "CANCELLED",
    "incomplete": "PENDING_APPROVAL", "incomplete_expired": "EXPIRED",
}


async def _stripe_giving_reconcile_once(days: int = 90) -> dict[str, Any]:
    """Reconcile Stripe monthly-giving subscriptions against Stripe (source of
    truth) — the mirror of ``_paypal_reconcile_once``. Idempotent, safe to run
    on demand:
      Pass A · rows that already carry a ``stripe_subscription_id`` → retrieve
        the subscription, map its status onto our row, and record any paid
        invoices as COMPLETED donations (deduped by payment_ref).
      Pass B · orphan PENDING_APPROVAL rows with no subscription id (the donor
        left checkout, or the webhook never landed) → find their subscription by
        the ``rgs_id`` metadata we stamped at checkout, link + activate it. Any
        still-unmatched orphan older than 2 days is marked EXPIRED so it stops
        showing as a phantom "pending".
    """
    stripe = await _stripe()
    if not stripe.api_key:
        return {"skipped": "stripe_not_configured"}

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    summary: dict[str, Any] = {
        "scanned": 0, "status_updated": 0, "activated": 0, "cancelled": 0,
        "payments_recorded": 0, "linked_orphans": 0, "orphans_expired": 0,
        "errors": 0, "days_window": days,
    }
    now = datetime.utcnow()
    since = int((now - timedelta(days=days)).timestamp())

    async def _record_paid_invoices(sub_id: str) -> None:
        try:
            invs = stripe.Invoice.list(subscription=sub_id, status="paid", limit=100)
        except Exception:  # noqa: BLE001
            return
        for inv in invs.auto_paging_iter():
            ref = str(inv.get("charge") or inv.get("payment_intent") or inv.get("id") or "")
            if not ref:
                continue
            async with SessionLocal() as db:
                seen = (await db.execute(text(
                    "SELECT 1 FROM donations WHERE payment_ref = :r LIMIT 1"), {"r": ref})).first()
            await _record_invoice_donation(inv)
            if not seen:
                summary["payments_recorded"] += 1

    # ── Pass A · rows with a subscription id ──────────────────────────────────
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text AS id, stripe_subscription_id AS sub_id,
                   UPPER(COALESCE(status,'')) AS status
            FROM recurring_giving_subscriptions
            WHERE payment_provider = 'stripe'
              AND stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> ''
              AND UPPER(COALESCE(status,'')) NOT IN ('CANCELLED','EXPIRED')
              AND created_at >= NOW() - (:days || ' days')::interval
        """), {"days": str(days)})).mappings().all()

    for r in rows:
        summary["scanned"] += 1
        try:
            sub = stripe.Subscription.retrieve(r["sub_id"])
        except Exception as exc:  # noqa: BLE001
            # resource_missing → Stripe never really created it; reap old rows.
            if "resource_missing" in str(exc).lower() or "no such subscription" in str(exc).lower():
                async with SessionLocal() as db:
                    await db.execute(text("""
                        UPDATE recurring_giving_subscriptions SET status='EXPIRED', updated_at=NOW()
                        WHERE id = CAST(:id AS uuid)
                          AND UPPER(COALESCE(status,'')) NOT IN ('ACTIVE','CANCELLED','EXPIRED')
                          AND created_at < NOW() - INTERVAL '1 day'
                    """), {"id": r["id"]})
                    await db.commit()
            else:
                summary["errors"] += 1
            continue
        mapped = _STRIPE_SUB_STATUS_MAP.get((sub.get("status") or "").lower())
        if mapped and mapped != r["status"]:
            async with SessionLocal() as db:
                await db.execute(text("""
                    UPDATE recurring_giving_subscriptions
                    SET status = :st,
                        cancelled_at = CASE WHEN :st='CANCELLED' THEN COALESCE(cancelled_at, NOW()) ELSE cancelled_at END,
                        updated_at = NOW()
                    WHERE id = CAST(:id AS uuid)
                """), {"st": mapped, "id": r["id"]})
                await db.commit()
            summary["status_updated"] += 1
            if mapped == "ACTIVE":
                summary["activated"] += 1
            elif mapped in ("CANCELLED", "EXPIRED"):
                summary["cancelled"] += 1
        if (mapped or r["status"]) == "ACTIVE":
            await _record_paid_invoices(r["sub_id"])

    # ── Pass B · orphan PENDING rows (no subscription id) ─────────────────────
    async with SessionLocal() as db:
        orphans = (await db.execute(text("""
            SELECT id::text AS id FROM recurring_giving_subscriptions
            WHERE payment_provider = 'stripe'
              AND (stripe_subscription_id IS NULL OR stripe_subscription_id = '')
              AND UPPER(COALESCE(status,'')) = 'PENDING_APPROVAL'
              AND created_at >= NOW() - (:days || ' days')::interval
        """), {"days": str(days)})).mappings().all()
    want = {o["id"] for o in orphans}

    if want:
        try:
            sub_iter = stripe.Subscription.list(
                created={"gte": since}, status="all", limit=100).auto_paging_iter()
        except Exception:  # noqa: BLE001
            sub_iter = iter(())
        for sub in sub_iter:
            rgs = ((sub.get("metadata") or {}).get("rgs_id")) or ""
            if rgs not in want:
                continue
            want.discard(rgs)
            st = _STRIPE_SUB_STATUS_MAP.get((sub.get("status") or "").lower(), "PENDING_APPROVAL")
            cust = sub.get("customer")
            async with SessionLocal() as db:
                await db.execute(text("""
                    UPDATE recurring_giving_subscriptions
                    SET stripe_subscription_id = :sub, stripe_customer_id = :cust, status = :st,
                        approved_at = CASE WHEN :st='ACTIVE' THEN COALESCE(approved_at, NOW()) ELSE approved_at END,
                        updated_at = NOW()
                    WHERE id = CAST(:id AS uuid)
                """), {"sub": sub.get("id"), "cust": (str(cust) if cust else None),
                       "st": st, "id": rgs})
                await db.commit()
            summary["linked_orphans"] += 1
            if st == "ACTIVE":
                summary["activated"] += 1
                await _record_paid_invoices(str(sub.get("id")))

        # Anything still unmatched and old → reap so it stops showing as pending.
        # Per-id UPDATEs (CAST(:id AS uuid)) — avoids a fragile array bind that
        # could throw and 500 the whole sync.
        for rgs_id in want:
            async with SessionLocal() as db:
                reaped = await db.execute(text("""
                    UPDATE recurring_giving_subscriptions
                    SET status = 'EXPIRED', updated_at = NOW()
                    WHERE id = CAST(:id AS uuid)
                      AND created_at < NOW() - INTERVAL '2 days'
                      AND UPPER(COALESCE(status,'')) = 'PENDING_APPROVAL'
                """), {"id": rgs_id})
                await db.commit()
                summary["orphans_expired"] += (reaped.rowcount or 0)

    return summary


# ── Webhook ─────────────────────────────────────────────────────────────────────

@router.post("/stripe/webhook")
async def stripe_webhook(request: Request) -> dict[str, Any]:
    """Stripe events. Verified against STRIPE_WEBHOOK_SECRET when set; if not yet
    configured we parse the payload unsigned (best-effort) so first-time setup
    still records — but you SHOULD set the secret for security."""
    stripe = await _stripe()
    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager
    secret = await SecretsManager.get("STRIPE_WEBHOOK_SECRET", settings.STRIPE_WEBHOOK_SECRET) or ""

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    if secret:
        try:
            event = stripe.Webhook.construct_event(payload, sig, secret)
        except Exception as exc:  # noqa: BLE001
            logger.warning("stripe_webhook_bad_signature", error=str(exc))
            raise HTTPException(400, detail="invalid signature") from exc
    else:
        try:
            event = json.loads(payload)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, detail="invalid payload") from exc

    etype = event.get("type") if isinstance(event, dict) else event["type"]
    obj = (event.get("data") or {}).get("object") if isinstance(event, dict) else event["data"]["object"]
    try:
        if etype == "checkout.session.completed":
            await _handle_checkout_completed(obj)
        elif etype in ("invoice.paid", "invoice.payment_succeeded"):
            await _record_invoice_donation(obj)
        elif etype == "invoice.payment_failed":
            await _handle_invoice_failed(obj)
        elif etype == "customer.subscription.deleted":
            await _handle_subscription_cancelled(obj)
    except Exception as exc:  # noqa: BLE001
        logger.warning("stripe_webhook_handler_failed", type=etype, error=str(exc))
    return {"received": True}


# ── Confirm on return (belt-and-braces so the first record isn't webhook-only) ──

class ConfirmBody(BaseModel):
    session_id: str


@router.post("/service/giving/stripe/confirm")
async def confirm_checkout(body: ConfirmBody) -> dict[str, Any]:
    """Called by the thank-you page after a successful Checkout. Retrieves the
    session and records the subscription immediately (idempotent with the
    webhook). Never fails the donor's confirmation."""
    stripe = await _stripe()
    if not stripe.api_key or not body.session_id:
        return {"ok": False}
    try:
        session = stripe.checkout.Session.retrieve(
            body.session_id, expand=["customer_details", "subscription"]
        )
        data = session if isinstance(session, dict) else session.to_dict()
        if data.get("status") == "complete" or data.get("payment_status") in ("paid", "no_payment_required"):
            await _handle_checkout_completed(data)
            return {"ok": True, "status": "active"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("stripe_confirm_failed", error=str(exc), session_id=body.session_id)
    return {"ok": False}
