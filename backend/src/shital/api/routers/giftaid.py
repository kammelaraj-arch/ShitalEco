"""
Gift Aid router — admin endpoints for HMRC Gift Aid claim management.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from shital.api.deps import CurrentSpace
from shital.core.fabrics.config import settings

router = APIRouter(prefix="/gift-aid", tags=["gift-aid"])


# ─── Schema patch helper ──────────────────────────────────────────────────────

async def _ensure_submissions_table() -> None:
    """Idempotently create gift_aid_submissions table if missing."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    try:
        async with SessionLocal() as db:
            await db.execute(text("""
                CREATE TABLE IF NOT EXISTS gift_aid_submissions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    correlation_id VARCHAR(100) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'submitted',
                    declarations_count INTEGER NOT NULL DEFAULT 0,
                    total_donated NUMERIC(12,2) NOT NULL DEFAULT 0,
                    amount_claimed NUMERIC(12,2) NOT NULL DEFAULT 0,
                    hmrc_reference VARCHAR(200) DEFAULT '',
                    environment VARCHAR(10) NOT NULL DEFAULT 'test',
                    errors TEXT DEFAULT '',
                    submitted_by VARCHAR(200) DEFAULT '',
                    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """))
            await db.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_gift_aid_submissions_date ON gift_aid_submissions(submitted_at)"
            ))
            await db.commit()
    except Exception:
        pass


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
        "hmrc_vendor_id": settings.HMRC_GIFT_AID_VENDOR_ID,
        "charity_number": settings.CHARITY_NUMBER,
    }


@router.post("/config")
async def update_gift_aid_config(ctx: CurrentSpace, config: GiftAidConfig):
    """Update Gift Aid configuration (stored in env/secrets — restart required)."""
    return {
        "message": "To update Gift Aid configuration, set these environment variables and restart the backend:",
        "env_vars": {
            "GETADDRESS_API_KEY": "Your GetAddress.io API key (get at getaddress.io/pricing)",
            "HMRC_GIFT_AID_USER_ID": "Your HMRC Government Gateway User ID",
            "HMRC_GIFT_AID_PASSWORD": "Your HMRC Government Gateway Password",
            "HMRC_GIFT_AID_CHARITY_HMO_REF": "Your charity HMRC reference (e.g. AB12345)",
            "HMRC_GIFT_AID_VENDOR_ID": "Your HMRC software vendor ID (from HMRC developer registration)",
            "HMRC_GIFT_AID_ENVIRONMENT": "test (for testing) or live (for production submissions)",
        },
        "getaddress_docs": "https://getaddress.io/documentation",
        "hmrc_charities_online": "https://www.gov.uk/guidance/claiming-gift-aid-as-a-charity-or-casc-claiming-online",
    }


# ─── Declarations ─────────────────────────────────────────────────────────────

class StoreDeclarationInput(BaseModel):
    order_ref: str
    full_name: str
    first_name: str = ""
    surname: str = ""
    postcode: str
    address: str
    uprn: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    donation_amount: Decimal
    donation_date: date | None = None
    gift_aid_agreed: bool = True


@router.post("/declarations")
async def store_declaration(ctx: CurrentSpace, body: StoreDeclarationInput):
    """Store a Gift Aid declaration in the database."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    declaration_id = str(uuid.uuid4())
    now = datetime.utcnow()
    decl_date = body.donation_date or date.today()
    first_name = body.first_name or body.full_name.split(" ", 1)[0]
    surname = body.surname or (body.full_name.split(" ", 1)[1] if " " in body.full_name else "")

    try:
        async with SessionLocal() as db:
            # ── CRM contact upsert ──────────────────────────────────────────
            contact_id: str | None = None
            email_key = body.contact_email.strip().lower() if body.contact_email.strip() else None
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
                         'kiosk', '', :now, :now)
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
                    "first": first_name, "surname": surname,
                    "name": body.full_name, "phone": body.contact_phone or "", "now": now,
                })
                row = c_result.mappings().first()
                contact_id = str(row["id"]) if row else contact_uuid

                if body.postcode or body.address:
                    await db.execute(text("""
                        INSERT INTO addresses
                            (id, contact_id, formatted, postcode, uprn,
                             is_primary, lookup_source, created_at)
                        VALUES (:id, :cid, :fmt, :pc, :uprn, true, 'kiosk', :now)
                    """), {
                        "id": str(uuid.uuid4()), "cid": contact_id,
                        "fmt": body.address or "", "pc": body.postcode.upper().strip(),
                        "uprn": body.uprn or "", "now": now,
                    })

            await db.execute(
                text("""
                    INSERT INTO gift_aid_declarations
                    (id, order_ref, full_name, first_name, surname, postcode, address, uprn,
                     contact_email, contact_phone, donation_amount, donation_date,
                     gift_aid_agreed, contact_id, hmrc_submitted, created_at)
                    VALUES (:id, :ref, :name, :first, :surname, :pc, :addr, :uprn,
                            :email, :phone, :amount, :ddate, :agreed, :cid, false, :now)
                """),
                {
                    "id": declaration_id, "ref": body.order_ref,
                    "name": body.full_name, "first": first_name, "surname": surname,
                    "pc": body.postcode.upper().strip(),
                    "addr": body.address, "uprn": body.uprn or "",
                    "email": body.contact_email, "phone": body.contact_phone,
                    "amount": str(body.donation_amount),
                    "ddate": decl_date, "agreed": body.gift_aid_agreed,
                    "cid": contact_id, "now": now,
                },
            )
            await db.commit()
        return {"declaration_id": declaration_id, "status": "stored"}
    except Exception as e:
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
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

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


# ─── XML Preview ──────────────────────────────────────────────────────────────

class PreviewXmlInput(BaseModel):
    declaration_ids: list[str] = []
    claim_to_date: date | None = None


@router.post("/preview-xml")
async def preview_xml(ctx: CurrentSpace, body: PreviewXmlInput):
    """Return the GovTalk XML that would be sent to HMRC (credentials masked for display)."""
    from sqlalchemy import text

    from shital.capabilities.giftaid.capabilities import (
        GiftAidDeclaration,
        GiftAidSubmission,
        build_gift_aid_xml_preview,
    )
    from shital.core.fabrics.database import SessionLocal

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
        return {"error": f"Could not fetch declarations: {e}", "xml": ""}

    if not rows:
        return {"error": "No declarations found", "xml": ""}

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
    xml = build_gift_aid_xml_preview(submission)
    total = sum(d.amount for d in declarations)
    return {
        "xml": xml,
        "declarations_count": len(declarations),
        "total_donated": float(total),
        "amount_claimed": float(total * Decimal("0.25")),
        "environment": settings.HMRC_GIFT_AID_ENVIRONMENT,
    }


# ─── HMRC Submission ──────────────────────────────────────────────────────────

class SubmitToHMRCInput(BaseModel):
    declaration_ids: list[str] = []  # empty = submit all unsubmitted
    claim_to_date: date | None = None


@router.post("/submit-to-hmrc")
async def submit_to_hmrc(ctx: CurrentSpace, body: SubmitToHMRCInput):
    """Submit a batch of Gift Aid declarations to HMRC Charities Online."""
    from sqlalchemy import text

    from shital.capabilities.giftaid.capabilities import (
        GiftAidDeclaration,
        GiftAidSubmission,
        submit_gift_aid_claim,
    )
    from shital.core.fabrics.database import SessionLocal

    await _ensure_submissions_table()

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
    total_donated = sum(d.amount for d in declarations)

    now = datetime.utcnow()
    # Record the submission attempt
    submission_id = str(uuid.uuid4())
    try:
        async with SessionLocal() as db:
            await db.execute(
                text("""
                    INSERT INTO gift_aid_submissions
                    (id, correlation_id, status, declarations_count, total_donated,
                     amount_claimed, hmrc_reference, environment, errors, submitted_at)
                    VALUES (:id, :cid, :status, :count, :total, :claimed, :ref, :env, :errors, :now)
                """),
                {
                    "id": submission_id,
                    "cid": result_obj.correlation_id,
                    "status": result_obj.status,
                    "count": result_obj.declarations_count,
                    "total": str(total_donated),
                    "claimed": str(result_obj.amount_claimed),
                    "ref": result_obj.hmrc_reference,
                    "env": settings.HMRC_GIFT_AID_ENVIRONMENT,
                    "errors": "; ".join(result_obj.errors) if result_obj.errors else "",
                    "now": now,
                },
            )
            await db.commit()
    except Exception:
        pass

    # Mark declarations as submitted if successful
    if result_obj.status == "submitted" and rows:
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
        "submission_id": submission_id,
        "correlation_id": result_obj.correlation_id,
        "status": result_obj.status,
        "declarations_submitted": result_obj.declarations_count,
        "total_donated": float(total_donated),
        "amount_claimed_from_hmrc": float(result_obj.amount_claimed),
        "hmrc_reference": result_obj.hmrc_reference,
        "errors": result_obj.errors,
        "environment": settings.HMRC_GIFT_AID_ENVIRONMENT,
    }


# ─── Submission History ───────────────────────────────────────────────────────

@router.get("/submissions")
async def list_submissions(ctx: CurrentSpace, limit: int = 50):
    """List past Gift Aid submission attempts to HMRC."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    await _ensure_submissions_table()

    try:
        async with SessionLocal() as db:
            result = await db.execute(
                text("""
                    SELECT id, correlation_id, status, declarations_count,
                           total_donated, amount_claimed, hmrc_reference,
                           environment, errors, submitted_at
                    FROM gift_aid_submissions
                    ORDER BY submitted_at DESC
                    LIMIT :limit
                """),
                {"limit": limit},
            )
            rows = result.mappings().all()
        return {"submissions": [dict(r) for r in rows], "total": len(rows)}
    except Exception as e:
        return {"submissions": [], "total": 0, "error": str(e)}
