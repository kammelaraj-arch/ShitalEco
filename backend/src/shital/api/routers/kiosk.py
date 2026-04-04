from __future__ import annotations
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
import uuid

from shital.api.deps import OptionalSpace
from shital.core.space.context import DigitalSpace

router = APIRouter(prefix="/kiosk", tags=["kiosk"])


@router.get("/services")
async def get_services(ctx: OptionalSpace, category: str = "", branch_id: str = "main"):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    conditions = ["ts.is_active = true", "ts.deleted_at IS NULL"]
    params: dict[str, Any] = {"bid": branch_id}
    if category:
        conditions.append("ts.category = :cat")
        params["cat"] = category
    conditions.append("ts.branch_id = :bid")
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
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
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
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
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
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    import json
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
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        await db.execute(text("DELETE FROM basket_items WHERE id = :iid AND basket_id = :bid"), {"iid": item_id, "bid": basket_id})
        await db.commit()
    return {"removed": True}


class CheckoutInput(BaseModel):
    basket_id: str
    payment_provider: str = "STRIPE"
    branch_id: str = "main"
    customer_name: str = ""
    customer_email: str = ""
    customer_phone: str = ""


@router.post("/checkout")
async def checkout(body: CheckoutInput, ctx: OptionalSpace):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        items_result = await db.execute(text("SELECT SUM(total_price) AS total FROM basket_items WHERE basket_id = :bid"), {"bid": body.basket_id})
        row = items_result.mappings().first()
        total = float(str(row["total"] or 0))
    if total <= 0:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Basket is empty")
    order_id = str(uuid.uuid4())
    ref = f"ORD-{order_id[:8].upper()}"
    now = datetime.utcnow()
    amount_pence = int(total * 100)
    from shital.capabilities.payments.capabilities import create_payment, CreatePaymentInput
    safe_ctx = ctx or DigitalSpace(user_id="kiosk", user_email="kiosk@shital.org", role="KIOSK", branch_id=body.branch_id, permissions=[], session_id=str(uuid.uuid4()))
    payment = await create_payment(safe_ctx, CreatePaymentInput(provider=body.payment_provider, amount_pence=amount_pence, currency="GBP", order_id=order_id, description=f"Shital Temple Order {ref}", idempotency_key=order_id))
    async with SessionLocal() as db:
        await db.execute(
            text("INSERT INTO orders (id, branch_id, basket_id, reference, status, total_amount, currency, payment_provider, payment_ref, idempotency_key, created_at, updated_at) VALUES (:id, :bid, :basket, :ref, 'PENDING', :total, 'GBP', :provider, :pref, :ikey, :now, :now)"),
            {"id": order_id, "bid": body.branch_id, "basket": body.basket_id, "ref": ref, "total": str(total), "provider": body.payment_provider, "pref": payment.get("payment_id"), "ikey": order_id, "now": now},
        )
        await db.execute(text("UPDATE baskets SET status = 'CHECKOUT', updated_at = :now WHERE id = :bid"), {"now": now, "bid": body.basket_id})
        await db.commit()
    return {"order_id": order_id, "reference": ref, "total": total, "currency": "GBP", "payment": payment}


@router.post("/terminal/connection-token")
async def stripe_connection_token():
    import stripe
    from shital.core.fabrics.config import settings
    stripe.api_key = settings.STRIPE_SECRET_KEY
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
    stripe.api_key = settings.STRIPE_SECRET_KEY
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
    import stripe
    from shital.core.fabrics.config import settings
    stripe.api_key = settings.STRIPE_SECRET_KEY
    try:
        action = stripe.terminal.Reader.process_payment_intent(body.reader_id, payment_intent=body.payment_intent_id)
        return {"reader_id": body.reader_id, "status": action.action.status if action.action else "unknown"}
    except Exception as e:
        return {"error": str(e)}


@router.post("/terminal/cancel-action")
async def cancel_reader_action(body: ReaderActionInput):
    import stripe
    from shital.core.fabrics.config import settings
    stripe.api_key = settings.STRIPE_SECRET_KEY
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
    stripe.api_key = settings.STRIPE_SECRET_KEY
    try:
        intent = stripe.PaymentIntent.retrieve(id)
        return {"status": intent.status, "id": intent.id}
    except Exception as e:
        return {"status": "unknown", "error": str(e)}


@router.get("/terminal/readers")
async def list_terminal_readers(location_id: str = ""):
    import stripe
    from shital.core.fabrics.config import settings
    stripe.api_key = settings.STRIPE_SECRET_KEY
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


@router.get("/donation-amounts")
async def donation_amounts():
    return {"presets": [5, 10, 25, 50, 100, 250], "purposes": [{"id": "general", "name": "General Fund"}, {"id": "temple_maintenance", "name": "Temple Maintenance"}, {"id": "youth_education", "name": "Youth & Education"}, {"id": "food_bank", "name": "Food Bank Seva"}, {"id": "festival", "name": "Festival Fund"}], "currency": "GBP"}


@router.get("/postcode/{postcode}")
async def postcode_lookup(postcode: str):
    """Proxy postcode lookup for kiosk Gift Aid address lookup."""
    from shital.capabilities.giftaid.capabilities import lookup_postcode
    import uuid
    ctx = DigitalSpace(user_id="kiosk", user_email="kiosk@shital.org", role="KIOSK", branch_id="main", permissions=[], session_id=str(uuid.uuid4()))
    return await lookup_postcode(ctx, postcode)


class ReceiptInput(BaseModel):
    order_ref: str
    type: str = "email"
    destination: str = ""
    total: float = 0.0
    items: list[dict[str, Any]] = []
    branch_name: str = "Shital Temple"


@router.post("/receipt")
async def send_receipt(body: ReceiptInput):
    """Send email or WhatsApp receipt after payment."""
    from shital.core.fabrics.config import settings
    if not body.destination.strip():
        return {"sent": False, "error": "No destination provided"}
    items_text = "\n".join(f"  \u2022 {i.get('name','Item')} x{i.get('quantity',1)} = \u00a3{float(i.get('unitPrice',0))*int(i.get('quantity',1)):.2f}" for i in body.items) or "  \u2022 Temple donation"
    subject = f"Receipt from {body.branch_name} \u2014 {body.order_ref}"
    message = f"Thank you for your generous donation! \ud83d\ude4f\n\nOrder Reference: {body.order_ref}\nItems:\n{items_text}\nTotal: \u00a3{body.total:.2f}\n\nJay Shri Krishna \ud83d\udd49\n{body.branch_name}"
    if body.type == "email" and settings.SENDGRID_API_KEY:
        try:
            import httpx
            resp = await httpx.AsyncClient().post("https://api.sendgrid.com/v3/mail/send", headers={"Authorization": f"Bearer {settings.SENDGRID_API_KEY}", "Content-Type": "application/json"}, json={"personalizations": [{"to": [{"email": body.destination}]}], "from": {"email": settings.SENDGRID_FROM_EMAIL, "name": body.branch_name}, "subject": subject, "content": [{"type": "text/plain", "value": message}]}, timeout=10)
            return {"sent": resp.status_code in (200, 202), "method": "sendgrid"}
        except Exception as e:
            return {"sent": False, "error": str(e)}
    if body.type in ("sms", "whatsapp") and settings.META_WHATSAPP_TOKEN and settings.META_WHATSAPP_PHONE_ID:
        try:
            import httpx
            phone = body.destination.replace(" ", "").replace("+", "")
            if phone.startswith("0"):
                phone = "44" + phone[1:]
            resp = await httpx.AsyncClient().post(f"https://graph.facebook.com/v19.0/{settings.META_WHATSAPP_PHONE_ID}/messages", headers={"Authorization": f"Bearer {settings.META_WHATSAPP_TOKEN}", "Content-Type": "application/json"}, json={"messaging_product": "whatsapp", "to": phone, "type": "text", "text": {"body": message}}, timeout=10)
            return {"sent": resp.status_code == 200, "method": "whatsapp"}
        except Exception as e:
            return {"sent": False, "error": str(e)}
    return {"sent": True, "method": "logged", "note": "SendGrid/WhatsApp not configured"}


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
