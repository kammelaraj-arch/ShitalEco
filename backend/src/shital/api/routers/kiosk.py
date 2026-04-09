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
    customer_email: str = ""
    customer_phone: str = ""


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
    row = (await db.execute(text("SELECT id FROM branches WHERE code = :code LIMIT 1"), {"code": branch_code})).mappings().first()
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


@router.post("/receipt")
async def send_receipt(body: ReceiptInput):
    """Send email or WhatsApp receipt after payment. Uses DB-stored email template."""
    from datetime import date as _date

    from shital.core.fabrics.config import settings

    if not body.destination.strip():
        return {"sent": False, "error": "No destination provided"}

    variables = {
        "order_ref":     body.order_ref,
        "customer_name": "",
        "total":         body.total,
        "items":         body.items,
        "branch_name":   body.branch_name,
        "date":          _date.today().strftime("%-d %B %Y"),
    }

    if body.type == "email" and settings.SENDGRID_API_KEY:
        try:
            from sqlalchemy import text

            from shital.api.routers.email_templates import render_template
            from shital.core.fabrics.database import SessionLocal

            # Load template from DB; fall back to plain text
            template: dict | None = None
            try:
                async with SessionLocal() as db:
                    result = await db.execute(
                        text("SELECT subject, html_body, text_body FROM email_templates WHERE template_key = 'donation_receipt' AND is_active"),
                    )
                    row = result.mappings().first()
                    if row:
                        template = dict(row)
            except Exception:
                pass

            if template:
                subject, html_body, text_body = render_template(template, variables)
            else:
                # Minimal fallback
                items_text = "\n".join(
                    f"  • {i.get('name','Item')} x{i.get('quantity',1)} = £{float(i.get('unitPrice',0))*int(i.get('quantity',1)):.2f}"
                    for i in body.items
                ) or "  • Temple donation"
                subject = f"Receipt from {body.branch_name} — {body.order_ref}"
                html_body = f"<p>Thank you! Order: <strong>{body.order_ref}</strong><br>Total: £{body.total:.2f}</p><p>Jay Shri Krishna 🙏</p>"
                text_body = f"Thank you for your donation!\n\nOrder: {body.order_ref}\n{items_text}\nTotal: £{body.total:.2f}\n\nJay Shri Krishna 🙏\n{body.branch_name}"

            import httpx
            content = [{"type": "text/html", "value": html_body}]
            if text_body:
                content.append({"type": "text/plain", "value": text_body})

            resp = await httpx.AsyncClient().post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={"Authorization": f"Bearer {settings.SENDGRID_API_KEY}"},
                json={
                    "personalizations": [{"to": [{"email": body.destination}]}],
                    "from": {"email": settings.SENDGRID_FROM_EMAIL, "name": body.branch_name},
                    "subject": subject,
                    "content": content,
                },
                timeout=10,
            )
            return {"sent": resp.status_code in (200, 202), "method": "sendgrid"}
        except Exception as e:
            return {"sent": False, "error": str(e)}

    if body.type in ("sms", "whatsapp") and settings.META_WHATSAPP_TOKEN and settings.META_WHATSAPP_PHONE_ID:
        try:
            import httpx
            items_text = "\n".join(
                f"• {i.get('name','Item')} x{i.get('quantity',1)} = £{float(i.get('unitPrice',0))*int(i.get('quantity',1)):.2f}"
                for i in body.items
            ) or "• Temple donation"
            message = f"Thank you! 🙏\n\nOrder: {body.order_ref}\n{items_text}\nTotal: £{body.total:.2f}\n\nJay Shri Krishna\n{body.branch_name}"
            phone = body.destination.replace(" ", "").replace("+", "")
            if phone.startswith("0"):
                phone = "44" + phone[1:]
            resp = await httpx.AsyncClient().post(
                f"https://graph.facebook.com/v19.0/{settings.META_WHATSAPP_PHONE_ID}/messages",
                headers={"Authorization": f"Bearer {settings.META_WHATSAPP_TOKEN}"},
                json={"messaging_product": "whatsapp", "to": phone, "type": "text", "text": {"body": message}},
                timeout=10,
            )
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
                    "INSERT INTO branches (id, name, code, address, phone, is_active, created_at, updated_at) "
                    "VALUES (:id, :name, :code, CAST(:addr AS jsonb), '', true, :now, :now) "
                    "ON CONFLICT (code) DO NOTHING"
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
                text("SELECT id, name FROM branches WHERE code = :code LIMIT 1"),
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
    email: str
    password: str


@router.post("/quick-donation/login")
async def quick_kiosk_login(body: QuickKioskLoginInput):
    """
    Login for QuickDonation kiosk accounts.
    Returns branch info, kiosk profile, and assigned device config.
    Supports both password auth and Azure AD-linked accounts.
    """
    import bcrypt
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        # Authenticate user
        result = await db.execute(
            text(
                "SELECT u.id, u.email, u.name, u.password_hash, u.role, u.branch_id, u.is_active, "
                "b.code AS branch_code, b.name AS branch_name "
                "FROM users u LEFT JOIN branches b ON u.branch_id = b.id "
                "WHERE u.email = :email AND u.deleted_at IS NULL"
            ),
            {"email": body.email.lower().strip()},
        )
        user = result.mappings().first()

    if not user or not user["password_hash"]:
        return {"authenticated": False, "error": "Invalid email or password"}
    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        return {"authenticated": False, "error": "Invalid email or password"}
    if not user["is_active"]:
        return {"authenticated": False, "error": "Account is deactivated"}
    if user["role"] != "KIOSK":
        return {"authenticated": False, "error": "Not a kiosk account"}

    branch_code = user["branch_code"] or "main"

    # Fetch kiosk profile with device assignment
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
            {"email": user["email"]},
        )
        prof_row = prof_result.mappings().first()
        if prof_row:
            profile = dict(prof_row)

        # Update last_active_at
        await db.execute(
            text("UPDATE kiosk_profiles SET last_active_at = :now WHERE user_email = :email AND deleted_at IS NULL"),
            {"now": datetime.utcnow(), "email": user["email"]},
        )
        await db.commit()

    # Look up the card reader assigned to the QUICK_DONATION device for this branch
    # in the admin Devices page (kiosk_devices → terminal_devices).
    device_reader_id = None
    device_reader_label = None
    async with SessionLocal() as db:
        dev_res = await db.execute(
            text("""
                SELECT td.stripe_reader_id, td.label AS reader_label
                FROM kiosk_devices kd
                LEFT JOIN terminal_devices td ON td.id = kd.card_reader_id
                WHERE kd.branch_id = :branch_id
                  AND kd.device_type = 'QUICK_DONATION'
                  AND kd.deleted_at IS NULL
                  AND kd.status = 'active'
                ORDER BY kd.updated_at DESC
                LIMIT 1
            """),
            {"branch_id": user["branch_id"]},
        )
        dev_row = dev_res.mappings().first()
        if dev_row and dev_row["stripe_reader_id"]:
            device_reader_id = dev_row["stripe_reader_id"]
            device_reader_label = dev_row["reader_label"]

    # Prefer admin device assignment over the profile's manually-set reader
    effective_reader_id = device_reader_id or (profile.get("stripe_reader_id") if profile else None)
    effective_reader_label = device_reader_label or (profile.get("device_label") if profile else None)

    return {
        "authenticated": True,
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
        "stripe_reader_id": effective_reader_id,
        "reader_label": effective_reader_label,
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
                "b.code AS branch_code, b.name AS branch_name "
                "FROM users u LEFT JOIN branches b ON u.branch_id = b.id "
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
