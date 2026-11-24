"""
Trustees' Annual Report (TAR) — Charity SORP §1.21.

Routes:
  GET  /admin/annual-reports                      list
  POST /admin/annual-reports                      create + auto-populate
  GET  /admin/annual-reports/{rid}                detail incl. sections
  PUT  /admin/annual-reports/{rid}/sections/{k}   edit one section
  POST /admin/annual-reports/{rid}/regenerate     refresh drafts from
                                                   current Governance Core data
  POST /admin/annual-reports/{rid}/finalise       freeze snapshot + lock
  POST /admin/annual-reports/{rid}/mark-filed     record Commission ref
  GET  /admin/annual-reports/{rid}/preview        rendered HTML of the TAR
                                                   (used by the UI preview pane)
  GET  /admin/annual-reports/sections             SORP canonical ordering
"""
from __future__ import annotations

import json
from datetime import UTC, date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["annual-reports"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR", "TREASURER", "CEO", "SECRETARY"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


class AnnualReportIn(BaseModel):
    title: str
    period_start: str   # YYYY-MM-DD
    period_end: str     # YYYY-MM-DD


class SectionIn(BaseModel):
    html: str


class MarkFiledIn(BaseModel):
    commission_reference: str = ""


async def _audit(
    db: Any, *, action: str, entity_id: str, ctx: CurrentSpace,
    metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, 'annual_reports', CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


@router.get("/admin/annual-reports/sections")
async def get_sections(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from shital.services.board.annual_report import section_order
    return {"sections": [{"key": k, "label": lbl} for (k, lbl) in section_order()]}


@router.get("/admin/annual-reports")
async def list_reports(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT id, title, period_start, period_end, status, "
            "signed_at, filed_with_commission_at, created_at "
            "FROM annual_reports ORDER BY period_end DESC"
        ))).mappings().all()
    return {"reports": [dict(r) for r in rows]}


@router.post("/admin/annual-reports")
async def create_report(
    body: AnnualReportIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services.board.annual_report import aggregate
    aggregated = await aggregate(body.period_start, body.period_end)
    sections = {
        k: {"html": v["draft_html"], "data": v["data"]}
        for k, v in aggregated["sections"].items()
    }
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO annual_reports
            (title, period_start, period_end, status,
             narrative_sections, created_by)
            VALUES (:t, :ps, :pe, 'DRAFT', CAST(:ns AS jsonb), :by)
            RETURNING id
        """), {
            "t":  body.title.strip()[:255],
            "ps": body.period_start,
            "pe": body.period_end,
            "ns": json.dumps(sections),
            "by": str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="TAR_CREATED", entity_id=new_id, ctx=ctx,
            metadata={"period_start": body.period_start,
                      "period_end": body.period_end,
                      "sections_drafted": len(sections)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "sections_drafted": len(sections), "success": True}


@router.get("/admin/annual-reports/{report_id}")
async def get_report(report_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT * FROM annual_reports WHERE id::text = :id"
        ), {"id": report_id})).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Annual report not found")
    return {"report": dict(row)}


@router.put("/admin/annual-reports/{report_id}/sections/{key}")
async def update_section(
    report_id: str, key: str, body: SectionIn,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        existing = (await db.execute(text(
            "SELECT status, narrative_sections FROM annual_reports "
            "WHERE id::text = :id"
        ), {"id": report_id})).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Annual report not found")
        if existing["status"] in ("FINALISED", "FILED"):
            raise HTTPException(400, detail=f"Cannot edit a {existing['status']} report")
        sections = dict(existing["narrative_sections"] or {})
        current = sections.get(key, {})
        current["html"] = body.html
        sections[key] = current
        await db.execute(text(
            "UPDATE annual_reports SET narrative_sections = CAST(:ns AS jsonb), "
            "updated_at = NOW() WHERE id::text = :id"
        ), {"ns": json.dumps(sections), "id": report_id})
        await _audit(
            db, action="TAR_SECTION_EDITED", entity_id=report_id, ctx=ctx,
            metadata={"section": key, "chars": len(body.html)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": report_id, "section": key, "success": True}


@router.post("/admin/annual-reports/{report_id}/regenerate")
async def regenerate(
    report_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services.board.annual_report import aggregate
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT period_start, period_end, status, narrative_sections "
            "FROM annual_reports WHERE id::text = :id"
        ), {"id": report_id})).mappings().one_or_none()
        if not row:
            raise HTTPException(404, detail="Annual report not found")
        if row["status"] in ("FINALISED", "FILED"):
            raise HTTPException(400, detail=f"Cannot regenerate a {row['status']} report")
        aggregated = await aggregate(
            row["period_start"].isoformat(), row["period_end"].isoformat(),
        )
        existing = dict(row["narrative_sections"] or {})
        merged: dict[str, Any] = {}
        for k, v in aggregated["sections"].items():
            # Preserve any edit the admin made manually; only refresh `data`
            # and the `draft_html` for sections the admin hasn't touched
            # (heuristic: if current html == previous draft_html).
            prev = existing.get(k, {})
            keep_html = prev.get("html") not in (None, "", v["draft_html"])
            merged[k] = {
                "data": v["data"],
                "html": prev.get("html") if keep_html else v["draft_html"],
            }
        await db.execute(text(
            "UPDATE annual_reports SET narrative_sections = CAST(:ns AS jsonb), "
            "updated_at = NOW() WHERE id::text = :id"
        ), {"ns": json.dumps(merged), "id": report_id})
        await _audit(
            db, action="TAR_REGENERATED", entity_id=report_id, ctx=ctx,
            metadata={"sections": len(merged)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": report_id, "success": True}


@router.post("/admin/annual-reports/{report_id}/finalise")
async def finalise(
    report_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        existing = (await db.execute(text(
            "SELECT status, narrative_sections, period_start, period_end "
            "FROM annual_reports WHERE id::text = :id"
        ), {"id": report_id})).mappings().one_or_none()
        if not existing:
            raise HTTPException(404, detail="Annual report not found")
        if existing["status"] == "FINALISED":
            return {"id": report_id, "success": True, "noop": True}
        snapshot = {
            "finalised_at": datetime.now(UTC).isoformat(),
            "sections":     existing["narrative_sections"],
        }
        await db.execute(text(
            "UPDATE annual_reports SET status = 'FINALISED', "
            "snapshot = CAST(:snap AS jsonb), signed_by_user_id = :by, "
            "signed_by_name = :nm, signed_at = NOW(), updated_at = NOW() "
            "WHERE id::text = :id"
        ), {
            "snap": json.dumps(snapshot),
            "by":   str(ctx.user_id) if ctx.user_id else None,
            "nm":   ctx.user_email or "",
            "id":   report_id,
        })
        await _audit(
            db, action="TAR_FINALISED", entity_id=report_id, ctx=ctx,
            metadata={"period_end": existing["period_end"].isoformat()},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": report_id, "success": True}


@router.post("/admin/annual-reports/{report_id}/mark-filed")
async def mark_filed(
    report_id: str, body: MarkFiledIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "UPDATE annual_reports SET status = 'FILED', "
            "filed_with_commission_at = NOW(), commission_reference = :cr, "
            "updated_at = NOW() WHERE id::text = :id AND status = 'FINALISED' "
            "RETURNING id"
        ), {"cr": body.commission_reference.strip()[:80], "id": report_id})
        if not res.first():
            raise HTTPException(400, detail="Only FINALISED reports can be marked FILED")
        await _audit(
            db, action="TAR_FILED", entity_id=report_id, ctx=ctx,
            metadata={"commission_reference": body.commission_reference},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": report_id, "success": True}


@router.get("/admin/annual-reports/{report_id}/preview")
async def preview(report_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Render the whole TAR to a single HTML string for the UI preview
    pane. The actual PDF export is produced by the browser (print
    stylesheet) or by WeasyPrint on a signed finalise flow; this
    endpoint always returns clean on-screen HTML."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services.board.annual_report import section_order
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT title, period_start, period_end, narrative_sections, "
            "snapshot, status FROM annual_reports WHERE id::text = :id"
        ), {"id": report_id})).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Annual report not found")
    sections = (
        row["snapshot"].get("sections") if row["status"] in ("FINALISED", "FILED")
        else row["narrative_sections"]
    ) or {}
    body_parts: list[str] = [
        f"<h1>{row['title']}</h1>",
        f"<p class='meta'>Period: {row['period_start']} – {row['period_end']}</p>",
    ]
    for key, label in section_order():
        html = (sections.get(key) or {}).get("html") or "<p><em>(not yet drafted)</em></p>"
        body_parts.append(f"<h2>{label}</h2>{html}")
    rendered = "\n".join(body_parts)
    return {
        "id": report_id, "title": row["title"], "status": row["status"],
        "period_start": row["period_start"].isoformat(),
        "period_end": row["period_end"].isoformat(),
        "html": rendered,
    }


# Keep imports used (not strictly needed but keeps linters happy).
_ = date
