"""Volunteer Reference Requests — first-class CRUD.

Each volunteer (from the paper application form) has two named referees.
This router exposes per-(volunteer, referee_index) request records:
admins can list, create, update, resend, mark cancelled, and view the
referee's submitted response.

Endpoints (all admin-gated unless noted):
  GET    /admin/volunteer-reference-requests                list (filters + pagination)
  GET    /admin/volunteer-reference-requests/{id}           detail
  POST   /admin/volunteer-reference-requests                upsert by (volunteer_id, referee_index)
  PUT    /admin/volunteer-reference-requests/{id}           update editable fields
  DELETE /admin/volunteer-reference-requests/{id}           soft-cancel (status=CANCELLED)
  POST   /admin/volunteer-reference-requests/{id}/resend    bump send_count, mark SENT
  POST   /admin/volunteer-reference-requests/{id}/responded record the referee response (admin route — public route stays on volunteers.py)
"""
from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["volunteer-references"])

VALID_STATUSES = {"PENDING", "SENT", "OPENED", "RESPONDED", "EXPIRED", "CANCELLED"}
PRIVILEGED     = {"SUPER_ADMIN", "ADMIN", "HR_MANAGER"}


def _require_admin(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Admin / HR role required")


def _token() -> str:
    # 32-byte URL-safe token — fits the existing magic-link convention
    # used by ref1_request_token / ref2_request_token on volunteers.
    return secrets.token_urlsafe(32)


# ── Schemas ─────────────────────────────────────────────────────────────────

class ReferenceRequestIn(BaseModel):
    volunteer_id:  str
    referee_index: int = 1                # 1 or 2
    referee_name:  str = ""
    referee_email: str = ""
    referee_phone: str = ""
    relationship:  str = ""
    notes:         str = ""
    expires_in_days: int = 30


class ReferenceRequestUpdate(BaseModel):
    referee_name:  str | None = None
    referee_email: str | None = None
    referee_phone: str | None = None
    relationship:  str | None = None
    notes:         str | None = None
    status:        str | None = None
    expires_at:    str | None = None
    response_data: dict[str, Any] | None = None


class ResendIn(BaseModel):
    new_expires_in_days: int | None = None     # reset expiry on resend


def _row(r: Any) -> dict[str, Any]:
    d = dict(r)
    for k in ("id", "volunteer_id", "requested_by"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    for k in ("requested_at", "sent_at", "opened_at", "responded_at",
              "expires_at", "created_at", "updated_at"):
        if d.get(k) is not None and hasattr(d[k], "isoformat"):
            d[k] = d[k].isoformat()
    if "response_data" in d and not isinstance(d["response_data"], dict):
        # asyncpg returns JSONB as dict already; defensive fallback.
        try:
            import json
            d["response_data"] = json.loads(d["response_data"] or "{}")
        except (TypeError, ValueError):
            d["response_data"] = {}
    return d


# ── List ────────────────────────────────────────────────────────────────────

@router.get("/admin/volunteer-reference-requests")
async def list_requests(
    ctx: CurrentSpace,
    volunteer_id: str = "",
    status: str | None = None,
    search: str = "",
    page: int = 1,
    per_page: int = 50,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {
        "limit":  max(1, min(per_page, 500)),
        "offset": max(0, (page - 1) * per_page),
    }
    if volunteer_id:
        where.append("vr.volunteer_id::text = :vid")
        params["vid"] = volunteer_id
    if status:
        if status not in VALID_STATUSES:
            raise HTTPException(400, detail=f"status must be one of: {sorted(VALID_STATUSES)}")
        where.append("vr.status = :status")
        params["status"] = status
    if search.strip():
        where.append("(LOWER(vr.referee_name) LIKE :q OR LOWER(vr.referee_email) LIKE :q "
                     "OR LOWER(v.first_names || ' ' || v.last_name) LIKE :q)")
        params["q"] = f"%{search.strip().lower()}%"
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT vr.*,
                   (v.first_names || ' ' || v.last_name) AS volunteer_name,
                   v.email AS volunteer_email,
                   v.status AS volunteer_status
            FROM   volunteer_reference_requests vr
            JOIN   volunteers v ON v.id = vr.volunteer_id
            {where_sql}
            ORDER BY vr.created_at DESC
            LIMIT  :limit OFFSET :offset
        """), params)).mappings().all()
        total = (await db.execute(
            text(f"""SELECT COUNT(*) AS cnt
                     FROM volunteer_reference_requests vr
                     JOIN volunteers v ON v.id = vr.volunteer_id
                     {where_sql}"""),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).mappings().first()

    return {
        "items":    [_row(r) for r in rows],
        "total":    int(total["cnt"]) if total else 0,
        "page":     page,
        "per_page": per_page,
    }


# ── Detail ──────────────────────────────────────────────────────────────────

@router.get("/admin/volunteer-reference-requests/{request_id}")
async def get_request(request_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        r = (await db.execute(text("""
            SELECT vr.*,
                   (v.first_names || ' ' || v.last_name) AS volunteer_name,
                   v.email AS volunteer_email,
                   v.status AS volunteer_status
            FROM   volunteer_reference_requests vr
            JOIN   volunteers v ON v.id = vr.volunteer_id
            WHERE  vr.id::text = :id
        """), {"id": request_id})).mappings().first()
    if not r:
        raise HTTPException(404, detail="Reference request not found")
    return _row(r)


# ── Create / upsert ─────────────────────────────────────────────────────────

@router.post("/admin/volunteer-reference-requests", status_code=201)
async def create_request(body: ReferenceRequestIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if body.referee_index not in (1, 2):
        raise HTTPException(400, detail="referee_index must be 1 or 2")
    if not body.referee_email.strip():
        raise HTTPException(400, detail="referee_email is required")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    me_id   = str(getattr(ctx, "user_id", "") or "") or None
    me_name = getattr(ctx, "user_email", "") or ""
    expires = datetime.now(UTC) + timedelta(days=max(1, body.expires_in_days))

    async with SessionLocal() as db:
        # Verify the volunteer exists first — clearer 404 than the FK
        # error that would otherwise come from the INSERT.
        v = (await db.execute(text("SELECT 1 FROM volunteers WHERE id::text = :id"),
                              {"id": body.volunteer_id})).first()
        if not v:
            raise HTTPException(404, detail="Volunteer not found")

        token = _token()
        result = await db.execute(text("""
            INSERT INTO volunteer_reference_requests
                (id, volunteer_id, referee_index,
                 referee_name, referee_email, referee_phone, relationship,
                 request_token, status, expires_at, notes,
                 requested_by, requested_by_name)
            VALUES (:id, :vid, :idx,
                    :rname, :remail, :rphone, :rel,
                    :tok, 'PENDING', :exp, :notes,
                    :by_id, :by_name)
            ON CONFLICT (volunteer_id, referee_index) DO UPDATE SET
                referee_name      = EXCLUDED.referee_name,
                referee_email     = EXCLUDED.referee_email,
                referee_phone     = EXCLUDED.referee_phone,
                relationship      = EXCLUDED.relationship,
                expires_at        = EXCLUDED.expires_at,
                notes             = EXCLUDED.notes,
                -- Don't reset request_token on upsert — keeps existing
                -- magic links live for any referee who already received one.
                updated_at        = NOW()
            RETURNING *
        """), {
            "id":     str(uuid.uuid4()),
            "vid":    body.volunteer_id,
            "idx":    body.referee_index,
            "rname":  body.referee_name,
            "remail": body.referee_email.strip(),
            "rphone": body.referee_phone,
            "rel":    body.relationship,
            "tok":    token,
            "exp":    expires,
            "notes":  body.notes,
            "by_id":  me_id,
            "by_name": me_name,
        })
        row = result.mappings().first()
        await db.commit()
    return _row(row) if row else {}


# ── Update ──────────────────────────────────────────────────────────────────

@router.put("/admin/volunteer-reference-requests/{request_id}")
async def update_request(
    request_id: str, body: ReferenceRequestUpdate, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    if body.status is not None and body.status not in VALID_STATUSES:
        raise HTTPException(400, detail=f"status must be one of: {sorted(VALID_STATUSES)}")

    sets: list[str] = []
    params: dict[str, Any] = {"id": request_id}
    for field in ("referee_name", "referee_email", "referee_phone",
                  "relationship", "notes", "status"):
        v = getattr(body, field, None)
        if v is not None:
            sets.append(f"{field} = :{field}")
            params[field] = v
    if body.expires_at is not None:
        try:
            sets.append("expires_at = :expires_at")
            params["expires_at"] = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, detail="expires_at must be ISO datetime") from None
    if body.response_data is not None:
        import json
        sets.append("response_data = CAST(:response_data AS jsonb)")
        params["response_data"] = json.dumps(body.response_data)

    if not sets:
        raise HTTPException(400, detail="No fields to update")

    sets.append("updated_at = NOW()")
    sets_sql = ", ".join(sets)

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        r = (await db.execute(text(f"""
            UPDATE volunteer_reference_requests SET {sets_sql}
            WHERE id::text = :id
            RETURNING *
        """), params)).mappings().first()
        if not r:
            raise HTTPException(404, detail="Reference request not found")
        await db.commit()
    return _row(r)


# ── Soft-delete / cancel ────────────────────────────────────────────────────

@router.delete("/admin/volunteer-reference-requests/{request_id}", status_code=204)
async def cancel_request(request_id: str, ctx: CurrentSpace) -> None:
    """Soft-cancel: flips status=CANCELLED. The row stays for audit; the
    request_token is unchanged so the referee's old link will show
    "cancelled, please contact us" via the public route."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        r = await db.execute(text("""
            UPDATE volunteer_reference_requests
            SET status = 'CANCELLED', updated_at = NOW()
            WHERE id::text = :id
            RETURNING id
        """), {"id": request_id})
        if not r.scalar():
            raise HTTPException(404, detail="Reference request not found")
        await db.commit()


# ── Resend ──────────────────────────────────────────────────────────────────

@router.post("/admin/volunteer-reference-requests/{request_id}/resend")
async def resend_request(
    request_id: str, body: ResendIn, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Bumps send_count + flips status to SENT + (optionally) extends
    expires_at. Email dispatch itself lives in volunteers.py's
    /admin/volunteers/{id}/send-references (uses the same token), so
    admins should hit that route OR this one + the email route. Keeping
    them separate so we can track resends without forcing an email send
    every time."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    params: dict[str, Any] = {"id": request_id, "now": datetime.now(UTC)}
    extra_set = ""
    if body.new_expires_in_days:
        params["exp"] = datetime.now(UTC) + timedelta(days=max(1, body.new_expires_in_days))
        extra_set = ", expires_at = :exp"

    async with SessionLocal() as db:
        r = (await db.execute(text(f"""
            UPDATE volunteer_reference_requests
            SET status      = 'SENT',
                send_count  = send_count + 1,
                sent_at     = :now,
                updated_at  = :now{extra_set}
            WHERE id::text = :id
            RETURNING *
        """), params)).mappings().first()
        if not r:
            raise HTTPException(404, detail="Reference request not found")
        await db.commit()
    return _row(r)


# ── Mark responded ──────────────────────────────────────────────────────────

@router.post("/admin/volunteer-reference-requests/{request_id}/responded")
async def mark_responded(
    request_id: str, body: ReferenceRequestUpdate, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Admin-side mirror of the public referee response endpoint — useful
    if an admin needs to record a response that came in by post / phone
    / email rather than the web form."""
    _require_admin(ctx)
    import json

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    response = json.dumps(body.response_data or {})
    async with SessionLocal() as db:
        r = (await db.execute(text("""
            UPDATE volunteer_reference_requests
            SET status        = 'RESPONDED',
                responded_at  = NOW(),
                response_data = CAST(:resp AS jsonb),
                notes         = COALESCE(NULLIF(:notes,''), notes),
                updated_at    = NOW()
            WHERE id::text = :id
            RETURNING *
        """), {"id": request_id, "resp": response, "notes": body.notes or ""})).mappings().first()
        if not r:
            raise HTTPException(404, detail="Reference request not found")
        await db.commit()
    return _row(r)
