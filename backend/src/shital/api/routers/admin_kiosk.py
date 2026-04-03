"""
Admin kiosk router — CRUD for temple services and order listing.
Requires authentication (admin role).
"""
from __future__ import annotations
from datetime import datetime
from typing import Any
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/admin", tags=["admin-kiosk"])


# ─── Temple Services ──────────────────────────────────────────────────────────

class ServiceBody(BaseModel):
    name: str = ""
    name_gu: str | None = None
    name_hi: str | None = None
    description: str | None = None
    category: str = "OTHER"
    price: float = 0.0
    currency: str = "GBP"
    duration: int | None = None
    capacity: int | None = None
    image_url: str | None = None
    is_active: bool = True
    branch_id: str = "main"


@router.get("/services")
async def list_services(branch_id: str = "", category: str = "", include_inactive: bool = True):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    conditions = ["deleted_at IS NULL"]
    params: dict[str, Any] = {}
    if branch_id:
        conditions.append("branch_id = :bid")
        params["bid"] = branch_id
    if category:
        conditions.append("category = :cat")
        params["cat"] = category
    if not include_inactive:
        conditions.append("is_active = true")

    where = " AND ".join(conditions)
    async with SessionLocal() as db:
        result = await db.execute(
            text(f"SELECT * FROM temple_services WHERE {where} ORDER BY category, name"),
            params,
        )
        rows = result.mappings().all()
    return {"services": [dict(r) for r in rows], "total": len(rows)}


@router.post("/services", status_code=201)
async def create_service(body: ServiceBody):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    service_id = str(uuid.uuid4())
    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO temple_services
                (id, name, name_gu, name_hi, description, category, price, currency,
                 duration, capacity, image_url, is_active, branch_id, created_at, updated_at)
                VALUES (:id, :name, :ngu, :nhi, :desc, :cat, :price, :cur,
                        :dur, :cap, :img, :active, :bid, :now, :now)
            """),
            {
                "id": service_id, "name": body.name, "ngu": body.name_gu,
                "nhi": body.name_hi, "desc": body.description, "cat": body.category,
                "price": str(body.price), "cur": body.currency, "dur": body.duration,
                "cap": body.capacity, "img": body.image_url, "active": body.is_active,
                "bid": body.branch_id, "now": now,
            },
        )
        await db.commit()
    return {"id": service_id, "message": "Service created"}


@router.put("/services/{service_id}")
async def update_service(service_id: str, body: ServiceBody):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    now = datetime.utcnow()
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
    params = {k: (str(v) if k == "price" else v) for k, v in updates.items()}
    params["sid"] = service_id
    params["now"] = now

    async with SessionLocal() as db:
        await db.execute(
            text(f"UPDATE temple_services SET {set_clauses}, updated_at = :now WHERE id = :sid"),
            params,
        )
        await db.commit()
    return {"id": service_id, "message": "Service updated"}


@router.delete("/services/{service_id}")
async def delete_service(service_id: str):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(
            text("UPDATE temple_services SET deleted_at = :now, is_active = false, updated_at = :now WHERE id = :sid"),
            {"now": now, "sid": service_id},
        )
        await db.commit()
    return {"deleted": True}


# ─── Kiosk Orders ─────────────────────────────────────────────────────────────

@router.get("/orders")
async def list_orders(limit: int = 50, offset: int = 0, status: str = "", branch_id: str = ""):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    conditions = []
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if status:
        conditions.append("status = :status")
        params["status"] = status
    if branch_id:
        conditions.append("branch_id = :bid")
        params["bid"] = branch_id

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT id, reference, branch_id, basket_id, status,
                       total_amount, currency, payment_provider, payment_ref,
                       customer_name, customer_email, customer_phone, created_at, updated_at
                FROM orders {where}
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        )
        rows = result.mappings().all()
        count_result = await db.execute(text(f"SELECT COUNT(*) AS cnt FROM orders {where}"), params)
        total = count_result.mappings().first()["cnt"]

    return {"orders": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}
