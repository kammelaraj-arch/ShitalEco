"""PayPal payment integration for the Shital Service web portal."""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any

import httpx
import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/service/paypal", tags=["service-paypal"])

_LIVE    = "https://api-m.paypal.com"
_SANDBOX = "https://api-m.sandbox.paypal.com"


async def _base() -> str:
    from shital.core.fabrics.secrets import SecretsManager
    env = await SecretsManager.get("PAYPAL_ENV") or "live"
    return _LIVE if env == "live" else _SANDBOX


async def _token() -> str:
    from shital.core.fabrics.secrets import SecretsManager
    client_id = await SecretsManager.get("PAYPAL_CLIENT_ID") or ""
    secret    = await SecretsManager.get("PAYPAL_CLIENT_SECRET") or ""
    if not client_id or not secret:
        raise HTTPException(503, detail="PayPal credentials not configured — add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Admin > API Keys")
    base = await _base()
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            f"{base}/v1/oauth2/token",
            auth=(client_id, secret),
            data={"grant_type": "client_credentials"},
        )
        r.raise_for_status()
        return r.json()["access_token"]


@router.get("/config")
async def paypal_config():
    """Return PayPal client_id for frontend SDK initialisation."""
    from shital.core.fabrics.secrets import SecretsManager
    client_id = await SecretsManager.get("PAYPAL_CLIENT_ID") or ""
    env       = await SecretsManager.get("PAYPAL_ENV") or "live"
    if not client_id:
        structlog.get_logger().warning(
            "paypal_client_id_empty",
            hint="Key shows 'Set' in Admin but decrypted to empty — re-save PAYPAL_CLIENT_ID in Admin > API Keys",
        )
    return {"client_id": client_id, "env": env, "currency": "GBP"}


@router.get("/ping")
async def paypal_ping():
    """Diagnostic: check if PayPal credentials are readable (no values exposed)."""
    from shital.core.fabrics.secrets import SecretsManager
    client_id = await SecretsManager.get("PAYPAL_CLIENT_ID") or ""
    secret    = await SecretsManager.get("PAYPAL_CLIENT_SECRET") or ""
    env       = await SecretsManager.get("PAYPAL_ENV") or "live"
    return {
        "client_id_readable": bool(client_id),
        "secret_readable": bool(secret),
        "env": env,
        "ready": bool(client_id and secret),
    }


class CreateOrderBody(BaseModel):
    amount: float
    description: str = "Shital Temple Donation"
    branch_id: str = "main"
    contact_name: str = ""
    contact_first_name: str = ""
    contact_surname: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    contact_postcode: str = ""
    contact_address: str = ""


def _fmt_uk_postcode(raw: str) -> str:
    """Normalise a UK postcode to 'AB1 2CD' format (space before last 3 chars)."""
    pc = raw.upper().replace(" ", "")
    return f"{pc[:-3]} {pc[-3:]}" if len(pc) >= 5 else raw.upper()


_UK_POSTCODE_RE = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$", re.IGNORECASE)


def _parse_uk_address(raw: str, postcode: str) -> dict | None:
    """Parse a UK address into PayPal's address shape, OR return None.

    PayPal's V2 Orders API drops the ENTIRE payer.address block (silently,
    no error) if any required field is missing or malformed. Returning None
    here lets the caller skip sending an address at all rather than ship a
    half-formed one that PayPal will throw away.

    Required for prefill to land:
      - country_code (GB)
      - postal_code  (well-formed UK postcode)
      - address_line_1 (non-empty)
      - admin_area_2 (city) — strongly recommended, prefill is unreliable
        without it on Live
    """
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    pc_compact = postcode.upper().replace(" ", "")

    # Strip any postcode-shaped segment from the comma-list so the city
    # extraction below doesn't pick up the postcode as the city.
    non_pc_parts = [p for p in parts if p.upper().replace(" ", "") != pc_compact and not _UK_POSTCODE_RE.match(p)]

    if not non_pc_parts:
        # Address-line-less submissions (postcode-only or completely empty)
        # are useless to PayPal — better to omit `payer.address` entirely
        # so PayPal doesn't blow away the rest of the prefill.
        return None
    if not postcode.strip():
        return None

    addr: dict = {
        "country_code": "GB",
        "postal_code":  _fmt_uk_postcode(postcode),
        "address_line_1": non_pc_parts[0],
    }
    if len(non_pc_parts) >= 3:
        addr["address_line_2"] = non_pc_parts[1]
        addr["admin_area_2"]   = non_pc_parts[-1]
    elif len(non_pc_parts) == 2:
        addr["admin_area_2"]   = non_pc_parts[1]
    # Single-line address: city unknown. PayPal accepts the block without
    # admin_area_2 but the prefill quality drops; nothing we can do without
    # asking the user for city explicitly.
    return addr


def _build_payer(body: CreateOrderBody) -> dict:
    """Build a clean PayPal V2 `payer` object. Drops fields that would cause
    PayPal to silently discard the whole block — see comments below."""
    payer: dict = {}

    # Name: BOTH given_name and surname must be non-empty strings, otherwise
    # PayPal Live throws away the entire name object (no prefill at all).
    given  = body.contact_first_name.strip()
    family = body.contact_surname.strip()
    if not given and " " in body.contact_name.strip():
        given, family = body.contact_name.strip().split(" ", 1)
        family = family.strip()
    elif not given:
        given = body.contact_name.strip()
    if given and family:
        payer["name"] = {"given_name": given, "surname": family}

    # Email: cheap regex so we never ship "john@" to PayPal and trip 422.
    email = body.contact_email.strip()
    if email and "@" in email and "." in email.split("@", 1)[1]:
        payer["email_address"] = email

    # Phone: PayPal validates national_number against country_code. Strip to
    # digits and only ship if we end up with a plausibly-UK 10-or-11 digit
    # number; otherwise PayPal returns 422 INVALID_PARAMETER_VALUE on the
    # whole order.
    digits = "".join(c for c in body.contact_phone if c.isdigit())
    if digits.startswith("44") and len(digits) >= 12:
        digits = digits[2:]
    if digits.startswith("0"):
        digits = digits[1:]
    if 9 <= len(digits) <= 11:
        payer["phone"] = {
            "phone_type": "MOBILE",
            "phone_number": {"national_number": digits},
        }

    # Address — see _parse_uk_address; returns None for unusable input.
    addr = _parse_uk_address(body.contact_address, body.contact_postcode)
    if addr:
        payer["address"] = addr

    return payer


@router.post("/order")
async def create_paypal_order(body: CreateOrderBody) -> dict[str, str]:
    """Create a PayPal order server-side and return its ID to the frontend."""
    token = await _token()
    base  = await _base()

    payer = _build_payer(body)

    purchase_unit: dict = {
        "amount": {"currency_code": "GBP", "value": f"{body.amount:.2f}"},
        "description": body.description[:127],
        # custom_id propagates through to the capture resource on the
        # PAYMENT.CAPTURE.COMPLETED webhook, so the webhook handler can
        # recover branch_id when /capture's synchronous DB write failed
        # and only the webhook backstop runs. 127 char limit, ASCII-safe.
        "custom_id": (body.branch_id or "main")[:127],
    }
    # purchase_units.shipping.address is the OTHER lever PayPal reads for
    # the Guest Card billing-address prefill (alongside payer.address). For
    # NO_SHIPPING flows it still drives the address fields on the card form.
    if "address" in payer and "name" in payer:
        purchase_unit["shipping"] = {
            "name": {
                "full_name": f"{payer['name']['given_name']} {payer['name']['surname']}".strip(),
            },
            "address": payer["address"],
        }

    payload: dict = {
        "intent": "CAPTURE",
        "purchase_units": [purchase_unit],
        "application_context": {
            "brand_name": "Shital Temple",
            "locale": "en-GB",
            "user_action": "PAY_NOW",
            "shipping_preference": "NO_SHIPPING",
            # landing_page=BILLING opens the Guest Card form directly,
            # skipping the PayPal-account upsell page where the payer
            # pre-fill silently gets dropped on the redirect. This is
            # the same fix that unblocked the kiosk monthly-giving form
            # in PR claude/paypal-prefill-belt-and-braces — symmetrical
            # behaviour for one-off donations.
            "landing_page": "BILLING",
        },
    }
    if payer:
        payload["payer"] = payer

    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{base}/v2/checkout/orders",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
        if not r.is_success:
            structlog.get_logger().error(
                "paypal_order_create_failed",
                status=r.status_code,
                body=r.text[:500],
                amount=body.amount,
            )
            r.raise_for_status()
        data = r.json()
    return {"id": data["id"]}


class CaptureBody(BaseModel):
    paypal_order_id: str
    amount: float
    branch_id: str = "main"
    contact_name: str = ""
    contact_first_name: str = ""
    contact_surname: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    gift_aid: bool = False
    gift_aid_postcode: str = ""
    gift_aid_address: str = ""
    contact_uprn: str = ""
    items: list[dict[str, Any]] = []


@router.post("/capture")
async def capture_paypal_order(body: CaptureBody) -> dict[str, Any]:
    """Capture the authorised PayPal payment and record the donation in the DB."""
    token = await _token()
    base  = await _base()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{base}/v2/checkout/orders/{body.paypal_order_id}/capture",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        r.raise_for_status()
        data = r.json()

    if data.get("status") != "COMPLETED":
        raise HTTPException(400, detail=f"PayPal payment not completed: {data.get('status')}")

    # Extract the capture transaction ID and confirmed amount from PayPal's response.
    # The capture ID is PayPal's permanent transaction reference (used for refunds/reconciliation).
    capture_data: dict = {}
    try:
        capture_data = data["purchase_units"][0]["payments"]["captures"][0]
    except (KeyError, IndexError):
        pass
    capture_id     = capture_data.get("id", "")
    captured_value = capture_data.get("amount", {}).get("value")
    captured_amount = float(captured_value) if captured_value else body.amount

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    order_id  = str(uuid.uuid4())
    order_ref = f"SVC-{body.paypal_order_id[:8].upper()}"
    now       = datetime.utcnow()

    # Each non-critical step runs in its own SessionLocal() block so a
    # failure on (say) addresses' unique-constraint for a returning donor
    # doesn't poison the rest of the transaction and lose the donation
    # row. The DONATION + ORDER inserts are the financial record and run
    # last, in their own block, so they only fail when the donations table
    # itself is genuinely unwritable (in which case the structured 500
    # below carries the PayPal capture id for manual reconciliation).
    import structlog
    logger = structlog.get_logger()

    full_name = body.contact_name or f"{body.contact_first_name} {body.contact_surname}".strip()
    email_key = body.contact_email.strip().lower() if body.contact_email.strip() else None
    contact_id: str | None = None
    decl_id: str | None = None

    # ── 1) Upsert CRM contact (best-effort) ─────────────────────────────────
    if email_key:
        try:
            async with SessionLocal() as db:
                contact_uuid = str(uuid.uuid4())
                c_result = await db.execute(text("""
                    INSERT INTO contacts
                        (id, email, first_name, surname, full_name, phone,
                         gdpr_consent, gdpr_consented_at, tac_consent, tac_consented_at,
                         first_source, first_branch_id, created_at, updated_at)
                    VALUES
                        (:id, :email, :first, :surname, :name, :phone,
                         true, :now, true, :now,
                         'service-portal', :branch, :now, :now)
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
                    "first": body.contact_first_name or "", "surname": body.contact_surname or "",
                    "name": full_name, "phone": body.contact_phone or "",
                    "branch": body.branch_id, "now": now,
                })
                row = c_result.mappings().first()
                contact_id = str(row["id"]) if row else contact_uuid
                await db.commit()
        except Exception as exc:
            logger.error("paypal_capture_contact_upsert_failed",
                         error=str(exc), email=email_key,
                         paypal_capture_id=capture_id)

    # ── 2) Upsert address linked to contact (best-effort) ───────────────────
    # `addresses` has a partial UNIQUE INDEX on (contact_id, postcode,
    # house_number) WHERE contact_id IS NOT NULL. Returning donors who pay
    # twice from the same postcode would trigger that, so add the matching
    # ON CONFLICT — and wrap the whole thing in try/except as belt-and-braces
    # against any other constraint the schema may grow.
    if contact_id:
        addr_text     = body.gift_aid_address or ""
        addr_postcode = body.gift_aid_postcode or ""
        addr_uprn     = body.contact_uprn or ""
        if addr_postcode or addr_text:
            try:
                async with SessionLocal() as db:
                    await db.execute(text("""
                        INSERT INTO addresses
                            (id, contact_id, formatted, postcode, uprn,
                             is_primary, lookup_source, created_at)
                        VALUES (:id, :cid, :fmt, :pc, :uprn, true, 'service-portal', :now)
                        ON CONFLICT (contact_id, postcode, house_number)
                          WHERE contact_id IS NOT NULL
                          DO UPDATE SET
                              formatted     = COALESCE(NULLIF(EXCLUDED.formatted,''), addresses.formatted),
                              uprn          = COALESCE(NULLIF(EXCLUDED.uprn,''),      addresses.uprn),
                              lookup_source = EXCLUDED.lookup_source
                    """), {
                        "id": str(uuid.uuid4()), "cid": contact_id,
                        "fmt": addr_text, "pc": addr_postcode, "uprn": addr_uprn, "now": now,
                    })
                    await db.commit()
            except Exception as exc:
                logger.error("paypal_capture_address_upsert_failed",
                             error=str(exc), contact_id=contact_id,
                             paypal_capture_id=capture_id)

    # ── 3) Gift Aid declaration (best-effort) ───────────────────────────────
    if body.gift_aid and full_name:
        try:
            async with SessionLocal() as db:
                decl_id = str(uuid.uuid4())
                await db.execute(text("""
                    INSERT INTO gift_aid_declarations
                        (id, order_ref, full_name, first_name, surname, postcode, address, uprn,
                         contact_email, contact_phone, donation_amount, donation_date,
                         gift_aid_agreed, contact_id, created_at, updated_at)
                    VALUES (:id,:ref,:name,:first,:surname,:pc,:addr,:uprn,
                            :email,:phone,:amt,:today,true,:cid,:now,:now)
                """), {
                    "id": decl_id, "ref": order_ref, "name": full_name,
                    "first": body.contact_first_name or full_name.split(" ", 1)[0],
                    "surname": body.contact_surname or (full_name.split(" ", 1)[1] if " " in full_name else ""),
                    "pc": body.gift_aid_postcode, "addr": body.gift_aid_address,
                    "uprn": body.contact_uprn,
                    "email": body.contact_email, "phone": body.contact_phone,
                    "amt": captured_amount, "today": now.date(), "cid": contact_id, "now": now,
                })
                await db.commit()
        except Exception as exc:
            logger.error("paypal_capture_giftaid_insert_failed",
                         error=str(exc), order_ref=order_ref,
                         paypal_capture_id=capture_id)
            decl_id = None  # so the donation row doesn't FK-link to a non-existent decl

    # ── 4) DONATION + ORDER (CRITICAL — must succeed or we surface 500) ─────
    try:
        async with SessionLocal() as db:
            await db.execute(text("""
                INSERT INTO donations
                    (id, branch_id, amount, currency, gift_aid_eligible, gift_aid_declaration_id,
                     purpose, reference, payment_provider, payment_ref, paypal_capture_id,
                     status, source, contact_id, idempotency_key, created_at, updated_at)
                VALUES (:id,:branch,:amount,'GBP',:ga,:decl_id,
                        'Service Portal',:ref,'paypal',:paypal_id,:capture_id,
                        'COMPLETED','service-portal',:cid,:idem,:now,:now)
                ON CONFLICT (idempotency_key) DO NOTHING
            """), {
                "id": str(uuid.uuid4()), "branch": body.branch_id, "amount": captured_amount,
                "ga": body.gift_aid, "decl_id": decl_id, "ref": order_ref,
                "paypal_id": body.paypal_order_id, "capture_id": capture_id,
                "cid": contact_id, "idem": f"paypal-{body.paypal_order_id}", "now": now,
            })

            await db.execute(text("""
                INSERT INTO orders
                    (id, branch_id, reference, status, total_amount, currency,
                     payment_provider, payment_ref, paypal_capture_id,
                     customer_name, customer_email, customer_phone,
                     contact_id, idempotency_key, created_at, updated_at)
                VALUES (:id,:branch,:ref,'COMPLETED',:amount,'GBP',
                        'paypal',:paypal_id,:capture_id,:name,:email,:phone,
                        :cid,:idem,:now,:now)
                ON CONFLICT (idempotency_key) DO NOTHING
            """), {
                "id": order_id, "branch": body.branch_id, "ref": order_ref, "amount": captured_amount,
                "paypal_id": body.paypal_order_id, "capture_id": capture_id,
                "name": body.contact_name, "email": body.contact_email, "phone": body.contact_phone,
                "cid": contact_id, "idem": f"paypal-order-{body.paypal_order_id}", "now": now,
            })

            # ── GL posting (Phase 2): DR Bank CR Donation income ────────────
            # Idempotency key matches the donation idempotency_key so a
            # retried /capture (or the webhook backstop) only posts once.
            try:
                from shital.services import gl
                payer_label = (body.contact_name or body.contact_email or "Donor").strip()
                await gl.post(
                    db,
                    branch_id=body.branch_id,
                    entry_date=now.date(),
                    description=f"PayPal donation — {payer_label}",
                    reference=order_ref,
                    source_type=gl.SOURCE_DONATION,
                    source_id=order_id,
                    posted_by="paypal-capture",
                    idempotency_key=f"gl-paypal-{body.paypal_order_id}",
                    lines=gl.lines_for_donation(captured_amount, payer_label),
                )
            except Exception as gl_exc:
                # Don't roll back the donation — funds are already captured.
                # Trustees can spot the missing JNL via /admin/gl/audit and
                # post a manual one. (We also log loudly.)
                import structlog
                structlog.get_logger().exception(
                    "paypal_capture_gl_post_failed",
                    error=str(gl_exc),
                    paypal_order_id=body.paypal_order_id,
                    paypal_capture_id=capture_id,
                )

            await db.commit()
    except Exception as exc:
        # Donor's PayPal payment SUCCEEDED — only our DB recording failed.
        # Surface this to the frontend so the donor sees the PayPal references
        # (not a fake confirmation screen). PayPal is the source of truth and
        # the funds are already captured; trustees can reconcile via capture_id,
        # and a future PAYMENT.CAPTURE.COMPLETED webhook handler (PR #90) will
        # write the row idempotently as belt-and-braces.
        import structlog
        structlog.get_logger().error(
            "paypal_capture_record_failed",
            error=str(exc),
            paypal_order_id=body.paypal_order_id,
            paypal_capture_id=capture_id,
            amount=captured_amount,
        )
        raise HTTPException(
            status_code=500,
            detail={
                "message": (
                    "Your PayPal payment was successful but we couldn't record it on our side. "
                    "Please email info@shital.org.uk with the references below so we can confirm your donation."
                ),
                "paypal_order_id":   body.paypal_order_id,
                "paypal_capture_id": capture_id,
                "amount":            captured_amount,
                "error":             str(exc)[:200],
            },
        )

    return {
        "success": True,
        "order_id": order_id,
        "order_ref": order_ref,
        "paypal_order_id": body.paypal_order_id,
        "paypal_capture_id": capture_id,
        "amount": captured_amount,
    }


@router.post("/webhook")
async def paypal_capture_webhook(request: Request) -> dict[str, Any]:
    """PayPal webhook backstop for one-off donation captures.

    Belt-and-braces companion to /capture, which writes the donation row
    synchronously when the donor clicks Pay. If that synchronous write
    fails for any reason — DB blip, schema drift, transient connection
    — the donor's payment is already complete on PayPal's side, but our
    DB has no record. PayPal then fires PAYMENT.CAPTURE.COMPLETED to
    this endpoint (typically within seconds) and we write the row here.

    Idempotency: uses the same idempotency_key as /capture
    (`paypal-<order_id>` for donations, `paypal-order-<order_id>` for
    orders), so when both /capture and the webhook race only one wins
    via the existing ON CONFLICT DO NOTHING constraints. No event-level
    dedup table needed — PayPal retries hit the same unique key.

    Configure in PayPal Developer Dashboard → Webhooks → URL
    `https://service.shital.org.uk/api/v1/service/paypal/webhook` with
    event PAYMENT.CAPTURE.COMPLETED subscribed. Signature verification
    reuses PAYPAL_WEBHOOK_ID (the same secret the subscription webhook
    in recurring_giving.py uses, if both endpoints share one webhook
    config in PayPal; otherwise create a separate webhook config and
    point both at the same secret — PayPal's verify endpoint accepts
    the id we send).
    """
    import json

    # Reuse _verify_paypal_webhook from the recurring-giving webhook. It's
    # generic (takes a webhook_id + event payload) and a third copy of
    # PayPal's verify-webhook-signature call would just rot. Long-term
    # this belongs in a shared paypal_utils module — out of scope here.
    from sqlalchemy import text

    from shital.api.routers.recurring_giving import _verify_paypal_webhook
    from shital.core.fabrics.database import SessionLocal
    from shital.core.fabrics.secrets import SecretsManager

    body_bytes = await request.body()
    try:
        event = json.loads(body_bytes)
    except Exception:
        raise HTTPException(400, detail="Invalid JSON payload")

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

    event_type = event.get("event_type", "")
    event_id   = event.get("id", "")

    # Ignore every event type except CAPTURE.COMPLETED. Subscription
    # events live on the /service/giving/webhook/paypal route; if PayPal
    # is misconfigured to send them here we still 200 so it doesn't
    # hammer us with retries.
    if event_type != "PAYMENT.CAPTURE.COMPLETED":
        return {"received": True, "event_type": event_type, "handled": False}

    resource     = event.get("resource", {}) or {}
    capture_id   = resource.get("id", "")
    amount_obj   = resource.get("amount", {}) or {}
    try:
        captured_amount = float(amount_obj.get("value", "0") or 0)
    except (TypeError, ValueError):
        captured_amount = 0.0

    # supplementary_data.related_ids.order_id is the v2 checkout order id
    # — the same id /capture wrote with, so our idempotency keys collide
    # harmlessly when both paths run.
    paypal_order_id = (
        ((resource.get("supplementary_data") or {}).get("related_ids") or {}).get("order_id", "")
    )

    # custom_id was stashed by /order (this PR) to body.branch_id. Fall
    # back to 'main' if absent (older orders created before this PR).
    branch_id = (resource.get("custom_id") or "main").strip() or "main"

    payer          = resource.get("payer") or {}
    payer_email    = (payer.get("email_address") or "").strip().lower() or None
    payer_name_obj = payer.get("name") or {}
    given          = (payer_name_obj.get("given_name") or "").strip()
    surname        = (payer_name_obj.get("surname")    or "").strip()
    full_name      = f"{given} {surname}".strip()

    if not paypal_order_id or not capture_id:
        structlog.get_logger().error(
            "paypal_webhook_capture_missing_ids",
            event_id=event_id, capture_id=capture_id, order_id=paypal_order_id,
        )
        return {"received": True, "event_type": event_type, "handled": False}

    now           = datetime.utcnow()
    order_uuid    = str(uuid.uuid4())
    order_ref     = f"SH{int(now.timestamp())}"
    donation_uuid = str(uuid.uuid4())

    try:
        async with SessionLocal() as db:
            contact_id: str | None = None
            if payer_email:
                contact_uuid = str(uuid.uuid4())
                c_result = await db.execute(text("""
                    INSERT INTO contacts
                        (id, email, first_name, surname, full_name,
                         gdpr_consent, gdpr_consented_at, tac_consent, tac_consented_at,
                         first_source, first_branch_id, created_at, updated_at)
                    VALUES
                        (:id, :email, :first, :surname, :name,
                         true, :now, true, :now,
                         'paypal-webhook', :branch, :now, :now)
                    ON CONFLICT (email) DO UPDATE SET
                        first_name = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
                        surname    = COALESCE(NULLIF(EXCLUDED.surname,''),    contacts.surname),
                        full_name  = COALESCE(NULLIF(EXCLUDED.full_name,''),  contacts.full_name),
                        updated_at = EXCLUDED.updated_at
                    RETURNING id
                """), {
                    "id": contact_uuid, "email": payer_email,
                    "first": given, "surname": surname, "name": full_name,
                    "branch": branch_id, "now": now,
                })
                row = c_result.mappings().first()
                contact_id = str(row["id"]) if row else contact_uuid

            await db.execute(text("""
                INSERT INTO donations
                    (id, branch_id, amount, currency, gift_aid_eligible,
                     purpose, reference, payment_provider, payment_ref, paypal_capture_id,
                     status, source, contact_id, idempotency_key, created_at, updated_at)
                VALUES (:id,:branch,:amount,'GBP',false,
                        'Service Portal',:ref,'paypal',:paypal_id,:capture_id,
                        'COMPLETED','paypal-webhook',:cid,:idem,:now,:now)
                ON CONFLICT (idempotency_key) DO NOTHING
            """), {
                "id": donation_uuid, "branch": branch_id, "amount": captured_amount,
                "ref": order_ref, "paypal_id": paypal_order_id, "capture_id": capture_id,
                "cid": contact_id, "idem": f"paypal-{paypal_order_id}", "now": now,
            })

            await db.execute(text("""
                INSERT INTO orders
                    (id, branch_id, reference, status, total_amount, currency,
                     payment_provider, payment_ref, paypal_capture_id,
                     customer_name, customer_email,
                     contact_id, idempotency_key, created_at, updated_at)
                VALUES (:id,:branch,:ref,'COMPLETED',:amount,'GBP',
                        'paypal',:paypal_id,:capture_id,:name,:email,
                        :cid,:idem,:now,:now)
                ON CONFLICT (idempotency_key) DO NOTHING
            """), {
                "id": order_uuid, "branch": branch_id, "ref": order_ref,
                "amount": captured_amount,
                "paypal_id": paypal_order_id, "capture_id": capture_id,
                "name": full_name, "email": payer_email,
                "cid": contact_id, "idem": f"paypal-order-{paypal_order_id}", "now": now,
            })

            await db.commit()
    except Exception as exc:
        # Log + 200. Returning 500 would have PayPal retry this event up
        # to ~25 times over 3 days — same DB problem will recur each
        # time. Better to surface in our logs and let trustees reconcile
        # via the PayPal dashboard using capture_id / order_id below.
        structlog.get_logger().error(
            "paypal_webhook_capture_record_failed",
            error=str(exc), event_id=event_id,
            paypal_order_id=paypal_order_id, paypal_capture_id=capture_id,
            amount=captured_amount, branch_id=branch_id,
        )
        return {
            "received": True, "event_type": event_type, "handled": False,
            "error": str(exc)[:200],
            "paypal_order_id": paypal_order_id, "paypal_capture_id": capture_id,
        }

    structlog.get_logger().info(
        "paypal_webhook_capture_recorded",
        event_id=event_id, paypal_order_id=paypal_order_id,
        paypal_capture_id=capture_id, amount=captured_amount,
        branch_id=branch_id,
    )

    return {
        "received": True,
        "event_type": event_type,
        "handled": True,
        "paypal_order_id":   paypal_order_id,
        "paypal_capture_id": capture_id,
        "amount":            captured_amount,
    }
