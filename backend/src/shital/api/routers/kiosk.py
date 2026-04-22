from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import OptionalSpace
from shital.core.space.context import DigitalSpace

router = APIRouter(prefix="/kiosk", tags=["kiosk"])


@router.get("/services")
async def get_services(ctx: OptionalSpace, category: str = "", branch_id: str = "main"):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    conditions = ["is_active = true", "deleted_at IS NULL"]
    params: dict[str, Any] = {"bid": branch_id}
    if category:
        conditions.append("category = :cat")
        params["cat"] = category
    conditions.append("branch_id = :bid")
    async with SessionLocal() as db:
        result = await db.execute(
            text(f"SELECT id, name, name_gu, name_hi, description, category, price, currency, duration, capacity, image_url FROM temple_services WHERE {' AND '.join(conditions)} ORDER BY category, name"),
            params,
        )
        rows = result.mappings().all()
    return {"services": [dict(r) for r in rows], "branch_id": branch_id}


@router.get("/services/categories")
async def get_categories(branch_id: str = "main"):
    return {
        "categories": [
            {"id": "PUJA", "name": "Puja", "name_gu": "પૂજા", "name_hi": "पूजा", "icon": "🧑‍🍳", "color": "#FF6B35"},
            {"id": "HAVAN", "name": "Havan", "name_gu": "હવન", "name_hi": "हवन", "icon": "🔥", "color": "#FF4500"},
            {"id": "DONATION", "name": "Donation", "name_gu": "દાન", "name_hi": "दान", "icon": "🙏", "color": "#FFD700"},
            {"id": "CLASS", "name": "Classes", "name_gu": "વર્ગ", "name_hi": "कक्षा", "icon": "📚", "color": "#4CAF50"},
            {"id": "HALL_HIRE", "name": "Hall Hire", "name_gu": "હૉલ ભાડે", "name_hi": "हॉल किराया", "icon": "🏛️", "color": "#9C27B0"},
            {"id": "FESTIVAL", "name": "Festival", "name_gu": "઻ત્સવ", "name_hi": "उत्सव", "icon": "🎉", "color": "#E91E63"},
        ]
    }


class CreateBasketInput(BaseModel):
    branch_id: str = "main"
    session_id: str = ""


class AddItemInput(BaseModel):
    basket_id: str
    item_type: str
    reference_id: str = ""
    name: str
    description: str = ""
    quantity: int = 1
    unit_price: float
    metadata: dict[str, Any] = {}


@router.post("/basket")
async def create_basket(body: CreateBasketInput):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    basket_id = str(uuid.uuid4())
    session_id = body.session_id or str(uuid.uuid4())
    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(
            text("INSERT INTO baskets (id, session_id, branch_id, status, expires_at, created_at, updated_at) VALUES (:id, :sid, :bid, 'ACTIVE', NOW() + INTERVAL '30 minutes', :now, :now)"),
            {"id": basket_id, "sid": session_id, "bid": body.branch_id, "now": now},
        )
        await db.commit()
    return {"basket_id": basket_id, "session_id": session_id}


@router.get("/basket/{basket_id}")
async def get_basket(basket_id: str):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        items_result = await db.execute(
            text("SELECT id, item_type, reference_id, name, description, quantity, unit_price, total_price, metadata FROM basket_items WHERE basket_id = :bid ORDER BY created_at"),
            {"bid": basket_id},
        )
        items = [dict(r) for r in items_result.mappings()]
    subtotal = sum(float(str(i["total_price"])) for i in items)
    return {"basket_id": basket_id, "items": items, "subtotal": subtotal, "item_count": len(items), "currency": "GBP"}


@router.post("/basket/item")
async def add_item(body: AddItemInput):
    import json

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    item_id = str(uuid.uuid4())
    total = body.unit_price * body.quantity
    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(
            text("INSERT INTO basket_items (id, basket_id, item_type, reference_id, name, description, quantity, unit_price, total_price, metadata, created_at, updated_at) VALUES (:id, :bid, :type, :ref, :name, :desc, :qty, :up, :tp, :meta, :now, :now)"),
            {"id": item_id, "bid": body.basket_id, "type": body.item_type, "ref": body.reference_id or None, "name": body.name, "desc": body.description or None, "qty": body.quantity, "up": str(body.unit_price), "tp": str(total), "meta": json.dumps(body.metadata), "now": now},
        )
        await db.commit()
    return {"item_id": item_id, "total_price": total}


@router.delete("/basket/{basket_id}/item/{item_id}")
async def remove_item(basket_id: str, item_id: str):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("DELETE FROM basket_items WHERE id = :iid AND basket_id = :bid"), {"iid": item_id, "bid": basket_id})
        await db.commit()
    return {"removed": True}


class CheckoutInput(BaseModel):
    basket_id: str
    payment_provider: str = "STRIPE"
    branch_id: str = "main"
    customer_name: str = ""
    customer_first_name: str = ""
    customer_surname: str = ""
    customer_email: str = ""
    customer_phone: str = ""
    customer_postcode: str = ""
    customer_address: str = ""
    customer_uprn: str = ""


@router.post("/checkout")
async def checkout(body: CheckoutInput, ctx: OptionalSpace):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        items_result = await db.execute(text("SELECT SUM(total_price) AS total FROM basket_items WHERE basket_id = :bid"), {"bid": body.basket_id})
        row = items_result.mappings().first()
        if row is None:
            raise HTTPException(status_code=400, detail="Basket is empty")
        total = float(str(row["total"] or 0))
    if total <= 0:
        raise HTTPException(status_code=400, detail="Basket is empty")
    order_id = str(uuid.uuid4())
    ref = f"ORD-{order_id[:8].upper()}"
    now = datetime.utcnow()
    amount_pence = int(total * 100)
    from shital.capabilities.payments.capabilities import CreatePaymentInput, create_payment
    safe_ctx = ctx or DigitalSpace(user_id="kiosk", user_email="kiosk@shital.org", role="KIOSK", branch_id=body.branch_id, permissions=[], session_id=str(uuid.uuid4()))
    payment = await create_payment(safe_ctx, CreatePaymentInput(provider=body.payment_provider, amount_pence=amount_pence, currency="GBP", order_id=order_id, description=f"Shital Temple Order {ref}", idempotency_key=order_id))

    full_name = body.customer_name or f"{body.customer_first_name} {body.customer_surname}".strip()
    email_key = body.customer_email.strip().lower() if body.customer_email.strip() else None

    async with SessionLocal() as db:
        # ── CRM contact upsert ──────────────────────────────────────────────
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
                     'kiosk', :branch, :now, :now)
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
                "first": body.customer_first_name or "", "surname": body.customer_surname or "",
                "name": full_name, "phone": body.customer_phone or "",
                "branch": body.branch_id, "now": now,
            })
            row = c_result.mappings().first()
            contact_id = str(row["id"]) if row else contact_uuid

            if body.customer_postcode or body.customer_address:
                await db.execute(text("""
                    INSERT INTO addresses
                        (id, contact_id, formatted, postcode, uprn,
                         is_primary, lookup_source, created_at)
                    VALUES (:id, :cid, :fmt, :pc, :uprn, true, 'kiosk', :now)
                """), {
                    "id": str(uuid.uuid4()), "cid": contact_id,
                    "fmt": body.customer_address or "", "pc": body.customer_postcode.upper().strip(),
                    "uprn": body.customer_uprn or "", "now": now,
                })

        await db.execute(
            text("""INSERT INTO orders
                (id, branch_id, basket_id, reference, status, total_amount, currency,
                 payment_provider, payment_ref, customer_name, customer_email, customer_phone,
                 contact_id, idempotency_key, created_at, updated_at)
                VALUES (:id, :bid, :basket, :ref, 'PENDING', :total, 'GBP',
                        :provider, :pref, :cname, :cemail, :cphone,
                        :cid, :ikey, :now, :now)"""),
            {
                "id": order_id, "bid": body.branch_id, "basket": body.basket_id,
                "ref": ref, "total": str(total), "provider": body.payment_provider,
                "pref": payment.get("payment_id"),
                "cname": full_name, "cemail": body.customer_email, "cphone": body.customer_phone,
                "cid": contact_id, "ikey": order_id, "now": now,
            },
        )
        await db.execute(text("UPDATE baskets SET status = 'CHECKOUT', updated_at = :now WHERE id = :bid"), {"now": now, "bid": body.basket_id})
        await db.commit()
    return {"order_id": order_id, "reference": ref, "total": total, "currency": "GBP", "payment": payment}


@router.post("/terminal/connection-token")
async def stripe_connection_token():
    import stripe

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager
    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY)
    try:
        token = stripe.terminal.ConnectionToken.create()
        return {"secret": token.secret}
    except Exception as e:
        return {"error": str(e), "secret": ""}


class TerminalPaymentInput(BaseModel):
    amount_pence: int
    currency: str = "GBP"
    order_id: str
    description: str = "Shital Temple Payment"
    reader_id: str = ""


@router.post("/terminal/payment-intent")
async def create_terminal_payment_intent(body: TerminalPaymentInput):
    import stripe

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager
    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY)
    try:
        intent = stripe.PaymentIntent.create(
            amount=body.amount_pence, currency=body.currency.lower(),
            payment_method_types=["card_present"], capture_method="automatic",
            description=body.description, metadata={"order_id": body.order_id, "reader_id": body.reader_id},
        )
        return {"payment_intent_id": intent.id, "client_secret": intent.client_secret, "status": intent.status}
    except Exception as e:
        return {"error": str(e)}


class ReaderActionInput(BaseModel):
    reader_id: str
    payment_intent_id: str


@router.post("/terminal/process-payment")
async def process_payment_on_reader(body: ReaderActionInput):
    if not body.reader_id or not body.reader_id.strip():
        return {"error": "No card reader configured. Please assign a Stripe Terminal reader in Admin → Devices."}
    import stripe

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager
    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY)
    try:
        action = stripe.terminal.Reader.process_payment_intent(body.reader_id, payment_intent=body.payment_intent_id)
        return {"reader_id": body.reader_id, "status": action.action.status if action.action else "unknown"}
    except Exception as e:
        return {"error": str(e)}


@router.post("/terminal/cancel-action")
async def cancel_reader_action(body: ReaderActionInput):
    import stripe

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager
    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY)
    try:
        stripe.terminal.Reader.cancel_action(body.reader_id)
        return {"cancelled": True}
    except Exception as e:
        return {"error": str(e)}


@router.get("/terminal/payment-intent-status")
async def get_payment_intent_status(id: str):
    """Poll a PaymentIntent status — used by kiosk to detect card tap success."""
    import stripe

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager
    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY)
    try:
        intent = stripe.PaymentIntent.retrieve(id)
        return {"status": intent.status, "id": intent.id}
    except Exception as e:
        return {"status": "unknown", "error": str(e)}


@router.get("/terminal/readers")
async def list_terminal_readers(location_id: str = ""):
    import stripe

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager
    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY)
    try:
        params: dict = {"limit": 20}
        if location_id:
            params["location"] = location_id
        elif settings.STRIPE_TERMINAL_LOCATION_ID:
            params["location"] = settings.STRIPE_TERMINAL_LOCATION_ID
        readers = stripe.terminal.Reader.list(**params)
        return {"readers": [{"id": r.id, "label": r.label or r.id, "device_type": r.device_type, "status": r.status, "serial_number": getattr(r, "serial_number", ""), "location": r.location} for r in readers.data]}
    except Exception as e:
        return {"readers": [], "error": str(e)}


class SquareCheckoutInput(BaseModel):
    amount_pence: int
    order_id: str
    description: str = "Shital Temple Payment"
    device_id: str = ""
    note: str = ""


@router.post("/square/terminal-checkout")
async def square_terminal_checkout(body: SquareCheckoutInput):
    import httpx

    from shital.core.fabrics.config import settings
    base = "https://connect.squareup.com" if settings.SQUARE_ENVIRONMENT == "production" else "https://connect.squareupsandbox.com"
    headers = {"Authorization": f"Bearer {settings.SQUARE_ACCESS_TOKEN}", "Content-Type": "application/json", "Square-Version": "2024-06-04"}
    payload = {"idempotency_key": body.order_id, "checkout": {"amount_money": {"amount": body.amount_pence, "currency": "GBP"}, "reference_id": body.order_id, "note": body.note or body.description, "device_options": {"device_id": body.device_id or settings.SQUARE_LOCATION_ID, "skip_receipt_screen": False, "collect_signature": False, "tip_settings": {"allow_tipping": False}}, "payment_type": "CARD_PRESENT"}}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{base}/v2/terminals/checkouts", headers=headers, json=payload, timeout=15)
        data = resp.json()
        if "checkout" in data:
            return {"checkout_id": data["checkout"]["id"], "device_id": body.device_id, "status": data["checkout"]["status"], "amount": body.amount_pence / 100}
        return {"error": data.get("errors", [{}])[0].get("detail", "Unknown error")}
    except Exception as e:
        return {"error": str(e)}


@router.get("/square/devices")
async def list_square_devices():
    import httpx

    from shital.core.fabrics.config import settings
    base = "https://connect.squareup.com" if settings.SQUARE_ENVIRONMENT == "production" else "https://connect.squareupsandbox.com"
    headers = {"Authorization": f"Bearer {settings.SQUARE_ACCESS_TOKEN}", "Square-Version": "2024-06-04"}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{base}/v2/devices", headers=headers, timeout=10)
        data = resp.json()
        return {"devices": [{"id": d["id"], "name": d.get("attributes", {}).get("name", d["id"]), "status": d.get("status", {}).get("category", "unknown"), "model": d.get("attributes", {}).get("model", "")} for d in data.get("devices", [])]}
    except Exception as e:
        return {"devices": [], "error": str(e)}


@router.get("/square/terminal-checkout/{checkout_id}")
async def square_checkout_status(checkout_id: str):
    """Poll Square Terminal checkout status."""
    import httpx

    from shital.core.fabrics.config import settings
    base = "https://connect.squareup.com" if settings.SQUARE_ENVIRONMENT == "production" else "https://connect.squareupsandbox.com"
    headers = {"Authorization": f"Bearer {settings.SQUARE_ACCESS_TOKEN}", "Square-Version": "2024-06-04"}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{base}/v2/terminals/checkouts/{checkout_id}", headers=headers, timeout=10)
        data = resp.json()
        checkout = data.get("checkout", {})
        return {
            "status": checkout.get("status", "UNKNOWN"),
            "checkout_id": checkout_id,
            "amount": checkout.get("amount_money", {}).get("amount", 0) / 100,
        }
    except Exception as e:
        return {"status": "UNKNOWN", "error": str(e)}


# ─── Clover Flex / Cloud Pay Display ─────────────────────────────────────────

def _clover_base(environment: str) -> str:
    return "https://api.clover.com" if environment == "production" else "https://sandbox.dev.clover.com"


class CloverPaymentInput(BaseModel):
    amount_pence: int
    order_id: str
    description: str = "Shital Temple Payment"
    device_id: str = ""
    items: list[dict[str, Any]] = []


@router.post("/clover/payment")
async def clover_payment(body: CloverPaymentInput):
    """
    Create a Clover order with line items and push it to the Clover Flex device display.
    The customer then taps/inserts their card on the device.
    Poll GET /clover/payment/{clover_order_id} to check completion.
    """
    import httpx

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager

    access_token = await SecretsManager.get("CLOVER_ACCESS_TOKEN") or settings.CLOVER_ACCESS_TOKEN
    merchant_id = await SecretsManager.get("CLOVER_MERCHANT_ID") or settings.CLOVER_MERCHANT_ID
    environment = await SecretsManager.get("CLOVER_ENVIRONMENT") or settings.CLOVER_ENVIRONMENT or "sandbox"
    device_id = body.device_id or await SecretsManager.get("CLOVER_DEVICE_ID") or ""

    if not access_token or not merchant_id:
        return {"error": "Clover is not configured. Add CLOVER_ACCESS_TOKEN and CLOVER_MERCHANT_ID in Admin → API Keys."}

    base = _clover_base(environment)
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # 1. Create an order
            order_resp = await client.post(
                f"{base}/v3/merchants/{merchant_id}/orders",
                headers=headers,
                json={"currency": "GBP", "manualTransaction": False, "testMode": environment != "production"},
            )
            if not order_resp.is_success:
                return {"error": f"Clover order creation failed ({order_resp.status_code}): {order_resp.text[:200]}"}
            clover_order_id = order_resp.json()["id"]

            # 2. Add line items
            line_items = body.items or [{"name": body.description, "unit_price_pence": body.amount_pence, "quantity": 1}]
            for item in line_items:
                await client.post(
                    f"{base}/v3/merchants/{merchant_id}/orders/{clover_order_id}/line_items",
                    headers=headers,
                    json={
                        "price": item.get("unit_price_pence", body.amount_pence),
                        "name": item.get("name", body.description),
                        "quantity": item.get("quantity", 1),
                    },
                )

            # 3. Push to device display (Cloud Pay Display)
            if device_id:
                await client.post(
                    f"{base}/v3/merchants/{merchant_id}/devices/{device_id}/displays",
                    headers=headers,
                    json={"type": "TRANSACTION", "order": {"id": clover_order_id}},
                )

        return {
            "clover_order_id": clover_order_id,
            "device_id": device_id,
            "amount": body.amount_pence / 100,
        }
    except Exception as e:
        return {"error": str(e)}


@router.get("/clover/payment/{order_id}")
async def clover_payment_status(order_id: str):
    """Poll Clover order for payment completion (expand=payments)."""
    import httpx

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager

    access_token = await SecretsManager.get("CLOVER_ACCESS_TOKEN") or settings.CLOVER_ACCESS_TOKEN
    merchant_id = await SecretsManager.get("CLOVER_MERCHANT_ID") or settings.CLOVER_MERCHANT_ID
    environment = await SecretsManager.get("CLOVER_ENVIRONMENT") or settings.CLOVER_ENVIRONMENT or "sandbox"

    if not access_token or not merchant_id:
        return {"status": "error", "error": "Clover not configured"}

    base = _clover_base(environment)
    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{base}/v3/merchants/{merchant_id}/orders/{order_id}?expand=payments",
                headers=headers,
            )
        data = resp.json()
        payments = data.get("payments", {}).get("elements", [])
        for p in payments:
            if p.get("result") == "SUCCESS":
                return {"status": "COMPLETED", "payment_id": p.get("id"), "amount": p.get("amount", 0) / 100}
            if p.get("result") in ("FAIL", "VOIDED"):
                return {"status": "FAILED"}
        if data.get("state") == "LOCKED":
            return {"status": "CANCELLED"}
        return {"status": "PENDING"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.get("/clover/devices")
async def list_clover_devices():
    """List Clover devices registered to the configured merchant."""
    import httpx

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager

    access_token = await SecretsManager.get("CLOVER_ACCESS_TOKEN") or settings.CLOVER_ACCESS_TOKEN
    merchant_id = await SecretsManager.get("CLOVER_MERCHANT_ID") or settings.CLOVER_MERCHANT_ID
    environment = await SecretsManager.get("CLOVER_ENVIRONMENT") or settings.CLOVER_ENVIRONMENT or "sandbox"

    if not access_token or not merchant_id:
        return {"devices": [], "error": "Clover not configured. Add CLOVER_ACCESS_TOKEN and CLOVER_MERCHANT_ID in Admin → API Keys."}

    base = _clover_base(environment)
    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{base}/v3/merchants/{merchant_id}/devices", headers=headers)
        elements = resp.json().get("devices", {}).get("elements", [])
        devices = [
            {
                "id": d.get("id"),
                "name": d.get("name") or d.get("id"),
                "model": d.get("model", "Clover Flex"),
                "serial": d.get("serial", ""),
                "status": "online" if d.get("online") else "offline",
            }
            for d in elements
        ]
        return {"devices": devices}
    except Exception as e:
        return {"devices": [], "error": str(e)}


# ─── SumUp ────────────────────────────────────────────────────────────────────

class SumUpCheckoutInput(BaseModel):
    amount_pence: int
    order_id: str
    description: str = "Temple Payment"
    reader_serial: str = ""     # SumUp Solo/Air Plus serial number


@router.post("/sumup/checkout")
async def sumup_checkout(body: SumUpCheckoutInput):
    """
    Create a SumUp checkout and push it to the configured SumUp reader.
    Poll GET /sumup/checkout/{checkout_id} to check completion.
    """
    import uuid as _uuid

    import httpx

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager

    access_token = await SecretsManager.get("SUMUP_ACCESS_TOKEN") or settings.SUMUP_ACCESS_TOKEN
    merchant_code = await SecretsManager.get("SUMUP_MERCHANT_CODE") or settings.SUMUP_MERCHANT_CODE

    if not access_token or not merchant_code:
        return {"error": "SumUp is not configured. Add SUMUP_ACCESS_TOKEN and SUMUP_MERCHANT_CODE in Admin → API Keys."}

    base = "https://api.sumup.com"
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    amount = round(body.amount_pence / 100, 2)
    checkout_ref = f"SHT-{body.order_id[:12].upper()}-{_uuid.uuid4().hex[:6].upper()}"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # 1. Create checkout
            create_resp = await client.post(
                f"{base}/v0.1/checkouts",
                headers=headers,
                json={
                    "checkout_reference": checkout_ref,
                    "amount": amount,
                    "currency": "GBP",
                    "merchant_code": merchant_code,
                    "description": body.description,
                },
            )
            if not create_resp.is_success:
                return {"error": f"SumUp checkout creation failed ({create_resp.status_code}): {create_resp.text[:200]}"}

            checkout = create_resp.json()
            checkout_id = checkout.get("id")

            # 2. Push to physical reader if serial provided
            reader_serial = body.reader_serial or await SecretsManager.get("SUMUP_READER_SERIAL") or ""
            if reader_serial and checkout_id:
                await client.post(
                    f"{base}/v0.1/merchants/{merchant_code}/readers/{reader_serial}/checkout",
                    headers=headers,
                    json={"id": checkout_id},
                )

        return {
            "checkout_id": checkout_id,
            "checkout_reference": checkout_ref,
            "amount": amount,
            "reader_serial": reader_serial,
        }
    except Exception as e:
        return {"error": str(e)}


@router.get("/sumup/checkout/{checkout_id}")
async def sumup_checkout_status(checkout_id: str):
    """Poll SumUp checkout status (PENDING / COMPLETED / FAILED / EXPIRED)."""
    import httpx

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager

    access_token = await SecretsManager.get("SUMUP_ACCESS_TOKEN") or settings.SUMUP_ACCESS_TOKEN
    if not access_token:
        return {"status": "error", "error": "SumUp not configured"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.sumup.com/v0.1/checkouts/{checkout_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        data = resp.json()
        return {"status": data.get("status", "PENDING"), "raw": data}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.get("/sumup/readers")
async def list_sumup_readers():
    """List SumUp readers registered to the merchant."""
    import httpx

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.secrets import SecretsManager

    access_token = await SecretsManager.get("SUMUP_ACCESS_TOKEN") or settings.SUMUP_ACCESS_TOKEN
    merchant_code = await SecretsManager.get("SUMUP_MERCHANT_CODE") or settings.SUMUP_MERCHANT_CODE

    if not access_token or not merchant_code:
        return {"readers": [], "error": "SumUp not configured. Add SUMUP_ACCESS_TOKEN and SUMUP_MERCHANT_CODE."}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.sumup.com/v0.1/merchants/{merchant_code}/readers",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        readers = resp.json() if resp.is_success else []
        if isinstance(readers, list):
            return {"readers": [{"serial": r.get("serial_number", ""), "name": r.get("name", r.get("serial_number", "")), "status": r.get("status", "unknown")} for r in readers]}
        return {"readers": []}
    except Exception as e:
        return {"readers": [], "error": str(e)}


class QuickDonationRecordInput(BaseModel):
    basket_id: str
    order_ref: str
    amount_pence: int
    branch_id: str = "main"
    payment_intent_id: str = ""
    reader_id: str = ""


# Anonymous kiosk user/branch lookup — maps branch codes to UUIDs at runtime.
# Falls back to using the code directly (works if DB stores string IDs).
async def _resolve_branch_uuid(db: Any, branch_code: str) -> str:
    """Resolve a branch short code (e.g. 'main') to its UUID. Returns the code unchanged if not found."""
    from sqlalchemy import text
    row = (await db.execute(text("SELECT id FROM branches WHERE branch_id = :code LIMIT 1"), {"code": branch_code})).mappings().first()
    return str(row["id"]) if row else branch_code


async def _resolve_anonymous_user(db: Any) -> str:
    """Get or create a system 'anonymous-kiosk' user for recording anonymous donations."""
    from sqlalchemy import text
    row = (await db.execute(text("SELECT id FROM users WHERE email = 'anonymous-kiosk@shital.org' LIMIT 1"))).mappings().first()
    if row:
        return str(row["id"])
    anon_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, email, name, role, created_at, updated_at) "
            "VALUES (:id, 'anonymous-kiosk@shital.org', 'Anonymous Kiosk Donor', 'KIOSK', :now, :now) "
            "ON CONFLICT (email) DO NOTHING"
        ),
        {"id": anon_id, "now": datetime.utcnow()},
    )
    await db.commit()
    # Re-fetch in case of race condition
    row = (await db.execute(text("SELECT id FROM users WHERE email = 'anonymous-kiosk@shital.org' LIMIT 1"))).mappings().first()
    return str(row["id"]) if row else anon_id


@router.post("/quick-donation/record")
async def record_quick_donation(body: QuickDonationRecordInput):
    """
    Record a quick donation as an anonymous entry in both the orders and donations tables.
    All quick donations are stored as anonymous — no personal data is captured.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    order_id = body.basket_id
    donation_id = str(uuid.uuid4())
    total = body.amount_pence / 100
    now = datetime.utcnow()
    try:
        async with SessionLocal() as db:
            branch_id = await _resolve_branch_uuid(db, body.branch_id)
            anon_user_id = await _resolve_anonymous_user(db)

            # 1. Record in orders table (for order tracking / reconciliation)
            await db.execute(
                text(
                    "INSERT INTO orders (id, user_id, branch_id, basket_id, reference, status, total_amount, currency, "
                    "payment_provider, payment_ref, idempotency_key, metadata, created_at, updated_at) "
                    "VALUES (:id, :uid, :bid, :basket, :ref, 'PENDING', :total, 'GBP', 'KIOSK', :pref, :ikey, "
                    "'{\"source\": \"quick-donation\", \"anonymous\": true}'::jsonb, :now, :now) "
                    "ON CONFLICT (id) DO NOTHING"
                ),
                {
                    "id": order_id, "uid": anon_user_id, "bid": branch_id,
                    "basket": body.basket_id, "ref": body.order_ref,
                    "total": str(total), "pref": body.payment_intent_id,
                    "ikey": order_id, "now": now,
                },
            )

            # 2. Record in donations table (for donation reporting, Gift Aid, finance)
            await db.execute(
                text(
                    "INSERT INTO donations (id, user_id, branch_id, amount, currency, "
                    "gift_aid_eligible, purpose, reference, payment_provider, payment_ref, "
                    "status, idempotency_key, created_at, updated_at) "
                    "VALUES (:id, :uid, :bid, :amount, 'GBP', false, 'General Fund', :ref, "
                    "'KIOSK', :pref, 'PENDING', :ikey, :now, :now) "
                    "ON CONFLICT (idempotency_key) DO NOTHING"
                ),
                {
                    "id": donation_id, "uid": anon_user_id, "bid": branch_id,
                    "amount": str(total), "ref": body.order_ref,
                    "pref": body.payment_intent_id, "ikey": f"qd-{order_id}",
                    "now": now,
                },
            )

            await db.commit()
        return {
            "recorded": True,
            "order_id": order_id,
            "donation_id": donation_id,
            "reference": body.order_ref,
            "anonymous": True,
        }
    except Exception as e:
        return {"recorded": False, "error": str(e)}


@router.get("/quick-donation/presets")
async def quick_donation_presets():
    """Return preset amounts for the Quick Donation kiosk."""
    return {
        "presets": [1, 2.5, 5, 10, 15, 20, 50],
        "currency": "GBP",
        "extra_presets": [25, 75, 100, 200],
    }


@router.get("/donation-amounts")
async def donation_amounts():
    return {"presets": [5, 10, 25, 50, 100, 250], "purposes": [{"id": "general", "name": "General Fund"}, {"id": "temple_maintenance", "name": "Temple Maintenance"}, {"id": "youth_education", "name": "Youth & Education"}, {"id": "food_bank", "name": "Food Bank Seva"}, {"id": "festival", "name": "Festival Fund"}], "currency": "GBP"}


@router.get("/postcode/{postcode}")
async def postcode_lookup(postcode: str):
    """Proxy postcode lookup for kiosk Gift Aid address lookup."""
    import uuid

    from shital.capabilities.giftaid.capabilities import lookup_postcode
    ctx = DigitalSpace(user_id="kiosk", user_email="kiosk@shital.org", role="KIOSK", branch_id="main", permissions=[], session_id=str(uuid.uuid4()))
    return await lookup_postcode(ctx, postcode)


class ReceiptInput(BaseModel):
    order_ref: str
    type: str = "email"
    destination: str = ""
    total: float = 0.0
    items: list[dict[str, Any]] = []
    branch_name: str = "Shital Temple"
    customer_name: str = ""


@router.post("/receipt")
async def send_receipt(body: ReceiptInput):
    """Send email or WhatsApp receipt after payment.
    Email priority: Office 365 SMTP (OFFICE365_PASSWORD set) → SendGrid fallback.
    Credentials are loaded from the encrypted API Keys store (Admin → Settings → API Keys).
    """
    import asyncio
    import logging
    import smtplib
    import ssl
    from datetime import date as _date
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    from shital.core.fabrics.secrets import SecretsManager

    _log = logging.getLogger("shital.receipt")

    if not body.destination.strip():
        return {"sent": False, "error": "No destination provided"}

    variables = {
        "order_ref":     body.order_ref,
        "customer_name": body.customer_name or "",
        "total":         body.total,
        "items":         body.items,
        "branch_name":   body.branch_name,
        "date":          _date.today().strftime("%-d %B %Y"),
    }

    # ── Helper: load donation_receipt template from DB ────────────────────────
    async def _load_email_template() -> dict | None:
        from sqlalchemy import text

        from shital.core.fabrics.database import SessionLocal
        try:
            async with SessionLocal() as db:
                result = await db.execute(
                    text("SELECT subject, html_body, text_body FROM email_templates WHERE template_key = 'donation_receipt' AND is_active"),
                )
                row = result.mappings().first()
                return dict(row) if row else None
        except Exception as db_err:
            _log.error("receipt_template_load_failed: %s", db_err)
            return None

    # ── Helper: build inline fallback email content ───────────────────────────
    def _build_fallback_email() -> tuple[str, str, str]:
        items_lines = "".join(
            f"<tr><td style='padding:8px 0;font-size:14px;border-bottom:1px solid #f0f0f0;'>{i.get('name','Item')} ×{i.get('quantity',1)}</td>"
            f"<td align='right' style='padding:8px 0;font-size:14px;font-weight:700;border-bottom:1px solid #f0f0f0;'>£{float(i.get('unitPrice',0))*int(i.get('quantity',1)):.2f}</td></tr>"
            for i in body.items
        ) or "<tr><td colspan='2' style='padding:8px 0;'>Temple Donation</td></tr>"
        subj = f"Your Donation Receipt — {body.branch_name} ({body.order_ref})"
        greeting = f"<p style='font-size:17px;font-weight:700;'>Dear {body.customer_name},</p>" if body.customer_name else ""
        html = f"""<!DOCTYPE html><html><body style="margin:0;font-family:Arial,sans-serif;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:20px 0;"><tr><td align="center">
<table width="560" style="max-width:560px;background:white;border-radius:12px;overflow:hidden;">
  <tr><td style="background:linear-gradient(135deg,#FF9933,#FF6600);padding:28px;text-align:center;">
    <div style="font-size:30px;">🕉</div>
    <div style="color:white;font-size:22px;font-weight:900;">Shital Temple</div>
    <div style="color:rgba(255,255,255,0.85);font-size:13px;">{body.branch_name}</div>
  </td></tr>
  <tr><td style="background:#22C55E;padding:10px;text-align:center;">
    <span style="color:white;font-weight:700;">✓ Donation Confirmed — Thank You!</span>
  </td></tr>
  <tr><td style="padding:28px;">
    {greeting}
    <p style="color:#555;font-size:14px;">Thank you for your generous donation to {body.branch_name}.</p>
    <div style="background:#FFF8F0;border-left:4px solid #FF9933;padding:16px;border-radius:6px;margin:20px 0;">
      <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;">Order Reference</div>
      <div style="font-size:20px;font-weight:900;letter-spacing:3px;font-family:monospace;">{body.order_ref}</div>
      <div style="font-size:12px;color:#999;margin-top:4px;">{variables['date']}</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><th align="left" style="font-size:11px;color:#999;text-transform:uppercase;padding-bottom:8px;border-bottom:2px solid #f0f0f0;">Donation</th>
          <th align="right" style="font-size:11px;color:#999;text-transform:uppercase;padding-bottom:8px;border-bottom:2px solid #f0f0f0;">Amount</th></tr>
      {items_lines}
      <tr><td style="padding-top:14px;font-size:16px;font-weight:900;">Total Donated</td>
          <td align="right" style="padding-top:14px;font-size:20px;font-weight:900;color:#FF6600;">£{body.total:.2f}</td></tr>
    </table>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:20px 0;">
      <div style="font-size:13px;font-weight:700;color:#15803d;">🎁 Gift Aid</div>
      <div style="font-size:13px;color:#166534;">If you are a UK taxpayer, we can claim Gift Aid on your donation at no extra cost to you.</div>
    </div>
    <p style="color:#FF9933;font-size:18px;font-weight:900;text-align:center;">🙏 Jay Shri Krishna</p>
  </td></tr>
  <tr><td style="background:#f9f9f9;padding:16px;text-align:center;font-size:12px;color:#999;">
    {body.branch_name} · Registered UK Charity<br>
    <a href="https://shital.org.uk/terms" style="color:#FF9933;text-decoration:none;">Terms &amp; Conditions</a>
    &nbsp;·&nbsp;
    <a href="https://shital.org.uk/privacy" style="color:#FF9933;text-decoration:none;">Privacy Policy</a>
  </td></tr>
</table></td></tr></table></body></html>"""
        text = (
            f"Shital Temple — {body.branch_name}\n\n"
            + (f"Dear {body.customer_name},\n\n" if body.customer_name else "")
            + f"Thank you for your generous donation!\n\nOrder: {body.order_ref}\nDate: {variables['date']}\n\n"
            + "\n".join(f"- {i.get('name','Item')} x{i.get('quantity',1)} = £{float(i.get('unitPrice',0))*int(i.get('quantity',1)):.2f}" for i in body.items)
            + f"\n\nTotal: £{body.total:.2f}\n\nJay Shri Krishna 🙏\n{body.branch_name}\n\nTerms & Conditions: https://shital.org.uk/terms\nPrivacy Policy: https://shital.org.uk/privacy"
        )
        return subj, html, text

    # ── Email ─────────────────────────────────────────────────────────────────
    if body.type == "email":
        # Credentials loaded from API Keys DB store (Admin → Settings → API Keys)
        office365_email    = await SecretsManager.get("OFFICE365_EMAIL",    fallback="noreply@shital.org.uk")
        office365_password = await SecretsManager.get("OFFICE365_PASSWORD", fallback="")
        sendgrid_key       = await SecretsManager.get("SENDGRID_API_KEY",   fallback="")

        if not office365_password and not sendgrid_key:
            _log.warning("receipt_skipped: no email provider configured")
            return {"sent": False, "error": "Email not configured — add OFFICE365_PASSWORD (or SENDGRID_API_KEY) in Admin → Settings → API Keys"}

        # Build content
        try:
            from shital.api.routers.email_templates import render_template
            tpl = await _load_email_template()
            if tpl:
                subject, html_body, text_body = render_template(tpl, variables)
            else:
                subject, html_body, text_body = _build_fallback_email()
        except Exception as e:
            _log.error("receipt_render_failed: %s", e)
            subject, html_body, text_body = _build_fallback_email()

        # ── Office 365 SMTP (primary) ─────────────────────────────────────────
        if office365_password:
            def _smtp_send() -> None:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"]    = f"Shital Temple <{office365_email}>"
                msg["To"]      = body.destination
                if text_body:
                    msg.attach(MIMEText(text_body, "plain", "utf-8"))
                msg.attach(MIMEText(html_body, "html", "utf-8"))
                ctx = ssl.create_default_context()
                with smtplib.SMTP("smtp.office365.com", 587, timeout=20) as srv:
                    srv.ehlo()
                    srv.starttls(context=ctx)
                    srv.login(office365_email, office365_password)
                    srv.sendmail(office365_email, body.destination, msg.as_string())

            try:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, _smtp_send)
                _log.info("receipt_sent_office365 to=%s ref=%s", body.destination, body.order_ref)
                return {"sent": True, "method": "office365"}
            except Exception as e:
                _log.error("office365_smtp_error: %s", e)
                return {"sent": False, "error": f"Office 365 SMTP error: {e}"}

        # ── SendGrid fallback ─────────────────────────────────────────────────
        try:
            import httpx
            content = [{"type": "text/html", "value": html_body}]
            if text_body:
                content.append({"type": "text/plain", "value": text_body})
            resp = await httpx.AsyncClient().post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={"Authorization": f"Bearer {sendgrid_key}"},
                json={
                    "personalizations": [{"to": [{"email": body.destination}]}],
                    "from": {"email": office365_email, "name": body.branch_name},
                    "subject": subject,
                    "content": content,
                },
                timeout=10,
            )
            sent = resp.status_code in (200, 202)
            if not sent:
                _log.error("sendgrid_error: %s %s", resp.status_code, resp.text[:200])
            return {"sent": sent, "method": "sendgrid", "status_code": resp.status_code}
        except Exception as e:
            _log.error("sendgrid_exception: %s", e)
            return {"sent": False, "error": str(e)}

    # ── WhatsApp via Meta Cloud API ───────────────────────────────────────────
    if body.type in ("sms", "whatsapp"):
        wa_token    = await SecretsManager.get("META_WHATSAPP_TOKEN",    fallback="")
        wa_phone_id = await SecretsManager.get("META_WHATSAPP_PHONE_ID", fallback="")

        if not (wa_token and wa_phone_id):
            _log.warning("receipt_skipped: WhatsApp not configured")
            return {"sent": False, "error": "WhatsApp not configured — add META_WHATSAPP_TOKEN and META_WHATSAPP_PHONE_ID in Admin → Settings → API Keys"}

        try:
            from sqlalchemy import text

            from shital.api.routers.email_templates import render_template
            from shital.core.fabrics.database import SessionLocal

            wa_template: dict | None = None
            try:
                async with SessionLocal() as db:
                    result = await db.execute(
                        text("SELECT text_body FROM email_templates WHERE template_key = 'whatsapp_receipt' AND is_active"),
                    )
                    row = result.mappings().first()
                    if row and row["text_body"]:
                        wa_template = {"subject": "", "html_body": "", "text_body": row["text_body"]}
            except Exception:
                pass

            if wa_template:
                _, _, message = render_template(wa_template, variables)
            else:
                items_text = "\n".join(
                    f"• {i.get('name','Item')} ×{i.get('quantity',1)} — £{float(i.get('unitPrice',0))*int(i.get('quantity',1)):.2f}"
                    for i in body.items
                ) or "• Temple Donation"
                message = (
                    f"🕉 *Shital Temple Receipt*\n*{body.branch_name}*\n\n"
                    f"✅ Thank you{', ' + body.customer_name if body.customer_name else ''}!\n\n"
                    f"📋 *Order:* {body.order_ref}\n📅 *Date:* {variables['date']}\n\n"
                    f"{items_text}\n\n"
                    f"💰 *Total: £{body.total:.2f}*\n\n"
                    f"🙏 *Jay Shri Krishna*\n_{body.branch_name} — Registered UK Charity_"
                )

            import httpx
            phone = body.destination.replace(" ", "").replace("+", "")
            if phone.startswith("0"):
                phone = "44" + phone[1:]

            resp = await httpx.AsyncClient().post(
                f"https://graph.facebook.com/v19.0/{wa_phone_id}/messages",
                headers={"Authorization": f"Bearer {wa_token}"},
                json={"messaging_product": "whatsapp", "to": phone, "type": "text", "text": {"body": message}},
                timeout=10,
            )
            sent = resp.status_code == 200
            if not sent:
                _log.error("whatsapp_error: %s %s", resp.status_code, resp.text[:200])
            return {"sent": sent, "method": "whatsapp", "status_code": resp.status_code}
        except Exception as e:
            _log.error("receipt_whatsapp_exception: %s", e)
            return {"sent": False, "error": str(e)}

    return {"sent": False, "method": "none", "error": f"Unsupported type '{body.type}' or service not configured"}


BRANCHES = [
    {"id": "main",      "name": "Wembley",       "name_gu": "વેમ્બ્લી",    "name_hi": "वेम्बली",    "city": "Wembley, London",   "postcode": "HA9 0EW"},
    {"id": "leicester", "name": "Leicester",     "name_gu": "લેસ્ટર",     "name_hi": "लेस्टर",     "city": "Leicester",          "postcode": "LE1"},
    {"id": "reading",   "name": "Reading",       "name_gu": "રીડિંગ",     "name_hi": "रीडिंग",     "city": "Reading, Berkshire", "postcode": "RG1"},
    {"id": "mk",        "name": "Milton Keynes", "name_gu": "મિલ્ટન કીન્સ", "name_hi": "मिल्टन कीन्स", "city": "Milton Keynes",      "postcode": "MK9"},
]


@router.get("/branches")
async def list_branches():
    """List all Shital Temple branches for kiosk branch selection."""
    return {"branches": BRANCHES}


# ─── QuickDonation Kiosk Accounts ────────────────────────────────────────────

QUICK_KIOSK_ACCOUNTS = [
    # Wembley — 4 kiosks
    {"email": "quickkiosk-wembley-1@shirdisai.org.uk", "name": "QuickKiosk Wembley 1",      "branch_code": "main",      "password": "Wembley!Kiosk2024"},
    {"email": "quickkiosk-wembley-2@shirdisai.org.uk", "name": "QuickKiosk Wembley 2",      "branch_code": "main",      "password": "Wembley!Kiosk2024"},
    {"email": "quickkiosk-wembley-3@shirdisai.org.uk", "name": "QuickKiosk Wembley 3",      "branch_code": "main",      "password": "Wembley!Kiosk2024"},
    {"email": "quickkiosk-wembley-4@shirdisai.org.uk", "name": "QuickKiosk Wembley 4",      "branch_code": "main",      "password": "Wembley!Kiosk2024"},
    # Leicester — 4 kiosks
    {"email": "quickkiosk-leicester-1@shirdisai.org.uk", "name": "QuickKiosk Leicester 1",  "branch_code": "leicester", "password": "Leicester!Kiosk2024"},
    {"email": "quickkiosk-leicester-2@shirdisai.org.uk", "name": "QuickKiosk Leicester 2",  "branch_code": "leicester", "password": "Leicester!Kiosk2024"},
    {"email": "quickkiosk-leicester-3@shirdisai.org.uk", "name": "QuickKiosk Leicester 3",  "branch_code": "leicester", "password": "Leicester!Kiosk2024"},
    {"email": "quickkiosk-leicester-4@shirdisai.org.uk", "name": "QuickKiosk Leicester 4",  "branch_code": "leicester", "password": "Leicester!Kiosk2024"},
    # Reading — 4 kiosks
    {"email": "quickkiosk-reading-1@shirdisai.org.uk", "name": "QuickKiosk Reading 1",      "branch_code": "reading",   "password": "Reading!Kiosk2024"},
    {"email": "quickkiosk-reading-2@shirdisai.org.uk", "name": "QuickKiosk Reading 2",      "branch_code": "reading",   "password": "Reading!Kiosk2024"},
    {"email": "quickkiosk-reading-3@shirdisai.org.uk", "name": "QuickKiosk Reading 3",      "branch_code": "reading",   "password": "Reading!Kiosk2024"},
    {"email": "quickkiosk-reading-4@shirdisai.org.uk", "name": "QuickKiosk Reading 4",      "branch_code": "reading",   "password": "Reading!Kiosk2024"},
    # Milton Keynes — 4 kiosks
    {"email": "quickkiosk-mk-1@shirdisai.org.uk",     "name": "QuickKiosk Milton Keynes 1", "branch_code": "mk",        "password": "MiltonKeynes!Kiosk2024"},
    {"email": "quickkiosk-mk-2@shirdisai.org.uk",     "name": "QuickKiosk Milton Keynes 2", "branch_code": "mk",        "password": "MiltonKeynes!Kiosk2024"},
    {"email": "quickkiosk-mk-3@shirdisai.org.uk",     "name": "QuickKiosk Milton Keynes 3", "branch_code": "mk",        "password": "MiltonKeynes!Kiosk2024"},
    {"email": "quickkiosk-mk-4@shirdisai.org.uk",     "name": "QuickKiosk Milton Keynes 4", "branch_code": "mk",        "password": "MiltonKeynes!Kiosk2024"},
]


@router.post("/quick-donation/seed-accounts")
async def seed_quick_kiosk_accounts():
    """
    Create QuickDonation kiosk accounts, branches, and kiosk_profiles.
    Idempotent — skips anything that already exists.
    Sets up the full mapping: Branch -> Kiosk User -> Profile -> Device (unassigned).
    Auto-creates the kiosk_profiles table if it doesn't exist (no migration needed).
    """
    import bcrypt
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    def _hash(plain: str) -> str:
        return bcrypt.hashpw(plain.encode(), bcrypt.gensalt(12)).decode()

    # Auto-create kiosk_profiles table if it doesn't exist
    async with SessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS kiosk_profiles (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                branch_id           VARCHAR(100) NOT NULL,
                branch_name         VARCHAR(200) NOT NULL DEFAULT '',
                user_id             UUID DEFAULT NULL,
                user_email          VARCHAR(200) NOT NULL,
                user_name           VARCHAR(200) NOT NULL DEFAULT '',
                device_id           UUID DEFAULT NULL,
                device_label        VARCHAR(255) DEFAULT '',
                stripe_reader_id    VARCHAR(255) DEFAULT '',
                device_provider     VARCHAR(50) DEFAULT 'stripe_terminal',
                profile_name        VARCHAR(200) NOT NULL,
                kiosk_type          VARCHAR(50) NOT NULL DEFAULT 'quick_donation',
                display_name        VARCHAR(200) DEFAULT '',
                preset_amounts      JSONB NOT NULL DEFAULT '[1, 2.5, 5, 10, 15, 20, 50]',
                default_purpose     VARCHAR(200) DEFAULT 'General Fund',
                gift_aid_prompt     BOOLEAN NOT NULL DEFAULT true,
                idle_timeout_secs   INT NOT NULL DEFAULT 90,
                theme               VARCHAR(50) DEFAULT 'saffron',
                is_active           BOOLEAN NOT NULL DEFAULT TRUE,
                last_active_at      TIMESTAMPTZ DEFAULT NULL,
                notes               TEXT DEFAULT '',
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                deleted_at          TIMESTAMPTZ DEFAULT NULL,
                UNIQUE(branch_id, user_email)
            )
        """))
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_branch ON kiosk_profiles(branch_id)"))
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_user ON kiosk_profiles(user_id)"))
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_device ON kiosk_profiles(device_id)"))
        await db.commit()

    now = datetime.utcnow()
    created: list[dict] = []
    skipped: list[str] = []
    profiles_created: list[dict] = []

    async with SessionLocal() as db:
        # 1. Ensure branches exist
        for b in BRANCHES:
            branch_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"shital-branch-{b['id']}"))
            import json
            addr_json = json.dumps({"city": b["city"], "postcode": b["postcode"]})
            await db.execute(
                text(
                    "INSERT INTO branches (id, branch_id, name, address, phone, is_active, created_at, updated_at) "
                    "VALUES (:id, :code, :name, CAST(:addr AS jsonb), '', true, :now, :now) "
                    "ON CONFLICT (branch_id) DO NOTHING"
                ),
                {
                    "id": branch_id, "name": b["name"], "code": b["id"],
                    "addr": addr_json, "now": now,
                },
            )

        # 2. Create kiosk accounts + kiosk_profiles
        for acct in QUICK_KIOSK_ACCOUNTS:
            existing = (await db.execute(
                text("SELECT id, branch_id FROM users WHERE email = :email AND deleted_at IS NULL LIMIT 1"),
                {"email": acct["email"]},
            )).mappings().first()

            # Resolve branch
            branch_row = (await db.execute(
                text("SELECT id, name FROM branches WHERE branch_id = :code LIMIT 1"),
                {"code": acct["branch_code"]},
            )).mappings().first()
            branch_uuid = str(branch_row["id"]) if branch_row else None
            branch_name = branch_row["name"] if branch_row else acct["branch_code"]

            if existing:
                user_id = str(existing["id"])
                skipped.append(acct["email"])
            else:
                user_id = str(uuid.uuid4())
                hashed = _hash(acct["password"])
                await db.execute(
                    text(
                        "INSERT INTO users (id, email, password_hash, name, role, is_active, "
                        "mfa_enabled, branch_id, created_at, updated_at) "
                        "VALUES (:id, :email, :hash, :name, 'KIOSK', true, false, :bid, :now, :now)"
                    ),
                    {
                        "id": user_id, "email": acct["email"], "hash": hashed,
                        "name": acct["name"], "bid": branch_uuid, "now": now,
                    },
                )
                created.append({
                    "email": acct["email"],
                    "name": acct["name"],
                    "branch": acct["branch_code"],
                    "password": acct["password"],
                })

            # 3. Create kiosk_profile (mapping row)
            profile_id = str(uuid.uuid4())
            profile_name = f"QuickDonation — {branch_name}"
            await db.execute(
                text(
                    "INSERT INTO kiosk_profiles "
                    "(id, branch_id, branch_name, user_id, user_email, user_name, "
                    " profile_name, kiosk_type, display_name, "
                    " preset_amounts, default_purpose, gift_aid_prompt, "
                    " idle_timeout_secs, theme, is_active, created_at, updated_at) "
                    "VALUES (:id, :bid, :bname, :uid, :email, :uname, "
                    " :pname, 'quick_donation', :dname, "
                    " '[1, 2.5, 5, 10, 15, 20, 50]'::jsonb, 'General Fund', true, "
                    " 90, 'saffron', true, :now, :now) "
                    "ON CONFLICT (branch_id, user_email) DO NOTHING"
                ),
                {
                    "id": profile_id, "bid": acct["branch_code"],
                    "bname": branch_name, "uid": user_id,
                    "email": acct["email"], "uname": acct["name"],
                    "pname": profile_name, "dname": f"Quick Donation {branch_name}",
                    "now": now,
                },
            )
            profiles_created.append({
                "profile_name": profile_name,
                "branch": acct["branch_code"],
                "email": acct["email"],
                "device": "UNASSIGNED — assign via admin or API",
            })

        await db.commit()

    return {
        "accounts": {"created": created, "skipped": skipped},
        "profiles": profiles_created,
        "total_accounts": len(QUICK_KIOSK_ACCOUNTS),
        "message": f"Created {len(created)} accounts, {len(profiles_created)} profiles. "
                   f"Skipped {len(skipped)} existing accounts. "
                   f"Assign card devices via POST /kiosk/quick-donation/assign-device.",
    }


class AssignDeviceInput(BaseModel):
    branch_id: str
    user_email: str
    stripe_reader_id: str
    device_label: str = ""


@router.post("/quick-donation/assign-device")
async def assign_device_to_profile(body: AssignDeviceInput):
    """
    Assign a Stripe Terminal card reader to a kiosk profile.
    Links the device in the kiosk_profiles mapping table.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()

    async with SessionLocal() as db:
        result = await db.execute(
            text(
                "UPDATE kiosk_profiles SET "
                "  stripe_reader_id = :rid, device_label = :label, "
                "  device_provider = 'stripe_terminal', updated_at = :now "
                "WHERE branch_id = :bid AND user_email = :email AND deleted_at IS NULL "
                "RETURNING id, profile_name"
            ),
            {
                "rid": body.stripe_reader_id, "label": body.device_label or body.stripe_reader_id,
                "bid": body.branch_id, "email": body.user_email, "now": now,
            },
        )
        row = result.mappings().first()
        await db.commit()

    if not row:
        return {"assigned": False, "error": "Profile not found for this branch/email combination"}

    return {
        "assigned": True,
        "profile_id": row["id"],
        "profile_name": row["profile_name"],
        "device": body.stripe_reader_id,
    }


@router.get("/quick-donation/profiles")
async def list_kiosk_profiles(branch_id: str = ""):
    """List all kiosk profiles with their branch, user, and device assignments."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    conditions = ["deleted_at IS NULL"]
    params: dict[str, Any] = {}
    if branch_id:
        conditions.append("branch_id = :bid")
        params["bid"] = branch_id
    where = " AND ".join(conditions)

    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT id, branch_id, branch_name, user_id, user_email, user_name,
                       device_id, device_label, stripe_reader_id, device_provider,
                       profile_name, kiosk_type, display_name,
                       preset_amounts, default_purpose, gift_aid_prompt,
                       idle_timeout_secs, theme, is_active, last_active_at,
                       notes, created_at, updated_at
                FROM kiosk_profiles
                WHERE {where}
                ORDER BY branch_name, profile_name
            """),
            params,
        )
        rows = result.mappings().all()

    profiles = []
    for r in rows:
        d = dict(r)
        for k in ("created_at", "updated_at", "last_active_at"):
            if d.get(k) and isinstance(d[k], datetime):
                d[k] = d[k].isoformat()
        profiles.append(d)

    return {"profiles": profiles, "total": len(profiles)}


class QuickKioskLoginInput(BaseModel):
    email: str   # accepts full email or short username (e.g. "wembley-1")
    password: str


@router.post("/quick-donation/login")
async def quick_kiosk_login(body: QuickKioskLoginInput):
    """
    Login for QuickDonation kiosk devices.
    First checks kiosk_devices.device_username (admin-configured credentials).
    Falls back to users table (legacy quickkiosk-* accounts).
    Returns branch info, card reader, and device feature flags.
    """
    import bcrypt
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    login_input = body.email.lower().strip()

    # ── Path 1: Device-level credentials (set in admin Edit Device form) ──────
    async with SessionLocal() as db:
        dev_res = await db.execute(
            text("""
                SELECT kd.id, kd.name, kd.branch_id, kd.device_password_hash,
                       kd.show_monthly_giving, kd.enable_gift_aid, kd.tap_and_go,
                       kd.donate_title, kd.monthly_giving_text, kd.monthly_giving_amount,
                       kd.card_reader_id,
                       td.stripe_reader_id, td.label AS reader_label,
                       b.name AS branch_name
                FROM kiosk_devices kd
                LEFT JOIN terminal_devices td ON td.id = kd.card_reader_id
                LEFT JOIN branches b ON b.branch_id = kd.branch_id
                WHERE LOWER(kd.device_username) = :uname
                  AND kd.deleted_at IS NULL
                  AND UPPER(kd.status) = 'ACTIVE'
                LIMIT 1
            """),
            {"uname": login_input},
        )
        device = dev_res.mappings().first()

    if device and device["device_password_hash"]:
        if not bcrypt.checkpw(body.password.encode(), device["device_password_hash"].encode()):
            return {"authenticated": False, "error": "Invalid username or password"}
        return {
            "authenticated": True,
            "user": {"id": str(device["id"]), "email": login_input, "name": device["name"], "role": "KIOSK"},
            "branch": {"id": device["branch_id"], "name": device["branch_name"] or device["branch_id"]},
            "profile": None,
            "stripe_reader_id": device["stripe_reader_id"],
            "reader_label": device["reader_label"],
            "show_monthly_giving": bool(device["show_monthly_giving"]),
            "enable_gift_aid": bool(device["enable_gift_aid"]),
            "tap_and_go": bool(device["tap_and_go"]),
            "donate_title": device["donate_title"] or "Tap & Donate",
            "monthly_giving_text": device["monthly_giving_text"] or "Make a big impact from just £5/month",
            "monthly_giving_amount": float(device["monthly_giving_amount"] or 5),
        }

    # ── Path 2: Legacy user-table login (quickkiosk-* accounts) ──────────────
    if "@" not in login_input:
        login_input = f"quickkiosk-{login_input}@shirdisai.org.uk"

    async with SessionLocal() as db:
        result = await db.execute(
            text(
                "SELECT u.id, u.email, u.name, u.password_hash, u.role, u.branch_id, u.is_active, "
                "b.branch_id AS branch_code, b.name AS branch_name "
                "FROM users u LEFT JOIN branches b ON u.branch_id::text = b.id::text "
                "WHERE u.email = :email AND u.deleted_at IS NULL"
            ),
            {"email": login_input},
        )
        user = result.mappings().first()

    if not user or not user["password_hash"]:
        return {"authenticated": False, "error": "Invalid username or password"}
    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        return {"authenticated": False, "error": "Invalid email or password"}
    if not user["is_active"]:
        return {"authenticated": False, "error": "Account is deactivated"}
    if user["role"] != "KIOSK":
        return {"authenticated": False, "error": "Not a kiosk account"}

    branch_code = user["branch_code"] or "main"

    # Fetch kiosk profile
    profile = None
    try:
        async with SessionLocal() as db:
            prof_result = await db.execute(
                text(
                    "SELECT id, profile_name, kiosk_type, display_name, "
                    "  device_label, stripe_reader_id, device_provider, "
                    "  preset_amounts, default_purpose, gift_aid_prompt, "
                    "  idle_timeout_secs, theme "
                    "FROM kiosk_profiles "
                    "WHERE user_email = :email AND is_active = true AND deleted_at IS NULL "
                    "LIMIT 1"
                ),
                {"email": user["email"]},
            )
            prof_row = prof_result.mappings().first()
            if prof_row:
                profile = dict(prof_row)
            await db.execute(
                text("UPDATE kiosk_profiles SET last_active_at = :now WHERE user_email = :email AND deleted_at IS NULL"),
                {"now": datetime.utcnow(), "email": user["email"]},
            )
            await db.commit()
    except Exception:
        pass

    # Look up card reader from admin Devices page for this branch
    device_reader_id = None
    device_reader_label = None
    dev_flags: dict = {"show_monthly_giving": False, "enable_gift_aid": False, "tap_and_go": True, "donate_title": "Tap & Donate", "monthly_giving_text": "Make a big impact from just £5/month", "monthly_giving_amount": 5.0}
    async with SessionLocal() as db:
        dev_res = await db.execute(
            text("""
                SELECT kd.show_monthly_giving, kd.enable_gift_aid, kd.tap_and_go,
                       kd.donate_title, kd.monthly_giving_text, kd.monthly_giving_amount,
                       td.stripe_reader_id, td.label AS reader_label
                FROM kiosk_devices kd
                LEFT JOIN terminal_devices td ON td.id = kd.card_reader_id
                WHERE kd.branch_id = :branch_id
                  AND kd.device_type = 'QUICK_DONATION'
                  AND kd.deleted_at IS NULL
                  AND UPPER(kd.status) = 'ACTIVE'
                ORDER BY kd.updated_at DESC
                LIMIT 1
            """),
            {"branch_id": branch_code},
        )
        dev_row = dev_res.mappings().first()
        if dev_row:
            if dev_row["stripe_reader_id"]:
                device_reader_id = dev_row["stripe_reader_id"]
                device_reader_label = dev_row["reader_label"]
            dev_flags = {
                "show_monthly_giving": bool(dev_row["show_monthly_giving"]),
                "enable_gift_aid": bool(dev_row["enable_gift_aid"]),
                "tap_and_go": bool(dev_row["tap_and_go"]),
                "donate_title": dev_row["donate_title"] or "Tap & Donate",
                "monthly_giving_text": dev_row["monthly_giving_text"] or "Make a big impact from just £5/month",
                "monthly_giving_amount": float(dev_row["monthly_giving_amount"] or 5),
            }

    effective_reader_id = device_reader_id or (profile.get("stripe_reader_id") if profile else None)
    effective_reader_label = device_reader_label or (profile.get("device_label") if profile else None)

    return {
        "authenticated": True,
        "user": {"id": str(user["id"]), "email": user["email"], "name": user["name"], "role": user["role"]},
        "branch": {"id": branch_code, "name": user["branch_name"] or "Unknown"},
        "profile": profile,
        "stripe_reader_id": effective_reader_id,
        "reader_label": effective_reader_label,
        **dev_flags,
    }


class AzureKioskLoginInput(BaseModel):
    id_token: str


@router.post("/quick-donation/login-azure")
async def quick_kiosk_login_azure(body: AzureKioskLoginInput):
    """
    Login for QuickDonation kiosk via Azure AD SSO.
    Validates the Microsoft ID token, finds the linked KIOSK user,
    and returns branch + profile + device config.
    """
    from sqlalchemy import text

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.database import SessionLocal
    from shital.core.fabrics.secrets import SecretsManager

    ms_client_id = await SecretsManager.get("MS_CLIENT_ID") or settings.MS_CLIENT_ID
    if not ms_client_id:
        return {"authenticated": False, "error": "Azure AD SSO is not configured"}

    # Validate token via existing Azure AD endpoint
    try:
        from shital.api.routers.auth_azure import VerifyTokenInput, verify_azure_token
        azure_result = await verify_azure_token(VerifyTokenInput(id_token=body.id_token, default_role="KIOSK"))
    except Exception as e:
        return {"authenticated": False, "error": f"Azure AD token validation failed: {e}"}

    azure_user = azure_result.get("user", {})
    email = azure_user.get("email", "")

    if not email:
        return {"authenticated": False, "error": "No email in Azure AD token"}

    # Verify user is a KIOSK role
    async with SessionLocal() as db:
        result = await db.execute(
            text(
                "SELECT u.id, u.email, u.name, u.role, u.is_active, "
                "b.branch_id AS branch_code, b.name AS branch_name "
                "FROM users u LEFT JOIN branches b ON u.branch_id::text = b.id::text "
                "WHERE u.email = :email AND u.deleted_at IS NULL"
            ),
            {"email": email},
        )
        user = result.mappings().first()

    if not user:
        return {"authenticated": False, "error": "No kiosk account found for this Azure AD user"}
    if not user["is_active"]:
        return {"authenticated": False, "error": "Account is deactivated"}
    if user["role"] != "KIOSK":
        return {"authenticated": False, "error": "Not a kiosk account. Role: " + user["role"]}

    branch_code = user["branch_code"] or "main"

    # Fetch kiosk profile
    profile = None
    async with SessionLocal() as db:
        prof_result = await db.execute(
            text(
                "SELECT id, profile_name, kiosk_type, display_name, "
                "  device_label, stripe_reader_id, device_provider, "
                "  preset_amounts, default_purpose, gift_aid_prompt, "
                "  idle_timeout_secs, theme "
                "FROM kiosk_profiles "
                "WHERE user_email = :email AND is_active = true AND deleted_at IS NULL "
                "LIMIT 1"
            ),
            {"email": email},
        )
        prof_row = prof_result.mappings().first()
        if prof_row:
            profile = dict(prof_row)

        await db.execute(
            text("UPDATE kiosk_profiles SET last_active_at = :now WHERE user_email = :email AND deleted_at IS NULL"),
            {"now": datetime.utcnow(), "email": email},
        )
        await db.commit()

    return {
        "authenticated": True,
        "auth_provider": "azure_ad",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
        },
        "branch": {
            "id": branch_code,
            "name": user["branch_name"] or "Unknown",
        },
        "profile": profile,
    }
