"""
Serious Incident Report (SIR) — Charity Commission CC28.

Routes:
  GET  /admin/compliance/sir                list (summary only for
                                              non-privileged viewers)
  POST /admin/compliance/sir                create
  GET  /admin/compliance/sir/{sid}          detail — access-logged
  PUT  /admin/compliance/sir/{sid}          edit
  POST /admin/compliance/sir/{sid}/updates  append timeline update
  POST /admin/compliance/sir/{sid}/mark-reported
                                            flag Commission report + ref
  POST /admin/compliance/sir/{sid}/resolve  close with resolution summary

Access policy
-------------
The SIR register is the single most sensitive module. Full read /
write access is restricted to CHAIR / SECRETARY / SAFEGUARDING_LEAD
/ SUPER_ADMIN. Other admin-role users see redacted summaries in the
list and are denied the detail endpoint.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["sir"])

_FULL_ACCESS_ROLES = {
    "SUPER_ADMIN", "CHAIR", "SECRETARY", "SAFEGUARDING_LEAD",
}
_SUMMARY_ACCESS_ROLES = _FULL_ACCESS_ROLES | {
    "ADMIN", "TRUSTEE", "CEO",
}


def _require_summary(ctx: CurrentSpace) -> None:
    if ctx.role not in _SUMMARY_ACCESS_ROLES:
        raise HTTPException(status_code=403, detail="Restricted — CC28 register")


def _require_full(ctx: CurrentSpace) -> None:
    if ctx.role not in _FULL_ACCESS_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Full SIR access restricted to CHAIR / SECRETARY / "
                   "SAFEGUARDING_LEAD / SUPER_ADMIN",
        )


class SIRIn(BaseModel):
    category: str
    severity: str = "MEDIUM"
    title: str
    summary: str = ""
    date_occurred: str | None = None
    date_discovered: str | None = None
    affected_parties: str = ""
    impact_assessment: str = ""
    actions_taken: str = ""
    further_actions_planned: str = ""
    commission_reportable: bool = False
    reporter_name: str = ""


class SIRPatch(BaseModel):
    category: str | None = None
    severity: str | None = None
    title: str | None = None
    summary: str | None = None
    date_occurred: str | None = None
    date_discovered: str | None = None
    affected_parties: str | None = None
    impact_assessment: str | None = None
    actions_taken: str | None = None
    further_actions_planned: str | None = None
    commission_reportable: bool | None = None
    reported_to_police: bool | None = None
    police_reference: str | None = None
    reported_to_ico: bool | None = None
    reported_to_insurer: bool | None = None
    status: str | None = None


class SIRUpdateIn(BaseModel):
    body: str


class MarkReportedIn(BaseModel):
    commission_reference: str = ""


class ResolveIn(BaseModel):
    resolution_summary: str = ""


async def _next_ref(db: Any) -> str:
    from sqlalchemy import text
    row = (await db.execute(text(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(ref FROM 5) AS INT)), 0) AS n "
        "FROM serious_incidents WHERE ref LIKE 'SIR-%'"
    ))).first()
    n = int(row[0]) if row else 0
    return f"SIR-{n + 1:04d}"


async def _audit(
    db: Any, *, action: str, entity_id: str, ctx: CurrentSpace,
    metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, 'serious_incidents', CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


@router.get("/admin/compliance/sir")
async def list_incidents(ctx: CurrentSpace) -> dict[str, Any]:
    """List all incidents. Non-privileged viewers get summary-only rows
    (ref, severity, status, category, title)."""
    _require_summary(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    is_full = ctx.role in _FULL_ACCESS_ROLES
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT * FROM serious_incidents ORDER BY created_at DESC"
        ))).mappings().all()
    out: list[dict[str, Any]] = []
    for r in rows:
        if is_full:
            out.append(dict(r))
        else:
            out.append({
                "id": str(r["id"]),
                "ref": r["ref"],
                "category": r["category"],
                "severity": r["severity"],
                "title": "— restricted —",
                "status": r["status"],
                "created_at": r["created_at"],
                "redacted": True,
            })
    return {"incidents": out, "restricted": not is_full}


@router.post("/admin/compliance/sir")
async def create_incident(
    body: SIRIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_full(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        ref = await _next_ref(db)
        row = (await db.execute(text("""
            INSERT INTO serious_incidents
            (ref, category, severity, title, summary,
             date_occurred, date_discovered,
             affected_parties, impact_assessment,
             actions_taken, further_actions_planned,
             commission_reportable, reporter_user_id, reporter_name,
             created_by)
            VALUES (:ref, :c, :s, :t, :sm,
                    :do, :dd, :ap, :ia, :at, :fa,
                    :cr, :ru, :rn, :by)
            RETURNING id
        """), {
            "ref": ref,
            "c":   body.category,
            "s":   body.severity,
            "t":   body.title.strip()[:255],
            "sm":  body.summary.strip(),
            "do":  body.date_occurred,
            "dd":  body.date_discovered,
            "ap":  body.affected_parties.strip(),
            "ia":  body.impact_assessment.strip(),
            "at":  body.actions_taken.strip(),
            "fa":  body.further_actions_planned.strip(),
            "cr":  body.commission_reportable,
            "ru":  str(ctx.user_id) if ctx.user_id else None,
            "rn":  body.reporter_name.strip()[:255] or ctx.user_email or "",
            "by":  str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="SIR_CREATED", entity_id=new_id, ctx=ctx,
            metadata={"ref": ref, "category": body.category,
                      "severity": body.severity,
                      "commission_reportable": body.commission_reportable},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "ref": ref, "success": True}


@router.get("/admin/compliance/sir/{sir_id}")
async def get_incident(sir_id: str, request: Request, ctx: CurrentSpace) -> dict[str, Any]:
    _require_full(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT * FROM serious_incidents WHERE id::text = :id"
        ), {"id": sir_id})).mappings().one_or_none()
        if not row:
            raise HTTPException(404, detail="Incident not found")
        updates = (await db.execute(text(
            "SELECT * FROM sir_updates WHERE sir_id::text = :id "
            "ORDER BY created_at"
        ), {"id": sir_id})).mappings().all()
        # Access log — every read of a SIR row.
        await _audit(
            db, action="SIR_VIEWED", entity_id=sir_id, ctx=ctx,
            metadata={"ref": row["ref"]},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"incident": dict(row), "updates": [dict(u) for u in updates]}


@router.put("/admin/compliance/sir/{sir_id}")
async def update_incident(
    sir_id: str, body: SIRPatch, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_full(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    data = body.model_dump(exclude_none=True)
    if not data:
        return {"id": sir_id, "success": True, "noop": True}
    sets = [f"{k} = :{k}" for k in data]
    data["id"]  = sir_id
    data["now"] = datetime.now(UTC)
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        res = await db.execute(text(
            f"UPDATE serious_incidents SET {', '.join(sets)} WHERE id::text = :id RETURNING id"
        ), data)
        if not res.first():
            raise HTTPException(404, detail="Incident not found")
        await _audit(
            db, action="SIR_UPDATED", entity_id=sir_id, ctx=ctx,
            metadata={"fields": list(body.model_dump(exclude_none=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": sir_id, "success": True}


@router.post("/admin/compliance/sir/{sir_id}/updates")
async def append_update(
    sir_id: str, body: SIRUpdateIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_full(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO sir_updates (sir_id, body, author_user_id, author_name)
            VALUES (CAST(:sid AS uuid), :b, :uid, :nm)
            RETURNING id
        """), {
            "sid": sir_id,
            "b":   body.body.strip(),
            "uid": str(ctx.user_id) if ctx.user_id else None,
            "nm":  ctx.user_email or "",
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="SIR_UPDATE_APPENDED", entity_id=sir_id, ctx=ctx,
            metadata={"update_id": new_id, "chars": len(body.body)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.post("/admin/compliance/sir/{sir_id}/mark-reported")
async def mark_reported(
    sir_id: str, body: MarkReportedIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_full(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text("""
            UPDATE serious_incidents SET
              reported_to_commission = true,
              commission_reported_at = NOW(),
              commission_reference = :cr,
              updated_at = NOW()
            WHERE id::text = :id RETURNING id
        """), {"cr": body.commission_reference.strip()[:80], "id": sir_id})
        if not res.first():
            raise HTTPException(404, detail="Incident not found")
        await _audit(
            db, action="SIR_REPORTED_TO_COMMISSION", entity_id=sir_id, ctx=ctx,
            metadata={"commission_reference": body.commission_reference},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": sir_id, "success": True}


@router.post("/admin/compliance/sir/{sir_id}/resolve")
async def resolve(
    sir_id: str, body: ResolveIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_full(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text("""
            UPDATE serious_incidents SET
              status = 'RESOLVED',
              resolved_at = NOW(),
              resolution_summary = :rs,
              updated_at = NOW()
            WHERE id::text = :id RETURNING id
        """), {"rs": body.resolution_summary.strip(), "id": sir_id})
        if not res.first():
            raise HTTPException(404, detail="Incident not found")
        await _audit(
            db, action="SIR_RESOLVED", entity_id=sir_id, ctx=ctx,
            metadata={"chars": len(body.resolution_summary)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": sir_id, "success": True}
