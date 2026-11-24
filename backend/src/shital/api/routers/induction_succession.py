"""
Trustee induction (CC3 + Governance Code 3.3), DBS tracking (CC9),
succession planning (Governance Code 3.5).

Routes:
  GET  /admin/board/induction/items                     taxonomy
  GET  /admin/board/trustees/{tid}/induction            per-trustee progress + pct
  PUT  /admin/board/trustees/{tid}/induction/{code}     mark complete
  DELETE /admin/board/trustees/{tid}/induction/{code}   undo

  PUT  /admin/board/trustees/{tid}/dbs                  update DBS fields
                                                         (CHAIR / SECRETARY /
                                                          SAFEGUARDING_LEAD only)
  GET  /admin/board/dbs-renewals?days=90                upcoming renewals

  GET  /admin/board/succession?years=8                  aggregated heatmap
"""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["induction-succession"])

_FULL_SAFEGUARDING_ROLES = {
    "SUPER_ADMIN", "CHAIR", "SECRETARY", "SAFEGUARDING_LEAD",
}


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR",
                        "SECRETARY", "CEO", "SAFEGUARDING_LEAD"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


def _require_safeguarding(ctx: CurrentSpace) -> None:
    if ctx.role not in _FULL_SAFEGUARDING_ROLES:
        raise HTTPException(status_code=403,
                            detail="DBS fields restricted to Chair / Secretary / Safeguarding Lead / Super Admin")


class InductionItemIn(BaseModel):
    evidence_note: str = ""
    evidence_attachment_id: str | None = None


class DBSUpdateIn(BaseModel):
    dbs_type: str = "NONE"
    dbs_reference: str = ""
    dbs_issued_at: str | None = None
    dbs_valid_until: str | None = None
    dbs_status: str = "NOT_REQUIRED"


class TermUpdateIn(BaseModel):
    term_number: int = Field(default=1, ge=1, le=20)
    term_max_years: int = Field(default=9, ge=1, le=20)


async def _audit(
    db: Any, *, action: str, entity_type: str, entity_id: str,
    ctx: CurrentSpace, metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, :et, CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "et":   entity_type,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


# ── Induction ────────────────────────────────────────────────────────────

@router.get("/admin/board/induction/items")
async def get_induction_items(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT * FROM induction_items WHERE is_active = true "
            "ORDER BY sort_order, title"
        ))).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.get("/admin/board/trustees/{trustee_id}/induction")
async def get_trustee_induction(
    trustee_id: str, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT ii.code, ii.title, ii.category, ii.description,
                   ii.sort_order, ii.is_required,
                   tip.completed_at, tip.completed_by_name,
                   tip.evidence_note, tip.evidence_attachment_id
            FROM   induction_items ii
            LEFT JOIN trustee_induction_progress tip
                   ON tip.item_code = ii.code AND tip.trustee_id::text = :tid
            WHERE  ii.is_active = true
            ORDER  BY ii.sort_order, ii.title
        """), {"tid": trustee_id})).mappings().all()
    total = len(rows)
    done  = sum(1 for r in rows if r["completed_at"] is not None)
    req_total = sum(1 for r in rows if r["is_required"])
    req_done  = sum(1 for r in rows if r["is_required"] and r["completed_at"] is not None)
    return {
        "items": [dict(r) for r in rows],
        "total": total, "completed": done,
        "required_total": req_total, "required_completed": req_done,
        "completion_pct": round(100 * done / total, 1) if total else 0.0,
        "required_completion_pct": round(100 * req_done / req_total, 1) if req_total else 0.0,
    }


@router.put("/admin/board/trustees/{trustee_id}/induction/{code}")
async def mark_induction_complete(
    trustee_id: str, code: str, body: InductionItemIn,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO trustee_induction_progress
            (trustee_id, item_code, completed_by, completed_by_name,
             evidence_note, evidence_attachment_id)
            VALUES (CAST(:tid AS uuid), :code, :by, :nm, :en,
                    CASE WHEN :ea = '' THEN NULL ELSE CAST(:ea AS uuid) END)
            ON CONFLICT (trustee_id, item_code) DO UPDATE SET
              completed_at = NOW(),
              completed_by = EXCLUDED.completed_by,
              completed_by_name = EXCLUDED.completed_by_name,
              evidence_note = EXCLUDED.evidence_note,
              evidence_attachment_id = EXCLUDED.evidence_attachment_id
            RETURNING id
        """), {
            "tid": trustee_id,
            "code": code,
            "by":  str(ctx.user_id) if ctx.user_id else None,
            "nm":  ctx.user_email or "",
            "en":  body.evidence_note.strip(),
            "ea":  body.evidence_attachment_id or "",
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="INDUCTION_COMPLETED",
            entity_type="trustee_induction_progress",
            entity_id=new_id, ctx=ctx,
            metadata={"trustee_id": trustee_id, "item_code": code},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.delete("/admin/board/trustees/{trustee_id}/induction/{code}")
async def unmark_induction(
    trustee_id: str, code: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "DELETE FROM trustee_induction_progress "
            "WHERE trustee_id::text = :tid AND item_code = :c RETURNING id"
        ), {"tid": trustee_id, "c": code})
        if not res.first():
            return {"noop": True, "success": True}
        await _audit(
            db, action="INDUCTION_UNMARKED",
            entity_type="trustee_induction_progress",
            entity_id=trustee_id, ctx=ctx,
            metadata={"trustee_id": trustee_id, "item_code": code},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"success": True}


# ── DBS ──────────────────────────────────────────────────────────────────

@router.put("/admin/board/trustees/{trustee_id}/dbs")
async def update_dbs(
    trustee_id: str, body: DBSUpdateIn,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_safeguarding(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    # Derive status if not explicitly passed.
    status = body.dbs_status
    if body.dbs_valid_until:
        try:
            du = datetime.fromisoformat(body.dbs_valid_until).date()
            status = "VALID" if du >= date.today() else "EXPIRED"
        except ValueError:
            pass
    async with SessionLocal() as db:
        res = await db.execute(text("""
            UPDATE trustees SET
              dbs_type        = :dt,
              dbs_reference   = :dr,
              dbs_issued_at   = :di,
              dbs_valid_until = :dv,
              dbs_status      = :ds,
              updated_at      = NOW()
            WHERE id::text = :id RETURNING id
        """), {
            "dt": body.dbs_type,
            "dr": body.dbs_reference.strip()[:80],
            "di": body.dbs_issued_at,
            "dv": body.dbs_valid_until,
            "ds": status,
            "id": trustee_id,
        })
        if not res.first():
            raise HTTPException(404, detail="Trustee not found")
        await _audit(
            db, action="DBS_UPDATED", entity_type="trustees",
            entity_id=trustee_id, ctx=ctx,
            metadata={"dbs_type": body.dbs_type, "status": status,
                      "valid_until": body.dbs_valid_until},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": trustee_id, "status": status, "success": True}


@router.get("/admin/board/dbs-renewals")
async def dbs_renewals(
    ctx: CurrentSpace, days: int = Query(90, ge=1, le=365),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id, full_name, role, dbs_type, dbs_reference,
                   dbs_issued_at, dbs_valid_until, dbs_status
            FROM   trustees
            WHERE  is_active = true
              AND  dbs_type <> 'NONE'
              AND  dbs_valid_until IS NOT NULL
              AND  dbs_valid_until <= CURRENT_DATE + make_interval(days => :d)
            ORDER  BY dbs_valid_until
        """), {"d": days})).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.put("/admin/board/trustees/{trustee_id}/term")
async def update_term(
    trustee_id: str, body: TermUpdateIn,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "UPDATE trustees SET term_number = :tn, term_max_years = :tm, "
            "updated_at = NOW() WHERE id::text = :id RETURNING id"
        ), {"tn": int(body.term_number), "tm": int(body.term_max_years),
            "id": trustee_id})
        if not res.first():
            raise HTTPException(404, detail="Trustee not found")
        await _audit(
            db, action="TERM_UPDATED", entity_type="trustees",
            entity_id=trustee_id, ctx=ctx,
            metadata={"term_number": body.term_number,
                      "term_max_years": body.term_max_years},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": trustee_id, "success": True}


# ── Succession ──────────────────────────────────────────────────────────

@router.get("/admin/board/succession")
async def succession(
    ctx: CurrentSpace, years: int = Query(8, ge=1, le=15),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        trustees = (await db.execute(text("""
            SELECT id, full_name, role, term_start, term_end,
                   term_number, term_max_years
            FROM   trustees
            WHERE  is_active = true
            ORDER  BY term_end NULLS LAST, full_name
        """))).mappings().all()

    year0 = date.today().year
    years_list = [str(year0 + i) for i in range(years)]
    retirements_by_year: dict[str, int] = {y: 0 for y in years_list}
    cap_warnings: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for t in trustees:
        term_end_year = t["term_end"].year if t["term_end"] else None
        cumulative = 0
        if t["term_start"]:
            cumulative = year0 - t["term_start"].year
        max_years = int(t["term_max_years"] or 9)
        approaching_cap = cumulative >= (max_years - 1)
        if approaching_cap:
            cap_warnings.append({
                "trustee_id": str(t["id"]),
                "name": t["full_name"],
                "cumulative_years": cumulative,
                "max_years": max_years,
            })
        # Fill cell states for each horizon year.
        states: list[str] = []
        for i, y in enumerate(years_list):
            y_int = int(y)
            if term_end_year and y_int > term_end_year:
                states.append("gap")
            elif term_end_year and y_int == term_end_year:
                states.append("retiring")
                retirements_by_year[y] += 1
            else:
                states.append("active")
        rows.append({
            "trustee_id": str(t["id"]),
            "name": t["full_name"],
            "role": t["role"],
            "term_start": t["term_start"].isoformat() if t["term_start"] else None,
            "term_end":   t["term_end"].isoformat()   if t["term_end"]   else None,
            "term_number": int(t["term_number"] or 1),
            "term_max_years": max_years,
            "cumulative_years": cumulative,
            "approaching_cap": approaching_cap,
            "states": states,
        })
    # Mark succession-risk years (3 or more retirements).
    high_risk_years = [y for y, n in retirements_by_year.items() if n >= 3]
    return {
        "years": years_list,
        "trustees": rows,
        "retirements_by_year": retirements_by_year,
        "high_risk_years": high_risk_years,
        "cap_warnings": cap_warnings,
    }
