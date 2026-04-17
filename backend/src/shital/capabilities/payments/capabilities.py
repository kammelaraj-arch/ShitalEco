"""
Payments Capabilities — PayPal, Stripe, Cash abstraction layer.
"""
from __future__ import annotations

from typing import Any

import httpx
import structlog
from pydantic import BaseModel

from shital.core.dna.registry import Fabric, capability
from shital.core.fabrics.config import settings
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()


class CreatePaymentInput(BaseModel):
    provider: str  # PAYPAL | STRIPE | CASH
    amount_pence: int
    currency: str = "GBP"
    order_id: str
    description: str
    idempotency_key: str
    return_url: str = ""
    cancel_url: str = ""


class CapturePaymentInput(BaseModel):
    provider: str
    payment_ref: str
    idempotency_key: str


@capability(
    name="create_payment",
    description="Create a payment intent using PayPal or Stripe. Returns approval URL (PayPal) or client secret (Stripe). For kiosk card payments use provider='STRIPE'.",
    fabric=Fabric.PAYMENTS,
    requires=["payments:create"],
    idempotent=True,
    tags=["payments"],
)
async def create_payment(ctx: DigitalSpace, data: CreatePaymentInput) -> dict[str, Any]:
    ctx.require_permission("payments:create") if "payments:create" in (ctx.permissions or []) else None

    amount_decimal = data.amount_pence / 100

    if data.provider == "PAYPAL":
        return await _create_paypal_order(data, amount_decimal)
    elif data.provider == "STRIPE":
        return await _create_stripe_intent(data)
    elif data.provider == "CASH":
        return {
            "payment_id": f"CASH-{data.order_id}",
            "provider": "CASH",
            "status": "PENDING",
            "amount": amount_decimal,
            "currency": data.currency,
        }
    else:
        from shital.core.fabrics.errors import ValidationError
        raise ValidationError(f"Unknown payment provider: {data.provider}")


async def _create_paypal_order(data: CreatePaymentInput, amount: float) -> dict[str, Any]:
    base_url = (
        "https://api-m.paypal.com"
        if settings.PAYPAL_MODE == "live"
        else "https://api-m.sandbox.paypal.com"
    )

    # Get access token
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            f"{base_url}/v1/oauth2/token",
            data={"grant_type": "client_credentials"},
            auth=(settings.PAYPAL_CLIENT_ID, settings.PAYPAL_CLIENT_SECRET),
            timeout=15,
        )
        token_resp.raise_for_status()
        access_token = token_resp.json()["access_token"]

        order_resp = await client.post(
            f"{base_url}/v2/checkout/orders",
            json={
                "intent": "CAPTURE",
                "purchase_units": [{
                    "amount": {"currency_code": data.currency, "value": f"{amount:.2f}"},
                    "description": data.description,
                    "custom_id": data.order_id,
                }],
                "application_context": {
                    "return_url": data.return_url or "https://shital.org/payment/success",
                    "cancel_url": data.cancel_url or "https://shital.org/payment/cancel",
                },
            },
            headers={
                "Authorization": f"Bearer {access_token}",
                "PayPal-Request-Id": data.idempotency_key,
            },
            timeout=15,
        )
        order_resp.raise_for_status()
        order = order_resp.json()

    approval_url = next(
        (lnk["href"] for lnk in order.get("links", []) if lnk["rel"] == "approve"), ""
    )

    return {
        "payment_id": order["id"],
        "provider": "PAYPAL",
        "status": order["status"],
        "approval_url": approval_url,
        "amount": amount,
        "currency": data.currency,
    }


async def _create_stripe_intent(data: CreatePaymentInput) -> dict[str, Any]:
    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY

    intent = stripe.PaymentIntent.create(
        amount=data.amount_pence,
        currency=data.currency.lower(),
        description=data.description,
        metadata={"order_id": data.order_id},
        idempotency_key=data.idempotency_key,
    )

    return {
        "payment_id": intent["id"],
        "provider": "STRIPE",
        "client_secret": intent["client_secret"],
        "status": intent["status"],
        "amount": data.amount_pence / 100,
        "currency": data.currency,
    }


@capability(
    name="capture_payment",
    description="Capture/complete a payment that has been authorised. For PayPal, this finalises the order after the user approves it.",
    fabric=Fabric.PAYMENTS,
    requires=[],
    idempotent=True,
    tags=["payments"],
)
async def capture_payment(ctx: DigitalSpace, data: CapturePaymentInput) -> dict[str, Any]:
    if data.provider == "PAYPAL":
        base_url = (
            "https://api-m.paypal.com"
            if settings.PAYPAL_MODE == "live"
            else "https://api-m.sandbox.paypal.com"
        )
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(
                f"{base_url}/v1/oauth2/token",
                data={"grant_type": "client_credentials"},
                auth=(settings.PAYPAL_CLIENT_ID, settings.PAYPAL_CLIENT_SECRET),
            )
            access_token = token_resp.json()["access_token"]

            capture_resp = await client.post(
                f"{base_url}/v2/checkout/orders/{data.payment_ref}/capture",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "PayPal-Request-Id": data.idempotency_key,
                },
            )
            capture_resp.raise_for_status()
            result = capture_resp.json()

        return {"status": result["status"], "payment_ref": data.payment_ref, "provider": "PAYPAL"}

    elif data.provider == "CASH":
        return {"status": "COMPLETED", "payment_ref": data.payment_ref, "provider": "CASH"}

    return {"status": "CAPTURED", "payment_ref": data.payment_ref, "provider": data.provider}
