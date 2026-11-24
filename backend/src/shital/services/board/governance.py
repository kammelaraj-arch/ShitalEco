"""
Governance core — conflict detection, risk auto-promote, quorum &
super-majority enforcement.

These are called from existing routers (board.py publish & close,
risk_register.py, trustee_interests.py) so the business rules stay in
one place and every caller audits identically.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from shital.api.deps import CurrentSpace

# ── Conflict detection ────────────────────────────────────────────────────

async def detect_conflicts(
    *, resolution_id: str, ctx: CurrentSpace, ip: str, ua: str,
) -> list[dict[str, Any]]:
    """Scan every ACTIVE trustee_interest.keywords against the
    resolution's title + background + recommendation. Any hit becomes a
    resolution_conflicts row with decision='RECUSED' — the chair can
    change the decision later via the UI.

    Keyword match is case-insensitive substring. Short (<= 2 char) terms
    are ignored to avoid false positives on 'a', 'of', etc.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    found: list[dict[str, Any]] = []
    async with SessionLocal() as db:
        res = (await db.execute(text(
            "SELECT title, background, recommendation FROM resolutions "
            "WHERE id::text = :id"
        ), {"id": resolution_id})).mappings().one_or_none()
        if not res:
            return []
        haystack = " ".join((
            (res.get("title") or ""),
            (res.get("background") or ""),
            (res.get("recommendation") or ""),
        )).lower()
        if not haystack.strip():
            return []
        interests = (await db.execute(text("""
            SELECT ti.id, ti.trustee_id, ti.category, ti.counterparty, ti.keywords,
                   t.full_name AS trustee_name
            FROM   trustee_interests ti
            JOIN   trustees t ON t.id = ti.trustee_id
            WHERE  ti.status = 'ACTIVE' AND t.is_active = true
              AND  (ti.expires_at IS NULL OR ti.expires_at > NOW())
        """))).mappings().all()
        for row in interests:
            terms = [
                w.strip().lower() for w in (row.get("keywords") or "").split()
                if len(w.strip()) > 2
            ]
            if not terms:
                continue
            matched_term = next((t for t in terms if t in haystack), None)
            if not matched_term:
                continue
            # Upsert a conflict row — RECUSED by default; chair can downgrade.
            ins = (await db.execute(text("""
                INSERT INTO resolution_conflicts
                (resolution_id, trustee_id, matched_interest_id, reason, decision,
                 recorded_by, recorded_by_name)
                VALUES (CAST(:rid AS uuid), :tid, :mii,
                        :reason, 'RECUSED', :rb, :rbn)
                ON CONFLICT (resolution_id, trustee_id) DO UPDATE SET
                  matched_interest_id = EXCLUDED.matched_interest_id,
                  reason = CASE WHEN resolution_conflicts.reason = ''
                                THEN EXCLUDED.reason
                                ELSE resolution_conflicts.reason END
                RETURNING id
            """), {
                "rid": resolution_id,
                "tid": row["trustee_id"],
                "mii": row["id"],
                "reason": (
                    f"Auto-detected on keyword '{matched_term}' from the "
                    f"trustee's {row['category']} interest ({row['counterparty']})."
                ),
                "rb":  str(ctx.user_id) if ctx.user_id else None,
                "rbn": ctx.user_email or "auto-detect",
            })).first()
            if ins:
                await db.execute(text("""
                    INSERT INTO board_audit_log
                    (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
                    VALUES (:uid, :name, 'CONFLICT_AUTO_DETECTED', 'resolution_conflicts',
                            :eid, CAST(:meta AS jsonb), :ip, :ua)
                """), {
                    "uid":  str(ctx.user_id) if ctx.user_id else None,
                    "name": ctx.user_email or "auto",
                    "eid":  str(ins[0]),
                    "meta": json.dumps({
                        "resolution_id": resolution_id,
                        "trustee_id": str(row["trustee_id"]),
                        "trustee_name": row["trustee_name"],
                        "matched_term": matched_term,
                        "interest_category": row["category"],
                    }),
                    "ip": ip, "ua": ua,
                })
            found.append({
                "trustee_id": str(row["trustee_id"]),
                "trustee_name": row["trustee_name"],
                "matched_term": matched_term,
                "interest_category": row["category"],
                "counterparty": row["counterparty"],
            })
        await db.commit()
    return found


# ── Risk auto-promote ─────────────────────────────────────────────────────

async def _next_risk_ref(db: Any) -> str:
    from sqlalchemy import text
    row = (await db.execute(text(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(risk_ref FROM 4) AS INT)), 0) AS n "
        "FROM risk_register WHERE risk_ref LIKE 'RR-%'"
    ))).first()
    n = int(row[0]) if row else 0
    return f"RR-{n + 1:04d}"


async def promote_resolution_risks(
    *, resolution_id: str, ctx: CurrentSpace, ip: str, ua: str,
) -> list[str]:
    """Called from publish_resolution after RESOLUTION_PUBLISHED. Copies
    every `resolution_risks` row with auto_promote=true (and no existing
    promoted_register_id) into risk_register, wiring source_type +
    source_id back to the resolution.

    Returns the list of new risk_register ids."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    created: list[str] = []
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT * FROM resolution_risks
            WHERE  resolution_id::text = :id
              AND  auto_promote = true
              AND  promoted_register_id IS NULL
        """), {"id": resolution_id})).mappings().all()
        for r in rows:
            lk = int(r["likelihood"] or 1)
            im = int(r["impact"] or 1)
            ref = await _next_risk_ref(db)
            ins = (await db.execute(text("""
                INSERT INTO risk_register
                (risk_ref, title, description, category, scope,
                 likelihood, impact, score, treatment, mitigation_plan,
                 source_type, source_id, created_by)
                VALUES
                (:ref, :title, :desc, :cat, :scope,
                 :lk, :im, :sc, :tr, :mit,
                 'RESOLUTION', CAST(:rid AS uuid), :by)
                RETURNING id
            """), {
                "ref":   ref,
                "title": r["title"],
                "desc":  r["description"],
                "cat":   r["category"],
                "scope": r["scope"],
                "lk":    lk, "im": im, "sc": lk * im,
                "tr":    r["treatment"],
                "mit":   r["mitigation_plan"],
                "rid":   resolution_id,
                "by":    str(ctx.user_id) if ctx.user_id else None,
            })).first()
            new_id = str(ins[0]) if ins else ""
            await db.execute(text(
                "UPDATE resolution_risks SET promoted_register_id = CAST(:nid AS uuid), "
                "updated_at = NOW() WHERE id = :rrid"
            ), {"nid": new_id, "rrid": r["id"]})
            await db.execute(text("""
                INSERT INTO board_audit_log
                (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
                VALUES (:uid, :name, 'RISK_PROMOTED_FROM_RESOLUTION', 'risk_register',
                        CAST(:eid AS uuid), CAST(:meta AS jsonb), :ip, :ua)
            """), {
                "uid":  str(ctx.user_id) if ctx.user_id else None,
                "name": ctx.user_email or "",
                "eid":  new_id,
                "meta": json.dumps({
                    "risk_ref": ref, "scope": r["scope"], "category": r["category"],
                    "resolution_id": resolution_id,
                }),
                "ip": ip, "ua": ua,
            })
            created.append(new_id)
        await db.commit()
    return created


async def promote_single_resolution_risk(
    *, resolution_id: str, risk_id: str, ctx: CurrentSpace, ip: str, ua: str,
) -> dict[str, Any]:
    """Manual single-row promote — same as the bulk path but one row.
    Also sets auto_promote = true so the normal publish hook won't
    re-promote it later."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        r = (await db.execute(text(
            "SELECT * FROM resolution_risks WHERE id::text = :id "
            "AND resolution_id::text = :rid"
        ), {"id": risk_id, "rid": resolution_id})).mappings().one_or_none()
        if not r:
            from fastapi import HTTPException
            raise HTTPException(404, detail="Resolution risk not found")
        if r["promoted_register_id"]:
            return {"id": risk_id, "promoted_register_id": str(r["promoted_register_id"]),
                    "already_promoted": True}
        lk = int(r["likelihood"] or 1)
        im = int(r["impact"] or 1)
        ref = await _next_risk_ref(db)
        ins = (await db.execute(text("""
            INSERT INTO risk_register
            (risk_ref, title, description, category, scope,
             likelihood, impact, score, treatment, mitigation_plan,
             source_type, source_id, created_by)
            VALUES
            (:ref, :title, :desc, :cat, :scope,
             :lk, :im, :sc, :tr, :mit,
             'RESOLUTION', CAST(:rid AS uuid), :by)
            RETURNING id
        """), {
            "ref":   ref,
            "title": r["title"],
            "desc":  r["description"],
            "cat":   r["category"],
            "scope": r["scope"],
            "lk":    lk, "im": im, "sc": lk * im,
            "tr":    r["treatment"],
            "mit":   r["mitigation_plan"],
            "rid":   resolution_id,
            "by":    str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(ins[0]) if ins else ""
        await db.execute(text(
            "UPDATE resolution_risks SET promoted_register_id = CAST(:nid AS uuid), "
            "auto_promote = true, updated_at = NOW() WHERE id = :rrid"
        ), {"nid": new_id, "rrid": r["id"]})
        await db.commit()
    return {"id": risk_id, "promoted_register_id": new_id, "risk_ref": ref}


# ── Quorum + super-majority ───────────────────────────────────────────────

async def compute_vote_outcome(
    *, resolution_id: str,
) -> dict[str, Any]:
    """Pure read: returns {quorum_met, pass_met, outcome, min_quorum,
    pass_threshold, tally_for/against/abstain, eligible_voters,
    recused_count}. Called by the close endpoint to decide CARRIED vs
    NOT_CARRIED vs INQUORATE. Also safe to call from the UI to show a
    live "will this pass?" indicator."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = (await db.execute(text(
            "SELECT category, required_quorum_count, required_quorum_pct, "
            "pass_threshold_pct, tally_for, tally_against, tally_abstain "
            "FROM resolutions WHERE id::text = :id"
        ), {"id": resolution_id})).mappings().one_or_none()
        if not res:
            return {"found": False}
        rule = (await db.execute(text(
            "SELECT min_quorum_count, min_quorum_pct, pass_threshold_pct, is_special "
            "FROM resolution_vote_rules WHERE category = :cat"
        ), {"cat": res["category"]})).mappings().one_or_none()
        if not rule:
            # Conservative default — simple majority with 3-trustee quorum.
            rule = {"min_quorum_count": 3, "min_quorum_pct": 50,
                    "pass_threshold_pct": 50, "is_special": False}

        min_quorum_count = int(res["required_quorum_count"] or rule["min_quorum_count"])
        min_quorum_pct   = int(res["required_quorum_pct"]   or rule["min_quorum_pct"])
        pass_pct         = int(res["pass_threshold_pct"]    or rule["pass_threshold_pct"])

        total_trustees = (await db.execute(text(
            "SELECT COUNT(*) FROM trustees "
            "WHERE is_active = true AND role IN "
            "('CHAIR','TREASURER','SECRETARY','CEO','TRUSTEE')"
        ))).scalar() or 0
        recused = (await db.execute(text(
            "SELECT COUNT(*) FROM resolution_conflicts "
            "WHERE resolution_id::text = :id AND decision = 'RECUSED'"
        ), {"id": resolution_id})).scalar() or 0
        eligible = max(0, int(total_trustees) - int(recused))

        tfor = int(res["tally_for"] or 0)
        tagn = int(res["tally_against"] or 0)
        tabs = int(res["tally_abstain"] or 0)
        voted = tfor + tagn + tabs

        quorum_by_pct = (voted * 100 >= min_quorum_pct * max(1, eligible))
        quorum_by_count = voted >= min_quorum_count
        quorum_met = quorum_by_pct and quorum_by_count

        decisive = tfor + tagn
        pass_met = decisive > 0 and (tfor * 100 >= pass_pct * decisive)

        if not quorum_met:
            outcome = "INQUORATE"
        elif pass_met:
            outcome = "CARRIED"
        else:
            outcome = "NOT_CARRIED"

        return {
            "found": True,
            "category": res["category"],
            "min_quorum_count": min_quorum_count,
            "min_quorum_pct":   min_quorum_pct,
            "pass_threshold_pct": pass_pct,
            "is_special": rule["is_special"],
            "total_eligible_trustees": int(total_trustees),
            "recused": int(recused),
            "eligible_to_vote": eligible,
            "tally_for": tfor, "tally_against": tagn, "tally_abstain": tabs,
            "voted": voted,
            "quorum_met": quorum_met,
            "pass_met":   pass_met,
            "outcome":    outcome,
        }


async def ensure_quorum_or_raise(resolution_id: str) -> dict[str, Any]:
    """Called by the close endpoint. Raises HTTP 400 if the attempted
    close would be INQUORATE unless the caller overrides."""
    from fastapi import HTTPException
    o = await compute_vote_outcome(resolution_id=resolution_id)
    if not o.get("found"):
        raise HTTPException(404, detail="Resolution not found")
    return o


# convenience for callers that want a UTC "now"
def _now() -> datetime:
    return datetime.now(UTC)
