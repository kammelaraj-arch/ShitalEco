"""
Trustee Interests & Related Parties — CC27 + SORP §9.14 register.

Each trustee discloses:
  * their standing interests (employments, directorships, ownerships,
    etc.) — used to auto-detect conflicts against a resolution's subject;
  * their related parties — used for SORP annual-report disclosure.

Routes:
  GET  /admin/board/trustees/{tid}/interests
  POST /admin/board/trustees/{tid}/interests
  PUT  /admin/board/trustees/{tid}/interests/{iid}
  DELETE /admin/board/trustees/{tid}/interests/{iid}

  GET  /admin/board/trustees/{tid}/related-parties
  POST /admin/board/trustees/{tid}/related-parties
  DELETE /admin/board/trustees/{tid}/related-parties/{rpid}

  GET  /admin/board/resolutions/{rid}/conflicts   — matched + manual
  POST /admin/board/resolutions/{rid}/conflicts   — record declaration
  POST /admin/board/resolutions/{rid}/conflicts/auto-detect  — rerun scan
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["trustee-interests"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "CEO", "SECRETARY"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


async def _audit(
    db: Any, *, action: str, entity_type: str, entity_id: str, ctx: CurrentSpace,
    metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, :et, :eid, CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid": str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act": action,
        "et":  entity_type,
        "eid": entity_id,
        "meta": __import__("json").dumps(metadata),
        "ip": ip, "ua": ua,
    })


class InterestIn(BaseModel):
    category: str
    counterparty: str = ""
    description: str = ""
    keywords: str = ""
    expires_at: str | None = None


class InterestPatch(BaseModel):
    category: str | None = None
    counterparty: str | None = None
    description: str | None = None
    keywords: str | None = None
    expires_at: str | None = None
    status: str | None = None


class RelatedPartyIn(BaseModel):
    related_name: str
    relationship: str
    notes: str = ""


class ConflictDeclarationIn(BaseModel):
    trustee_id: str
    reason: str = ""
    decision: str = "RECUSED"   # RECUSED | PARTICIPATED_WITH_DECLARATION | NOT_A_CONFLICT
    matched_interest_id: str | None = None


# ── Interests ──────────────────────────────────────────────────────────────

@router.get("/admin/board/trustees/{trustee_id}/interests")
async def list_interests(trustee_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT * FROM trustee_interests WHERE trustee_id::text = :tid "
            "ORDER BY declared_at DESC"
        ), {"tid": trustee_id})).mappings().all()
    return {"interests": [dict(r) for r in rows]}


@router.post("/admin/board/trustees/{trustee_id}/interests")
async def add_interest(
    trustee_id: str, body: InterestIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    kw = body.keywords.strip() or body.counterparty.strip()
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO trustee_interests
            (trustee_id, category, counterparty, description, keywords,
             expires_at, created_by)
            VALUES (CAST(:tid AS uuid), :cat, :cp, :desc, :kw, :exp, :by)
            RETURNING id
        """), {
            "tid": trustee_id,
            "cat": body.category,
            "cp":  body.counterparty.strip()[:255],
            "desc": body.description.strip(),
            "kw":  kw,
            "exp": body.expires_at,
            "by":  str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="INTEREST_DECLARED", entity_type="trustee_interests",
            entity_id=new_id, ctx=ctx,
            metadata={"trustee_id": trustee_id, "category": body.category,
                      "counterparty": body.counterparty},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.put("/admin/board/trustees/{trustee_id}/interests/{interest_id}")
async def update_interest(
    trustee_id: str, interest_id: str, body: InterestPatch,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    data = body.model_dump(exclude_none=True)
    if not data:
        return {"id": interest_id, "success": True, "noop": True}
    sets = [f"{k} = :{k}" for k in data]
    data["id"]  = interest_id
    data["tid"] = trustee_id
    data["now"] = datetime.now(UTC)
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        res = await db.execute(text(
            f"UPDATE trustee_interests SET {', '.join(sets)} "
            "WHERE id::text = :id AND trustee_id::text = :tid RETURNING id"
        ), data)
        if not res.first():
            raise HTTPException(404, detail="Interest not found")
        await _audit(
            db, action="INTEREST_UPDATED", entity_type="trustee_interests",
            entity_id=interest_id, ctx=ctx,
            metadata={"trustee_id": trustee_id, "fields": list(body.model_dump(exclude_none=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": interest_id, "success": True}


@router.delete("/admin/board/trustees/{trustee_id}/interests/{interest_id}")
async def delete_interest(
    trustee_id: str, interest_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "UPDATE trustee_interests SET status = 'WITHDRAWN', updated_at = NOW() "
            "WHERE id::text = :id AND trustee_id::text = :tid RETURNING id"
        ), {"id": interest_id, "tid": trustee_id})
        if not res.first():
            raise HTTPException(404, detail="Interest not found")
        await _audit(
            db, action="INTEREST_WITHDRAWN", entity_type="trustee_interests",
            entity_id=interest_id, ctx=ctx,
            metadata={"trustee_id": trustee_id},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": interest_id, "success": True}


# ── Related parties ───────────────────────────────────────────────────────

@router.get("/admin/board/trustees/{trustee_id}/related-parties")
async def list_related_parties(trustee_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT * FROM trustee_related_parties WHERE trustee_id::text = :tid "
            "ORDER BY declared_at DESC"
        ), {"tid": trustee_id})).mappings().all()
    return {"related_parties": [dict(r) for r in rows]}


@router.post("/admin/board/trustees/{trustee_id}/related-parties")
async def add_related_party(
    trustee_id: str, body: RelatedPartyIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO trustee_related_parties
            (trustee_id, related_name, relationship, notes, created_by)
            VALUES (CAST(:tid AS uuid), :rn, :rel, :nt, :by)
            RETURNING id
        """), {
            "tid": trustee_id,
            "rn":  body.related_name.strip()[:255],
            "rel": body.relationship,
            "nt":  body.notes.strip(),
            "by":  str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="RELATED_PARTY_DECLARED", entity_type="trustee_related_parties",
            entity_id=new_id, ctx=ctx,
            metadata={"trustee_id": trustee_id, "relationship": body.relationship},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.delete("/admin/board/trustees/{trustee_id}/related-parties/{rp_id}")
async def delete_related_party(
    trustee_id: str, rp_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "DELETE FROM trustee_related_parties WHERE id::text = :id "
            "AND trustee_id::text = :tid RETURNING id"
        ), {"id": rp_id, "tid": trustee_id})
        if not res.first():
            raise HTTPException(404, detail="Related party not found")
        await _audit(
            db, action="RELATED_PARTY_REMOVED", entity_type="trustee_related_parties",
            entity_id=rp_id, ctx=ctx,
            metadata={"trustee_id": trustee_id},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": rp_id, "success": True}


# ── Conflicts on a resolution ─────────────────────────────────────────────

@router.get("/admin/board/resolutions/{resolution_id}/conflicts")
async def list_conflicts(resolution_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT rc.*,
                   t.full_name AS trustee_name, t.role AS trustee_role,
                   ti.category AS interest_category,
                   ti.counterparty AS interest_counterparty
            FROM   resolution_conflicts rc
            JOIN   trustees t ON t.id = rc.trustee_id
            LEFT JOIN trustee_interests ti ON ti.id = rc.matched_interest_id
            WHERE  rc.resolution_id::text = :id
            ORDER  BY rc.recorded_at
        """), {"id": resolution_id})).mappings().all()
    return {"conflicts": [dict(r) for r in rows]}


@router.post("/admin/board/resolutions/{resolution_id}/conflicts")
async def record_conflict_declaration(
    resolution_id: str, body: ConflictDeclarationIn,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO resolution_conflicts
            (resolution_id, trustee_id, matched_interest_id, reason, decision,
             recorded_by, recorded_by_name)
            VALUES (CAST(:rid AS uuid), CAST(:tid AS uuid),
                    CASE WHEN :mii = '' THEN NULL ELSE CAST(:mii AS uuid) END,
                    :reason, :dec, :rb, :rbn)
            ON CONFLICT (resolution_id, trustee_id) DO UPDATE SET
              reason   = EXCLUDED.reason,
              decision = EXCLUDED.decision,
              matched_interest_id = EXCLUDED.matched_interest_id,
              recorded_by = EXCLUDED.recorded_by,
              recorded_by_name = EXCLUDED.recorded_by_name,
              recorded_at = NOW()
            RETURNING id
        """), {
            "rid":  resolution_id,
            "tid":  body.trustee_id,
            "mii":  body.matched_interest_id or "",
            "reason": body.reason.strip()[:2000],
            "dec":  body.decision,
            "rb":   str(ctx.user_id) if ctx.user_id else None,
            "rbn":  ctx.user_email or "",
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="CONFLICT_DECLARED", entity_type="resolution_conflicts",
            entity_id=new_id, ctx=ctx,
            metadata={"resolution_id": resolution_id, "trustee_id": body.trustee_id,
                      "decision": body.decision},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.post("/admin/board/resolutions/{resolution_id}/conflicts/auto-detect")
async def auto_detect_conflicts_endpoint(
    resolution_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from shital.services.board.governance import detect_conflicts
    found = await detect_conflicts(
        resolution_id=resolution_id, ctx=ctx,
        ip=(request.client.host if request.client else ""),
        ua=request.headers.get("user-agent", ""),
    )
    return {"matches": found, "count": len(found)}
