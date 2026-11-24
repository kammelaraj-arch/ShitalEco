"""
Trustee attendance per meeting (SORP §9.4 TAR disclosure).

Routes:
  GET  /admin/board/meetings/{mid}/attendance
  PUT  /admin/board/meetings/{mid}/attendance            bulk-set (array)
  GET  /admin/board/trustees/{tid}/attendance-stats?year=YYYY
  GET  /admin/board/attendance-report?year=YYYY          matrix for TAR
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["meeting-attendance"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "CEO", "SECRETARY"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


class AttendanceRow(BaseModel):
    trustee_id: str
    status: str = "PRESENT"   # PRESENT | VIRTUAL | LATE | APOLOGIES | ABSENT
    note: str = ""


class AttendanceBulkIn(BaseModel):
    records: list[AttendanceRow]


async def _audit(
    db: Any, *, action: str, entity_id: str, ctx: CurrentSpace,
    metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, 'meeting_attendance', CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


@router.get("/admin/board/meetings/{meeting_id}/attendance")
async def get_attendance(meeting_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        # LEFT JOIN so trustees without a record yet appear with status='UNSET'.
        rows = (await db.execute(text("""
            SELECT t.id AS trustee_id, t.full_name, t.role,
                   COALESCE(ma.status, 'UNSET') AS status,
                   COALESCE(ma.note, '')        AS note,
                   ma.recorded_at
            FROM   trustees t
            LEFT JOIN meeting_attendance ma
                   ON ma.trustee_id = t.id AND ma.meeting_id::text = :id
            WHERE  t.is_active = true
            ORDER  BY t.full_name
        """), {"id": meeting_id})).mappings().all()
    return {"attendance": [dict(r) for r in rows]}


@router.put("/admin/board/meetings/{meeting_id}/attendance")
async def set_attendance(
    meeting_id: str, body: AttendanceBulkIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        for r in body.records:
            await db.execute(text("""
                INSERT INTO meeting_attendance
                (meeting_id, trustee_id, status, note, recorded_by)
                VALUES (CAST(:mid AS uuid), CAST(:tid AS uuid), :s, :n, :by)
                ON CONFLICT (meeting_id, trustee_id) DO UPDATE SET
                  status      = EXCLUDED.status,
                  note        = EXCLUDED.note,
                  recorded_by = EXCLUDED.recorded_by,
                  recorded_at = NOW()
            """), {
                "mid": meeting_id,
                "tid": r.trustee_id,
                "s":   r.status,
                "n":   r.note.strip()[:1000],
                "by":  str(ctx.user_id) if ctx.user_id else None,
            })
        await _audit(
            db, action="ATTENDANCE_RECORDED", entity_id=meeting_id, ctx=ctx,
            metadata={"records": len(body.records)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"meeting_id": meeting_id, "count": len(body.records), "success": True}


@router.get("/admin/board/trustees/{trustee_id}/attendance-stats")
async def trustee_stats(
    trustee_id: str, ctx: CurrentSpace, year: int | None = Query(None),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    year_f = year or datetime.now(UTC).year
    async with SessionLocal() as db:
        # Meetings in the year the trustee was active for (simple: all
        # meetings in the year window; charity can refine later).
        rows = (await db.execute(text("""
            SELECT bm.id, bm.title, bm.scheduled_at,
                   COALESCE(ma.status, 'ABSENT') AS status
            FROM   board_meetings bm
            LEFT JOIN meeting_attendance ma
                   ON ma.meeting_id = bm.id AND ma.trustee_id::text = :tid
            WHERE  EXTRACT(YEAR FROM bm.scheduled_at) = :yr
              AND  bm.status IN ('SCHEDULED', 'OPENED', 'CLOSED')
            ORDER  BY bm.scheduled_at
        """), {"tid": trustee_id, "yr": year_f})).mappings().all()
    present = sum(1 for r in rows if r["status"] in ("PRESENT", "VIRTUAL", "LATE"))
    apologies = sum(1 for r in rows if r["status"] == "APOLOGIES")
    absent = sum(1 for r in rows if r["status"] == "ABSENT")
    total = len(rows)
    pct = round(100 * present / total, 1) if total else 0.0
    return {
        "trustee_id": trustee_id, "year": year_f,
        "meetings": total, "present": present, "apologies": apologies,
        "absent": absent, "attendance_pct": pct,
        "meetings_detail": [dict(r) for r in rows],
    }


@router.get("/admin/board/attendance-report")
async def report(
    ctx: CurrentSpace, year: int | None = Query(None),
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    year_f = year or datetime.now(UTC).year
    async with SessionLocal() as db:
        trustees = (await db.execute(text(
            "SELECT id, full_name, role FROM trustees "
            "WHERE is_active = true ORDER BY full_name"
        ))).mappings().all()
        meetings = (await db.execute(text("""
            SELECT id, title, meeting_type, scheduled_at
            FROM   board_meetings
            WHERE  EXTRACT(YEAR FROM scheduled_at) = :yr
              AND  status IN ('SCHEDULED', 'OPENED', 'CLOSED')
            ORDER  BY scheduled_at
        """), {"yr": year_f})).mappings().all()
        att = (await db.execute(text("""
            SELECT meeting_id, trustee_id, status
            FROM   meeting_attendance
            WHERE  meeting_id IN (
                SELECT id FROM board_meetings
                WHERE  EXTRACT(YEAR FROM scheduled_at) = :yr
            )
        """), {"yr": year_f})).mappings().all()
    index: dict[str, dict[str, str]] = {}
    for a in att:
        index.setdefault(str(a["trustee_id"]), {})[str(a["meeting_id"])] = a["status"]
    rows: list[dict[str, Any]] = []
    for t in trustees:
        tid = str(t["id"])
        by_meeting = index.get(tid, {})
        statuses = [by_meeting.get(str(m["id"]), "ABSENT") for m in meetings]
        present = sum(1 for s in statuses if s in ("PRESENT", "VIRTUAL", "LATE"))
        pct = round(100 * present / len(meetings), 1) if meetings else 0.0
        rows.append({
            "trustee_id": tid, "full_name": t["full_name"], "role": t["role"],
            "statuses":   statuses,
            "attendance_pct": pct,
        })
    return {
        "year": year_f,
        "meetings": [dict(m) for m in meetings],
        "rows": rows,
    }
