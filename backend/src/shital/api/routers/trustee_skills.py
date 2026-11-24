"""
Trustee skills matrix (Charity Governance Code principle 3.4).

Routes:
  GET  /admin/board/skills/taxonomy                 list required_skills
  GET  /admin/board/skills-matrix                   trustees x skills grid
                                                    with gap flag per skill
  GET  /admin/board/trustees/{tid}/skills           list for one trustee
  PUT  /admin/board/trustees/{tid}/skills/{code}    upsert rating + evidence
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["trustee-skills"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "CEO", "SECRETARY"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


class SkillIn(BaseModel):
    self_rating: int = Field(ge=0, le=5)
    evidence: str = ""
    last_reviewed_at: str | None = None


async def _audit(
    db: Any, *, action: str, entity_id: str, ctx: CurrentSpace,
    metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, 'trustee_skills', CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


@router.get("/admin/board/skills/taxonomy")
async def get_taxonomy(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT * FROM required_skills WHERE is_active = true "
            "ORDER BY sort_order, label"
        ))).mappings().all()
    return {"skills": [dict(r) for r in rows]}


@router.get("/admin/board/skills-matrix")
async def skills_matrix(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        skills = (await db.execute(text(
            "SELECT * FROM required_skills WHERE is_active = true "
            "ORDER BY sort_order, label"
        ))).mappings().all()
        trustees = (await db.execute(text(
            "SELECT id, full_name, role FROM trustees "
            "WHERE is_active = true ORDER BY full_name"
        ))).mappings().all()
        grid = (await db.execute(text(
            "SELECT trustee_id, skill_code, self_rating, evidence, last_reviewed_at "
            "FROM trustee_skills"
        ))).mappings().all()
    index: dict[str, dict[str, Any]] = {}
    for r in grid:
        index.setdefault(str(r["trustee_id"]), {})[r["skill_code"]] = {
            "self_rating": int(r["self_rating"]),
            "evidence": r["evidence"],
            "last_reviewed_at": r["last_reviewed_at"].isoformat() if r["last_reviewed_at"] else None,
        }
    # Compute per-skill gap = max rating across trustees < 3 (Proficient).
    gaps: list[str] = []
    skill_max: dict[str, int] = {}
    for s in skills:
        code = s["code"]
        mx = max(
            (index.get(str(t["id"]), {}).get(code, {}).get("self_rating", 0)
             for t in trustees),
            default=0,
        )
        skill_max[code] = int(mx)
        if mx < 3:
            gaps.append(code)
    return {
        "skills":   [dict(s) for s in skills],
        "trustees": [dict(t) for t in trustees],
        "ratings":  index,
        "max_by_skill": skill_max,
        "gaps":     gaps,
    }


@router.get("/admin/board/trustees/{trustee_id}/skills")
async def list_trustee_skills(trustee_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT rs.code, rs.label, rs.category, rs.description,
                   COALESCE(ts.self_rating, 0) AS self_rating,
                   COALESCE(ts.evidence, '')   AS evidence,
                   ts.last_reviewed_at
            FROM   required_skills rs
            LEFT JOIN trustee_skills ts
                   ON ts.skill_code = rs.code AND ts.trustee_id::text = :tid
            WHERE  rs.is_active = true
            ORDER  BY rs.sort_order, rs.label
        """), {"tid": trustee_id})).mappings().all()
    return {"skills": [dict(r) for r in rows]}


@router.put("/admin/board/trustees/{trustee_id}/skills/{skill_code}")
async def upsert_trustee_skill(
    trustee_id: str, skill_code: str, body: SkillIn,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    reviewed = body.last_reviewed_at or datetime.now(UTC).date().isoformat()
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO trustee_skills
            (trustee_id, skill_code, self_rating, evidence, last_reviewed_at)
            VALUES (CAST(:tid AS uuid), :code, :r, :e, :rv)
            ON CONFLICT (trustee_id, skill_code) DO UPDATE SET
              self_rating      = EXCLUDED.self_rating,
              evidence         = EXCLUDED.evidence,
              last_reviewed_at = EXCLUDED.last_reviewed_at,
              updated_at       = NOW()
            RETURNING id
        """), {
            "tid":  trustee_id,
            "code": skill_code,
            "r":    int(body.self_rating),
            "e":    body.evidence.strip(),
            "rv":   reviewed,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="SKILL_RATING_SET", entity_id=new_id, ctx=ctx,
            metadata={"trustee_id": trustee_id, "skill_code": skill_code,
                      "self_rating": int(body.self_rating)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}
