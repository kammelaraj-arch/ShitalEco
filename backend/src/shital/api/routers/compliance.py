"""Compliance router — daily / monthly / quarterly / yearly forms per MASTER 05.

Phase 1 (this module): daily forms (MASTER 05A). All six sub-forms are stored
as one JSONB row per branch per day, matching the "combined daily page" UX
one-to-one. Keeping a single envelope row (rather than six narrow tables) lets
us evolve the sub-form schemas without migrations, and makes the audit trail
trivial (one row = one submitted paper form).

Later phases add:
  - MASTER 05B: quarterly return, yearly review, improvement plan (separate
    tables; those have real relational structure around sign-off + actions).
  - MASTER 07: static Quick Start Guide (frontend only, no API).

Permission model:
  compliance:daily:read  — SUPER_ADMIN, TRUSTEE, BRANCH_MANAGER, AUDITOR,
                          VOLUNTEER (own-branch only, enforced in handler).
  compliance:daily:write — SUPER_ADMIN, TRUSTEE, BRANCH_MANAGER, VOLUNTEER
                          (own-branch only).
  compliance:daily:review — SUPER_ADMIN, TRUSTEE, BRANCH_MANAGER
                          (sign-off / mark reviewed).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace

logger = structlog.get_logger()
router = APIRouter(prefix="/compliance", tags=["compliance"])

# ── DDL guard ────────────────────────────────────────────────────────────────
_tables_ready = False


async def _ensure_tables() -> None:
    """Create the compliance tables if they don't exist. Self-healing; runs
    once per worker process."""
    global _tables_ready
    if _tables_ready:
        return

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    _ddl = [
        """CREATE TABLE IF NOT EXISTS daily_compliance_records (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id     VARCHAR(100) NOT NULL,
            record_date   DATE         NOT NULL,
            -- data holds all 6 sub-forms (opening_closing, food_prep,
            -- donations, temperatures, allergens, issues). See
            -- DailyRecordData below for the shape.
            data          JSONB        NOT NULL DEFAULT '{}'::jsonb,
            status        VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
                                        -- DRAFT | SUBMITTED | REVIEWED
            created_by    TEXT         NOT NULL DEFAULT '',
            submitted_at  TIMESTAMPTZ,
            reviewed_by   TEXT         NOT NULL DEFAULT '',
            reviewed_at   TIMESTAMPTZ,
            manager_notes TEXT         NOT NULL DEFAULT '',
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        # One record per branch per day — upsert target
        "CREATE UNIQUE INDEX IF NOT EXISTS uidx_daily_compliance_branch_date "
        "ON daily_compliance_records(branch_id, record_date)",
        # History views scan these two indexes
        "CREATE INDEX IF NOT EXISTS idx_daily_compliance_branch "
        "ON daily_compliance_records(branch_id, record_date DESC)",
        "CREATE INDEX IF NOT EXISTS idx_daily_compliance_status "
        "ON daily_compliance_records(status, record_date DESC)",
    ]

    for sql in _ddl:
        try:
            async with SessionLocal() as db:
                await db.execute(text(sql))
                await db.commit()
        except Exception as exc:
            logger.warning("compliance_ddl_failed", sql=sql[:60], error=str(exc))

    _tables_ready = True


# ── Pydantic schemas (bundle of 6 sub-forms, submitted together) ────────────
# Field names mirror MASTER 05A section numbers so an auditor can line up the
# paper form against the stored JSON without a translation table.

class CheckBool(BaseModel):
    """A single check with an action note. `value` is True when the check
    passed (or N/A when `na` is set). Volunteers record `action` any time
    `value` is False to show the corrective step taken."""
    value: bool | None = None
    na: bool = False
    action: str = ""


class OpeningClosing(BaseModel):
    """§1 — Opening and closing checklist. Each check has an opening and
    closing state so the paper form's two tick-boxes map cleanly."""
    # Opening-side checks (keys mirror the paper form's 11 rows)
    opening: dict[str, CheckBool] = Field(default_factory=dict)
    closing: dict[str, CheckBool] = Field(default_factory=dict)
    opened_by: str = ""
    closed_by: str = ""
    manager_action: str = ""


class FoodPrep(BaseModel):
    """§2 — Food & prasad preparation check (8 items)."""
    checks: dict[str, CheckBool] = Field(default_factory=dict)
    food_lead: str = ""
    served_by: str = ""


class DonationReceipt(BaseModel):
    """§3 — Donation / delivery receiving record (log, 0..N rows)."""
    time: str = ""
    donor_or_supplier: str = ""
    food_quantity: str = ""
    date_or_batch: str = ""
    condition_ok: bool = False
    accepted: bool = True
    initials: str = ""
    reject_action: str = ""


class TemperatureEntry(BaseModel):
    """§4 — Temperature & cooking record (log, 0..N rows). Stage is one of
    cooking / cooling / reheating / hot_holding / cold_storage."""
    time: str = ""
    food_batch: str = ""
    stage: str = ""
    target: str = ""
    actual: str = ""
    passed: bool = False
    initials: str = ""
    corrective_action: str = ""


class AllergenCheck(BaseModel):
    """§5 — Allergen & serving check (log, 0..N rows)."""
    food_or_prasad: str = ""
    known_allergen: str = ""
    separate_utensil: bool = False
    info_given: bool = False
    initials: str = ""


class DailyIssue(BaseModel):
    """§6 — Daily issue record (log, 0..N rows)."""
    time: str = ""
    issue: str = ""
    immediate_action: str = ""
    reported_to: str = ""
    initials: str = ""


class DailyRecordData(BaseModel):
    """The combined daily record — one of these per branch per day."""
    opening_closing: OpeningClosing = Field(default_factory=OpeningClosing)
    food_prep: FoodPrep = Field(default_factory=FoodPrep)
    donations: list[DonationReceipt] = Field(default_factory=list)
    temperatures: list[TemperatureEntry] = Field(default_factory=list)
    allergens: list[AllergenCheck] = Field(default_factory=list)
    issues: list[DailyIssue] = Field(default_factory=list)


class DailyRecordUpsert(BaseModel):
    branch_id: str
    record_date: str   # ISO date, YYYY-MM-DD
    data: DailyRecordData
    submit: bool = False   # True → mark SUBMITTED; False → save DRAFT


class ReviewBody(BaseModel):
    reviewed: bool = True
    manager_notes: str = ""


# ── Permission helpers ──────────────────────────────────────────────────────
# compliance:read / compliance:write are the existing permissions. For Phase 1
# we add a lighter check so VOLUNTEER (branch-scoped) can submit their own
# branch's daily record without inheriting read access to other branches' data.

_WRITE_ROLES  = {"SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER", "VOLUNTEER"}
_REVIEW_ROLES = {"SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER"}
_CROSS_BRANCH_ROLES = {"SUPER_ADMIN", "TRUSTEE", "AUDITOR"}


def _authorise(ctx: CurrentSpace, *, action: str, target_branch: str) -> None:
    """Raise 403 if the caller can't perform `action` on `target_branch`.

    action = 'read' | 'write' | 'review'.

    Rules:
      - SUPER_ADMIN, TRUSTEE, AUDITOR: cross-branch read; SUPER_ADMIN+TRUSTEE
        can also write/review cross-branch.
      - BRANCH_MANAGER, VOLUNTEER: own-branch only. Compared via ctx.branch_id.
      - Everyone else: 403.
    """
    role = (ctx.role or "").upper()
    is_cross = role in _CROSS_BRANCH_ROLES
    is_write = action in ("write", "review")
    if is_write:
        allowed = _REVIEW_ROLES if action == "review" else _WRITE_ROLES
        if role not in allowed:
            raise HTTPException(status_code=403, detail=f"Role {role} may not {action} compliance records")
    else:
        # read
        if role not in _WRITE_ROLES | _CROSS_BRANCH_ROLES:
            raise HTTPException(status_code=403, detail=f"Role {role} may not read compliance records")

    # Branch scoping — anyone not in the cross-branch set is pinned to their own
    if not is_cross and target_branch and ctx.branch_id and target_branch != ctx.branch_id:
        raise HTTPException(status_code=403, detail="You can only access your own branch's compliance records")


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/daily")
async def get_daily_record(
    ctx: CurrentSpace,
    branch_id: str = Query(..., description="Branch code, e.g. 'wembley_main'"),
    record_date: str = Query(..., description="ISO date YYYY-MM-DD"),
) -> dict[str, Any]:
    """Fetch the daily compliance record for a branch/date. Returns an empty
    skeleton if no record exists yet, so the form can render in 'new' mode."""
    _authorise(ctx, action="read", target_branch=branch_id)
    await _ensure_tables()
    try:
        _d = date.fromisoformat(record_date)
    except ValueError as exc:
        raise HTTPException(400, detail="record_date must be ISO YYYY-MM-DD") from exc

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("""
                SELECT id, branch_id, record_date, data, status, created_by,
                       submitted_at, reviewed_by, reviewed_at, manager_notes,
                       created_at, updated_at
                FROM daily_compliance_records
                WHERE branch_id = :bid AND record_date = :d
            """),
            {"bid": branch_id, "d": _d},
        )).mappings().first()
    if row:
        return dict(row)
    # Empty skeleton — same shape the form expects on create
    return {
        "id": None, "branch_id": branch_id, "record_date": record_date,
        "data": DailyRecordData().model_dump(),
        "status": "DRAFT", "created_by": "",
        "submitted_at": None, "reviewed_by": "", "reviewed_at": None,
        "manager_notes": "",
    }


@router.post("/daily")
async def upsert_daily_record(body: DailyRecordUpsert, ctx: CurrentSpace) -> dict[str, Any]:
    """Create or update today's record. Upserts on (branch_id, record_date).
    `submit=True` moves status to SUBMITTED and stamps submitted_at."""
    _authorise(ctx, action="write", target_branch=body.branch_id)
    await _ensure_tables()
    try:
        _d = date.fromisoformat(body.record_date)
    except ValueError as exc:
        raise HTTPException(400, detail="record_date must be ISO YYYY-MM-DD") from exc

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    author = str(getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or "")
    new_status = "SUBMITTED" if body.submit else "DRAFT"
    try:
        async with SessionLocal() as db:
            # ON CONFLICT upsert — INSERT if new, UPDATE if (branch_id, date)
            # already present. Reviewers aren't allowed to overwrite review
            # fields via this endpoint; that's what /daily/{id}/review is for.
            await db.execute(text("""
                INSERT INTO daily_compliance_records
                    (id, branch_id, record_date, data, status, created_by,
                     submitted_at, created_at, updated_at)
                VALUES
                    (:id, :bid, :d, CAST(:data AS JSONB), :status, :author,
                     CASE WHEN :submitted THEN :now END, :now, :now)
                ON CONFLICT (branch_id, record_date) DO UPDATE SET
                    data         = EXCLUDED.data,
                    status       = CASE
                        WHEN daily_compliance_records.status = 'REVIEWED' THEN 'REVIEWED'
                        ELSE EXCLUDED.status
                    END,
                    submitted_at = COALESCE(daily_compliance_records.submitted_at,
                                            EXCLUDED.submitted_at),
                    updated_at   = EXCLUDED.updated_at
            """), {
                "id": str(uuid.uuid4()), "bid": body.branch_id, "d": _d,
                "data": body.data.model_dump_json(),
                "status": new_status, "author": author,
                "submitted": body.submit, "now": now,
            })
            await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("daily_compliance_upsert_failed", branch=body.branch_id,
                       date=body.record_date, error=str(exc))
        raise HTTPException(500, detail=f"Save failed: {exc}") from exc
    return {"ok": True, "status": new_status}


@router.post("/daily/{record_id}/review")
async def review_daily_record(
    record_id: str, body: ReviewBody, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Branch manager / trustee sign-off. Moves status to REVIEWED and stamps
    reviewed_by + reviewed_at. Does NOT touch `data` — reviewers can't edit
    the volunteer's submission, only annotate it via manager_notes."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    # Look up the branch so we can authorise correctly
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT branch_id FROM daily_compliance_records WHERE id = :id"),
            {"id": record_id},
        )).first()
    if not row:
        raise HTTPException(404, detail="Record not found")
    _authorise(ctx, action="review", target_branch=row[0])

    reviewer = str(getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or "")
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE daily_compliance_records SET
                status        = :status,
                reviewed_by   = :reviewer,
                reviewed_at   = :now,
                manager_notes = :notes,
                updated_at    = :now
            WHERE id = :id
        """), {
            "id": record_id,
            "status": "REVIEWED" if body.reviewed else "SUBMITTED",
            "reviewer": reviewer if body.reviewed else "",
            "now": datetime.utcnow() if body.reviewed else None,
            "notes": body.manager_notes,
        })
        await db.commit()
    return {"ok": True}


@router.get("/daily/history")
async def list_daily_records(
    ctx: CurrentSpace,
    branch_id: str = Query("", description="Blank → all branches (cross-branch roles only)"),
    date_from: str = Query("", description="ISO YYYY-MM-DD; blank → no lower bound"),
    date_to:   str = Query("", description="ISO YYYY-MM-DD; blank → no upper bound"),
    status: str = Query("", description="DRAFT | SUBMITTED | REVIEWED | '' for all"),
    limit: int = Query(50, ge=1, le=500),
) -> dict[str, Any]:
    """Summary list for the history view. Returns metadata + the counts /
    issue summary rolled up from `data`, without shipping the whole JSONB
    payload (which can get big)."""
    target_branch = branch_id or ctx.branch_id
    _authorise(ctx, action="read", target_branch=target_branch if branch_id else "")
    await _ensure_tables()

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {"limit": limit}
    role = (ctx.role or "").upper()
    is_cross = role in _CROSS_BRANCH_ROLES
    # Cross-branch roles can pass branch_id='' to see all branches; others
    # are pinned to their own branch regardless of input.
    if not is_cross or branch_id:
        where.append("branch_id = :bid")
        params["bid"] = target_branch
    if date_from:
        where.append("record_date >= :df"); params["df"] = date.fromisoformat(date_from)
    if date_to:
        where.append("record_date <= :dt"); params["dt"] = date.fromisoformat(date_to)
    if status:
        where.append("status = :st"); params["st"] = status
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id, branch_id, record_date, status, created_by,
                   submitted_at, reviewed_by, reviewed_at,
                   COALESCE(jsonb_array_length(data->'issues'), 0) AS issue_count,
                   COALESCE(jsonb_array_length(data->'donations'), 0) AS donation_count,
                   COALESCE(jsonb_array_length(data->'temperatures'), 0) AS temperature_count
            FROM daily_compliance_records
            {where_sql}
            ORDER BY record_date DESC, branch_id
            LIMIT :limit
        """), params)).mappings().all()

    return {"items": [dict(r) for r in rows], "count": len(rows)}
