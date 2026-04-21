"""PayPal payment integration for the Shital Service web portal."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import httpx
import structlog
from fastapi import APIRouter, HTTPException
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


def _parse_uk_address(raw: str, postcode: str) -> dict:
    """Parse a UK address string into PayPal address fields."""
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    pc_compact = postcode.upper().replace(" ", "")
    addr: dict = {"country_code": "GB"}
    if postcode:
        addr["postal_code"] = _fmt_uk_postcode(postcode)
    if parts:
        addr["address_line_1"] = parts[0]
    if len(parts) >= 2:
        addr["address_line_2"] = parts[1]
    # Last non-postcode part is the city/county — compare without spaces
    city_candidates = [p for p in parts[1:] if p.upper().replace(" ", "") != pc_compact]
    if city_candidates:
        addr["admin_area_2"] = city_candidates[-1]
    return addr


@router.post("/order")
async def create_paypal_order(body: CreateOrderBody) -> dict[str, str]:
    """Create a PayPal order server-side and return its ID to the frontend."""
    token = await _token()
    base  = await _base()

    # Build payer — prefer explicit first/surname, fall back to splitting full name
    given  = body.contact_first_name.strip() or body.contact_name.strip().split(" ", 1)[0]
    family = body.contact_surname.strip() or (body.contact_name.strip().split(" ", 1)[1] if " " in body.contact_name.strip() else "")

    payer: dict = {}
    if given or family:
        payer["name"] = {"given_name": given, "surname": family}
    if body.contact_email:
        payer["email_address"] = body.contact_email
    if body.contact_phone:
        digits = "".join(c for c in body.contact_phone if c.isdigit())
        if digits:
            payer["phone"] = {"phone_type": "MOBILE", "phone_number": {"national_number": digits[-10:]}}
    if body.contact_postcode or body.contact_address:
        payer["address"] = _parse_uk_address(body.contact_address, body.contact_postcode)

    payload: dict = {
        "intent": "CAPTURE",
        "purchase_units": [{
            "amount": {"currency_code": "GBP", "value": f"{body.amount:.2f}"},
            "description": body.description[:127],
        }],
        "application_context": {
            "brand_name": "Shital Temple",
            "user_action": "PAY_NOW",
            "shipping_preference": "NO_SHIPPING",
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

    try:
        async with SessionLocal() as db:
            full_name = body.contact_name or f"{body.contact_first_name} {body.contact_surname}".strip()
            email_key = body.contact_email.strip().lower() if body.contact_email.strip() else None

            # ── Upsert CRM contact ──────────────────────────────────────────
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

                # ── Upsert address linked to contact ────────────────────────
                addr_text    = body.gift_aid_address or ""
                addr_postcode = body.gift_aid_postcode or ""
                addr_uprn    = body.contact_uprn or ""
                if addr_postcode or addr_text:
                    await db.execute(text("""
                        INSERT INTO addresses
                            (id, contact_id, formatted, postcode, uprn,
                             is_primary, lookup_source, created_at)
                        VALUES (:id, :cid, :fmt, :pc, :uprn, true, 'service-portal', :now)
                    """), {
                        "id": str(uuid.uuid4()), "cid": contact_id,
                        "fmt": addr_text, "pc": addr_postcode, "uprn": addr_uprn, "now": now,
                    })

            # ── Gift Aid declaration ────────────────────────────────────────
            decl_id: str | None = None
            if body.gift_aid and full_name:
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

            # ── Donation ledger ─────────────────────────────────────────────
            await db.execute(text("""
                INSERT INTO donations
                    (id, branch_id, amount, currency, gift_aid_eligible, gift_aid_declaration_id,
                     purpose, reference, payment_provider, payment_ref, paypal_capture_id,
                     status, contact_id, idempotency_key, created_at, updated_at)
                VALUES (:id,:branch,:amount,'GBP',:ga,:decl_id,
                        'Service Portal',:ref,'paypal',:paypal_id,:capture_id,
                        'COMPLETED',:cid,:idem,:now,:now)
                ON CONFLICT (idempotency_key) DO NOTHING
            """), {
                "id": str(uuid.uuid4()), "branch": body.branch_id, "amount": captured_amount,
                "ga": body.gift_aid, "decl_id": decl_id, "ref": order_ref,
                "paypal_id": body.paypal_order_id, "capture_id": capture_id,
                "cid": contact_id, "idem": f"paypal-{body.paypal_order_id}", "now": now,
            })

            # ── Order record ────────────────────────────────────────────────
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
            await db.commit()
    except Exception as exc:
        import structlog
        structlog.get_logger().error("paypal_capture_record_failed", error=str(exc))

    return {
        "success": True,
        "order_id": order_id,
        "order_ref": order_ref,
        "paypal_order_id": body.paypal_order_id,
        "paypal_capture_id": capture_id,
        "amount": captured_amount,
    }
