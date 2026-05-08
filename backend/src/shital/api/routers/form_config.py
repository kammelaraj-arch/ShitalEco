"""Form-text overrides — admin-editable copy on public forms.

Generic system: each form has a `form_key` (e.g. `volunteer_registration`)
and a catalogue of named fields with default text. Admins can set
`override_text` per field; the public endpoint merges defaults with
overrides at read time. Storage is sparse — only customised fields exist
in the database.

Endpoints:
  GET    /service/form-config/{form_key}            public read (resolved)
  GET    /admin/form-config/{form_key}              admin read (defaults +
                                                    override + last-edited)
  PUT    /admin/form-config/{form_key}/{field_key}  set / update override
  DELETE /admin/form-config/{form_key}/{field_key}  revert to default
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["form-config"])


# ─── Field catalogues — defaults + descriptions per form_key ──────────────────
#
# Each entry: (field_key, default_text, description, kind, group)
#   kind: 'heading' | 'paragraph' | 'label' | 'placeholder' | 'button'
#   group: a short section name for UI grouping (e.g. 'Personal', 'Health')

VOLUNTEER_REGISTRATION_FIELDS: list[dict[str, str]] = [
    # Page header
    {"key": "page.title", "default": "Volunteer Registration",
     "desc": "Big page title", "kind": "heading", "group": "Header"},
    {"key": "page.subtitle",
     "default": "Join the SHITAL volunteering family. Minimum age 18.",
     "desc": "Subtitle under the page title",
     "kind": "paragraph", "group": "Header"},

    # Personal Details section
    {"key": "section.personal.title", "default": "Personal Details",
     "desc": "Section heading", "kind": "heading", "group": "Personal Details"},

    # Emergency Contact section
    {"key": "section.emergency.title", "default": "Emergency Contact",
     "desc": "Section heading", "kind": "heading", "group": "Emergency Contact"},

    # Health section
    {"key": "section.health.title", "default": "Health",
     "desc": "Section heading", "kind": "heading", "group": "Health"},
    {"key": "section.health.question",
     "default": "Are there any restricting factors or medication that we should be aware of?",
     "desc": "Health-disclosure prompt",
     "kind": "paragraph", "group": "Health"},
    {"key": "section.health.checkbox_yes",
     "default": "Yes — I have a health condition or medication SHITAL should know about",
     "desc": "Affirmative checkbox label",
     "kind": "label", "group": "Health"},
    {"key": "section.health.help_placeholder",
     "default": "Please specify how we can help you",
     "desc": "Placeholder for the health-detail textarea",
     "kind": "placeholder", "group": "Health"},

    # Police-check declaration
    {"key": "section.police_check.title", "default": "Police-Check Declaration",
     "desc": "Section heading", "kind": "heading", "group": "Police-Check"},
    {"key": "section.police_check.intro",
     "default": (
         "The volunteering opportunities will involve direct contact with "
         "devotees. As such, applications to volunteer are exempt from the "
         "Rehabilitation of Offenders Act 1974 — you are required to declare "
         "your entire criminal record, including cautions, reprimands, final "
         "warnings and convictions categorised \"spent\" under that "
         "legislation. Information will be kept strictly confidential."
     ),
     "desc": "Rehab-of-Offenders Act 1974 exemption notice. KEEP THIS LEGALLY ACCURATE.",
     "kind": "paragraph", "group": "Police-Check"},
    {"key": "section.police_check.checkbox_yes",
     "default": "Yes — I have been convicted at a Court or cautioned by the Police",
     "desc": "Affirmative checkbox label",
     "kind": "label", "group": "Police-Check"},
    {"key": "section.police_check.detail_placeholder",
     "default": "Please give details, including dates and nature of offences",
     "desc": "Placeholder for the criminal-record textarea",
     "kind": "placeholder", "group": "Police-Check"},

    # Referees
    {"key": "section.referee1.title", "default": "Character Referee 1",
     "desc": "Referee 1 heading", "kind": "heading", "group": "Referees"},
    {"key": "section.referee1.intro",
     "default": "Please give an independent referee (not a family member).",
     "desc": "Instructions above the referee 1 form",
     "kind": "paragraph", "group": "Referees"},
    {"key": "section.referee2.title", "default": "Character Referee 2",
     "desc": "Referee 2 heading", "kind": "heading", "group": "Referees"},
    {"key": "section.referee2.intro",
     "default": "A second independent referee (not a family member).",
     "desc": "Instructions above the referee 2 form",
     "kind": "paragraph", "group": "Referees"},

    # Skills
    {"key": "section.skills.title", "default": "Your Skills",
     "desc": "Skills heading", "kind": "heading", "group": "Skills"},
    {"key": "section.skills.intro",
     "default": "Tick everything that applies. We use this to match you with suitable opportunities.",
     "desc": "Instructions above the skills checklist",
     "kind": "paragraph", "group": "Skills"},
    {"key": "section.skills.other_label", "default": "Other skills (free-text)",
     "desc": "Label for the free-text 'other skills' textarea",
     "kind": "label", "group": "Skills"},
    {"key": "section.skills.other_placeholder",
     "default": "Security, First Aid, Singing, Musical Instruments etc.",
     "desc": "Placeholder for the free-text 'other skills' textarea",
     "kind": "placeholder", "group": "Skills"},

    # Availability
    {"key": "section.availability.title", "default": "Availability",
     "desc": "Availability heading", "kind": "heading", "group": "Availability"},
    {"key": "section.availability.intro",
     "default": "Tell us when you're typically free. You can leave any cell blank.",
     "desc": "Instructions above the availability matrix",
     "kind": "paragraph", "group": "Availability"},

    # Declarations
    {"key": "section.declarations.title", "default": "Declarations",
     "desc": "Declarations heading", "kind": "heading", "group": "Declarations"},
    {"key": "section.declarations.activity_label",
     "default": "Volunteer activity declaration",
     "desc": "Bold lead label for the activity declaration",
     "kind": "label", "group": "Declarations"},
    {"key": "section.declarations.activity_text",
     "default": (
         "I am voluntarily participating in the activities of SHITAL's events "
         "with the knowledge of the danger involved and that medical facilities "
         "may not be immediately available in the event of injury. I confirm "
         "that neither I nor anyone on my behalf will demand or expect any "
         "remuneration in cash or in kind for my services and time volunteering "
         "for SHITAL."
     ),
     "desc": "Body of the activity declaration. KEEP LEGALLY MEANINGFUL.",
     "kind": "paragraph", "group": "Declarations"},
    {"key": "section.declarations.confidentiality_label",
     "default": "Confidentiality undertaking",
     "desc": "Bold lead label for the confidentiality undertaking",
     "kind": "label", "group": "Declarations"},
    {"key": "section.declarations.confidentiality_text",
     "default": (
         "I agree to abide by SHITAL's Confidentiality Policy and acknowledge "
         "that violation may lead to disciplinary action and termination of "
         "my volunteering services."
     ),
     "desc": "Body of the confidentiality NDA. KEEP LEGALLY MEANINGFUL.",
     "kind": "paragraph", "group": "Declarations"},
    {"key": "section.declarations.marketing_text",
     "default": (
         "I'd like SHITAL to keep me informed about news, events and "
         "volunteering opportunities by email or SMS. We never sell or share "
         "your details with third parties — you can withdraw at any time."
     ),
     "desc": "Marketing-consent label. Editable but should remain GDPR-clear.",
     "kind": "paragraph", "group": "Declarations"},

    # Submit + thank-you
    {"key": "submit.button", "default": "Submit Application →",
     "desc": "Final submit button text", "kind": "button", "group": "Submit"},
    {"key": "submit.help",
     "default": "After submission, a trustee will review your application. References will be taken before a role is confirmed.",
     "desc": "Help text under the submit button",
     "kind": "paragraph", "group": "Submit"},

    {"key": "done.title", "default": "Application Received",
     "desc": "Thank-you screen heading", "kind": "heading", "group": "Thank You"},
    {"key": "done.thanks",
     "default": "Thank you for offering to volunteer with SHITAL.",
     "desc": "Thank-you body line",
     "kind": "paragraph", "group": "Thank You"},
    {"key": "done.reference_label", "default": "Your reference",
     "desc": "Label above the reference number",
     "kind": "label", "group": "Thank You"},
    {"key": "done.next_steps",
     "default": (
         "A trustee will review your application and contact you by email. "
         "References will be taken before a role is confirmed. Please quote "
         "the reference above in any correspondence."
     ),
     "desc": "Body text on the thank-you screen explaining next steps",
     "kind": "paragraph", "group": "Thank You"},
    {"key": "done.back_button", "default": "Back to Home",
     "desc": "Button on thank-you screen", "kind": "button", "group": "Thank You"},
]


FORM_CATALOGUES: dict[str, list[dict[str, str]]] = {
    "volunteer_registration": VOLUNTEER_REGISTRATION_FIELDS,
}


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required",
        )


def _looks_uuid(s: str | None) -> bool:
    if not s:
        return False
    try:
        uuid.UUID(s)
        return True
    except (ValueError, AttributeError):
        return False


# ─── Public read ──────────────────────────────────────────────────────────────

@router.get("/service/form-config/{form_key}")
async def get_public_form_config(form_key: str) -> dict[str, Any]:
    """Return the resolved text for every field on a form. Public endpoint
    so the service app can fetch its own copy without auth."""
    catalogue = FORM_CATALOGUES.get(form_key)
    if not catalogue:
        raise HTTPException(404, detail=f"Unknown form_key '{form_key}'")

    overrides = await _load_overrides(form_key)
    resolved: dict[str, str] = {}
    for entry in catalogue:
        key = entry["key"]
        resolved[key] = overrides.get(key, entry["default"])
    return {"form_key": form_key, "fields": resolved}


# ─── Admin read + write ───────────────────────────────────────────────────────

@router.get("/admin/form-config/{form_key}")
async def get_admin_form_config(form_key: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Return every field with default + override + last-edited info."""
    _require_admin(ctx)
    catalogue = FORM_CATALOGUES.get(form_key)
    if not catalogue:
        raise HTTPException(404, detail=f"Unknown form_key '{form_key}'")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT field_key, override_text, updated_by_name, updated_at
            FROM   form_text_overrides
            WHERE  form_key = :fk
        """), {"fk": form_key})
        ov = {r._mapping["field_key"]: r._mapping for r in rows}

    items: list[dict[str, Any]] = []
    for entry in catalogue:
        k = entry["key"]
        meta = ov.get(k)
        items.append({
            "key": k,
            "default": entry["default"],
            "override": meta["override_text"] if meta else None,
            "effective": meta["override_text"] if meta else entry["default"],
            "description": entry.get("desc", ""),
            "kind": entry.get("kind", "paragraph"),
            "group": entry.get("group", ""),
            "updated_by_name": meta["updated_by_name"] if meta else "",
            "updated_at": (meta["updated_at"].isoformat()
                           if meta and meta["updated_at"] else None),
        })
    return {"form_key": form_key, "fields": items}


class OverrideBody(BaseModel):
    text: str


@router.put("/admin/form-config/{form_key}/{field_key:path}")
async def set_override(
    form_key: str, field_key: str, body: OverrideBody, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Set or update an override. If the new text equals the default, the row
    is deleted (clean revert)."""
    _require_admin(ctx)
    catalogue = FORM_CATALOGUES.get(form_key)
    if not catalogue:
        raise HTTPException(404, detail=f"Unknown form_key '{form_key}'")
    entry = next((e for e in catalogue if e["key"] == field_key), None)
    if not entry:
        raise HTTPException(404, detail=f"Unknown field_key '{field_key}' for form '{form_key}'")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    new_text = body.text
    now = datetime.now(UTC)
    actor = str(ctx.user_id) if _looks_uuid(str(ctx.user_id)) else None
    actor_name = ctx.user_email or ""

    async with SessionLocal() as db:
        if new_text == entry["default"]:
            await db.execute(text("""
                DELETE FROM form_text_overrides
                WHERE form_key = :fk AND field_key = :fld
            """), {"fk": form_key, "fld": field_key})
        else:
            await db.execute(text("""
                INSERT INTO form_text_overrides
                    (id, form_key, field_key, override_text,
                     updated_by, updated_by_name, created_at, updated_at)
                VALUES
                    (:id, :fk, :fld, :txt, :actor, :actor_name, :now, :now)
                ON CONFLICT (form_key, field_key) DO UPDATE SET
                    override_text   = EXCLUDED.override_text,
                    updated_by      = EXCLUDED.updated_by,
                    updated_by_name = EXCLUDED.updated_by_name,
                    updated_at      = EXCLUDED.updated_at
            """), {
                "id": str(uuid.uuid4()), "fk": form_key, "fld": field_key,
                "txt": new_text, "actor": actor, "actor_name": actor_name[:255],
                "now": now,
            })
        await db.commit()
    return {"form_key": form_key, "field_key": field_key, "success": True}


@router.delete("/admin/form-config/{form_key}/{field_key:path}")
async def reset_override(
    form_key: str, field_key: str, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Revert a field to its default by deleting the override row."""
    _require_admin(ctx)
    if form_key not in FORM_CATALOGUES:
        raise HTTPException(404, detail=f"Unknown form_key '{form_key}'")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        await db.execute(text("""
            DELETE FROM form_text_overrides
            WHERE form_key = :fk AND field_key = :fld
        """), {"fk": form_key, "fld": field_key})
        await db.commit()
    return {"form_key": form_key, "field_key": field_key, "reverted": True}


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _load_overrides(form_key: str) -> dict[str, str]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT field_key, override_text
            FROM   form_text_overrides
            WHERE  form_key = :fk
        """), {"fk": form_key})
        return {r._mapping["field_key"]: r._mapping["override_text"] for r in rows}
