"""
Risk Register — CC26 compliant organisation-wide risk log.

Routes:
  GET  /admin/risk-register                             — list + filters
  POST /admin/risk-register                             — create
  GET  /admin/risk-register/{rid}                       — one row
  PUT  /admin/risk-register/{rid}                       — update
  DELETE /admin/risk-register/{rid}                     — soft delete via status
  GET  /admin/risk-register/taxonomy                    — categories + levels + treatments

  GET  /admin/board/resolutions/{rid}/risks             — per-resolution risks
  POST /admin/board/resolutions/{rid}/risks             — add one
  PUT  /admin/board/resolutions/{rid}/risks/{xid}       — edit
  DELETE /admin/board/resolutions/{rid}/risks/{xid}     — remove
  POST /admin/board/resolutions/{rid}/risks/{xid}/promote — manual promote

Auto-promote: `services.board.governance.promote_resolution_risks(rid)`
is called from `publish_resolution` so every risk flagged
`auto_promote=true` lands in the main register at publish time.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["risk-register"])


# ── Helpers ─────────────────────────────────────────────────────────────────

def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "CEO", "ACCOUNTANT"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


def _clamp(v: int | None, lo: int, hi: int, default: int) -> int:
    if v is None:
        return default
    try:
        v = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


async def _next_risk_ref(db: Any) -> str:
    from sqlalchemy import text
    row = (await db.execute(text(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(risk_ref FROM 4) AS INT)), 0) AS n "
        "FROM risk_register WHERE risk_ref LIKE 'RR-%'"
    ))).first()
    n = int(row[0]) if row else 0
    return f"RR-{n + 1:04d}"


async def _audit(
    db: Any, *, action: str, entity_id: str, ctx: CurrentSpace,
    metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, 'risk_register', :eid, CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid": str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act": action,
        "eid": entity_id,
        "meta": __import__("json").dumps(metadata),
        "ip": ip, "ua": ua,
    })


# ── Pydantic shapes ─────────────────────────────────────────────────────────

class RiskIn(BaseModel):
    title: str
    description: str = ""
    category: str
    scope: str = "OPERATIONAL"
    branch_id: str | None = None
    owner_user_id: str | None = None
    likelihood: int = Field(default=1, ge=1, le=5)
    impact: int = Field(default=1, ge=1, le=5)
    treatment: str = "TREAT"
    mitigation_plan: str = ""
    review_date: str | None = None  # YYYY-MM-DD
    status: str = "OPEN"


class RiskPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    scope: str | None = None
    branch_id: str | None = None
    owner_user_id: str | None = None
    likelihood: int | None = None
    impact: int | None = None
    treatment: str | None = None
    mitigation_plan: str | None = None
    review_date: str | None = None
    status: str | None = None


class ResolutionRiskIn(BaseModel):
    title: str
    description: str = ""
    category: str
    scope: str = "OPERATIONAL"
    likelihood: int = Field(default=1, ge=1, le=5)
    impact: int = Field(default=1, ge=1, le=5)
    treatment: str = "TREAT"
    mitigation_plan: str = ""
    auto_promote: bool = True


# ── Taxonomy endpoint ───────────────────────────────────────────────────────

@router.get("/admin/risk-register/taxonomy")
async def risk_taxonomy(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        cats = (await db.execute(text(
            "SELECT code, label, description, sort_order FROM risk_categories "
            "WHERE is_active = true ORDER BY sort_order, label"
        ))).mappings().all()
        levels = (await db.execute(text(
            "SELECT code, label, min_score, max_score, colour_hex, sort_order FROM risk_levels "
            "ORDER BY sort_order"
        ))).mappings().all()
        treatments = (await db.execute(text(
            "SELECT code, label, description, sort_order FROM risk_treatments "
            "ORDER BY sort_order"
        ))).mappings().all()
    return {
        "categories": [dict(r) for r in cats],
        "levels":     [dict(r) for r in levels],
        "treatments": [dict(r) for r in treatments],
        "scopes": [
            {"code": "STRATEGIC",    "label": "Strategic (board owned)"},
            {"code": "OPERATIONAL",  "label": "Operational (CEO/manager owned)"},
            {"code": "COMPLIANCE",   "label": "Compliance (trustees own)"},
            {"code": "PROJECT",      "label": "Project (sponsor owned)"},
        ],
    }


# ── Register CRUD ───────────────────────────────────────────────────────────

@router.get("/admin/risk-register")
async def list_register(
    ctx: CurrentSpace,
    scope: str | None = Query(None),
    status: str | None = Query(None),
    category: str | None = Query(None),
    branch_id: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    conds: list[str] = []
    params: dict[str, Any] = {"lim": limit}
    if scope:
        conds.append("scope = :scope")
        params["scope"] = scope
    if status:
        conds.append("status = :status")
        params["status"] = status
    if category:
        conds.append("category = :cat")
        params["cat"] = category
    if branch_id:
        conds.append("branch_id::text = :bid")
        params["bid"] = branch_id
    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT * FROM risk_register" + where
            + " ORDER BY score DESC, risk_ref LIMIT :lim"
        ), params)).mappings().all()
    return {"risks": [dict(r) for r in rows]}


@router.post("/admin/risk-register")
async def create_risk(body: RiskIn, request: Request, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    lk = _clamp(body.likelihood, 1, 5, 1)
    im = _clamp(body.impact, 1, 5, 1)
    async with SessionLocal() as db:
        ref = await _next_risk_ref(db)
        row = (await db.execute(text("""
            INSERT INTO risk_register
            (risk_ref, title, description, category, scope, branch_id, owner_user_id,
             likelihood, impact, score, treatment, mitigation_plan, status, review_date,
             source_type, source_id, created_by)
            VALUES
            (:ref, :title, :desc, :cat, :scope, :bid, :own,
             :lk, :im, :sc, :tr, :mit, :st, :rd,
             'MANUAL', NULL, :by)
            RETURNING id
        """), {
            "ref": ref,
            "title": body.title.strip()[:255],
            "desc":  body.description.strip(),
            "cat":   body.category,
            "scope": body.scope,
            "bid":   body.branch_id,
            "own":   body.owner_user_id,
            "lk":    lk, "im": im, "sc": lk * im,
            "tr":    body.treatment,
            "mit":   body.mitigation_plan.strip(),
            "st":    body.status,
            "rd":    body.review_date,
            "by":    str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="RISK_CREATED", entity_id=new_id, ctx=ctx,
            metadata={"risk_ref": ref, "scope": body.scope, "category": body.category,
                      "score": lk * im, "source": "manual"},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "risk_ref": ref, "success": True}


@router.get("/admin/risk-register/{risk_id}")
async def get_risk(risk_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT * FROM risk_register WHERE id::text = :id"
        ), {"id": risk_id})).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Risk not found")
    return {"risk": dict(row)}


@router.put("/admin/risk-register/{risk_id}")
async def update_risk(
    risk_id: str, body: RiskPatch, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    sets: list[str] = []
    params: dict[str, Any] = {"id": risk_id, "now": datetime.now(UTC)}
    data = body.model_dump(exclude_none=True)
    # Clamp likelihood/impact + recompute score if either moved.
    if "likelihood" in data:
        data["likelihood"] = _clamp(data["likelihood"], 1, 5, 1)
    if "impact" in data:
        data["impact"] = _clamp(data["impact"], 1, 5, 1)
    if {"likelihood", "impact"} & data.keys():
        # Fetch current to compute final score, then write all three.
        async with SessionLocal() as db:
            cur = (await db.execute(text(
                "SELECT likelihood, impact FROM risk_register WHERE id::text = :id"
            ), {"id": risk_id})).first()
            if not cur:
                raise HTTPException(404, detail="Risk not found")
            cur_lk = int(cur[0])
            cur_im = int(cur[1])
        lk = int(data.get("likelihood", cur_lk))
        im = int(data.get("impact", cur_im))
        data["score"] = lk * im
    for k, v in data.items():
        sets.append(f"{k} = :{k}")
        params[k] = v
    if not sets:
        return {"id": risk_id, "success": True, "noop": True}
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        res = await db.execute(text(
            f"UPDATE risk_register SET {', '.join(sets)} WHERE id::text = :id RETURNING id"
        ), params)
        if not res.first():
            raise HTTPException(404, detail="Risk not found")
        await _audit(
            db, action="RISK_UPDATED", entity_id=risk_id, ctx=ctx,
            metadata={"fields": list(data.keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": risk_id, "success": True}


@router.delete("/admin/risk-register/{risk_id}")
async def delete_risk(risk_id: str, request: Request, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        # Soft-close rather than drop; the register is a legal record.
        res = await db.execute(text(
            "UPDATE risk_register SET status = 'CLOSED', updated_at = NOW() "
            "WHERE id::text = :id RETURNING id"
        ), {"id": risk_id})
        if not res.first():
            raise HTTPException(404, detail="Risk not found")
        await _audit(
            db, action="RISK_CLOSED", entity_id=risk_id, ctx=ctx,
            metadata={"via": "soft-delete"},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": risk_id, "success": True}


# ── Per-resolution risk entries ─────────────────────────────────────────────

@router.get("/admin/board/resolutions/{resolution_id}/risks")
async def list_resolution_risks(resolution_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT rr.*, r.risk_ref AS register_ref
            FROM   resolution_risks rr
            LEFT JOIN risk_register r ON r.id = rr.promoted_register_id
            WHERE  rr.resolution_id::text = :id
            ORDER  BY rr.created_at
        """), {"id": resolution_id})).mappings().all()
    return {"risks": [dict(r) for r in rows]}


@router.post("/admin/board/resolutions/{resolution_id}/risks")
async def add_resolution_risk(
    resolution_id: str, body: ResolutionRiskIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    lk = _clamp(body.likelihood, 1, 5, 1)
    im = _clamp(body.impact, 1, 5, 1)
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO resolution_risks
            (resolution_id, title, description, category, scope, likelihood, impact,
             treatment, mitigation_plan, auto_promote, created_by)
            VALUES
            (CAST(:rid AS uuid), :title, :desc, :cat, :scope, :lk, :im,
             :tr, :mit, :ap, :by)
            RETURNING id
        """), {
            "rid": resolution_id,
            "title": body.title.strip()[:255],
            "desc":  body.description.strip(),
            "cat":   body.category,
            "scope": body.scope,
            "lk":    lk, "im": im,
            "tr":    body.treatment,
            "mit":   body.mitigation_plan.strip(),
            "ap":    body.auto_promote,
            "by":    str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="RESOLUTION_RISK_ADDED", entity_id=resolution_id, ctx=ctx,
            metadata={"risk_id": new_id, "score": lk * im, "scope": body.scope,
                      "category": body.category, "auto_promote": body.auto_promote},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.delete("/admin/board/resolutions/{resolution_id}/risks/{risk_id}")
async def delete_resolution_risk(
    resolution_id: str, risk_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "DELETE FROM resolution_risks WHERE id::text = :id "
            "AND resolution_id::text = :rid RETURNING id"
        ), {"id": risk_id, "rid": resolution_id})
        if not res.first():
            raise HTTPException(404, detail="Resolution risk not found")
        await _audit(
            db, action="RESOLUTION_RISK_REMOVED", entity_id=resolution_id, ctx=ctx,
            metadata={"risk_id": risk_id},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": risk_id, "success": True}


@router.post("/admin/board/resolutions/{resolution_id}/risks/{risk_id}/promote")
async def promote_resolution_risk(
    resolution_id: str, risk_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Explicit single-row promote. Used from the UI when the resolution
    isn't published yet but the admin wants to seed the register now."""
    _require_admin(ctx)
    from shital.services.board.governance import promote_single_resolution_risk
    out = await promote_single_resolution_risk(
        resolution_id=resolution_id, risk_id=risk_id, ctx=ctx,
        ip=(request.client.host if request.client else ""),
        ua=request.headers.get("user-agent", ""),
    )
    return out
