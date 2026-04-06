"""
Projects router — fundraising projects (e.g. Temple Hall, Prayer Room).
Each project can have catalog_items linked to it (brick donations etc).
"""
from __future__ import annotations
from datetime import datetime
from typing import Any
from fastapi import APIRouter, HTTPException
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
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
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


@router.post("", status_code=201)
async def create_project(body: ProjectIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    import uuid, re
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
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
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
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
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True}


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        result = await db.execute(
            text("DELETE FROM projects WHERE id = :pid OR project_id = :pid"),
            {"pid": project_id}
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Project not found")


@router.get("/{project_id}/items")
async def get_project_items(project_id: str, ctx: OptionalSpace) -> dict[str, Any]:
    """Get catalog items linked to this project."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
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
