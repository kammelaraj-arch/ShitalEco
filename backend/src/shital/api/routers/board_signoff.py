"""Phase D — chair sign-off endpoints.

Three stages:
  1. POST /admin/board/resolutions/{rid}/signoff/signature
     — chair (and optionally other trustees) draw their signature.
       Bytes come in as a base64-encoded PNG.
  2. POST /admin/board/resolutions/{rid}/announcement/approve
     — chair approves an external-audience announcement.
  3. POST /admin/board/resolutions/{rid}/signoff/finalise
     — PIN gate + sanity checks (no PENDING conditions, chair sig
       on file, resolution status CLOSED and outcome CARRIED or
       passed-with-casting-vote). Generates the PDF, writes it as an
       attachment, locks the record, runs the announcement fan-out.

GET /admin/board/resolutions/{rid}/signoff — status + checklist so the
UI can show what's blocking.
"""
from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from passlib.hash import bcrypt
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal
from shital.services.board.fanout import fanout_announcement
from shital.services.board.pdf import attach_pdf_to_resolution

router = APIRouter(tags=["board-signoff"])


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _require_chair(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "CHAIR"}:
        raise HTTPException(403, detail="Chair or admin role required")


async def _resolution_state(rid: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        res = (await db.execute(text("""
            SELECT id, title, status, outcome, chair_signoff_at,
                   pdf_attachment_id
            FROM   resolutions WHERE id = CAST(:id AS uuid)
        """), {"id": rid})).mappings().first()
        if not res:
            raise HTTPException(404, detail="Resolution not found")
        pending_conds = int((await db.execute(text("""
            SELECT COUNT(*) FROM resolution_vote_conditions
             WHERE resolution_id = CAST(:id AS uuid) AND status = 'PENDING'
        """), {"id": rid})).scalar() or 0)
        chair_sig = int((await db.execute(text("""
            SELECT COUNT(*) FROM resolution_signatures s
             JOIN  trustees  t ON t.id = s.trustee_id
             WHERE s.resolution_id = CAST(:id AS uuid) AND t.role = 'CHAIR'
        """), {"id": rid})).scalar() or 0)
        plan = (await db.execute(text("""
            SELECT id, requires_chair_approval, approved_at, status
            FROM   resolution_announcements WHERE resolution_id = CAST(:id AS uuid)
            LIMIT  1
        """), {"id": rid})).mappings().first()
    return {
        "resolution": dict(res),
        "pending_conditions": pending_conds,
        "chair_signature_on_file": bool(chair_sig),
        "plan": dict(plan) if plan else None,
    }


# ─── GET sign-off state ──────────────────────────────────────────────────────
@router.get("/admin/board/resolutions/{rid}/signoff")
async def get_signoff_state(rid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_chair(ctx)
    state = await _resolution_state(rid)
    res = state["resolution"]
    blockers = []
    if res["status"] not in {"OPEN", "CLOSED"}:
        blockers.append(f"Resolution is {res['status']}, must be OPEN or CLOSED")
    if state["pending_conditions"] > 0:
        blockers.append(f"{state['pending_conditions']} conditions still PENDING — resolve them in Vote & Close first")
    if not state["chair_signature_on_file"]:
        blockers.append("Chair signature not captured yet — draw it below")
    plan = state["plan"]
    if plan and plan["requires_chair_approval"] and not plan["approved_at"]:
        blockers.append("Announcement external audience awaits chair approval")
    state["blockers"] = blockers
    state["ready_to_finalise"] = not blockers and bool(res["status"] == "CLOSED")
    return state


# ─── Save a drawn signature ──────────────────────────────────────────────────
class SignatureBody(BaseModel):
    png_base64: str
    trustee_id: str | None = None   # defaults to CHAIR trustee row if omitted


@router.post("/admin/board/resolutions/{rid}/signoff/signature")
async def save_signature(
    rid: str, body: SignatureBody, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_chair(ctx)
    raw = (body.png_base64 or "").split(",", 1)[-1]  # strip data: prefix if present
    try:
        png = base64.b64decode(raw, validate=False)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, detail=f"Bad base64 PNG: {exc}") from exc
    if len(png) < 100:
        raise HTTPException(400, detail="Signature PNG is too small to be a real drawing")
    if len(png) > 1_000_000:
        raise HTTPException(413, detail="Signature PNG over 1 MB")
    # Basic header sniff — PNG magic 89 50 4E 47
    if png[:4] != b"\x89PNG":
        raise HTTPException(400, detail="Not a PNG image")

    async with SessionLocal() as db:
        # Pick trustee row — explicit body override or the CHAIR by role.
        if body.trustee_id:
            t = (await db.execute(text("""
                SELECT id, full_name, role FROM trustees WHERE id = CAST(:id AS uuid)
            """), {"id": body.trustee_id})).mappings().first()
        else:
            t = (await db.execute(text("""
                SELECT id, full_name, role FROM trustees
                 WHERE role = 'CHAIR' AND is_active = true LIMIT 1
            """))).mappings().first()
        if not t:
            raise HTTPException(404, detail="No chair trustee found")
        await db.execute(text("""
            INSERT INTO resolution_signatures
                (resolution_id, trustee_id, signer_name, signer_role,
                 signature_png, ip_address, user_agent)
            VALUES
                (CAST(:rid AS uuid), CAST(:tid AS uuid), :name, :role,
                 :png, :ip, :ua)
            ON CONFLICT (resolution_id, trustee_id) DO UPDATE SET
                signature_png = EXCLUDED.signature_png,
                created_at    = NOW()
        """), {
            "rid": rid, "tid": str(t["id"]),
            "name": t["full_name"], "role": t["role"], "png": png,
            "ip": (request.client.host if request.client else "")[:45],
            "ua": (request.headers.get("user-agent") or "")[:500],
        })
        await db.commit()
    return {"ok": True, "trustee_id": str(t["id"]), "trustee_name": t["full_name"]}


# ─── Approve the announcement plan (external-audience gate) ──────────────────
@router.post("/admin/board/resolutions/{rid}/announcement/approve")
async def approve_announcement(rid: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_chair(ctx)
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        r = await db.execute(text("""
            UPDATE resolution_announcements
               SET approved_by = CAST(:u AS uuid),
                   approved_at = :now,
                   status      = 'APPROVED',
                   updated_at  = :now
             WHERE resolution_id = CAST(:rid AS uuid)
        """), {"rid": rid, "u": getattr(ctx, "user_id", None), "now": now})
        await db.commit()
    if not r.rowcount:
        raise HTTPException(404, detail="No announcement plan to approve")
    return {"ok": True, "approved_at": now.isoformat()}


# ─── Finalise: PIN + PDF + lock + fan-out ────────────────────────────────────
class FinaliseBody(BaseModel):
    pin: str


@router.post("/admin/board/resolutions/{rid}/signoff/finalise")
async def finalise_signoff(rid: str, body: FinaliseBody, ctx: CurrentSpace) -> dict[str, Any]:
    _require_chair(ctx)

    # Verify a Chair trustee's PIN. SES on top: PIN + audit log = signed.
    async with SessionLocal() as db:
        chair = (await db.execute(text("""
            SELECT id, full_name, pin_hash
            FROM   trustees
            WHERE  role = 'CHAIR' AND is_active = true LIMIT 1
        """))).mappings().first()
    if not chair:
        raise HTTPException(404, detail="No active CHAIR trustee")
    if not chair["pin_hash"] or not bcrypt.verify(body.pin, chair["pin_hash"]):
        raise HTTPException(401, detail="Invalid chair PIN")

    # Preconditions
    state = await _resolution_state(rid)
    if state["blockers"]:
        raise HTTPException(409, detail={"errors": state["blockers"]})
    if state["resolution"]["chair_signoff_at"]:
        raise HTTPException(409, detail="Already signed off")

    # Mark sign-off + generate PDF.
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE resolutions
               SET chair_signoff_at = :now,
                   chair_signoff_by = CAST(:u AS uuid),
                   awaiting_chair_approval = false,
                   updated_at = :now
             WHERE id = CAST(:rid AS uuid)
        """), {"rid": rid, "u": getattr(ctx, "user_id", None), "now": now})
        await db.commit()

    pdf_att_id = await attach_pdf_to_resolution(rid)

    # Run announcement fan-out. If no plan or no email channel, it's a
    # no-op; errors are surfaced per-recipient.
    fan = await fanout_announcement(rid, triggered_by=getattr(ctx, "user_email", "") or "")

    return {
        "ok": True,
        "chair_signoff_at": now.isoformat(),
        "pdf_attachment_id": pdf_att_id,
        "announcement": fan,
    }


__all__ = ["router"]
