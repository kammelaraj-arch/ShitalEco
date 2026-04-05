"""Assets router — fixed asset register."""
from __future__ import annotations
from datetime import datetime
import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal
from sqlalchemy import text

router = APIRouter(prefix="/assets", tags=["assets"])


class AssetIn(BaseModel):
    name: str
    category: str = "OTHER"
    description: str = ""
    serial_number: str = ""
    purchase_date: str = ""
    purchase_price: str = "0"
    supplier: str = ""
    location: str = ""
    warranty_expiry: str = ""
    assigned_to: str = ""
    notes: str = ""


def _serialize(rows: list) -> list:
    out = []
    for r in rows:
        d = dict(r)
        for k in ("purchase_date", "warranty_expiry", "created_at", "updated_at", "deleted_at"):
            if d.get(k) and hasattr(d[k], "isoformat"):
                d[k] = d[k].isoformat()
        for k in ("purchase_price", "current_value"):
            if d.get(k) is not None:
                d[k] = float(d[k])
        out.append(d)
    return out


@router.get("")
async def list_assets(ctx: CurrentSpace, category: str = ""):
    async with SessionLocal() as db:
        where = "branch_id = :bid AND deleted_at IS NULL"
        params: dict = {"bid": ctx.branch_id}
        if category:
            where += " AND category = :cat"
            params["cat"] = category
        result = await db.execute(
            text(f"SELECT * FROM assets WHERE {where} ORDER BY category, name"),
            params,
        )
        rows = _serialize(result.mappings().all())

    total_value = sum(r.get("current_value") or 0 for r in rows)
    by_category: dict = {}
    for r in rows:
        cat = r["category"]
        if cat not in by_category:
            by_category[cat] = {"count": 0, "value": 0.0}
        by_category[cat]["count"] += 1
        by_category[cat]["value"] += r.get("current_value") or 0

    return {
        "assets": rows,
        "total": len(rows),
        "total_value": round(total_value, 2),
        "by_category": by_category,
    }


@router.post("")
async def create_asset(body: AssetIn, ctx: CurrentSpace):
    asset_id = str(uuid.uuid4())
    now = datetime.utcnow()
    price = float(body.purchase_price) if body.purchase_price else 0.0
    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO assets
                (id, branch_id, name, description, category, serial_number,
                 purchase_date, purchase_price, current_value, supplier,
                 warranty_expiry, location, status, assigned_to, notes, created_at, updated_at)
                VALUES (:id, :bid, :name, :desc, :cat, :serial, :pd, :pp, :pp,
                        :supplier, :warranty, :loc, 'ACTIVE', :assigned, :notes, :now, :now)
            """),
            {
                "id": asset_id, "bid": ctx.branch_id, "name": body.name,
                "desc": body.description or None, "cat": body.category,
                "serial": body.serial_number or None,
                "pd": body.purchase_date or None,
                "pp": price,
                "supplier": body.supplier or None,
                "warranty": body.warranty_expiry or None,
                "loc": body.location or None,
                "assigned": body.assigned_to or None,
                "notes": body.notes or None, "now": now,
            },
        )
        await db.commit()
    return {"id": asset_id, "name": body.name}


@router.patch("/{asset_id}")
async def update_asset(asset_id: str, body: AssetIn, ctx: CurrentSpace):
    now = datetime.utcnow()
    price = float(body.purchase_price) if body.purchase_price else 0.0
    async with SessionLocal() as db:
        await db.execute(
            text("""
                UPDATE assets SET
                    name=:name, description=:desc, category=:cat,
                    serial_number=:serial, purchase_date=:pd,
                    purchase_price=:pp, current_value=:pp,
                    supplier=:supplier, warranty_expiry=:warranty,
                    location=:loc, assigned_to=:assigned, notes=:notes, updated_at=:now
                WHERE id=:id AND branch_id=:bid AND deleted_at IS NULL
            """),
            {
                "id": asset_id, "bid": ctx.branch_id, "name": body.name,
                "desc": body.description or None, "cat": body.category,
                "serial": body.serial_number or None,
                "pd": body.purchase_date or None, "pp": price,
                "supplier": body.supplier or None,
                "warranty": body.warranty_expiry or None,
                "loc": body.location or None,
                "assigned": body.assigned_to or None,
                "notes": body.notes or None, "now": now,
            },
        )
        await db.commit()
    return {"id": asset_id}


@router.delete("/{asset_id}")
async def dispose_asset(asset_id: str, ctx: CurrentSpace):
    async with SessionLocal() as db:
        await db.execute(
            text("UPDATE assets SET deleted_at=NOW(), status='DISPOSED', updated_at=NOW() WHERE id=:id AND branch_id=:bid"),
            {"id": asset_id, "bid": ctx.branch_id},
        )
        await db.commit()
    return {"disposed": asset_id}
