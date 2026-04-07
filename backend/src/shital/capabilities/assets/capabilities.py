"""
Asset Capabilities — Asset register, depreciation, maintenance scheduling.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

import structlog
from pydantic import BaseModel

from shital.core.dna.registry import Fabric, capability
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()

DEPRECIATION_RATES: dict[str, Decimal] = {
    "IT": Decimal("0.33"),
    "EQUIPMENT": Decimal("0.20"),
    "FURNITURE": Decimal("0.10"),
    "VEHICLE": Decimal("0.15"),
    "PROPERTY": Decimal("0.04"),
    "OTHER": Decimal("0.10"),
}


class CreateAssetInput(BaseModel):
    name: str
    category: str
    description: str = ""
    serial_number: str = ""
    purchase_date: str = ""
    purchase_price: str = "0"
    supplier: str = ""
    location: str = ""
    warranty_expiry: str = ""
    assigned_to: str = ""


class MaintenanceInput(BaseModel):
    asset_id: str
    scheduled_date: str
    description: str
    estimated_cost: str = "0"


@capability(
    name="register_asset",
    description="Register a new physical asset (IT equipment, furniture, vehicles, property) in the asset register.",
    fabric=Fabric.ASSETS,
    requires=["assets:write"],
    tags=["assets"],
)
async def register_asset(ctx: DigitalSpace, data: CreateAssetInput) -> dict[str, Any]:
    ctx.require_permission("assets:write")

    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    asset_id = str(uuid.uuid4())
    now = datetime.utcnow()

    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO assets
                (id, branch_id, name, description, category, serial_number,
                 purchase_date, purchase_price, current_value, supplier,
                 warranty_expiry, location, status, assigned_to, created_at, updated_at)
                VALUES (:id, :bid, :name, :desc, :cat, :serial, :pd, :pp, :pp,
                        :supplier, :warranty, :loc, 'ACTIVE', :assigned, :now, :now)
            """),
            {
                "id": asset_id, "bid": ctx.branch_id, "name": data.name,
                "desc": data.description or None, "cat": data.category,
                "serial": data.serial_number or None,
                "pd": data.purchase_date or None,
                "pp": data.purchase_price,
                "supplier": data.supplier or None,
                "warranty": data.warranty_expiry or None,
                "loc": data.location or None,
                "assigned": data.assigned_to or None, "now": now,
            },
        )
        await db.commit()

    return {"asset_id": asset_id, "name": data.name, "category": data.category}


@capability(
    name="get_asset_register",
    description="Get full asset register for the branch with current values and depreciation summary.",
    fabric=Fabric.ASSETS,
    requires=["assets:read"],
    idempotent=True,
    tags=["assets", "reporting"],
)
async def get_asset_register(ctx: DigitalSpace, category: str = "") -> dict[str, Any]:
    ctx.require_permission("assets:read")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    conditions = ["a.branch_id = :bid", "a.deleted_at IS NULL", "a.status != 'DISPOSED'"]
    params: dict[str, Any] = {"bid": ctx.branch_id}
    if category:
        conditions.append("a.category = :cat")
        params["cat"] = category

    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT a.id, a.name, a.category, a.serial_number, a.purchase_date,
                       a.purchase_price, a.current_value, a.location, a.status,
                       a.warranty_expiry, u.name AS assigned_to_name
                FROM assets a
                LEFT JOIN users u ON u.id = a.assigned_to
                WHERE {" AND ".join(conditions)}
                ORDER BY a.category, a.name
            """),
            params,
        )
        rows = result.mappings().all()

    assets = []
    total_value = Decimal("0")
    by_category: dict[str, dict[str, Any]] = {}

    for r in rows:
        val = Decimal(str(r["current_value"] or 0))
        total_value += val
        cat = r["category"]
        if cat not in by_category:
            by_category[cat] = {"count": 0, "total_value": Decimal("0")}
        by_category[cat]["count"] += 1
        by_category[cat]["total_value"] += val

        # Calculate depreciation
        dep_rate = DEPRECIATION_RATES.get(cat, Decimal("0.10"))
        purchase_date = r["purchase_date"]
        years_owned = 0
        if purchase_date:
            pd = purchase_date if isinstance(purchase_date, date) else date.fromisoformat(str(purchase_date))
            years_owned = (date.today() - pd).days / 365.25

        annual_dep = (Decimal(str(r["purchase_price"] or 0)) * dep_rate).quantize(Decimal("0.01"))

        assets.append({
            "id": r["id"], "name": r["name"], "category": cat,
            "serial_number": r["serial_number"], "location": r["location"],
            "purchase_date": str(r["purchase_date"]) if r["purchase_date"] else None,
            "purchase_price": str(r["purchase_price"] or 0),
            "current_value": str(val),
            "annual_depreciation": str(annual_dep),
            "years_owned": round(years_owned, 1),
            "status": r["status"],
            "assigned_to": r["assigned_to_name"],
            "warranty_expiry": str(r["warranty_expiry"]) if r["warranty_expiry"] else None,
        })

    return {
        "branch_id": ctx.branch_id,
        "assets": assets,
        "total_assets": len(assets),
        "total_value": str(total_value),
        "by_category": {k: {"count": v["count"], "total_value": str(v["total_value"])} for k, v in by_category.items()},
    }


@capability(
    name="schedule_maintenance",
    description="Schedule a maintenance task for an asset.",
    fabric=Fabric.ASSETS,
    requires=["assets:write"],
    tags=["assets", "maintenance"],
)
async def schedule_maintenance(ctx: DigitalSpace, data: MaintenanceInput) -> dict[str, Any]:
    ctx.require_permission("assets:write")

    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    record_id = str(uuid.uuid4())
    now = datetime.utcnow()

    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO maintenance_records
                (id, asset_id, scheduled_date, description, cost, status, created_at, updated_at)
                VALUES (:id, :asset, :sched, :desc, :cost, 'SCHEDULED', :now, :now)
            """),
            {
                "id": record_id, "asset": data.asset_id,
                "sched": data.scheduled_date, "desc": data.description,
                "cost": data.estimated_cost or None, "now": now,
            },
        )
        await db.commit()

    return {"record_id": record_id, "asset_id": data.asset_id, "scheduled_date": data.scheduled_date}


@capability(
    name="get_overdue_maintenance",
    description="List all assets with overdue or upcoming maintenance tasks.",
    fabric=Fabric.ASSETS,
    requires=["assets:read"],
    idempotent=True,
    tags=["assets", "maintenance"],
)
async def get_overdue_maintenance(ctx: DigitalSpace) -> dict[str, Any]:
    ctx.require_permission("assets:read")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT m.id, m.asset_id, m.scheduled_date, m.description,
                       m.cost, a.name AS asset_name, a.category
                FROM maintenance_records m
                JOIN assets a ON a.id = m.asset_id
                WHERE a.branch_id = :bid
                  AND m.status = 'SCHEDULED'
                  AND m.scheduled_date <= :today
                ORDER BY m.scheduled_date ASC
            """),
            {"bid": ctx.branch_id, "today": date.today()},
        )
        rows = result.mappings().all()

    items = [dict(r) for r in rows]
    return {"overdue_count": len(items), "items": items}
