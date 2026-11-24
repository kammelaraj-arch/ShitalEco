"""
Policy register (Charity Governance Code principle 7). One row per
policy (safeguarding, GDPR, finance, etc) with status + next_review_date.

Routes:
  GET  /admin/policies                        list (optional ?category / ?status)
  POST /admin/policies                        create
  GET  /admin/policies/{pid}                  detail + version history
  PUT  /admin/policies/{pid}                  update
  DELETE /admin/policies/{pid}                archive (soft)
  POST /admin/policies/{pid}/new-version      bump version + attach new doc
  GET  /admin/policies/review-due             rows due within N days
"""
from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["policies"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "CEO", "SECRETARY"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


class PolicyIn(BaseModel):
    title: str
    category: str
    summary: str = ""
    owner_user_id: str | None = None
    owner_name: str = ""
    review_period_months: int = 12
    adopted_at: str | None = None
    adopted_at_resolution_id: str | None = None
    status: str = "DRAFT"


class PolicyPatch(BaseModel):
    title: str | None = None
    category: str | None = None
    summary: str | None = None
    owner_user_id: str | None = None
    owner_name: str | None = None
    review_period_months: int | None = None
    adopted_at: str | None = None
    next_review_date: str | None = None
    status: str | None = None


class NewVersionIn(BaseModel):
    summary_of_changes: str = ""
    attachment_id: str | None = None
    adopted_at: str | None = None
    adopted_at_resolution_id: str | None = None


def _next_review(adopted_at: str | None, months: int) -> str | None:
    if not adopted_at:
        return None
    try:
        d = datetime.fromisoformat(adopted_at).date()
    except ValueError:
        return None
    # Approximate month-adds (rollover-safe) — good enough for a
    # one-year-ahead review date; HR/finance strict date math isn't
    # needed here.
    year = d.year + ((d.month - 1 + months) // 12)
    month = ((d.month - 1 + months) % 12) + 1
    day = min(d.day, 28)
    return date(year, month, day).isoformat()


async def _audit(
    db: Any, *, action: str, entity_id: str, ctx: CurrentSpace,
    metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, 'policies', CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


@router.get("/admin/policies")
async def list_policies(
    ctx: CurrentSpace,
    category: str | None = Query(None),
    status: str | None = Query(None),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    conds: list[str] = []
    params: dict[str, Any] = {}
    if category:
        conds.append("category = :c")
        params["c"] = category
    if status:
        conds.append("status = :s")
        params["s"] = status
    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            f"SELECT * FROM policies{where} ORDER BY category, title"
        ), params)).mappings().all()
    return {"policies": [dict(r) for r in rows]}


@router.get("/admin/policies/review-due")
async def review_due(
    ctx: CurrentSpace, days: int = Query(60, ge=1, le=365),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id, title, category, next_review_date, owner_name, status
            FROM   policies
            WHERE  status NOT IN ('ARCHIVED')
              AND  next_review_date IS NOT NULL
              AND  next_review_date <= CURRENT_DATE + make_interval(days => :d)
            ORDER BY next_review_date
        """), {"d": days})).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.post("/admin/policies")
async def create_policy(
    body: PolicyIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    nxt = _next_review(body.adopted_at, int(body.review_period_months))
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO policies
            (title, category, summary, current_version, owner_user_id, owner_name,
             review_period_months, adopted_at, adopted_at_resolution_id,
             next_review_date, status, created_by)
            VALUES (:t, :c, :s, 1,
                    CASE WHEN :ou = '' THEN NULL ELSE CAST(:ou AS uuid) END,
                    :on, :rp, :ad,
                    CASE WHEN :arid = '' THEN NULL ELSE CAST(:arid AS uuid) END,
                    :nxt, :st, :by)
            RETURNING id
        """), {
            "t":    body.title.strip()[:255],
            "c":    body.category,
            "s":    body.summary.strip(),
            "ou":   body.owner_user_id or "",
            "on":   body.owner_name.strip()[:255],
            "rp":   int(body.review_period_months),
            "ad":   body.adopted_at,
            "arid": body.adopted_at_resolution_id or "",
            "nxt":  nxt,
            "st":   body.status,
            "by":   str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="POLICY_CREATED", entity_id=new_id, ctx=ctx,
            metadata={"category": body.category, "title": body.title},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.get("/admin/policies/{policy_id}")
async def get_policy(policy_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT * FROM policies WHERE id::text = :id"
        ), {"id": policy_id})).mappings().one_or_none()
        if not row:
            raise HTTPException(404, detail="Policy not found")
        versions = (await db.execute(text(
            "SELECT * FROM policy_versions WHERE policy_id::text = :id "
            "ORDER BY version_number DESC"
        ), {"id": policy_id})).mappings().all()
    return {"policy": dict(row), "versions": [dict(v) for v in versions]}


@router.put("/admin/policies/{policy_id}")
async def update_policy(
    policy_id: str, body: PolicyPatch, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    data = body.model_dump(exclude_none=True)
    if not data:
        return {"id": policy_id, "success": True, "noop": True}
    # Recompute next_review_date if either adopted_at or
    # review_period_months was passed in without an explicit override.
    if {"adopted_at", "review_period_months"} & data.keys() and "next_review_date" not in data:
        async with SessionLocal() as db:
            cur = (await db.execute(text(
                "SELECT adopted_at, review_period_months FROM policies WHERE id::text = :id"
            ), {"id": policy_id})).mappings().one_or_none()
            if not cur:
                raise HTTPException(404, detail="Policy not found")
            ad = data.get("adopted_at", cur["adopted_at"].isoformat() if cur["adopted_at"] else None)
            rp = int(data.get("review_period_months", cur["review_period_months"]))
            nxt = _next_review(ad, rp)
            if nxt:
                data["next_review_date"] = nxt
    sets = [f"{k} = :{k}" for k in data]
    data["id"]  = policy_id
    data["now"] = datetime.now(UTC)
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        res = await db.execute(text(
            f"UPDATE policies SET {', '.join(sets)} WHERE id::text = :id RETURNING id"
        ), data)
        if not res.first():
            raise HTTPException(404, detail="Policy not found")
        await _audit(
            db, action="POLICY_UPDATED", entity_id=policy_id, ctx=ctx,
            metadata={"fields": list(body.model_dump(exclude_none=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": policy_id, "success": True}


@router.delete("/admin/policies/{policy_id}")
async def archive_policy(
    policy_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "UPDATE policies SET status = 'ARCHIVED', updated_at = NOW() "
            "WHERE id::text = :id RETURNING id"
        ), {"id": policy_id})
        if not res.first():
            raise HTTPException(404, detail="Policy not found")
        await _audit(
            db, action="POLICY_ARCHIVED", entity_id=policy_id, ctx=ctx,
            metadata={},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": policy_id, "success": True}


@router.post("/admin/policies/{policy_id}/new-version")
async def new_version(
    policy_id: str, body: NewVersionIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        pol = (await db.execute(text(
            "SELECT current_version, review_period_months "
            "FROM policies WHERE id::text = :id"
        ), {"id": policy_id})).mappings().one_or_none()
        if not pol:
            raise HTTPException(404, detail="Policy not found")
        next_n = int(pol["current_version"]) + 1
        adopted = body.adopted_at or datetime.now(UTC).date().isoformat()
        nxt = _next_review(adopted, int(pol["review_period_months"]))
        v = (await db.execute(text("""
            INSERT INTO policy_versions
            (policy_id, version_number, summary_of_changes, attachment_id,
             adopted_at, adopted_at_resolution_id, created_by)
            VALUES (CAST(:pid AS uuid), :n, :s,
                    CASE WHEN :att = '' THEN NULL ELSE CAST(:att AS uuid) END,
                    :ad,
                    CASE WHEN :arid = '' THEN NULL ELSE CAST(:arid AS uuid) END,
                    :by)
            RETURNING id
        """), {
            "pid":  policy_id,
            "n":    next_n,
            "s":    body.summary_of_changes.strip(),
            "att":  body.attachment_id or "",
            "ad":   adopted,
            "arid": body.adopted_at_resolution_id or "",
            "by":   str(ctx.user_id) if ctx.user_id else None,
        })).first()
        version_id = str(v[0]) if v else ""
        await db.execute(text("""
            UPDATE policies SET current_version = :n,
                current_attachment_id = CASE WHEN :att = '' THEN current_attachment_id ELSE CAST(:att AS uuid) END,
                adopted_at = :ad,
                adopted_at_resolution_id = CASE WHEN :arid = '' THEN adopted_at_resolution_id ELSE CAST(:arid AS uuid) END,
                next_review_date = :nxt,
                status = 'ACTIVE', updated_at = NOW()
            WHERE id::text = :id
        """), {
            "n":    next_n,
            "att":  body.attachment_id or "",
            "ad":   adopted,
            "arid": body.adopted_at_resolution_id or "",
            "nxt":  nxt,
            "id":   policy_id,
        })
        await _audit(
            db, action="POLICY_VERSION_ADDED", entity_id=policy_id, ctx=ctx,
            metadata={"version_id": version_id, "version_number": next_n},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"policy_id": policy_id, "version_id": version_id,
            "version_number": next_n, "success": True}


# Suppress the unused imports warning — date/timedelta are used indirectly
_ = (date, timedelta)
