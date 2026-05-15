"""Reimbursement claims — employees / trustees / LMC members file an
expense claim with a receipt, auto-routes to their manager for approval.

Receipt is a base64-encoded data URL (photo from the in-app camera, or a
file upload). Stored inline in the DB (receipt_data TEXT) — at temple
volumes the size is acceptable; if it ever isn't, swap to an
object-store blob with a signed URL.

Endpoints (all behind admin auth — only the claimant or a privileged
role sees individual rows, plus the assigned manager):
  POST   /reimbursements                   submit a new claim
  GET    /reimbursements                   list (?role=mine|manager|all)
  GET    /reimbursements/{id}              detail
  PUT    /reimbursements/{id}/approve      approve (manager only)
  PUT    /reimbursements/{id}/reject       reject  (manager only)
  PUT    /reimbursements/{id}/mark-paid    paid    (finance only)
"""
from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(prefix="/reimbursements", tags=["reimbursements"])


VALID_CLAIMANT_TYPES = {"EMPLOYEE", "TRUSTEE", "LMC"}
VALID_CATEGORIES = {
    "GENERAL", "TRAVEL", "MEALS", "OFFICE_SUPPLIES", "EVENT_EXPENSES",
    "TEMPLE_SUPPLIES", "MAINTENANCE", "PROFESSIONAL_FEES", "OTHER",
}
VALID_STATUSES = {"PENDING_APPROVAL", "APPROVED", "REJECTED", "PAID"}

PRIVILEGED_ROLES = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "HR_MANAGER"}


def _privileged(ctx: CurrentSpace) -> bool:
    return (getattr(ctx, "role", "") or "").upper() in PRIVILEGED_ROLES


# ── Schemas ─────────────────────────────────────────────────────────────────

class ReimbursementIn(BaseModel):
    claimant_type: str = "EMPLOYEE"
    claimant_id: str | None = None
    claimant_name: str = ""
    claimant_email: str = ""
    branch_id: str = ""             # blank → caller's branch
    amount: float
    currency: str = "GBP"
    category: str = "GENERAL"
    expense_date: str | None = None  # YYYY-MM-DD
    description: str = ""
    receipt_data: str | None = None  # base64 data URL or raw base64
    receipt_mime: str | None = None
    manager_id: str | None = None
    manager_name: str = ""


class ReviewIn(BaseModel):
    notes: str = ""


class PaymentIn(BaseModel):
    method: str = ""        # 'bank_transfer' | 'cash' | 'cheque' | ...
    reference: str = ""


# ── Helpers ─────────────────────────────────────────────────────────────────

def _row(r: Any) -> dict[str, Any]:
    d = dict(r)
    for k in ("id", "claimant_id", "manager_id", "reviewed_by"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    if d.get("expense_date") is not None and hasattr(d["expense_date"], "isoformat"):
        d["expense_date"] = d["expense_date"].isoformat()
    for k in ("reviewed_at", "paid_at", "created_at", "updated_at"):
        if d.get(k) is not None and hasattr(d[k], "isoformat"):
            d[k] = d[k].isoformat()
    if d.get("amount") is not None:
        try:
            d["amount"] = float(d["amount"])
        except (TypeError, ValueError):
            d["amount"] = 0.0
    return d


# ── List ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_claims(
    ctx: CurrentSpace,
    role: str = "mine",          # mine | manager | all
    status: str | None = None,
    branch_id: str = "",
    limit: int = 200,
    page: int = 1,
    per_page: int = 20,
) -> dict[str, Any]:
    """List reimbursement claims.

    role=mine     → only ones I filed (claimant_id = me)
    role=manager  → ones routed to me for approval (manager_id = me) +
                    everything in my branch if I'm a privileged role
    role=all      → privileged-roles see everything; non-privileged are
                    still scoped to their own claimant_id

    Always paginated; total returned so the new <Pagination/> widget
    displays "from-to of N".
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where = ["1=1"]
    params: dict[str, Any] = {
        "limit": min(max(1, per_page), 200),
        "offset": max(0, (page - 1) * per_page),
    }

    role = (role or "mine").lower()
    me = str(getattr(ctx, "user_id", "") or "")

    if role == "mine":
        where.append("claimant_id::text = :me")
        params["me"] = me
    elif role == "manager":
        if _privileged(ctx) and branch_id:
            where.append("(manager_id::text = :me OR branch_id = :bid)")
            params["me"]  = me
            params["bid"] = branch_id
        else:
            where.append("manager_id::text = :me")
            params["me"] = me
    elif role == "all":
        if not _privileged(ctx):
            # Non-privileged: silently scope to own
            where.append("claimant_id::text = :me")
            params["me"] = me
    else:
        raise HTTPException(400, detail="role must be one of: mine, manager, all")

    if status:
        if status not in VALID_STATUSES:
            raise HTTPException(400, detail=f"status must be one of: {sorted(VALID_STATUSES)}")
        where.append("status = :status")
        params["status"] = status

    if branch_id and role != "manager":
        where.append("branch_id = :bid")
        params["bid"] = branch_id

    where_sql = " AND ".join(where)

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id, claimant_type, claimant_id, claimant_name, claimant_email,
                   branch_id, amount, currency, category, expense_date, description,
                   receipt_mime,
                   -- Don't return the full receipt_data in the list; the
                   -- detail endpoint pulls it on demand. This keeps list
                   -- responses sane when receipts run to a few MB each.
                   (receipt_data IS NOT NULL) AS has_receipt,
                   status, manager_id, manager_name,
                   reviewed_by, reviewed_by_name, reviewed_at, review_notes,
                   payment_method, payment_ref, paid_at,
                   created_at, updated_at
            FROM reimbursement_claims
            WHERE {where_sql}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """), params)).mappings().all()

        total_row = (await db.execute(
            text(f"SELECT COUNT(*) AS cnt FROM reimbursement_claims WHERE {where_sql}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).mappings().first()

    items = [_row(r) for r in rows]
    return {"items": items, "total": int(total_row["cnt"]) if total_row else 0,
            "page": page, "per_page": per_page}


# ── Detail (includes receipt_data) ──────────────────────────────────────────

@router.get("/{claim_id}")
async def get_claim(claim_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        r = (await db.execute(text("""
            SELECT * FROM reimbursement_claims WHERE id = :id
        """), {"id": claim_id})).mappings().first()
    if not r:
        raise HTTPException(404, detail="Claim not found")
    me = str(getattr(ctx, "user_id", "") or "")
    # Access control: claimant, manager, or privileged role.
    if (str(r.get("claimant_id") or "") != me
        and str(r.get("manager_id") or "") != me
        and not _privileged(ctx)):
        raise HTTPException(403, detail="Not authorised to view this claim")
    return _row(r)


# ── Create ──────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_claim(body: ReimbursementIn, ctx: CurrentSpace) -> dict[str, Any]:
    if body.amount is None or body.amount <= 0:
        raise HTTPException(400, detail="amount must be > 0")
    if body.claimant_type not in VALID_CLAIMANT_TYPES:
        raise HTTPException(400, detail=f"claimant_type must be one of: {sorted(VALID_CLAIMANT_TYPES)}")
    if body.category not in VALID_CATEGORIES:
        # Allow free-text categories too, but flag.
        # Don't 400 — temple needs flexibility.
        pass

    exp_date: date | None = None
    if body.expense_date:
        try:
            exp_date = date.fromisoformat(body.expense_date)
        except ValueError:
            raise HTTPException(400, detail="expense_date must be YYYY-MM-DD") from None

    me_id    = str(getattr(ctx, "user_id", "") or "")
    me_email = getattr(ctx, "user_email", "") or ""
    branch_id = (body.branch_id or getattr(ctx, "branch_id", "") or "main").strip() or "main"

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    claim_id = str(uuid.uuid4())
    now = datetime.now(UTC)

    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO reimbursement_claims
                (id, claimant_type, claimant_id, claimant_name, claimant_email,
                 branch_id, amount, currency, category, expense_date, description,
                 receipt_data, receipt_mime,
                 status, manager_id, manager_name,
                 created_at, updated_at)
            VALUES (:id, :ctype, :cid, :cname, :cemail,
                    :bid, :amt, :curr, :cat, :exp, :desc,
                    :rdata, :rmime,
                    'PENDING_APPROVAL', :mgr_id, :mgr_name,
                    :now, :now)
        """), {
            "id": claim_id,
            "ctype":   body.claimant_type,
            "cid":     body.claimant_id or me_id or None,
            "cname":   body.claimant_name,
            "cemail":  body.claimant_email or me_email,
            "bid":     branch_id,
            "amt":     float(body.amount),
            "curr":    (body.currency or "GBP").upper(),
            "cat":     body.category or "GENERAL",
            "exp":     exp_date,
            "desc":    body.description,
            "rdata":   body.receipt_data,
            "rmime":   body.receipt_mime,
            "mgr_id":  body.manager_id,
            "mgr_name": body.manager_name,
            "now":     now,
        })
        await db.commit()

    return {"id": claim_id, "status": "PENDING_APPROVAL"}


# ── Approve / Reject / Mark-paid ────────────────────────────────────────────

async def _transition(claim_id: str, ctx: CurrentSpace, new_status: str,
                      notes: str = "", payment: PaymentIn | None = None) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    me = str(getattr(ctx, "user_id", "") or "")
    me_name = getattr(ctx, "user_email", "") or "system"

    async with SessionLocal() as db:
        r = (await db.execute(
            text("SELECT * FROM reimbursement_claims WHERE id = :id"),
            {"id": claim_id},
        )).mappings().first()
        if not r:
            raise HTTPException(404, detail="Claim not found")

        # Approve / reject — manager or privileged role.
        if new_status in ("APPROVED", "REJECTED"):
            if not _privileged(ctx) and str(r.get("manager_id") or "") != me:
                raise HTTPException(403, detail="Only the manager (or admin) can approve/reject")
            if r["status"] != "PENDING_APPROVAL":
                raise HTTPException(409, detail=f"Claim is {r['status']}, not pending")

        # Mark paid — privileged role only (typically finance).
        if new_status == "PAID":
            if not _privileged(ctx):
                raise HTTPException(403, detail="Only accountant/admin can mark paid")
            if r["status"] != "APPROVED":
                raise HTTPException(409, detail=f"Claim must be APPROVED before paying, currently {r['status']}")

        params: dict[str, Any] = {
            "id":     claim_id,
            "status": new_status,
            "by":     me or None,
            "by_name": me_name,
            "notes":  notes or "",
            "now":    datetime.now(UTC),
        }
        if new_status == "PAID" and payment:
            params["pmethod"] = payment.method
            params["pref"]    = payment.reference
            await db.execute(text("""
                UPDATE reimbursement_claims
                SET status = :status,
                    payment_method = :pmethod,
                    payment_ref    = :pref,
                    paid_at        = :now,
                    updated_at     = :now
                WHERE id = :id
            """), params)
        else:
            await db.execute(text("""
                UPDATE reimbursement_claims
                SET status            = :status,
                    reviewed_by       = :by,
                    reviewed_by_name  = :by_name,
                    reviewed_at       = :now,
                    review_notes      = :notes,
                    updated_at        = :now
                WHERE id = :id
            """), params)
        await db.commit()

    return {"id": claim_id, "status": new_status}


@router.put("/{claim_id}/approve")
async def approve_claim(claim_id: str, body: ReviewIn, ctx: CurrentSpace) -> dict[str, Any]:
    return await _transition(claim_id, ctx, "APPROVED", notes=body.notes)


@router.put("/{claim_id}/reject")
async def reject_claim(claim_id: str, body: ReviewIn, ctx: CurrentSpace) -> dict[str, Any]:
    return await _transition(claim_id, ctx, "REJECTED", notes=body.notes)


@router.put("/{claim_id}/mark-paid")
async def mark_paid(claim_id: str, body: PaymentIn, ctx: CurrentSpace) -> dict[str, Any]:
    return await _transition(claim_id, ctx, "PAID", payment=body)
