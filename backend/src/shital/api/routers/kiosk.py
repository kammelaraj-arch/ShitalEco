from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import OptionalSpace
from shital.core.fabrics.cache import cache_get, cache_set
from shital.core.fabrics.config import settings
from shital.core.fabrics.database import SessionLocal
from shital.core.fabrics.secrets import SecretsManager
from shital.core.space.context import DigitalSpace

router = APIRouter(prefix="/kiosk", tags=["kiosk"])


@router.get("/services")
async def get_services(ctx: OptionalSpace, category: str = "", branch_id: str = "main"):

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

        # Record in donations table so the unified finance view picks it up
        await db.execute(text(
            "INSERT INTO donations (id, user_id, branch_id, amount, currency, "
            "gift_aid_eligible, purpose, reference, payment_provider, payment_ref, "
            "status, source, contact_id, idempotency_key, created_at, updated_at) "
            "VALUES (:id, :uid, :bid, :amount, 'GBP', false, 'General Fund', :ref, "
            ":provider, :pref, 'PENDING', 'kiosk', :cid, :ikey, :now, :now) "
            "ON CONFLICT (idempotency_key) DO NOTHING"
        ), {
            "id": str(uuid.uuid4()), "uid": contact_id or "", "bid": body.branch_id,
            "amount": str(total), "ref": ref,
            "provider": body.payment_provider, "pref": payment.get("payment_id") or "",
            "cid": contact_id, "ikey": f"kiosk-{order_id}", "now": now,
        })

        await db.commit()
    return {"order_id": order_id, "reference": ref, "total": total, "currency": "GBP", "payment": payment}


def _upsert_contact_sql() -> str:
    return """
        INSERT INTO contacts
            (id, email, first_name, surname, full_name, phone,
             gdpr_consent, gdpr_consented_at, tac_consent, tac_consented_at,
             first_source, first_branch_id, created_at, updated_at)
        VALUES
            (:id, :email, :first, :surname, :name, :phone,
             true, :now, true, :now, 'kiosk', :branch, :now, :now)
        ON CONFLICT (email) DO UPDATE SET
            first_name        = COALESCE(NULLIF(EXCLUDED.first_name,''),  contacts.first_name),
            surname           = COALESCE(NULLIF(EXCLUDED.surname,''),     contacts.surname),
            full_name         = COALESCE(NULLIF(EXCLUDED.full_name,''),   contacts.full_name),
            phone             = COALESCE(NULLIF(EXCLUDED.phone,''),       contacts.phone),
            gdpr_consent      = true,
            gdpr_consented_at = COALESCE(contacts.gdpr_consented_at, EXCLUDED.gdpr_consented_at),
            tac_consent       = true,
            tac_consented_at  = COALESCE(contacts.tac_consented_at,  EXCLUDED.tac_consented_at),
            updated_at        = EXCLUDED.updated_at
        RETURNING id
    """


class OrderPendingInput(BaseModel):
    basket_id: str
    order_ref: str
    payment_provider: str
    payment_intent_id: str = ""
    branch_id: str = "main"
    device_id: str = ""
    device_label: str = ""
    source: str = "kiosk"
    total_amount: float = 0.0
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    gift_aid_eligible: bool = False
    # Gift Aid declaration fields (optional — only sent when donor agreed)
    ga_full_name: str = ""
    ga_postcode: str = ""
    ga_address: str = ""
    ga_email: str = ""


@router.post("/order/pending")
async def create_pending_order(body: OrderPendingInput):
    """
    Called immediately when payment is dispatched to the card reader.
    Saves order + contact + donation with status PENDING so every initiated
    payment is visible in the admin regardless of outcome.
    Idempotent — safe to call multiple times.
    """


    now = datetime.utcnow()
    order_id = str(uuid.uuid4())

    email_key = body.contact_email.strip().lower() if body.contact_email.strip() else None
    name_parts = body.contact_name.strip().split(" ", 1) if body.contact_name.strip() else []
    first_name = name_parts[0] if name_parts else ""
    surname    = name_parts[1] if len(name_parts) > 1 else ""

    async with SessionLocal() as db:
        items_result = await db.execute(
            text("SELECT SUM(total_price) AS total FROM basket_items WHERE basket_id = :bid"),
            {"bid": body.basket_id},
        )
        row = items_result.mappings().first()
        total = float(str(row["total"] or 0)) if row and row["total"] else body.total_amount

        contact_id: str | None = None
        if email_key:
            contact_uuid = str(uuid.uuid4())
            c_row = await db.execute(text(_upsert_contact_sql()), {
                "id": contact_uuid, "email": email_key,
                "first": first_name, "surname": surname,
                "name": body.contact_name, "phone": body.contact_phone or "",
                "branch": body.branch_id, "now": now,
            })
            r = c_row.mappings().first()
            contact_id = str(r["id"]) if r else contact_uuid

        await db.execute(text("""
            INSERT INTO orders
                (id, branch_id, basket_id, reference, status, total_amount, currency,
                 payment_provider, payment_ref, device_id, device_label, source,
                 customer_name, customer_email, customer_phone,
                 contact_id, idempotency_key, created_at, updated_at)
            VALUES
                (:id, :bid, :basket, :ref, 'PENDING', :total, 'GBP',
                 :provider, :pref, :did, :dlabel, :source,
                 :cname, :cemail, :cphone,
                 :cid, :ikey, :now, :now)
            ON CONFLICT (idempotency_key) DO NOTHING
        """), {
            "id": order_id, "bid": body.branch_id, "basket": body.basket_id,
            "ref": body.order_ref, "total": str(total),
            "provider": body.payment_provider, "pref": body.payment_intent_id or "",
            "did": body.device_id or "", "dlabel": body.device_label or "",
            "source": body.source or "kiosk",
            "cname": body.contact_name, "cemail": body.contact_email, "cphone": body.contact_phone,
            "cid": contact_id, "ikey": body.order_ref, "now": now,
        })

        await db.execute(text(
            "INSERT INTO donations (id, user_id, branch_id, amount, currency, "
            "gift_aid_eligible, purpose, reference, payment_provider, payment_ref, "
            "status, source, contact_id, idempotency_key, created_at, updated_at) "
            "VALUES (:id, :uid, :bid, :amount, 'GBP', :ga, 'General Fund', :ref, "
            ":provider, :pref, 'PENDING', 'kiosk', :cid, :ikey, :now, :now) "
            "ON CONFLICT (idempotency_key) DO NOTHING"
        ), {
            "id": str(uuid.uuid4()), "uid": contact_id or "", "bid": body.branch_id,
            "amount": str(total), "ref": body.order_ref,
            "provider": body.payment_provider, "pref": body.payment_intent_id or "",
            "ga": body.gift_aid_eligible,
            "cid": contact_id, "ikey": f"donation-{body.order_ref}", "now": now,
        })

        # Save Gift Aid declaration + address when donor agreed
        if body.gift_aid_eligible and body.ga_full_name and body.ga_postcode:
            ga_email_key = body.ga_email.strip().lower() if body.ga_email.strip() else (
                email_key  # fall back to checkout email
            )
            ga_contact_id = contact_id
            if ga_email_key and ga_email_key != email_key:
                # Different email for Gift Aid — upsert separately
                ga_uuid = str(uuid.uuid4())
                ga_parts = body.ga_full_name.strip().split(" ", 1)
                ga_row = await db.execute(text(_upsert_contact_sql()), {
                    "id": ga_uuid, "email": ga_email_key,
                    "first": ga_parts[0], "surname": ga_parts[1] if len(ga_parts) > 1 else "",
                    "name": body.ga_full_name, "phone": "",
                    "branch": body.branch_id, "now": now,
                })
                r2 = ga_row.mappings().first()
                ga_contact_id = str(r2["id"]) if r2 else ga_uuid

            if ga_contact_id and body.ga_postcode:
                await db.execute(text("""
                    INSERT INTO addresses (id, contact_id, formatted, postcode, uprn,
                                          is_primary, lookup_source, created_at)
                    VALUES (:id, :cid, :fmt, :pc, '', true, 'kiosk', :now)
                    ON CONFLICT DO NOTHING
                """), {
                    "id": str(uuid.uuid4()), "cid": ga_contact_id,
                    "fmt": body.ga_address or body.ga_postcode,
                    "pc": body.ga_postcode.upper().strip(), "now": now,
                })

            await db.execute(text("""
                INSERT INTO gift_aid_declarations
                    (id, order_ref, full_name, postcode, address, contact_email,
                     donation_amount, donation_date, gift_aid_agreed,
                     contact_id, hmrc_submitted, created_at)
                VALUES
                    (:id, :ref, :name, :pc, :addr, :email,
                     :amount, :ddate, true,
                     :cid, false, :now)
                ON CONFLICT DO NOTHING
            """), {
                "id": str(uuid.uuid4()), "ref": body.order_ref,
                "name": body.ga_full_name, "pc": body.ga_postcode.upper().strip(),
                "addr": body.ga_address or "",
                "email": body.ga_email.strip() or body.contact_email.strip(),
                "amount": total, "ddate": now.date(),
                "cid": ga_contact_id, "now": now,
            })

        await db.execute(
            text("UPDATE baskets SET status = 'CHECKOUT', updated_at = :now WHERE id = :bid"),
            {"now": now, "bid": body.basket_id},
        )
        await db.commit()

    return {"order_id": order_id, "reference": body.order_ref, "status": "PENDING"}


class OrderConfirmInput(BaseModel):
    order_ref: str
    payment_ref: str = ""


@router.post("/order/confirm")
async def confirm_order(body: OrderConfirmInput):
    """
    Called by PaymentScreen when payment succeeds.
    Updates order + donation to COMPLETED with the real transaction ID.
    Also sends receipt email if a customer email is on record.
    Idempotent — safe to call multiple times.
    """


    now = datetime.utcnow()
    email_sent = False

    async with SessionLocal() as db:
        # Update order to COMPLETED and record the real transaction ID
        await db.execute(text("""
            UPDATE orders
               SET status = 'COMPLETED',
                   payment_ref = CASE WHEN :pref != '' THEN :pref ELSE payment_ref END,
                   updated_at  = :now
             WHERE reference = :ref
        """), {"pref": body.payment_ref or "", "now": now, "ref": body.order_ref})

        await db.execute(text("""
            UPDATE donations
               SET status = 'COMPLETED',
                   payment_ref = CASE WHEN :pref != '' THEN :pref ELSE payment_ref END,
                   updated_at  = :now
             WHERE reference = :ref
        """), {"pref": body.payment_ref or "", "now": now, "ref": body.order_ref})

        await db.execute(text("""
            UPDATE baskets SET status = 'COMPLETED', updated_at = :now
             WHERE id = (SELECT basket_id FROM orders WHERE reference = :ref LIMIT 1)
        """), {"now": now, "ref": body.order_ref})

        # Fetch data needed for the receipt
        order_row = await db.execute(
            text("SELECT basket_id, total_amount, branch_id, customer_email, customer_name FROM orders WHERE reference = :ref LIMIT 1"),
            {"ref": body.order_ref},
        )
        order = order_row.mappings().first()
        await db.commit()

    if order and order["customer_email"]:
        try:
            # Load item names from basket_items
            async with SessionLocal() as db:
                items_result = await db.execute(
                    text("SELECT name, quantity, unit_price FROM basket_items WHERE basket_id = :bid"),
                    {"bid": order["basket_id"]},
                )
                db_items = [dict(r) for r in items_result.mappings().all()]

            branch_id = order["branch_id"] or "main"
            branch_label = (
                "Wembley" if branch_id in ("main", "wembley") else
                branch_id.replace("-", " ").title()
            )
            result = await send_receipt(ReceiptInput(
                order_ref=body.order_ref,
                type="email",
                destination=order["customer_email"],
                total=float(str(order["total_amount"])),
                items=[
                    {"name": r["name"], "quantity": r["quantity"], "unitPrice": float(str(r["unit_price"]))}
                    for r in db_items
                ],
                branch_name=f"Shital {branch_label}",
                customer_name=order["customer_name"] or "",
            ))
            email_sent = bool(result.get("sent"))
        except Exception:
            email_sent = False

    return {"confirmed": True, "reference": body.order_ref, "email_sent": email_sent}


@router.post("/terminal/connection-token")
async def stripe_connection_token():
    import stripe

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

    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY)
    try:
        action = stripe.terminal.Reader.process_payment_intent(body.reader_id, payment_intent=body.payment_intent_id)
        return {"reader_id": body.reader_id, "status": action.action.status if action.action else "unknown"}
    except Exception as e:
        return {"error": str(e)}


@router.post("/terminal/cancel-action")
async def cancel_reader_action(body: ReaderActionInput):
    import stripe

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

    stripe.api_key = await SecretsManager.get("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY)
    try:
        intent = stripe.PaymentIntent.retrieve(id)
        return {"status": intent.status, "id": intent.id}
    except Exception as e:
        return {"status": "unknown", "error": str(e)}


@router.get("/terminal/readers")
async def list_terminal_readers(location_id: str = ""):
    import stripe

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
    reader_serial: str = ""   # SumUp reader serial (for fallback lookup)
    reader_id: str = ""       # SumUp reader API id (preferred for push endpoint)


@router.post("/sumup/checkout")
async def sumup_checkout(body: SumUpCheckoutInput):
    """
    Create a SumUp checkout and push it to the configured SumUp reader.
    Poll GET /sumup/checkout/{checkout_id} to check completion.
    """
    import uuid as _uuid



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
            # 1. Create checkout — include return_url so SumUp calls our webhook
            #    the instant the card payment completes on the reader
            webhook_url = f"{settings.SITE_URL}/api/v1/kiosk/sumup/webhook"
            create_resp = await client.post(
                f"{base}/v0.1/checkouts",
                headers=headers,
                json={
                    "checkout_reference": checkout_ref,
                    "amount": amount,
                    "currency": "GBP",
                    "merchant_code": merchant_code,
                    "description": body.description,
                    "return_url": webhook_url,
                },
            )
            if not create_resp.is_success:
                return {"error": f"SumUp checkout creation failed ({create_resp.status_code}): {create_resp.text[:200]}"}

            checkout = create_resp.json()
            checkout_id = checkout.get("id")

            # 2. Push to physical reader
            # body.reader_id = SumUp API reader ID (rdr_XXX) if known
            # body.reader_serial = physical serial number (e.g. 200101578509)
            # Always look up the API reader ID from serial — serial cannot be used in the push URL
            reader_id = (body.reader_id or "").strip()
            reader_serial = (body.reader_serial or "").strip() or await SecretsManager.get("SUMUP_READER_SERIAL") or ""

            if not reader_id and reader_serial:
                # Resolve serial → API reader ID via readers list
                rd_resp = await client.get(
                    f"{base}/v0.1/merchants/{merchant_code}/readers",
                    headers=headers,
                )
                if rd_resp.is_success:
                    rd_data = rd_resp.json()
                    rd_list = rd_data if isinstance(rd_data, list) else rd_data.get("items", rd_data.get("readers", []))
                    for rd in rd_list:
                        # SumUp returns serial under device.identifier, not serial_number
                        device_serial = rd.get("device", {}).get("identifier", rd.get("serial_number", ""))
                        if device_serial == reader_serial or rd.get("id") == reader_serial:
                            reader_id = rd.get("id", "")
                            break

            if not reader_id:
                return {"error": f"Could not resolve SumUp reader ID for serial '{reader_serial}'. Ensure the reader is paired and SUMUP_MERCHANT_CODE is correct."}

            push_status = None
            if reader_id and checkout_id:
                push_resp = await client.post(
                    f"{base}/v0.1/merchants/{merchant_code}/readers/{reader_id}/checkout",
                    headers=headers,
                    json={"id": checkout_id, "total_amount": {"currency": "GBP", "minor_unit": 2, "value": body.amount_pence}},
                )
                push_status = push_resp.status_code
                if not push_resp.is_success:
                    return {"error": f"Reader push failed ({push_resp.status_code}): {push_resp.text[:200]}", "reader_id_used": reader_id, "merchant_code_used": merchant_code}

        return {
            "checkout_id": checkout_id,
            "checkout_reference": checkout_ref,
            "amount": amount,
            "reader_id": reader_id,
            "reader_serial": reader_serial,
            "push_status": push_status,
        }
    except Exception as e:
        return {"error": str(e)}


@router.post("/sumup/webhook")
async def sumup_webhook(request: Request):
    """
    SumUp calls this URL (set as return_url in checkout creation) the instant
    a checkout status changes — typically PENDING → PAID after card tap.
    We cache the status in Redis so the frontend poll returns it immediately.
    """

    try:
        body = await request.json()
    except Exception:
        return {"ok": False}

    checkout_id = body.get("id") or body.get("checkout_id")
    status = body.get("status")
    if checkout_id and status:
        try:
            await cache_set(f"sumup:checkout:{checkout_id}", {"status": status.upper()}, ttl=3600)
        except Exception:
            pass  # Redis unavailable — webhook still accepted
    return {"ok": True}


@router.get("/sumup/checkout/{checkout_id}")
async def sumup_checkout_status(checkout_id: str):
    """
    Return SumUp checkout status. Checks the Redis webhook cache first
    (populated by POST /sumup/webhook the instant payment completes) then
    falls back to polling the SumUp API directly.
    """


    # Fast path: webhook already delivered the final status
    try:
        cached = await cache_get(f"sumup:checkout:{checkout_id}")
        if cached and cached.get("status") not in (None, "PENDING"):
            return {"status": cached["status"], "source": "webhook"}
    except Exception:
        cached = None  # Redis unavailable — fall through to API poll

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
        status = data.get("status", "PENDING")
        if status and status != "PENDING":
            try:
                await cache_set(f"sumup:checkout:{checkout_id}", {"status": status.upper()}, ttl=3600)
            except Exception:
                pass
        return {"status": status, "raw": data}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.get("/sumup/recent-transaction")
async def sumup_recent_transaction(amount_pence: int, since_seconds: int = 120):
    """
    Check if a SumUp transaction of the given amount completed in the last
    `since_seconds` seconds. Used as a fallback when the checkout status stays
    PENDING but the reader processed a standalone (non-cloud-linked) payment.
    Returns {"paid": true, "transaction_id": "..."} or {"paid": false}.
    """
    from datetime import UTC, timedelta

    access_token = await SecretsManager.get("SUMUP_ACCESS_TOKEN") or settings.SUMUP_ACCESS_TOKEN
    merchant_code = await SecretsManager.get("SUMUP_MERCHANT_CODE") or settings.SUMUP_MERCHANT_CODE
    if not access_token or not merchant_code:
        return {"paid": False, "error": "SumUp not configured"}

    amount_decimal = round(amount_pence / 100, 2)
    oldest = (datetime.utcnow().replace(tzinfo=UTC) - timedelta(seconds=since_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.sumup.com/v0.1/me/transactions/history",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"limit": 10, "oldest_time": oldest},
            )
        if not resp.is_success:
            return {"paid": False, "error": f"SumUp API {resp.status_code}: {resp.text}"}
        txns = resp.json().get("items", [])
        for t in txns:
            t_status = (t.get("status") or "").upper()
            if t_status == "SUCCESSFUL" and abs(float(t.get("amount", 0)) - amount_decimal) < 0.01:
                return {"paid": True, "transaction_id": t.get("id"), "status": t.get("status")}
        return {"paid": False}
    except Exception as e:
        return {"paid": False, "error": str(e)}


@router.get("/sumup/readers")
async def list_sumup_readers():
    """List SumUp readers registered to the merchant."""


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
        if not resp.is_success:
            return {"readers": [], "error": f"SumUp API error ({resp.status_code}): {resp.text[:200]}"}
        data = resp.json()
        # SumUp returns {"items": [...]} — not a bare list and not "readers"
        rd_list = data if isinstance(data, list) else data.get("items", data.get("readers", []))
        return {"readers": [
            {
                "id":     r.get("id", ""),
                "serial": r.get("device", {}).get("identifier", r.get("serial_number", "")),
                "name":   r.get("name", ""),
                "status": r.get("status", "unknown"),
            }
            for r in rd_list
        ]}
    except Exception as e:
        return {"readers": [], "error": str(e)}


class QuickDonationRecordInput(BaseModel):
    basket_id: str
    order_ref: str
    amount_pence: int
    branch_id: str = "main"
    payment_intent_id: str = ""
    payment_provider: str = "SUMUP"
    reader_id: str = ""
    # Optional Gift Aid — collected before payment on the kiosk
    ga_first_name: str = ""
    ga_surname: str = ""
    ga_house_number: str = ""
    ga_postcode: str = ""
    ga_email: str = ""
    ga_declared: bool = False


# Anonymous kiosk user/branch lookup — maps branch codes to UUIDs at runtime.
# Falls back to using the code directly (works if DB stores string IDs).
async def _resolve_branch_uuid(db: Any, branch_code: str) -> str:
    """Resolve a branch short code (e.g. 'main') to its UUID. Returns the code unchanged if not found."""
    row = (await db.execute(text("SELECT id FROM branches WHERE branch_id = :code LIMIT 1"), {"code": branch_code})).mappings().first()
    return str(row["id"]) if row else branch_code


async def _resolve_anonymous_user(db: Any) -> str:
    """Get or create a system 'anonymous-kiosk' user for recording anonymous donations."""
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
                    "payment_provider, payment_ref, source, idempotency_key, created_at, updated_at) "
                    "VALUES (:id, :uid, :bid, :basket, :ref, 'PENDING', :total, 'GBP', :provider, :pref, "
                    "'quick-donation', :ikey, :now, :now) "
                    "ON CONFLICT (idempotency_key) DO NOTHING"
                ),
                {
                    "id": order_id, "uid": anon_user_id, "bid": branch_id,
                    "basket": body.basket_id, "ref": body.order_ref,
                    "total": str(total), "pref": body.payment_intent_id,
                    "provider": (body.payment_provider or "SUMUP").upper(),
                    "ikey": order_id, "now": now,
                },
            )

            ga = body.ga_declared and bool(body.ga_first_name or body.ga_surname)

            # 2. Record in donations table (for donation reporting, Gift Aid, finance)
            provider_upper = (body.payment_provider or "SUMUP").upper()
            # Estimated fee rates — will be replaced by actual settlement data via webhook
            fee_pct = 0.0169 if provider_upper == "SUMUP" else 0.0175
            fee_amount = round(total * fee_pct, 2)
            net_amount = round(total - fee_amount, 2)

            await db.execute(
                text(
                    "INSERT INTO donations (id, user_id, branch_id, amount, currency, "
                    "gift_aid_eligible, purpose, reference, payment_provider, payment_ref, "
                    "fee_pct, fee_amount, net_amount, "
                    "status, source, idempotency_key, created_at, updated_at) "
                    "VALUES (:id, :uid, :bid, :amount, 'GBP', :ga_elig, 'General Fund', :ref, "
                    ":provider, :pref, :fee_pct, :fee_amount, :net_amount, "
                    "'PENDING', 'quick-donation', :ikey, :now, :now) "
                    "ON CONFLICT (idempotency_key) DO NOTHING"
                ),
                {
                    "id": donation_id, "uid": anon_user_id, "bid": branch_id,
                    "amount": str(total), "ref": body.order_ref,
                    "provider": provider_upper, "pref": body.payment_intent_id,
                    "fee_pct": str(fee_pct), "fee_amount": str(fee_amount), "net_amount": str(net_amount),
                    "ikey": f"qd-{order_id}", "ga_elig": ga, "now": now,
                },
            )

            # 3. Store Gift Aid declaration + upsert contact (reuses gift_aid_declarations table)
            declaration_id: str | None = None
            if ga:
                # Ensure source column exists (idempotent migration)
                await db.execute(text(
                    "ALTER TABLE gift_aid_declarations ADD COLUMN IF NOT EXISTS source VARCHAR(64) DEFAULT 'kiosk'"
                ))

                full_name = f"{body.ga_first_name} {body.ga_surname}".strip()
                email_key = body.ga_email.strip().lower() if body.ga_email.strip() else None
                contact_id: str | None = None

                if email_key:
                    contact_uuid = str(uuid.uuid4())
                    c_row = (await db.execute(text("""
                        INSERT INTO contacts
                            (id, email, first_name, surname, full_name, phone,
                             gdpr_consent, gdpr_consented_at, tac_consent, tac_consented_at,
                             first_source, first_branch_id, created_at, updated_at)
                        VALUES
                            (:id, :email, :first, :surname, :name, '',
                             true, :now, true, :now, 'quick-donation', :branch, :now, :now)
                        ON CONFLICT (email) DO UPDATE SET
                            first_name        = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
                            surname           = COALESCE(NULLIF(EXCLUDED.surname,''),    contacts.surname),
                            full_name         = COALESCE(NULLIF(EXCLUDED.full_name,''),  contacts.full_name),
                            gdpr_consent      = true,
                            gdpr_consented_at = COALESCE(contacts.gdpr_consented_at, EXCLUDED.gdpr_consented_at),
                            updated_at        = EXCLUDED.updated_at
                        RETURNING id
                    """), {
                        "id": contact_uuid, "email": email_key,
                        "first": body.ga_first_name, "surname": body.ga_surname,
                        "name": full_name, "branch": body.branch_id, "now": now,
                    })).mappings().first()
                    contact_id = str(c_row["id"]) if c_row else contact_uuid

                    if body.ga_postcode:
                        await db.execute(text("""
                            INSERT INTO addresses
                                (id, contact_id, formatted, postcode, uprn,
                                 is_primary, lookup_source, created_at)
                            VALUES (:id, :cid, :fmt, :pc, '', true, 'quick-donation', :now)
                        """), {
                            "id": str(uuid.uuid4()), "cid": contact_id,
                            "fmt": body.ga_house_number or "", "pc": body.ga_postcode.upper().strip(), "now": now,
                        })

                declaration_id = str(uuid.uuid4())
                await db.execute(text("""
                    INSERT INTO gift_aid_declarations
                        (id, order_ref, full_name, first_name, surname, postcode, address, uprn,
                         contact_email, contact_phone, donation_amount, donation_date,
                         gift_aid_agreed, contact_id, source, hmrc_submitted, created_at)
                    VALUES
                        (:id, :ref, :name, :first, :surname, :pc, :addr, '',
                         :email, '', :amount, :ddate,
                         true, :cid, 'quick-donation', false, :now)
                """), {
                    "id": declaration_id, "ref": body.order_ref,
                    "name": full_name, "first": body.ga_first_name, "surname": body.ga_surname,
                    "pc": body.ga_postcode.upper().strip() if body.ga_postcode else "",
                    "addr": body.ga_house_number or "",
                    "email": body.ga_email.strip().lower() if body.ga_email else "",
                    "amount": str(total), "ddate": now.date(),
                    "cid": contact_id, "now": now,
                })

            await db.commit()
        return {
            "recorded": True,
            "order_id": order_id,
            "donation_id": donation_id,
            "declaration_id": declaration_id,
            "reference": body.order_ref,
            "gift_aid": ga,
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

            from shital.api.routers.email_templates import render_template

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
    """Legacy endpoint — delegates to assign-reader."""
    return await assign_reader(AssignReaderInput(
        provider="stripe_terminal",
        stripe_reader_id=body.stripe_reader_id,
        label=body.device_label or body.stripe_reader_id,
        branch_id=body.branch_id,
        user_email=body.user_email,
    ))


class AssignReaderInput(BaseModel):
    provider: str                  # 'stripe_terminal' | 'sumup' | 'clover'
    stripe_reader_id: str = ""
    sumup_reader_serial: str = ""
    sumup_reader_api_id: str = ""
    clover_device_id: str = ""
    label: str = ""
    # Identify the device — supply device_username (Path-1) or user_email (Path-2)
    device_username: str = ""
    user_email: str = ""
    branch_id: str = ""


@router.post("/quick-donation/assign-reader")
async def assign_reader(body: AssignReaderInput):
    """
    Persist a card reader assignment for a kiosk device.
    Works for both Stripe Terminal and SumUp readers.

    Priority: if device_username is given, updates kiosk_devices → terminal_devices
    (Path-1 device credentials).  If user_email is given, also updates kiosk_profiles
    (Path-2 legacy accounts).  Both can be supplied to update both tables.
    """


    provider = body.provider.lower().strip()
    if provider not in ("stripe_terminal", "sumup", "clover", "cash"):
        return {"assigned": False, "error": f"Unknown provider: {provider}"}

    now = datetime.utcnow()
    label = body.label or body.stripe_reader_id or body.sumup_reader_serial or provider
    terminal_device_id: str | None = None

    async with SessionLocal() as db:
        # 1. Upsert terminal_devices record based on unique identifier
        if provider == "stripe_terminal":
            unique_id = body.stripe_reader_id
        elif provider == "clover":
            unique_id = body.clover_device_id
        else:
            unique_id = body.sumup_reader_serial
        if unique_id:
            existing = (await db.execute(
                text("""
                    SELECT id FROM terminal_devices
                    WHERE (stripe_reader_id = :sid OR sumup_reader_serial = :serial OR clover_device_id = :clover)
                      AND deleted_at IS NULL
                    LIMIT 1
                """),
                {"sid": body.stripe_reader_id or "", "serial": body.sumup_reader_serial or "", "clover": body.clover_device_id or ""},
            )).mappings().first()

            if existing:
                terminal_device_id = str(existing["id"])
                await db.execute(text("""
                    UPDATE terminal_devices SET
                        provider             = :prov,
                        stripe_reader_id     = COALESCE(NULLIF(:sid,''),  stripe_reader_id),
                        sumup_reader_serial  = COALESCE(NULLIF(:serial,''), sumup_reader_serial),
                        clover_device_id     = COALESCE(NULLIF(:clover,''), clover_device_id),
                        label                = :label,
                        updated_at           = :now
                    WHERE id = :id
                """), {
                    "prov": provider, "sid": body.stripe_reader_id or "",
                    "serial": body.sumup_reader_serial or "", "clover": body.clover_device_id or "",
                    "label": label, "now": now, "id": terminal_device_id,
                })
            else:
                terminal_device_id = str(uuid.uuid4())
                await db.execute(text("""
                    INSERT INTO terminal_devices
                        (id, label, provider, stripe_reader_id, sumup_reader_serial, clover_device_id,
                         branch_id, status, is_active, created_at, updated_at)
                    VALUES
                        (:id, :label, :prov, :sid, :serial, :clover,
                         :branch, 'offline', true, :now, :now)
                    ON CONFLICT DO NOTHING
                """), {
                    "id": terminal_device_id, "label": label, "prov": provider,
                    "sid": body.stripe_reader_id or "", "serial": body.sumup_reader_serial or "",
                    "clover": body.clover_device_id or "",
                    "branch": body.branch_id or "main", "now": now,
                })

        # 2. Link terminal_devices to kiosk_device (Path-1: device credentials)
        if body.device_username and terminal_device_id:
            await db.execute(text("""
                UPDATE kiosk_devices
                SET card_reader_id = :td_id, updated_at = :now
                WHERE LOWER(device_username) = :uname AND deleted_at IS NULL
            """), {"td_id": terminal_device_id, "uname": body.device_username.lower().strip(), "now": now})

        # 3. Update kiosk_profiles (Path-2: legacy email login)
        if body.user_email:
            email = body.user_email.strip().lower()
            if provider == "stripe_terminal":
                await db.execute(text("""
                    UPDATE kiosk_profiles SET
                        stripe_reader_id     = :rid,
                        sumup_reader_serial  = '',
                        sumup_reader_api_id  = '',
                        device_provider      = 'stripe_terminal',
                        device_label         = :label,
                        updated_at           = :now
                    WHERE user_email = :email AND deleted_at IS NULL
                """), {"rid": body.stripe_reader_id or "", "label": label, "now": now, "email": email})
            else:
                await db.execute(text("""
                    UPDATE kiosk_profiles SET
                        sumup_reader_serial  = :serial,
                        sumup_reader_api_id  = :api_id,
                        stripe_reader_id     = '',
                        device_provider      = :prov,
                        device_label         = :label,
                        updated_at           = :now
                    WHERE user_email = :email AND deleted_at IS NULL
                """), {
                    "serial": body.sumup_reader_serial or "", "api_id": body.sumup_reader_api_id or "",
                    "prov": provider, "label": label, "now": now, "email": email,
                })

        await db.commit()

    return {
        "assigned": True,
        "provider": provider,
        "terminal_device_id": terminal_device_id,
        "label": label,
    }


@router.get("/quick-donation/profiles")
async def list_kiosk_profiles(branch_id: str = ""):
    """List all kiosk profiles with their branch, user, and device assignments."""


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


# ── Monthly giving signup (Quick Donation kiosk) ──────────────────────────────

class MonthlySignupInput(BaseModel):
    first_name: str
    surname: str
    house_number: str = ""
    postcode: str = ""
    email: str
    amount: float
    gift_aid: bool = False
    branch_id: str = "main"


async def _create_kiosk_subscription(
    first_name: str, surname: str, email: str, amount: float,
    house_number: str = "", postcode: str = "",
) -> tuple[str | None, str | None, str | None]:
    """Create PayPal subscription for kiosk monthly giving. Returns (approval_url, sub_id, plan_id)."""
    try:
        client_id = await SecretsManager.get("PAYPAL_CLIENT_ID") or ""
        secret    = await SecretsManager.get("PAYPAL_CLIENT_SECRET") or ""
        env       = await SecretsManager.get("PAYPAL_ENV") or "live"
        if not client_id or not secret:
            return None, None, None
        base = "https://api-m.paypal.com" if env == "live" else "https://api-m.sandbox.paypal.com"
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f"{base}/v1/oauth2/token",
                             auth=(client_id, secret), data={"grant_type": "client_credentials"})
            r.raise_for_status()
            token = r.json()["access_token"]
            hdrs  = {"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                     "Prefer": "return=representation"}
            # reuse shared product helper
            from shital.api.routers.recurring_giving import _ensure_product
            product_id = await _ensure_product(token, base)
            # create a fresh plan for this amount
            plan_r = await c.post(f"{base}/v1/billing/plans", headers=hdrs, json={
                "product_id": product_id,
                "name": f"Shital Temple Monthly — £{amount:.2f}",
                "status": "ACTIVE",
                "billing_cycles": [{
                    "frequency": {"interval_unit": "MONTH", "interval_count": 1},
                    "tenure_type": "REGULAR", "sequence": 1, "total_cycles": 0,
                    "pricing_scheme": {"fixed_price": {"value": f"{amount:.2f}", "currency_code": "GBP"}},
                }],
                "payment_preferences": {"auto_bill_outstanding": True, "payment_failure_threshold": 3},
            })
            plan_r.raise_for_status()
            plan_id = plan_r.json()["id"]
            sub_body: dict = {
                "plan_id": plan_id,
                "subscriber": {
                    "name": {"given_name": first_name, "surname": surname},
                    "email_address": email,
                },
                "application_context": {
                    "brand_name": "Shital Temple",
                    "return_url":  "https://shital.org.uk/donate/#monthly-complete",
                    "cancel_url":  "https://shital.org.uk/donate/#monthly-cancel",
                },
            }
            if postcode:
                sub_body["subscriber"]["shipping_address"] = {
                    "name": {"full_name": f"{first_name} {surname}"},
                    "address": {"address_line_1": house_number,
                                "postal_code": postcode.upper().replace(" ", ""),
                                "country_code": "GB"},
                }
            sub_r = await c.post(f"{base}/v1/billing/subscriptions", headers=hdrs, json=sub_body)
            sub_r.raise_for_status()
            sub_data  = sub_r.json()
            sub_id    = sub_data.get("id")
            for link in sub_data.get("links", []):
                if link.get("rel") == "approve":
                    return link["href"], sub_id, plan_id
    except Exception as exc:
        import structlog
        structlog.get_logger().warning("kiosk_monthly_paypal_error", error=str(exc))
    return None, None, None


@router.post("/quick-donation/monthly-signup")
async def quick_donation_monthly_signup(body: MonthlySignupInput):
    """Record kiosk monthly-giving signup and create PayPal subscription."""
    import uuid
    from datetime import datetime



    now      = datetime.utcnow()
    full_name = f"{body.first_name} {body.surname}".strip()
    email_key = body.email.strip().lower()

    approval_url, paypal_sub_id, plan_id = await _create_kiosk_subscription(
        body.first_name, body.surname, email_key,
        body.amount, body.house_number, body.postcode,
    )

    status = "PENDING_APPROVAL" if approval_url else "PENDING_CONTACT"
    signup_id = str(uuid.uuid4())

    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO recurring_giving_subscriptions
                (id, paypal_subscription_id, paypal_plan_id, amount, frequency, status, branch_id,
                 donor_name, donor_email, donor_first_name, donor_surname,
                 donor_postcode, donor_address, created_at, updated_at)
            VALUES
                (:id, :sub_id, :plan_id, :amt, 'MONTH', :status, :bid,
                 :name, :email, :fn, :sn, :pc, :addr, :now, :now)
        """), {
            "id": signup_id, "sub_id": paypal_sub_id, "plan_id": plan_id or "",
            "amt": body.amount, "status": status, "bid": body.branch_id,
            "name": full_name, "email": email_key,
            "fn": body.first_name, "sn": body.surname,
            "pc": body.postcode, "addr": body.house_number, "now": now,
        })
        await db.commit()

    # Fetch PayPal client_id for the frontend SDK
    paypal_client_id = ""
    try:
        paypal_client_id = await SecretsManager.get("PAYPAL_CLIENT_ID") or ""
    except Exception:
        pass

    return {
        "ok": True,
        "signup_id": signup_id,
        "approval_url": approval_url,
        "plan_id": plan_id,
        "paypal_client_id": paypal_client_id,
        "amount": body.amount,
        "name": full_name,
    }


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
                       COALESCE(td.provider, 'stripe_terminal') AS reader_provider,
                       COALESCE(td.sumup_reader_serial, '') AS sumup_reader_serial,
                       COALESCE(td.clover_device_id, '') AS clover_device_id,
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
            "reader_provider": device["reader_provider"],
            "sumup_reader_serial": device["sumup_reader_serial"],
            "clover_device_id": device["clover_device_id"],
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
    device_reader_provider = "stripe_terminal"
    device_sumup_serial = ""
    device_clover_id = ""
    dev_flags: dict = {"show_monthly_giving": False, "enable_gift_aid": False, "tap_and_go": True, "donate_title": "Tap & Donate", "monthly_giving_text": "Make a big impact from just £5/month", "monthly_giving_amount": 5.0}
    async with SessionLocal() as db:
        dev_res = await db.execute(
            text("""
                SELECT kd.show_monthly_giving, kd.enable_gift_aid, kd.tap_and_go,
                       kd.donate_title, kd.monthly_giving_text, kd.monthly_giving_amount,
                       td.stripe_reader_id, td.label AS reader_label,
                       COALESCE(td.provider, 'stripe_terminal') AS reader_provider,
                       COALESCE(td.sumup_reader_serial, '') AS sumup_reader_serial
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
            if dev_row["stripe_reader_id"] or dev_row["sumup_reader_serial"] or dev_row["clover_device_id"]:
                device_reader_id = dev_row["stripe_reader_id"]
                device_reader_label = dev_row["reader_label"]
                device_reader_provider = dev_row["reader_provider"]
                device_sumup_serial = dev_row["sumup_reader_serial"]
                device_clover_id = dev_row["clover_device_id"]
            dev_flags = {
                "show_monthly_giving": bool(dev_row["show_monthly_giving"]),
                "enable_gift_aid": bool(dev_row["enable_gift_aid"]),
                "tap_and_go": bool(dev_row["tap_and_go"]),
                "donate_title": dev_row["donate_title"] or "Tap & Donate",
                "monthly_giving_text": dev_row["monthly_giving_text"] or "Make a big impact from just £5/month",
                "monthly_giving_amount": float(dev_row["monthly_giving_amount"] or 5),
            }

    # Merge kiosk_devices reader (preferred) with kiosk_profiles reader (fallback)
    profile_provider = (profile.get("device_provider") or "stripe_terminal") if profile else "stripe_terminal"
    profile_sumup_serial = (profile.get("sumup_reader_serial") or "") if profile else ""
    profile_stripe_id = (profile.get("stripe_reader_id") or "") if profile else ""

    # If kiosk_devices had a configured reader, use it; otherwise fall back to kiosk_profiles
    if device_reader_id or device_sumup_serial or device_clover_id:
        effective_reader_id = device_reader_id
        effective_reader_label = device_reader_label or (profile.get("device_label") if profile else None)
        effective_provider = device_reader_provider
        effective_sumup_serial = device_sumup_serial
        effective_clover_id = device_clover_id
    else:
        effective_reader_id = profile_stripe_id or None
        effective_reader_label = (profile.get("device_label") if profile else None)
        effective_provider = profile_provider
        effective_sumup_serial = profile_sumup_serial
        effective_clover_id = ""  # kiosk_profiles has no clover field yet

    return {
        "authenticated": True,
        "user": {"id": str(user["id"]), "email": user["email"], "name": user["name"], "role": user["role"]},
        "branch": {"id": branch_code, "name": user["branch_name"] or "Unknown"},
        "profile": profile,
        "stripe_reader_id": effective_reader_id,
        "reader_label": effective_reader_label,
        "reader_provider": effective_provider,
        "sumup_reader_serial": effective_sumup_serial,
        "clover_device_id": effective_clover_id,
        **dev_flags,
    }


@router.get("/quick-donation/refresh-config")
async def quick_kiosk_refresh_config(username: str):
    """
    Returns the latest device config (reader, flags, branch) for an already
    logged-in device without requiring the password again.
    Non-sensitive: only feature flags, reader IDs, and branch info are returned.
    """


    login_input = username.strip().lower()
    if not login_input:
        return {"ok": False, "error": "username required"}

    async with SessionLocal() as db:
        dev_res = await db.execute(
            text("""
                SELECT kd.id, kd.name, kd.branch_id,
                       kd.show_monthly_giving, kd.enable_gift_aid, kd.tap_and_go,
                       kd.donate_title, kd.monthly_giving_text, kd.monthly_giving_amount,
                       kd.card_reader_id,
                       td.stripe_reader_id, td.label AS reader_label,
                       COALESCE(td.provider, 'stripe_terminal') AS reader_provider,
                       COALESCE(td.sumup_reader_serial, '') AS sumup_reader_serial,
                       COALESCE(td.clover_device_id, '') AS clover_device_id,
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

    if not device:
        return {"ok": False, "error": "Device not found"}

    return {
        "ok": True,
        "branch": {"id": device["branch_id"], "name": device["branch_name"] or device["branch_id"]},
        "stripe_reader_id": device["stripe_reader_id"],
        "reader_label": device["reader_label"],
        "reader_provider": device["reader_provider"],
        "sumup_reader_serial": device["sumup_reader_serial"],
        "clover_device_id": device["clover_device_id"],
        "show_monthly_giving": bool(device["show_monthly_giving"]),
        "enable_gift_aid": bool(device["enable_gift_aid"]),
        "tap_and_go": bool(device["tap_and_go"]),
        "donate_title": device["donate_title"] or "Tap & Donate",
        "monthly_giving_text": device["monthly_giving_text"] or "Make a big impact from just £5/month",
        "monthly_giving_amount": float(device["monthly_giving_amount"] or 5),
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
