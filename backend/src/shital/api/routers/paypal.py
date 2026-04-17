"""PayPal payment integration for the Shital Service web portal."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import httpx
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
    return {"client_id": client_id, "env": env, "currency": "GBP"}


class CreateOrderBody(BaseModel):
    amount: float
    description: str = "Shital Temple Donation"
    branch_id: str = "main"


@router.post("/order")
async def create_paypal_order(body: CreateOrderBody) -> dict[str, str]:
    """Create a PayPal order server-side and return its ID to the frontend."""
    token = await _token()
    base  = await _base()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{base}/v2/checkout/orders",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
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
            },
        )
        r.raise_for_status()
        data = r.json()
    return {"id": data["id"]}


class CaptureBody(BaseModel):
    paypal_order_id: str
    amount: float
    branch_id: str = "main"
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    gift_aid: bool = False
    gift_aid_postcode: str = ""
    gift_aid_address: str = ""
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

    order_id  = str(uuid.uuid4())
    order_ref = f"SVC-{body.paypal_order_id[:8].upper()}"
    now       = datetime.utcnow()

    try:
        from shital.core.fabrics.database import SessionLocal
        from sqlalchemy import text
        async with SessionLocal() as db:
            decl_id: str | None = None
            if body.gift_aid and body.contact_name:
                decl_id = str(uuid.uuid4())
                await db.execute(text("""
                    INSERT INTO gift_aid_declarations
                        (id, order_ref, full_name, postcode, address,
                         contact_email, contact_phone, donation_amount, donation_date,
                         gift_aid_agreed, created_at, updated_at)
                    VALUES (:id,:ref,:name,:pc,:addr,:email,:phone,:amt,:today,true,:now,:now)
                """), {
                    "id": decl_id, "ref": order_ref,
                    "name": body.contact_name, "pc": body.gift_aid_postcode,
                    "addr": body.gift_aid_address, "email": body.contact_email,
                    "phone": body.contact_phone, "amt": body.amount,
                    "today": now.date(), "now": now,
                })

            await db.execute(text("""
                INSERT INTO donations
                    (id, branch_id, amount, currency, gift_aid_eligible, gift_aid_declaration_id,
                     purpose, reference, payment_provider, payment_ref, status, idempotency_key,
                     created_at, updated_at)
                VALUES (:id,:branch,:amount,'GBP',:ga,:decl_id,
                        'Service Portal',:ref,'paypal',:paypal_id,'COMPLETED',:idem,:now,:now)
                ON CONFLICT (idempotency_key) DO NOTHING
            """), {
                "id": str(uuid.uuid4()), "branch": body.branch_id, "amount": body.amount,
                "ga": body.gift_aid, "decl_id": decl_id,
                "ref": order_ref, "paypal_id": body.paypal_order_id,
                "idem": f"paypal-{body.paypal_order_id}", "now": now,
            })

            await db.execute(text("""
                INSERT INTO orders
                    (id, branch_id, reference, status, total_amount, currency,
                     payment_provider, payment_ref, customer_name, customer_email, customer_phone,
                     idempotency_key, created_at, updated_at)
                VALUES (:id,:branch,:ref,'COMPLETED',:amount,'GBP',
                        'paypal',:paypal_id,:name,:email,:phone,:idem,:now,:now)
                ON CONFLICT (idempotency_key) DO NOTHING
            """), {
                "id": order_id, "branch": body.branch_id, "ref": order_ref, "amount": body.amount,
                "paypal_id": body.paypal_order_id,
                "name": body.contact_name, "email": body.contact_email, "phone": body.contact_phone,
                "idem": f"paypal-order-{body.paypal_order_id}", "now": now,
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
        "amount": body.amount,
    }
