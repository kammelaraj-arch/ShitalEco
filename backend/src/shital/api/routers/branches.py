"""
Branches router — CRUD for temple branch locations.
Requires SUPER_ADMIN or ADMIN role for write operations.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace, OptionalSpace

router = APIRouter(prefix="/branches", tags=["branches"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class BranchIn(BaseModel):
    name: str
    city: str = ""
    postcode: str = ""
    address: str = ""
    phone: str = ""
    email: str = ""
    established: str = ""
    is_active: bool = True
    manager_name: str = ""
    manager_email: str = ""
    notes: str = ""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="SUPER_ADMIN or ADMIN required")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_branches(ctx: OptionalSpace) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(text(
            "SELECT * FROM branches ORDER BY established ASC, name ASC"
        ))
        rows = result.mappings().all()
    return {"branches": [dict(r) for r in rows]}


@router.post("", status_code=201)
async def create_branch(body: BranchIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    import re
    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    # Auto-generate branch_id from name if not set
    branch_id = re.sub(r'[^a-z0-9]', '_', body.name.lower())[:30].strip('_')
    now = datetime.utcnow()
    async with SessionLocal() as db:
        existing = await db.execute(
            text("SELECT id FROM branches WHERE branch_id = :bid"),
            {"bid": branch_id}
        )
        if existing.first():
            branch_id = f"{branch_id}_{str(uuid.uuid4())[:4]}"
        await db.execute(text("""
            INSERT INTO branches (id, branch_id, name, city, postcode, address,
                phone, email, established, is_active, manager_name, manager_email,
                notes, created_at, updated_at)
            VALUES (:id, :bid, :name, :city, :pc, :addr, :ph, :em, :est,
                :active, :mgr, :mgr_em, :notes, :now, :now)
        """), {
            "id": str(uuid.uuid4()), "bid": branch_id,
            "name": body.name, "city": body.city, "pc": body.postcode,
            "addr": body.address, "ph": body.phone, "em": body.email,
            "est": body.established, "active": body.is_active,
            "mgr": body.manager_name, "mgr_em": body.manager_email,
            "notes": body.notes, "now": now,
        })
        await db.commit()
    return {"ok": True, "branch_id": branch_id}


@router.put("/{branch_id}")
async def update_branch(branch_id: str, body: BranchIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    now = datetime.utcnow()
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE branches SET
                name = :name, city = :city, postcode = :pc, address = :addr,
                phone = :ph, email = :em, established = :est, is_active = :active,
                manager_name = :mgr, manager_email = :mgr_em, notes = :notes,
                updated_at = :now
            WHERE branch_id = :bid
        """), {
            "name": body.name, "city": body.city, "pc": body.postcode,
            "addr": body.address, "ph": body.phone, "em": body.email,
            "est": body.established, "active": body.is_active,
            "mgr": body.manager_name, "mgr_em": body.manager_email,
            "notes": body.notes, "now": now, "bid": branch_id,
        })
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Branch not found")
    return {"ok": True}


@router.delete("/{branch_id}", status_code=204)
async def delete_branch(branch_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        result = await db.execute(
            text("DELETE FROM branches WHERE branch_id = :bid"),
            {"bid": branch_id}
        )
        await db.commit()
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise HTTPException(status_code=404, detail="Branch not found")
