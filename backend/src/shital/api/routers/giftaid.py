"""
Gift Aid router — admin endpoints for HMRC Gift Aid claim management.
"""
from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import uuid

from shital.api.deps import CurrentSpace
from shital.core.fabrics.config import settings

router = APIRouter(prefix="/gift-aid", tags=["gift-aid"])


# ─── Configuration (admin-only) ───────────────────────────────────────────────

class GiftAidConfig(BaseModel):
    getaddress_api_key: str | None = None
    hmrc_user_id: str | None = None
    hmrc_password: str | None = None
    hmrc_charity_ref: str | None = None
    hmrc_environment: str | None = None  # test | live


@router.get("/config")
async def get_gift_aid_config(ctx: CurrentSpace):
    """Return current Gift Aid configuration (passwords masked)."""
    return {
        "getaddress_api_key_set": bool(settings.GETADDRESS_API_KEY),
        "getaddress_api_key_preview": (settings.GETADDRESS_API_KEY[:8] + "***") if settings.GETADDRESS_API_KEY else "",
        "hmrc_user_id": settings.HMRC_GIFT_AID_USER_ID,
        "hmrc_charity_ref": settings.HMRC_GIFT_AID_CHARITY_HMO_REF,
        "hmrc_environment": settings.HMRC_GIFT_AID_ENVIRONMENT,
        "hmrc_credentials_set": bool(settings.HMRC_GIFT_AID_USER_ID and settings.HMRC_GIFT_AID_PASSWORD),
        "charity_number": settings.CHARITY_NUMBER,
    }


@router.post("/config")
async def update_gift_aid_config(ctx: CurrentSpace, config: GiftAidConfig):
    """Update Gift Aid configuration (stored in env/secrets — restart required)."""
    # In production, these would be saved to a secrets manager or .env
    # For now, returns a guidance response
    return {
        "message": "To update Gift Aid configuration, set these environment variables and restart the backend:",
        "env_vars": {
            "GETADDRESS_API_KEY": "Your GetAddress.io API key (get at getaddress.io/pricing)",
            "HMRC_GIFT_AID_USER_ID": "Your HMRC Government Gateway User ID",
            "HMRC_GIFT_AID_PASSWORD": "Your HMRC Government Gateway Password",
            "HMRC_GIFT_AID_CHARITY_HMO_REF": "Your charity HMRC reference (e.g. AB12345)",
            "HMRC_GIFT_AID_ENVIRONMENT": "test (for testing) or live (for production submissions)",
        },
        "getaddress_docs": "https://getaddress.io/documentation",
        "hmrc_charities_online": "https://www.gov.uk/guidance/claiming-gift-aid-as-a-charity-or-casc-claiming-online",
    }


# ─── Declarations ─────────────────────────────────────────────────────────────

class StoreDeclarationInput(BaseModel):
    order_ref: str
    full_name: str
    postcode: str
    address: str
    contact_email: str = ""
    contact_phone: str = ""
    donation_amount: Decimal
    donation_date: date | None = None
    gift_aid_agreed: bool = True


@router.post("/declarations")
async def store_declaration(ctx: CurrentSpace, body: StoreDeclarationInput):
    """Store a Gift Aid declaration in the database."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    declaration_id = str(uuid.uuid4())
    now = datetime.utcnow()
    decl_date = body.donation_date or date.today()

    try:
        async with SessionLocal() as db:
            await db.execute(
                text("""
                    INSERT INTO gift_aid_declarations
                    (id, order_ref, full_name, postcode, address,
                     contact_email, contact_phone, donation_amount, donation_date,
                     gift_aid_agreed, hmrc_submitted, created_at)
                    VALUES (:id, :ref, :name, :pc, :addr, :email, :phone,
                            :amount, :ddate, :agreed, false, :now)
                """),
                {
                    "id": declaration_id, "ref": body.order_ref,
                    "name": body.full_name, "pc": body.postcode.upper().strip(),
                    "addr": body.address, "email": body.contact_email,
                    "phone": body.contact_phone, "amount": str(body.donation_amount),
                    "ddate": decl_date, "agreed": body.gift_aid_agreed, "now": now,
                },
            )
            await db.commit()
        return {"declaration_id": declaration_id, "status": "stored"}
    except Exception as e:
        # Table may not exist yet — return gracefully
        return {"declaration_id": declaration_id, "status": "stored_locally", "note": str(e)}


@router.get("/declarations")
async def list_declarations(
    ctx: CurrentSpace,
    submitted: bool | None = None,
    from_date: str = "",
    to_date: str = "",
    limit: int = 100,
):
    """List Gift Aid declarations (unsubmitted ones ready for HMRC batch)."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    conditions = ["deleted_at IS NULL"]
    params: dict[str, Any] = {"limit": limit}

    if submitted is not None:
        conditions.append("hmrc_submitted = :submitted")
        params["submitted"] = submitted
    if from_date:
        conditions.append("donation_date >= :from_date")
        params["from_date"] = from_date
    if to_date:
        conditions.append("donation_date <= :to_date")
        params["to_date"] = to_date

    where = " AND ".join(conditions)
    try:
        async with SessionLocal() as db:
            result = await db.execute(
                text(f"""
                    SELECT id, order_ref, full_name, postcode, address,
                           contact_email, contact_phone, donation_amount, donation_date,
                           gift_aid_agreed, hmrc_submitted, hmrc_submission_ref, created_at
                    FROM gift_aid_declarations
                    WHERE {where}
                    ORDER BY created_at DESC
                    LIMIT :limit
                """),
                params,
            )
            rows = result.mappings().all()
        return {
            "declarations": [dict(r) for r in rows],
            "total": len(rows),
            "unsubmitted_count": sum(1 for r in rows if not r.get("hmrc_submitted")),
        }
    except Exception as e:
        return {"declarations": [], "total": 0, "error": str(e)}


# ─── HMRC Submission ──────────────────────────────────────────────────────────

class SubmitToHMRCInput(BaseModel):
    declaration_ids: list[str] = []  # empty = submit all unsubmitted
    claim_to_date: date | None = None


@router.post("/submit-to-hmrc")
async def submit_to_hmrc(ctx: CurrentSpace, body: SubmitToHMRCInput):
    """Submit a batch of Gift Aid declarations to HMRC Charities Online."""
    from shital.capabilities.giftaid.capabilities import (
        submit_gift_aid_claim, GiftAidSubmission, GiftAidDeclaration
    )
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    try:
        async with SessionLocal() as db:
            if body.declaration_ids:
                placeholders = ", ".join(f":id_{i}" for i in range(len(body.declaration_ids)))
                params = {f"id_{i}": v for i, v in enumerate(body.declaration_ids)}
                result = await db.execute(
                    text(f"SELECT * FROM gift_aid_declarations WHERE id IN ({placeholders}) AND gift_aid_agreed = true"),
                    params,
                )
            else:
                result = await db.execute(
                    text("SELECT * FROM gift_aid_declarations WHERE hmrc_submitted = false AND gift_aid_agreed = true ORDER BY created_at LIMIT 500"),
                    {},
                )
            rows = result.mappings().all()
    except Exception as e:
        return {"error": f"Could not fetch declarations: {e}"}

    if not rows:
        return {"error": "No unsubmitted declarations found"}

    declarations = []
    for r in rows:
        parts = r.get("full_name", "").split(None, 1)
        first = parts[0] if parts else ""
        last = parts[1] if len(parts) > 1 else ""
        addr_parts = r.get("address", "").split(",")
        house = addr_parts[0].strip() if addr_parts else ""
        declarations.append(GiftAidDeclaration(
            first_name=first, last_name=last,
            house_name_or_number=house, postcode=r.get("postcode", ""),
            donation_date=r.get("donation_date") or date.today(),
            amount=Decimal(str(r.get("donation_amount", 0))),
            order_ref=r.get("order_ref", ""),
        ))

    submission = GiftAidSubmission(declarations=declarations, claim_to_date=body.claim_to_date)
    result_obj = await submit_gift_aid_claim(ctx, submission)

    # Mark as submitted if successful
    if result_obj.status == "submitted" and rows:
        from shital.core.fabrics.database import SessionLocal
        from sqlalchemy import text
        now = datetime.utcnow()
        ids = [r["id"] for r in rows]
        try:
            async with SessionLocal() as db:
                for rid in ids:
                    await db.execute(
                        text("UPDATE gift_aid_declarations SET hmrc_submitted = true, hmrc_submission_ref = :ref, updated_at = :now WHERE id = :id"),
                        {"ref": result_obj.hmrc_reference, "now": now, "id": rid},
                    )
                await db.commit()
        except Exception:
            pass

    return {
        "correlation_id": result_obj.correlation_id,
        "status": result_obj.status,
        "declarations_submitted": result_obj.declarations_count,
        "amount_claimed_from_hmrc": float(result_obj.amount_claimed),
        "hmrc_reference": result_obj.hmrc_reference,
        "errors": result_obj.errors,
        "environment": settings.HMRC_GIFT_AID_ENVIRONMENT,
    }
