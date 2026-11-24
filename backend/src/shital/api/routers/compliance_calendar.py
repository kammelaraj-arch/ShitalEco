"""
Compliance deadlines + filings (annual return, accounts, ICO, HMRC …).

Routes:
  GET  /admin/compliance/deadlines                 list
  POST /admin/compliance/deadlines                 create
  PUT  /admin/compliance/deadlines/{did}
  DELETE /admin/compliance/deadlines/{did}         archive
  GET  /admin/compliance/filings                   list (optional
                                                     ?status + ?authority)
  POST /admin/compliance/filings                   create filing record
  POST /admin/compliance/filings/{fid}/mark-filed  log the actual filing
  GET  /admin/compliance/upcoming?days=90          dashboard tile data
"""
from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["compliance-calendar"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR",
                        "TREASURER", "SECRETARY", "CEO", "ACCOUNTANT"}:
        raise HTTPException(status_code=403, detail="Admin / finance role required")


class DeadlineIn(BaseModel):
    title: str
    authority: str = "OTHER"
    frequency: str = "ANNUAL"
    base_month: int | None = None
    base_day: int | None = None
    days_offset_from_fye: int | None = None
    owner_user_id: str | None = None
    owner_name: str = ""
    remind_days: list[int] | None = None
    notes: str = ""


class DeadlinePatch(BaseModel):
    title: str | None = None
    authority: str | None = None
    frequency: str | None = None
    base_month: int | None = None
    base_day: int | None = None
    days_offset_from_fye: int | None = None
    owner_user_id: str | None = None
    owner_name: str | None = None
    remind_days: list[int] | None = None
    notes: str | None = None
    status: str | None = None


class FilingIn(BaseModel):
    deadline_id: str
    period_start: str | None = None
    period_end: str | None = None
    due_date: str
    note: str = ""


class MarkFiledIn(BaseModel):
    reference_number: str = ""
    evidence_attachment_id: str | None = None
    note: str = ""


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


# ── Deadlines ──────────────────────────────────────────────────────────

@router.get("/admin/compliance/deadlines")
async def list_deadlines(
    ctx: CurrentSpace, status: str | None = Query(None),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    where = " WHERE status = :s" if status else ""
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            f"SELECT * FROM compliance_deadlines{where} ORDER BY authority, title"
        ), {"s": status} if status else {})).mappings().all()
    return {"deadlines": [dict(r) for r in rows]}


@router.post("/admin/compliance/deadlines")
async def create_deadline(
    body: DeadlineIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    remind = body.remind_days or [60, 30, 7]
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO compliance_deadlines
            (title, authority, frequency, base_month, base_day,
             days_offset_from_fye, owner_user_id, owner_name,
             remind_days, notes, created_by)
            VALUES (:t, :a, :f, :bm, :bd, :off,
                    CASE WHEN :ou = '' THEN NULL ELSE CAST(:ou AS uuid) END,
                    :on, :rd::int[], :nt, :by)
            RETURNING id
        """), {
            "t":  body.title.strip()[:255],
            "a":  body.authority,
            "f":  body.frequency,
            "bm": body.base_month,
            "bd": body.base_day,
            "off": body.days_offset_from_fye,
            "ou": body.owner_user_id or "",
            "on": body.owner_name.strip()[:255],
            "rd": "{" + ",".join(str(x) for x in remind) + "}",
            "nt": body.notes.strip(),
            "by": str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="DEADLINE_CREATED", entity_type="compliance_deadlines",
            entity_id=new_id, ctx=ctx,
            metadata={"title": body.title, "authority": body.authority,
                      "frequency": body.frequency},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.put("/admin/compliance/deadlines/{deadline_id}")
async def update_deadline(
    deadline_id: str, body: DeadlinePatch,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    data: dict[str, Any] = body.model_dump(exclude_none=True)
    if "remind_days" in data:
        data["remind_days"] = "{" + ",".join(str(x) for x in data["remind_days"]) + "}"
    if not data:
        return {"id": deadline_id, "success": True, "noop": True}
    sets = [
        f"{k} = :{k}::int[]" if k == "remind_days" else f"{k} = :{k}"
        for k in data
    ]
    data["id"]  = deadline_id
    data["now"] = datetime.now(UTC)
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        res = await db.execute(text(
            f"UPDATE compliance_deadlines SET {', '.join(sets)} "
            "WHERE id::text = :id RETURNING id"
        ), data)
        if not res.first():
            raise HTTPException(404, detail="Deadline not found")
        await _audit(
            db, action="DEADLINE_UPDATED", entity_type="compliance_deadlines",
            entity_id=deadline_id, ctx=ctx,
            metadata={"fields": list(body.model_dump(exclude_none=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": deadline_id, "success": True}


@router.delete("/admin/compliance/deadlines/{deadline_id}")
async def archive_deadline(
    deadline_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "UPDATE compliance_deadlines SET status = 'ARCHIVED', updated_at = NOW() "
            "WHERE id::text = :id RETURNING id"
        ), {"id": deadline_id})
        if not res.first():
            raise HTTPException(404, detail="Deadline not found")
        await _audit(
            db, action="DEADLINE_ARCHIVED", entity_type="compliance_deadlines",
            entity_id=deadline_id, ctx=ctx, metadata={},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": deadline_id, "success": True}


# ── Filings ────────────────────────────────────────────────────────────

@router.get("/admin/compliance/filings")
async def list_filings(
    ctx: CurrentSpace,
    status: str | None = Query(None),
    authority: str | None = Query(None),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    conds: list[str] = []
    params: dict[str, Any] = {}
    if status:
        conds.append("cf.status = :s")
        params["s"] = status
    if authority:
        conds.append("cd.authority = :a")
        params["a"] = authority
    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT cf.*, cd.title AS deadline_title, cd.authority
            FROM   compliance_filings cf
            JOIN   compliance_deadlines cd ON cd.id = cf.deadline_id
            {where}
            ORDER  BY cf.due_date
        """), params)).mappings().all()
    return {"filings": [dict(r) for r in rows]}


@router.post("/admin/compliance/filings")
async def create_filing(
    body: FilingIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO compliance_filings
            (deadline_id, period_start, period_end, due_date, note, status)
            VALUES (CAST(:did AS uuid), :ps, :pe, :dd, :nt, 'UPCOMING')
            RETURNING id
        """), {
            "did": body.deadline_id,
            "ps":  body.period_start,
            "pe":  body.period_end,
            "dd":  body.due_date,
            "nt":  body.note.strip(),
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="FILING_CREATED", entity_type="compliance_filings",
            entity_id=new_id, ctx=ctx,
            metadata={"deadline_id": body.deadline_id, "due_date": body.due_date},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.post("/admin/compliance/filings/{filing_id}/mark-filed")
async def mark_filed(
    filing_id: str, body: MarkFiledIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text("""
            UPDATE compliance_filings SET
              filed_at = NOW(),
              filed_by_user_id = :by,
              filed_by_name = :nm,
              reference_number = :rn,
              evidence_attachment_id = CASE WHEN :ea = '' THEN NULL ELSE CAST(:ea AS uuid) END,
              status = 'FILED',
              note  = CASE WHEN :nt = '' THEN note ELSE :nt END,
              updated_at = NOW()
            WHERE id::text = :id RETURNING id
        """), {
            "by":  str(ctx.user_id) if ctx.user_id else None,
            "nm":  ctx.user_email or "",
            "rn":  body.reference_number.strip()[:80],
            "ea":  body.evidence_attachment_id or "",
            "nt":  body.note.strip(),
            "id":  filing_id,
        })
        if not res.first():
            raise HTTPException(404, detail="Filing not found")
        await _audit(
            db, action="FILING_MARKED_FILED", entity_type="compliance_filings",
            entity_id=filing_id, ctx=ctx,
            metadata={"reference_number": body.reference_number},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": filing_id, "success": True}


@router.get("/admin/compliance/upcoming")
async def upcoming(
    ctx: CurrentSpace, days: int = Query(90, ge=1, le=365),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT cf.id, cf.due_date, cf.status, cf.reference_number,
                   cd.title AS deadline_title, cd.authority
            FROM   compliance_filings cf
            JOIN   compliance_deadlines cd ON cd.id = cf.deadline_id
            WHERE  cf.status <> 'FILED'
              AND  cf.due_date <= CURRENT_DATE + make_interval(days => :d)
            ORDER  BY cf.due_date
        """), {"d": days})).mappings().all()
    # Server-side status flip without a cron job.
    today = date.today()
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        due: date = d["due_date"]
        if due < today:
            d["status"] = "OVERDUE"
        elif due <= today + timedelta(days=30):
            d["status"] = "DUE_SOON"
        out.append(d)
    return {"items": out}
