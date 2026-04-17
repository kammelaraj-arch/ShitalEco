"""
Projects router — fundraising projects (e.g. Temple Hall, Prayer Room).
Each project can have catalog_items linked to it (brick donations etc).
"""
from __future__ import annotations

import csv
import io
import re
import uuid as _uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from shital.api.deps import CurrentSpace, OptionalSpace

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectIn(BaseModel):
    name: str
    description: str = ""
    branch_id: str = "main"
    goal_amount: float = 0
    image_url: str = ""
    start_date: str | None = None
    end_date: str | None = None
    is_active: bool = True
    sort_order: int = 0


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="SUPER_ADMIN or ADMIN required")


@router.get("")
async def list_projects(ctx: OptionalSpace, branch_id: str = "", include_inactive: bool = False) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        filters = []
        params: dict[str, Any] = {}
        if branch_id:
            filters.append("branch_id = :bid")
            params["bid"] = branch_id
        if not include_inactive:
            filters.append("is_active = true")
        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        result = await db.execute(text(
            f"SELECT * FROM projects {where} ORDER BY sort_order ASC, name ASC"
        ), params)
        rows = result.mappings().all()
    return {"projects": [dict(r) for r in rows]}


@router.get("/export.csv")
async def export_projects_csv(ctx: CurrentSpace) -> StreamingResponse:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(text("""
            SELECT project_id, name, description, branch_id, goal_amount,
                   start_date, end_date, is_active, sort_order, image_url
            FROM projects
            ORDER BY sort_order ASC, name ASC
        """))
        rows = result.mappings().all()

    buf = io.StringIO()
    buf.write('\ufeff')  # UTF-8 BOM — Excel reads Unicode correctly
    writer = csv.writer(buf)
    writer.writerow(["project_id", "name", "description", "branch_id", "goal_amount",
                     "start_date", "end_date", "is_active", "sort_order", "image_url"])
    for r in rows:
        img = r["image_url"] or ""
        if img.startswith("data:"):
            img = ""
        writer.writerow([
            r["project_id"], r["name"], r["description"] or "",
            r["branch_id"], float(r["goal_amount"] or 0),
            r["start_date"].isoformat() if r["start_date"] else "",
            r["end_date"].isoformat() if r["end_date"] else "",
            "true" if r["is_active"] else "false",
            r["sort_order"] or 0,
            img,
        ])

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="projects.csv"'},
    )


@router.post("/import")
async def import_projects_csv(ctx: CurrentSpace, file: UploadFile = File(...)) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    raw = await file.read()
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(content))
    imported = 0
    errors: list[dict[str, Any]] = []
    now = datetime.utcnow()

    async with SessionLocal() as db:
        for row_num, row in enumerate(reader, start=2):
            try:
                name = (row.get("name") or "").strip()
                if not name:
                    errors.append({"row": row_num, "error": "Missing name"})
                    continue

                pid = (row.get("project_id") or "").strip()
                if not pid:
                    pid = re.sub(r"[^a-z0-9]", "_", name.lower())[:40].strip("_")

                goal = 0.0
                try:
                    goal = float((row.get("goal_amount") or "0").strip())
                except ValueError:
                    pass

                is_active = (row.get("is_active") or "true").strip().lower() not in ("false", "0", "no")
                start_date = (row.get("start_date") or "").strip() or None
                end_date = (row.get("end_date") or "").strip() or None
                sort_order = 0
                try:
                    sort_order = int((row.get("sort_order") or "0").strip())
                except ValueError:
                    pass

                existing = await db.execute(
                    text("SELECT id FROM projects WHERE project_id = :pid"), {"pid": pid}
                )
                params: dict[str, Any] = {
                    "name": name, "desc": (row.get("description") or "").strip(),
                    "bid": (row.get("branch_id") or "main").strip(),
                    "goal": goal, "img": (row.get("image_url") or "").strip(),
                    "start": start_date, "end": end_date,
                    "active": is_active, "sort": sort_order, "now": now, "pid": pid,
                }
                if existing.first():
                    await db.execute(text("""
                        UPDATE projects SET
                            name=:name, description=:desc, branch_id=:bid,
                            goal_amount=:goal, image_url=:img,
                            start_date=:start, end_date=:end,
                            is_active=:active, sort_order=:sort, updated_at=:now
                        WHERE project_id=:pid
                    """), params)
                else:
                    await db.execute(text("""
                        INSERT INTO projects
                            (id, project_id, name, description, branch_id, goal_amount,
                             image_url, start_date, end_date, is_active, sort_order,
                             created_at, updated_at)
                        VALUES
                            (:id, :pid, :name, :desc, :bid, :goal,
                             :img, :start, :end, :active, :sort, :now, :now)
                    """), {**params, "id": str(_uuid.uuid4())})
                imported += 1
            except Exception as exc:
                errors.append({"row": row_num, "error": str(exc)[:120]})

        if imported > 0:
            await db.commit()

    return {"imported": imported, "skipped": len(errors), "errors": errors[:20]}


@router.post("", status_code=201)
async def create_project(body: ProjectIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    import re
    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    project_id = re.sub(r'[^a-z0-9]', '_', body.name.lower())[:40].strip('_')
    now = datetime.utcnow()
    async with SessionLocal() as db:
        existing = await db.execute(
            text("SELECT id FROM projects WHERE project_id = :pid"),
            {"pid": project_id}
        )
        if existing.first():
            project_id = f"{project_id}_{str(uuid.uuid4())[:4]}"
        new_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO projects
                (id, project_id, name, description, branch_id, goal_amount,
                 image_url, start_date, end_date, is_active, sort_order,
                 created_at, updated_at)
            VALUES
                (:id, :pid, :name, :desc, :bid, :goal,
                 :img, :start, :end, :active, :sort,
                 :now, :now)
        """), {
            "id": new_id, "pid": project_id,
            "name": body.name, "desc": body.description, "bid": body.branch_id,
            "goal": body.goal_amount, "img": body.image_url,
            "start": body.start_date, "end": body.end_date,
            "active": body.is_active, "sort": body.sort_order, "now": now,
        })
        await db.commit()
    return {"ok": True, "id": new_id, "project_id": project_id}


@router.put("/{project_id}")
async def update_project(project_id: str, body: ProjectIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE projects SET
                name = :name, description = :desc, branch_id = :bid,
                goal_amount = :goal, image_url = :img,
                start_date = :start, end_date = :end,
                is_active = :active, sort_order = :sort,
                updated_at = :now
            WHERE id = :pid OR project_id = :pid
        """), {
            "name": body.name, "desc": body.description, "bid": body.branch_id,
            "goal": body.goal_amount, "img": body.image_url,
            "start": body.start_date, "end": body.end_date,
            "active": body.is_active, "sort": body.sort_order,
            "now": now, "pid": project_id,
        })
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True}


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(
            text("DELETE FROM projects WHERE id = :pid OR project_id = :pid"),
            {"pid": project_id}
        )
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Project not found")


@router.get("/{project_id}/items")
async def get_project_items(project_id: str, ctx: OptionalSpace) -> dict[str, Any]:
    """Get catalog items linked to this project."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(text("""
            SELECT id, name, name_gu, name_hi, name_te, description, category,
                   price, currency, emoji, image_url, gift_aid_eligible,
                   is_active, is_live, sort_order, available_from, available_until
            FROM catalog_items
            WHERE project_id = :pid AND deleted_at IS NULL
            ORDER BY sort_order ASC, name ASC
        """), {"pid": project_id})
        rows = result.mappings().all()
    return {"items": [dict(r) for r in rows]}
