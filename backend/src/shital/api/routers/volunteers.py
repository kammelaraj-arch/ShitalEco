"""Volunteer registration — public registration form + admin review workflow.

Mirrors the SHITAL paper Volunteer Registration Form V1.2: personal details,
emergency contact, age range, health, criminal-record declaration (the role
is exempt from Rehab-of-Offenders Act 1974), two character referees, skills
checklist, availability matrix, and three separate declaration signatures
(activity declaration, criminal-record declaration, confidentiality NDA).

Submissions land as PENDING. Admins (acting as trustees per the process doc
"Volunteer_registration_process_for_the_Staff_Trustees") list, view, and
approve or reject — no public lookup of pending records.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["volunteers"])


async def _send_registration_emails(
    applicant_email: str, applicant_name: str, reference: str, branch_id: str,
) -> None:
    """Best-effort confirmation + safeguarding notification. Never raises:
    registration is already committed by the time we're called, and a failed
    SMTP (misconfigured creds, network blip) must not surface as a 5xx to
    the applicant."""
    import structlog

    from shital.api.routers.email_templates import (
        RELATED_VOLUNTEER,
        send_raw_email,
        send_template,
    )
    from shital.core.fabrics.config import settings

    log = structlog.get_logger()
    name = applicant_name.strip() or "there"

    # Applicant confirmation — rendered from the `volunteer_confirmation`
    # email template so trustees can edit the wording in Admin → Email
    # Templates without a deploy. Logged to sent_emails (audit + resend).
    if applicant_email and "@" in applicant_email:
        try:
            await send_template(
                "volunteer_confirmation", applicant_email,
                {"name": name, "reference": reference, "branch_name": branch_id or "SHITAL"},
                related_type=RELATED_VOLUNTEER, related_id=reference,
                triggered_by="volunteer-registration",
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("volunteer_confirm_email_failed", reference=reference, error=str(exc))

    # Safeguarding / trustee notification — audited via the same path.
    notify_to = (settings.VOLUNTEER_NOTIFY_EMAIL or settings.OFFICE365_EMAIL or "").strip()
    if notify_to and "@" in notify_to:
        s_subject = f"New volunteer application — {reference} ({applicant_name})"
        s_html = (
            "<p>A new volunteer application has been submitted.</p><ul>"
            f"<li><strong>Reference:</strong> {reference}</li>"
            f"<li><strong>Name:</strong> {applicant_name}</li>"
            f"<li><strong>Email:</strong> {applicant_email}</li>"
            f"<li><strong>Branch:</strong> {branch_id or '—'}</li></ul>"
            "<p>Review in Admin → Volunteers.</p>"
        )
        s_text = (
            f"New volunteer application {reference}\n"
            f"Name:   {applicant_name}\nEmail:  {applicant_email}\nBranch: {branch_id or '—'}\n"
        )
        try:
            await send_raw_email(
                to_email=notify_to, subject=s_subject, html_body=s_html, text_body=s_text,
                related_type=RELATED_VOLUNTEER, related_id=reference,
                triggered_by="volunteer-registration",
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("volunteer_notify_email_failed", reference=reference, error=str(exc))


# ─── Models ───────────────────────────────────────────────────────────────────

class VolunteerRegistration(BaseModel):
    """Public registration payload — every field on the paper form."""

    # Personal
    title: str = ""
    first_names: str
    last_name: str
    address: str = ""
    postcode: str = ""
    mobile: str = ""
    phone: str = ""
    email: str
    age_range: str = ""

    # Emergency contact
    ec_title: str = ""
    ec_full_name: str = ""
    ec_email: str = ""
    ec_mobile: str = ""
    ec_phone: str = ""
    ec_address: str = ""
    ec_postcode: str = ""

    # Health
    has_health_restrictions: bool = False
    health_notes: str = ""

    # Police-check declaration
    has_criminal_record: bool = False
    criminal_record_details: str = ""

    # Referee 1
    ref1_title: str = ""
    ref1_first_names: str = ""
    ref1_last_name: str = ""
    ref1_address: str = ""
    ref1_postcode: str = ""
    ref1_mobile: str = ""
    ref1_phone: str = ""
    ref1_email: str = ""

    # Referee 2
    ref2_title: str = ""
    ref2_first_names: str = ""
    ref2_last_name: str = ""
    ref2_address: str = ""
    ref2_postcode: str = ""
    ref2_mobile: str = ""
    ref2_phone: str = ""
    ref2_email: str = ""

    # Skills + availability — JSONB on the wire and at rest
    skills: dict[str, list[str]] = Field(default_factory=dict)
    skills_other_text: str = ""
    availability: dict[str, Any] = Field(default_factory=dict)
    availability_pattern: str = ""

    # Consents — three separate declarations on the paper form, all required
    declaration_agreed: bool = False
    confidentiality_agreed: bool = False
    marketing_consent: bool = False

    # Branch the application is destined for (e.g. wembley, main)
    branch_id: str = "main"

    # Where the volunteer wants to help — list of branch codes, with the
    # literal "remote" as a sentinel for online/remote-only volunteering.
    preferred_branches: list[str] = Field(default_factory=list)


def _ref_ok(first: str, last: str, email: str, mobile: str, phone: str) -> bool:
    return bool(first.strip() and last.strip() and (email.strip() or mobile.strip() or phone.strip()))


def _ec_ok(v: VolunteerRegistration) -> bool:
    return bool(v.ec_full_name.strip() and (v.ec_mobile.strip() or v.ec_phone.strip()))


def _compute_stage(v: VolunteerRegistration) -> int:
    """Volunteer progression ladder:
      0 · Registered      — basics only (expression of interest)
      1 · One-Day Seva    — + emergency contact (can help at a supervised seva)
      2 · Full Volunteer  — + two references + confidentiality undertaking (DBS)
    Cumulative: stage 2 implies stage 1 (emergency contact) is also complete."""
    full = (
        _ref_ok(v.ref1_first_names, v.ref1_last_name, v.ref1_email, v.ref1_mobile, v.ref1_phone)
        and _ref_ok(v.ref2_first_names, v.ref2_last_name, v.ref2_email, v.ref2_mobile, v.ref2_phone)
        and v.confidentiality_agreed
    )
    if _ec_ok(v) and full:
        return 2
    if _ec_ok(v):
        return 1
    return 0


def _validate(v: VolunteerRegistration) -> list[str]:
    """Stage-0 (express sign-up) validation only — the volunteer ladder collects
    the heavier safeguarding data (emergency contact → Stage 1; references + DBS →
    Stage 2) progressively, so those are NOT required to register. Return list of
    error messages (empty = ok)."""
    errs: list[str] = []
    if not v.first_names.strip():
        errs.append("First name is required")
    if not v.last_name.strip():
        errs.append("Last name is required")
    if not v.email.strip() or "@" not in v.email:
        errs.append("A valid email is required")
    if not (v.mobile.strip() or v.phone.strip()):
        errs.append("At least one contact number (mobile or phone) is required")
    if v.age_range not in {"18-25", "26-35", "36-45", "46-55", "55+"}:
        errs.append("Age range is required (minimum age for volunteers is 18)")
    if not v.preferred_branches:
        errs.append("Please tell us where you'd like to volunteer (at least one branch or remote)")
    if not v.declaration_agreed:
        errs.append("Please agree to be contacted about volunteering")
    # If the applicant DID start the heavier sections, keep their internal
    # consistency (but never block the express Stage-0 path).
    if v.has_health_restrictions and not v.health_notes.strip():
        errs.append("Please describe how we can help with your health restrictions")
    if v.has_criminal_record and not v.criminal_record_details.strip():
        errs.append("Please provide the criminal-record details requested")
    return errs


def _gen_reference() -> str:
    """VOL-NNNNNN — short 8-char applicant-friendly reference.

    Drops the SHITAL- prefix and the embedded date (the date lives on
    `created_at`; trustees can sort by date via the admin UI). 6 hex
    digits = 16M unique values, plenty for SHITAL's volunteer pipeline.
    """
    return f"VOL-{uuid.uuid4().hex[:6].upper()}"


def _gen_draft_token() -> str:
    """44-char URL-safe random — opaque resume token. The applicant
    stashes it in their URL hash; we use it as a primary lookup key."""
    import secrets
    return secrets.token_urlsafe(32)


_stage_col_ready = False


async def _ensure_stage_column() -> None:
    """Idempotent: add the volunteer-ladder `stage` column if it's missing.
    Cached after first success so we don't ALTER on every request."""
    global _stage_col_ready
    if _stage_col_ready:
        return
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text(
            "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS stage SMALLINT NOT NULL DEFAULT 0"))
        await db.execute(text(
            "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS ec_relationship VARCHAR(80) NOT NULL DEFAULT ''"))
        # Backfill existing rows (submitted before the ladder) so trustees see
        # the right stage. Emergency contact → 1; + both references + NDA → 2.
        await db.execute(text("""
            UPDATE volunteers SET stage = CASE
                WHEN ec_full_name <> '' AND (ec_mobile <> '' OR ec_phone <> '')
                     AND ref1_first_names <> '' AND ref1_last_name <> ''
                     AND ref2_first_names <> '' AND ref2_last_name <> ''
                     AND confidentiality_agreed THEN 2
                WHEN ec_full_name <> '' AND (ec_mobile <> '' OR ec_phone <> '') THEN 1
                ELSE 0 END
            WHERE stage = 0
        """))
        await db.commit()
    _stage_col_ready = True


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )


# ─── Public endpoint — registration ───────────────────────────────────────────

@router.post("/service/volunteers/register")
async def register_volunteer(
    body: VolunteerRegistration, request: Request,
) -> dict[str, Any]:
    """Public volunteer registration. Creates a PENDING row and returns a
    reference number the applicant can quote when chasing the application."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    errs = _validate(body)
    if errs:
        # Match the error envelope used by HR / projects routers so the admin
        # form (and the public form) can surface each error individually.
        raise HTTPException(status_code=400, detail={"errors": errs})

    await _ensure_stage_column()
    reference = _gen_reference()
    now = datetime.now(UTC)
    submitted_ip = (request.client.host if request.client else "")[:45]
    user_agent = (request.headers.get("user-agent") or "")[:500]
    email_key = body.email.strip().lower()

    async with SessionLocal() as db:
        # Upsert the volunteer as a CRM contact first. Same pattern as the
        # PayPal capture flow — a person who later donates (or has already)
        # ends up sharing one contacts row, deduped by email. Sensitive
        # volunteer-only fields (criminal record, health, references) stay
        # on the volunteers row; contacts only holds identity + consents.
        contact_uuid = str(uuid.uuid4())
        c_result = await db.execute(text("""
            INSERT INTO contacts
                (id, email, first_name, surname, full_name, phone,
                 gdpr_consent, gdpr_consented_at, tac_consent, tac_consented_at,
                 first_source, first_branch_id, created_at, updated_at)
            VALUES
                (:id, :email, :first, :surname, :name, :phone,
                 true, :now, :tac, :tac_at,
                 'volunteer-registration', :branch, :now, :now)
            ON CONFLICT (email) DO UPDATE SET
                first_name        = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
                surname           = COALESCE(NULLIF(EXCLUDED.surname,''),    contacts.surname),
                full_name         = COALESCE(NULLIF(EXCLUDED.full_name,''),  contacts.full_name),
                phone             = COALESCE(NULLIF(EXCLUDED.phone,''),      contacts.phone),
                gdpr_consent      = true,
                gdpr_consented_at = COALESCE(contacts.gdpr_consented_at, EXCLUDED.gdpr_consented_at),
                tac_consent       = (contacts.tac_consent OR EXCLUDED.tac_consent),
                tac_consented_at  = COALESCE(contacts.tac_consented_at,  EXCLUDED.tac_consented_at),
                updated_at        = EXCLUDED.updated_at
            RETURNING id
        """), {
            "id": contact_uuid, "email": email_key,
            "first": body.first_names.strip(), "surname": body.last_name.strip(),
            "name": f"{body.first_names.strip()} {body.last_name.strip()}".strip(),
            "phone": body.mobile.strip() or body.phone.strip(),
            "tac": body.confidentiality_agreed,
            "tac_at": now if body.confidentiality_agreed else None,
            "branch": body.branch_id, "now": now,
        })
        c_row = c_result.mappings().first()
        contact_id = str(c_row["id"]) if c_row else contact_uuid

        # Address linked to the contact (so future donate/volunteer flows
        # can prefill). Matches PayPal capture: same insert, dedup index
        # (addresses_unique_contact_pc_house) handles repeat applications.
        # The unique index is partial (WHERE contact_id IS NOT NULL) so the
        # ON CONFLICT must repeat that predicate for inference to match.
        if body.postcode.strip() or body.address.strip():
            _house = (body.address or "").split(",")[0].strip()[:50]
            await db.execute(text("""
                INSERT INTO addresses
                    (id, contact_id, formatted, postcode, house_number, uprn,
                     is_primary, lookup_source, created_at)
                VALUES (:id, :cid, :fmt, :pc, :house, '', true, 'volunteer-registration', :now)
                ON CONFLICT (contact_id, postcode, house_number)
                    WHERE contact_id IS NOT NULL DO NOTHING
            """), {
                "id": str(uuid.uuid4()), "cid": contact_id,
                "fmt": body.address, "pc": body.postcode.upper(),
                "house": _house, "now": now,
            })

        await db.execute(text("""
            INSERT INTO volunteers (
                id, reference_number, contact_id,
                title, first_names, last_name, address, postcode,
                mobile, phone, email, age_range,
                ec_title, ec_full_name, ec_email, ec_mobile, ec_phone,
                ec_address, ec_postcode,
                has_health_restrictions, health_notes,
                has_criminal_record, criminal_record_details,
                ref1_title, ref1_first_names, ref1_last_name,
                ref1_address, ref1_postcode, ref1_mobile, ref1_phone, ref1_email,
                ref2_title, ref2_first_names, ref2_last_name,
                ref2_address, ref2_postcode, ref2_mobile, ref2_phone, ref2_email,
                skills, skills_other_text, availability, availability_pattern,
                declaration_signed_at, confidentiality_agreed, marketing_consent,
                status, stage, branch_id, preferred_branches,
                submitted_ip, user_agent,
                created_at, updated_at
            ) VALUES (
                :id, :reference, :contact_id,
                :title, :first_names, :last_name, :address, :postcode,
                :mobile, :phone, :email, :age_range,
                :ec_title, :ec_full_name, :ec_email, :ec_mobile, :ec_phone,
                :ec_address, :ec_postcode,
                :has_health_restrictions, :health_notes,
                :has_criminal_record, :criminal_record_details,
                :ref1_title, :ref1_first_names, :ref1_last_name,
                :ref1_address, :ref1_postcode, :ref1_mobile, :ref1_phone, :ref1_email,
                :ref2_title, :ref2_first_names, :ref2_last_name,
                :ref2_address, :ref2_postcode, :ref2_mobile, :ref2_phone, :ref2_email,
                CAST(:skills AS jsonb), :skills_other_text,
                CAST(:availability AS jsonb), :availability_pattern,
                :declaration_signed_at, :confidentiality_agreed, :marketing_consent,
                'PENDING', :stage, :branch_id, CAST(:preferred_branches AS jsonb),
                :submitted_ip, :user_agent,
                :now, :now
            )
        """), {
            "stage": _compute_stage(body),
            "id": str(uuid.uuid4()), "reference": reference,
            "contact_id": contact_id,
            "title": body.title, "first_names": body.first_names.strip(),
            "last_name": body.last_name.strip(), "address": body.address,
            "postcode": body.postcode, "mobile": body.mobile, "phone": body.phone,
            "email": email_key, "age_range": body.age_range,
            "ec_title": body.ec_title, "ec_full_name": body.ec_full_name,
            "ec_email": body.ec_email, "ec_mobile": body.ec_mobile,
            "ec_phone": body.ec_phone, "ec_address": body.ec_address,
            "ec_postcode": body.ec_postcode,
            "has_health_restrictions": body.has_health_restrictions,
            "health_notes": body.health_notes,
            "has_criminal_record": body.has_criminal_record,
            "criminal_record_details": body.criminal_record_details,
            "ref1_title": body.ref1_title, "ref1_first_names": body.ref1_first_names,
            "ref1_last_name": body.ref1_last_name, "ref1_address": body.ref1_address,
            "ref1_postcode": body.ref1_postcode, "ref1_mobile": body.ref1_mobile,
            "ref1_phone": body.ref1_phone, "ref1_email": body.ref1_email,
            "ref2_title": body.ref2_title, "ref2_first_names": body.ref2_first_names,
            "ref2_last_name": body.ref2_last_name, "ref2_address": body.ref2_address,
            "ref2_postcode": body.ref2_postcode, "ref2_mobile": body.ref2_mobile,
            "ref2_phone": body.ref2_phone, "ref2_email": body.ref2_email,
            "skills": _jsonify(body.skills),
            "skills_other_text": body.skills_other_text,
            "availability": _jsonify(body.availability),
            "availability_pattern": body.availability_pattern,
            "declaration_signed_at": now,
            "confidentiality_agreed": body.confidentiality_agreed,
            "marketing_consent": body.marketing_consent,
            "branch_id": body.branch_id,
            "preferred_branches": _jsonify(
                [b.strip().lower() for b in body.preferred_branches if b.strip()]
            ),
            "submitted_ip": submitted_ip,
            "user_agent": user_agent, "now": now,
        })
        await db.commit()

    # Best-effort: SMTP failures must not 5xx a committed application.
    await _send_registration_emails(
        applicant_email=email_key,
        applicant_name=f"{body.first_names.strip()} {body.last_name.strip()}".strip(),
        reference=reference,
        branch_id=body.branch_id,
    )

    # Auto-add to the branch's default seva group (mandatory) so admins can
    # message all of a branch's volunteers. Best-effort — never blocks signup.
    try:
        from shital.api.routers.seva import add_volunteer_to_branch_group
        await add_volunteer_to_branch_group(
            body.branch_id,
            f"{body.first_names.strip()} {body.last_name.strip()}".strip(),
            email_key,
            (body.mobile or body.phone or "").strip(),
        )
    except Exception:  # noqa: BLE001
        pass

    return {
        "success": True,
        "reference_number": reference,
        "stage": _compute_stage(body),
        "message": (
            "Thank you. You're registered. "
            "We've sent a confirmation to your email. "
            "Complete the next steps whenever you're ready to unlock more seva."
        ),
    }


class AdvanceBody(BaseModel):
    """Progressive-enrichment payload for the volunteer ladder. The applicant
    proves ownership with reference_number + email, then adds the heavier
    safeguarding fields to climb from Stage 0 → 1 (emergency contact) → 2
    (two references + confidentiality undertaking). Only non-empty fields
    overwrite what's already stored, so partial saves accumulate."""
    reference_number: str = ""
    email: str = ""
    ec_title: str = ""
    ec_full_name: str = ""
    ec_relationship: str = ""
    ec_email: str = ""
    ec_mobile: str = ""
    ec_phone: str = ""
    ec_address: str = ""
    ec_postcode: str = ""
    has_health_restrictions: bool = False
    health_notes: str = ""
    has_criminal_record: bool = False
    criminal_record_details: str = ""
    ref1_title: str = ""
    ref1_first_names: str = ""
    ref1_last_name: str = ""
    ref1_address: str = ""
    ref1_postcode: str = ""
    ref1_mobile: str = ""
    ref1_phone: str = ""
    ref1_email: str = ""
    ref2_title: str = ""
    ref2_first_names: str = ""
    ref2_last_name: str = ""
    ref2_address: str = ""
    ref2_postcode: str = ""
    ref2_mobile: str = ""
    ref2_phone: str = ""
    ref2_email: str = ""
    confidentiality_agreed: bool = False


@router.post("/service/volunteers/advance")
async def advance_volunteer(body: AdvanceBody) -> dict[str, Any]:
    """Add emergency-contact / references to an existing application to climb
    the volunteer ladder. Ownership = reference_number + email match."""
    import types

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    ref = body.reference_number.strip()
    email_key = body.email.strip().lower()
    if not ref or not email_key:
        raise HTTPException(status_code=400, detail={"errors": ["Reference and email are required"]})

    await _ensure_stage_column()
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT ec_full_name, ec_mobile, ec_phone,
                   ref1_first_names, ref1_last_name, ref1_email, ref1_mobile, ref1_phone,
                   ref2_first_names, ref2_last_name, ref2_email, ref2_mobile, ref2_phone,
                   confidentiality_agreed
            FROM volunteers
            WHERE reference_number = :ref AND LOWER(email) = :email
        """), {"ref": ref, "email": email_key})).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail={"errors": [
                "No application found for that reference and email"]})

        # Merge: provided non-empty value wins, else keep what's stored.
        def pick(new: str, old: str | None) -> str:
            return new.strip() or (old or "")
        merged = types.SimpleNamespace(
            ec_full_name=pick(body.ec_full_name, row["ec_full_name"]),
            ec_mobile=pick(body.ec_mobile, row["ec_mobile"]),
            ec_phone=pick(body.ec_phone, row["ec_phone"]),
            ref1_first_names=pick(body.ref1_first_names, row["ref1_first_names"]),
            ref1_last_name=pick(body.ref1_last_name, row["ref1_last_name"]),
            ref1_email=pick(body.ref1_email, row["ref1_email"]),
            ref1_mobile=pick(body.ref1_mobile, row["ref1_mobile"]),
            ref1_phone=pick(body.ref1_phone, row["ref1_phone"]),
            ref2_first_names=pick(body.ref2_first_names, row["ref2_first_names"]),
            ref2_last_name=pick(body.ref2_last_name, row["ref2_last_name"]),
            ref2_email=pick(body.ref2_email, row["ref2_email"]),
            ref2_mobile=pick(body.ref2_mobile, row["ref2_mobile"]),
            ref2_phone=pick(body.ref2_phone, row["ref2_phone"]),
            confidentiality_agreed=bool(row["confidentiality_agreed"]) or body.confidentiality_agreed,
        )
        stage = _compute_stage(merged)  # type: ignore[arg-type]

        await db.execute(text("""
            UPDATE volunteers SET
                ec_title = COALESCE(NULLIF(:ec_title,''), ec_title),
                ec_full_name = COALESCE(NULLIF(:ec_full_name,''), ec_full_name),
                ec_relationship = COALESCE(NULLIF(:ec_relationship,''), ec_relationship),
                ec_email = COALESCE(NULLIF(:ec_email,''), ec_email),
                ec_mobile = COALESCE(NULLIF(:ec_mobile,''), ec_mobile),
                ec_phone = COALESCE(NULLIF(:ec_phone,''), ec_phone),
                ec_address = COALESCE(NULLIF(:ec_address,''), ec_address),
                ec_postcode = COALESCE(NULLIF(:ec_postcode,''), ec_postcode),
                has_health_restrictions = :has_health_restrictions,
                health_notes = COALESCE(NULLIF(:health_notes,''), health_notes),
                has_criminal_record = :has_criminal_record,
                criminal_record_details = COALESCE(NULLIF(:criminal_record_details,''), criminal_record_details),
                ref1_title = COALESCE(NULLIF(:ref1_title,''), ref1_title),
                ref1_first_names = COALESCE(NULLIF(:ref1_first_names,''), ref1_first_names),
                ref1_last_name = COALESCE(NULLIF(:ref1_last_name,''), ref1_last_name),
                ref1_address = COALESCE(NULLIF(:ref1_address,''), ref1_address),
                ref1_postcode = COALESCE(NULLIF(:ref1_postcode,''), ref1_postcode),
                ref1_mobile = COALESCE(NULLIF(:ref1_mobile,''), ref1_mobile),
                ref1_phone = COALESCE(NULLIF(:ref1_phone,''), ref1_phone),
                ref1_email = COALESCE(NULLIF(:ref1_email,''), ref1_email),
                ref2_title = COALESCE(NULLIF(:ref2_title,''), ref2_title),
                ref2_first_names = COALESCE(NULLIF(:ref2_first_names,''), ref2_first_names),
                ref2_last_name = COALESCE(NULLIF(:ref2_last_name,''), ref2_last_name),
                ref2_address = COALESCE(NULLIF(:ref2_address,''), ref2_address),
                ref2_postcode = COALESCE(NULLIF(:ref2_postcode,''), ref2_postcode),
                ref2_mobile = COALESCE(NULLIF(:ref2_mobile,''), ref2_mobile),
                ref2_phone = COALESCE(NULLIF(:ref2_phone,''), ref2_phone),
                ref2_email = COALESCE(NULLIF(:ref2_email,''), ref2_email),
                confidentiality_agreed = (confidentiality_agreed OR :confidentiality_agreed),
                stage = :stage,
                updated_at = NOW()
            WHERE reference_number = :ref AND LOWER(email) = :email
        """), {
            "ec_title": body.ec_title, "ec_full_name": body.ec_full_name,
            "ec_relationship": body.ec_relationship,
            "ec_email": body.ec_email, "ec_mobile": body.ec_mobile, "ec_phone": body.ec_phone,
            "ec_address": body.ec_address, "ec_postcode": body.ec_postcode,
            "has_health_restrictions": body.has_health_restrictions, "health_notes": body.health_notes,
            "has_criminal_record": body.has_criminal_record,
            "criminal_record_details": body.criminal_record_details,
            "ref1_title": body.ref1_title, "ref1_first_names": body.ref1_first_names,
            "ref1_last_name": body.ref1_last_name, "ref1_address": body.ref1_address,
            "ref1_postcode": body.ref1_postcode, "ref1_mobile": body.ref1_mobile,
            "ref1_phone": body.ref1_phone, "ref1_email": body.ref1_email,
            "ref2_title": body.ref2_title, "ref2_first_names": body.ref2_first_names,
            "ref2_last_name": body.ref2_last_name, "ref2_address": body.ref2_address,
            "ref2_postcode": body.ref2_postcode, "ref2_mobile": body.ref2_mobile,
            "ref2_phone": body.ref2_phone, "ref2_email": body.ref2_email,
            "confidentiality_agreed": body.confidentiality_agreed,
            "stage": stage, "ref": ref, "email": email_key,
        })
        await db.commit()

    return {"success": True, "reference_number": ref, "stage": stage}


def _jsonify(obj: Any) -> str:
    """Serialise dict/list to JSON for SQLAlchemy bind into a jsonb column."""
    import json
    return json.dumps(obj)


# ─── Public endpoints — partial save / resume ────────────────────────────────

class DraftBody(BaseModel):
    """Wizard auto-save payload. The whole form goes in `payload` as-is —
    no validation, since drafts are explicitly mid-fill. The server only
    cares about the token (for upserts) and email (for resume-by-email
    later, if the applicant loses their token but remembers their email)."""
    token: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    email: str = ""
    branch_id: str = "main"


@router.post("/service/volunteers/draft")
async def save_draft(body: DraftBody) -> dict[str, Any]:
    """Create a new draft, or upsert an existing one by token. Returns
    the (possibly new) token + expiry the client should display."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    token = body.token.strip() or _gen_draft_token()
    email_key = body.email.strip().lower()[:255]

    async with SessionLocal() as db:
        result = await db.execute(text("""
            INSERT INTO volunteer_drafts
                (id, token, email, payload, branch_id, created_at, updated_at, expires_at)
            VALUES
                (gen_random_uuid(), :token, :email, CAST(:payload AS jsonb), :branch,
                 NOW(), NOW(), NOW() + INTERVAL '30 days')
            ON CONFLICT (token) DO UPDATE SET
                payload    = EXCLUDED.payload,
                email      = COALESCE(NULLIF(EXCLUDED.email,''), volunteer_drafts.email),
                branch_id  = EXCLUDED.branch_id,
                updated_at = NOW(),
                expires_at = NOW() + INTERVAL '30 days'
            RETURNING token, expires_at
        """), {
            "token": token, "email": email_key,
            "payload": _jsonify(body.payload), "branch": body.branch_id,
        })
        row = result.mappings().one()
        await db.commit()
    return {
        "ok": True,
        "token": row["token"],
        "expires_at": row["expires_at"].isoformat() if row["expires_at"] else None,
    }


@router.get("/service/volunteers/draft/{token}")
async def get_draft(token: str) -> dict[str, Any]:
    """Resume — fetch a saved draft by token. 404 if expired/missing.
    Public on purpose: the token IS the auth (32 bytes of urandom),
    so anyone with the link can resume."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = await db.execute(text("""
            SELECT token, payload, branch_id, updated_at, expires_at
            FROM   volunteer_drafts
            WHERE  token = :token
              AND  expires_at > NOW()
        """), {"token": token})
        rec = row.mappings().one_or_none()
    if not rec:
        raise HTTPException(404, detail="Draft not found or expired")
    return {
        "token":      rec["token"],
        "payload":    rec["payload"],
        "branch_id":  rec["branch_id"],
        "updated_at": rec["updated_at"].isoformat() if rec["updated_at"] else None,
        "expires_at": rec["expires_at"].isoformat() if rec["expires_at"] else None,
    }


class EmailLinkBody(BaseModel):
    """Send the resume link to an email address. The token IS the auth —
    anyone who has it can already resume the draft, so emailing the
    matching link to whichever address they pick doesn't expand access.
    Office 365 SMTP does the heavy rate-limiting in practice."""
    token: str
    email: str


@router.post("/service/volunteers/draft/email-link")
async def email_draft_link(body: EmailLinkBody) -> dict[str, Any]:
    """Email the resume link for a saved draft. Used when an applicant
    closes the tab and forgets to bookmark — they ask the form to email
    them, click the link in their inbox, resume on any device."""
    from sqlalchemy import text

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.database import SessionLocal

    if "@" not in body.email or len(body.email) > 255:
        raise HTTPException(400, detail="Valid email address required")

    # Confirm the draft exists and isn't expired before we send anything —
    # otherwise the email would link to a 404.
    async with SessionLocal() as db:
        row = await db.execute(text("""
            SELECT token, expires_at
            FROM   volunteer_drafts
            WHERE  token = :token AND expires_at > NOW()
        """), {"token": body.token})
        rec = row.mappings().one_or_none()
        if not rec:
            raise HTTPException(404, detail="Draft not found or expired")
        # Persist whichever email the applicant wants the link sent to,
        # so admins can also re-send manually if needed.
        await db.execute(
            text("UPDATE volunteer_drafts SET email = :email, updated_at = NOW() WHERE token = :token"),
            {"email": body.email.strip().lower(), "token": body.token},
        )
        await db.commit()

    # Resume URL: ?screen=volunteer hash routes the service portal straight
    # to the wizard; #draft=TOKEN rehydrates the saved form.
    site = (settings.SITE_URL or "https://shital.org.uk").rstrip("/")
    # The volunteer wizard lives on the service-portal subdomain.
    if "://" in site and "service." not in site:
        # Best-effort rewrite of shital.org.uk → service.shital.org.uk
        # without forcing config to grow a new SERVICE_URL setting yet.
        scheme, host = site.split("://", 1)
        if not host.startswith("service."):
            site = f"{scheme}://service.{host}"
    resume_url = f"{site}/?screen=volunteer#draft={body.token}"

    subject = "Your SHITAL volunteer-application resume link"
    text_body = (
        "Hello,\n\n"
        "Here's the link to continue your SHITAL volunteer application "
        "where you left off. The link is valid for 30 days from your last "
        "save and can be opened on any device.\n\n"
        f"{resume_url}\n\n"
        "If you didn't request this email, you can ignore it — the link "
        "won't work without the unique code at the end.\n\n"
        "— SHITAL Volunteers"
    )
    html_body = f"""
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:auto;color:#222">
          <p>Hello,</p>
          <p>Here's the link to continue your SHITAL volunteer application
             where you left off. The link is valid for <strong>30 days</strong>
             from your last save and can be opened on any device.</p>
          <p style="margin:24px 0">
            <a href="{resume_url}"
               style="display:inline-block;background:linear-gradient(135deg,#D4AF37,#C5A028);
                      color:#3B0000;font-weight:700;text-decoration:none;
                      padding:12px 24px;border-radius:12px">
              Resume my application
            </a>
          </p>
          <p style="font-size:12px;color:#666;word-break:break-all">
            Or paste this URL into your browser: <br>{resume_url}
          </p>
          <p style="font-size:12px;color:#666">
            If you didn't request this email you can safely ignore it —
            the link won't work without the unique code at the end.
          </p>
          <p style="font-size:12px;color:#999;margin-top:24px">— SHITAL Volunteers</p>
        </div>
    """

    # Route through the centralised audit/queue path. Same path as
    # send_template() — failures land in /admin/email-templates/sent
    # with related_type='volunteer_draft' so they're searchable + resendable.
    from shital.api.routers.email_templates import (
        RELATED_VOLUNTEER_DRAFT,
        send_raw_email,
    )

    result = await send_raw_email(
        to_email=body.email.strip(),
        subject=subject,
        html_body=html_body,
        text_body=text_body,
        related_type=RELATED_VOLUNTEER_DRAFT,
        related_id=body.token,
    )
    if not result.get("sent"):
        # 502 keeps the existing contract (frontend treats !ok as a failure
        # banner) but the audit row is already in place for ops to inspect.
        raise HTTPException(502, detail=f"Email send failed: {result.get('error') or result.get('reason') or 'unknown'}")

    return {"ok": True, "sent_to": body.email.strip(), "sent_email_id": result.get("sent_email_id")}


@router.delete("/service/volunteers/draft/{token}")
async def delete_draft(token: str) -> dict[str, Any]:
    """Discard — applicant explicitly clearing their draft. No-op if the
    token isn't found (idempotent)."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        await db.execute(
            text("DELETE FROM volunteer_drafts WHERE token = :token"),
            {"token": token},
        )
        await db.commit()
    return {"ok": True}


# ─── Admin endpoints — list + detail + approve/reject ─────────────────────────

@router.get("/admin/volunteers")
async def admin_list_volunteers(
    ctx: CurrentSpace,
    status_filter: str = "",  # PENDING | APPROVED | REJECTED | "" (all)
    branch_id: str = "",
    search: str = "",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """List volunteers for admin review. Returns summary fields only — full
    detail (including referee + criminal-record info) requires the detail
    endpoint to keep list responses light."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {"limit": max(1, min(limit, 200)), "offset": max(0, offset)}
    if status_filter:
        where.append("status = :status")
        params["status"] = status_filter
    if branch_id:
        where.append("branch_id = :branch_id")
        params["branch_id"] = branch_id
    if search.strip():
        where.append(
            "(LOWER(first_names || ' ' || last_name) LIKE :search "
            "OR LOWER(email) LIKE :search "
            "OR LOWER(reference_number) LIKE :search)"
        )
        params["search"] = f"%{search.strip().lower()}%"
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = await db.execute(text(f"""
            SELECT id, reference_number, first_names, last_name,
                   email, mobile, phone, age_range, branch_id,
                   preferred_branches,
                   status, created_at, reviewed_at,
                   has_criminal_record, has_health_restrictions
            FROM   volunteers
            {where_sql}
            ORDER  BY created_at DESC
            LIMIT  :limit OFFSET :offset
        """), params)
        items = [dict(r._mapping) for r in rows]
        total_row = await db.execute(text(f"SELECT COUNT(*) AS n FROM volunteers {where_sql}"), params)
        total = total_row.scalar_one()
    return {"items": items, "total": total, "limit": params["limit"], "offset": params["offset"]}


@router.get("/admin/volunteers/{volunteer_id}")
async def admin_get_volunteer(volunteer_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = await db.execute(
            text("SELECT * FROM volunteers WHERE id::text = :id"),
            {"id": volunteer_id},
        )
        rec = row.mappings().one_or_none()
    if not rec:
        raise HTTPException(404, detail="Volunteer record not found")
    return {"volunteer": dict(rec)}


class ReviewBody(BaseModel):
    rejection_reason: str = ""


@router.post("/admin/volunteers/{volunteer_id}/approve")
async def admin_approve_volunteer(
    volunteer_id: str, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    return await _set_review_status(volunteer_id, ctx, "APPROVED", "")


@router.post("/admin/volunteers/{volunteer_id}/reject")
async def admin_reject_volunteer(
    volunteer_id: str, body: ReviewBody, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    return await _set_review_status(volunteer_id, ctx, "REJECTED", body.rejection_reason.strip())


# ─── Reference request workflow ───────────────────────────────────────────────

@router.post("/admin/volunteers/{volunteer_id}/send-references")
async def admin_send_reference_requests(
    volunteer_id: str, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Email both referees a magic-link to fill in a reference response form.
    Generates per-referee tokens stored on the volunteer row; tokens stay
    stable across re-sends so the referee's existing link still works."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.config import settings
    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT id, first_names, last_name,
                   ref1_first_names, ref1_last_name, ref1_email,
                   ref2_first_names, ref2_last_name, ref2_email,
                   ref1_request_token, ref2_request_token
            FROM   volunteers
            WHERE  id::text = :id
        """), {"id": volunteer_id})).mappings().one_or_none()
        if not row:
            raise HTTPException(404, detail="Volunteer not found")

        # Re-use existing tokens if present so a previously-sent link stays
        # valid for the referee. New volunteers get fresh tokens.
        token1 = row["ref1_request_token"] or _gen_draft_token()
        token2 = row["ref2_request_token"] or _gen_draft_token()
        now = datetime.now(UTC)
        await db.execute(text("""
            UPDATE volunteers
            SET    ref1_request_token = :t1,
                   ref2_request_token = :t2,
                   references_sent_at = :now,
                   updated_at         = :now
            WHERE  id::text = :id
        """), {"t1": token1, "t2": token2, "id": volunteer_id, "now": now})
        await db.commit()

    site = (settings.SITE_URL or "https://shital.org.uk").rstrip("/")
    if "://" in site and "service." not in site:
        scheme, host = site.split("://", 1)
        if not host.startswith("service."):
            site = f"{scheme}://service.{host}"
    applicant_name = f"{row['first_names']} {row['last_name']}".strip()
    charity_number = settings.CHARITY_NUMBER or "1138530"

    from shital.api.routers.email_templates import send_template

    results: list[dict[str, Any]] = []
    for tag, token, ref_name, ref_email in (
        ("ref1", token1,
            f"{row['ref1_first_names']} {row['ref1_last_name']}".strip() or "Referee",
            (row["ref1_email"] or "").strip()),
        ("ref2", token2,
            f"{row['ref2_first_names']} {row['ref2_last_name']}".strip() or "Referee",
            (row["ref2_email"] or "").strip()),
    ):
        if not ref_email or "@" not in ref_email:
            results.append({"ref": tag, "sent": False, "reason": "no email on file"})
            continue
        url = f"{site}/?screen=reference#token={token}"
        out = await send_template(
            "volunteer_reference_request",
            ref_email,
            {
                "referee_name":   ref_name,
                "applicant_name": applicant_name,
                "response_url":   url,
                "charity_number": charity_number,
            },
            related_type="volunteer_reference",
            related_id=f"{volunteer_id}:{tag}",
            triggered_by=getattr(ctx, "user_email", "") or "admin",
        )
        results.append({"ref": tag, "to": ref_email, **out})

    return {"ok": True, "results": results}


# ─── Public endpoints — referee submits a reference response ─────────────────

class ReferenceResponseBody(BaseModel):
    """Free-form reference response from the public form. We capture standard
    safeguarding fields plus an open free-text recommendation."""
    relationship: str = ""        # "Manager / Friend / Teacher / etc."
    known_for_years: str = ""     # "5"  or  "More than 10"
    known_in_capacity: str = ""   # Free text
    is_honest_reliable: str = ""  # "yes" / "no" / "unsure"
    suitable_for_volunteering: str = ""  # same scale
    safeguarding_concerns: str = ""      # "yes" / "no"
    safeguarding_details: str = ""       # required if previous = yes
    other_comments: str = ""             # free-text recommendation


@router.get("/public/volunteers/reference/{token}")
async def public_get_reference_context(token: str) -> dict[str, Any]:
    """Public — looks up the volunteer + which referee is responding so the
    form can show "You are providing a reference for {applicant} as
    {referee}". Token IS the auth — anyone with the link can submit."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT first_names, last_name,
                   ref1_first_names, ref1_last_name, ref1_request_token,
                   ref2_first_names, ref2_last_name, ref2_request_token,
                   ref1_response_received_at, ref2_response_received_at
            FROM   volunteers
            WHERE  ref1_request_token = :t OR ref2_request_token = :t
            LIMIT  1
        """), {"t": token})).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Reference link not found or expired")
    is_ref1 = row["ref1_request_token"] == token
    return {
        "applicant_name": f"{row['first_names']} {row['last_name']}".strip(),
        "referee_name":
            f"{row['ref1_first_names']} {row['ref1_last_name']}".strip() if is_ref1
            else f"{row['ref2_first_names']} {row['ref2_last_name']}".strip(),
        "already_submitted": bool(
            row["ref1_response_received_at"] if is_ref1 else row["ref2_response_received_at"]
        ),
    }


@router.post("/public/volunteers/reference/{token}")
async def public_submit_reference(
    token: str, body: ReferenceResponseBody, request: Request,
) -> dict[str, Any]:
    """Public — referee submits the reference. Stores in ref{N}_response
    JSONB on the volunteer row, marks received_at. Idempotent on token —
    re-submission updates the same row."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    payload = {
        **body.model_dump(),
        "submitted_ip": (request.client.host if request.client else "")[:45],
        "user_agent":   (request.headers.get("user-agent") or "")[:500],
    }
    if body.safeguarding_concerns.lower() == "yes" and not body.safeguarding_details.strip():
        raise HTTPException(400, detail="Please describe the safeguarding concerns")

    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT id, ref1_request_token, ref2_request_token
            FROM   volunteers
            WHERE  ref1_request_token = :t OR ref2_request_token = :t
            LIMIT  1
        """), {"t": token})).mappings().one_or_none()
        if not row:
            raise HTTPException(404, detail="Reference link not found or expired")
        is_ref1 = row["ref1_request_token"] == token
        col_payload = "ref1_response" if is_ref1 else "ref2_response"
        col_at = "ref1_response_received_at" if is_ref1 else "ref2_response_received_at"
        now = datetime.now(UTC)
        await db.execute(text(f"""
            UPDATE volunteers
            SET    {col_payload} = CAST(:p AS jsonb),
                   {col_at}      = :now,
                   updated_at    = :now
            WHERE  id = :id
        """), {"p": _jsonify(payload), "now": now, "id": row["id"]})
        await db.commit()
    return {"ok": True}


async def _set_review_status(
    volunteer_id: str, ctx: CurrentSpace, new_status: str, rejection_reason: str,
) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.now(UTC)
    async with SessionLocal() as db:
        # Two-step lookup avoids the eager UUID-cast trap that bit projects.py
        # before #31 — id::text = :id won't raise on non-UUID inputs.
        existing = await db.execute(
            text("SELECT id, status FROM volunteers WHERE id::text = :id"),
            {"id": volunteer_id},
        )
        rec = existing.mappings().one_or_none()
        if not rec:
            raise HTTPException(404, detail="Volunteer record not found")

        await db.execute(text("""
            UPDATE volunteers
            SET    status = :new_status,
                   reviewed_by_user_id = :reviewer,
                   reviewed_at = :now,
                   rejection_reason = :reason,
                   updated_at = :now
            WHERE  id = :id
        """), {
            "new_status": new_status,
            "reviewer": str(ctx.user_id) if getattr(ctx, "user_id", None) else None,
            "now": now, "reason": rejection_reason, "id": rec["id"],
        })
        await db.commit()
    return {"success": True, "status": new_status, "id": str(rec["id"])}
