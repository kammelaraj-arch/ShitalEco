"""
Admin kiosk router — CRUD for temple services and order listing.
Requires authentication (admin role).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/admin", tags=["admin-kiosk"])


# ─── Dashboard Stats ─────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats():
    """Aggregate dashboard statistics — no auth required (public summary)."""
    from datetime import date

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    today = date.today()
    async with SessionLocal() as db:
        # Items
        items_r = await db.execute(
            text("SELECT COUNT(*) AS cnt FROM catalog_items WHERE deleted_at IS NULL")
        )
        total_items = items_r.mappings().first()["cnt"]

        # Orders
        orders_r = await db.execute(
            text("SELECT COUNT(*) AS cnt, COALESCE(SUM(CAST(total_amount AS NUMERIC)), 0) AS rev FROM orders")
        )
        orow = orders_r.mappings().first()
        total_orders = orow["cnt"]
        total_revenue = float(orow["rev"] or 0)

        # Today's orders
        today_r = await db.execute(
            text("SELECT COUNT(*) AS cnt FROM orders WHERE DATE(created_at) = :today"),
            {"today": today},
        )
        today_orders = today_r.mappings().first()["cnt"]

        # Monthly revenue (last 12 months)
        monthly_r = await db.execute(text("""
            SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS month,
                   SUM(CAST(total_amount AS NUMERIC)) AS amount
            FROM orders
            WHERE created_at >= NOW() - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', created_at)
            ORDER BY DATE_TRUNC('month', created_at)
        """))
        monthly = [{"month": r["month"], "amount": float(r["amount"] or 0)} for r in monthly_r.mappings()]

        # Recent 5 orders
        recent_r = await db.execute(text("""
            SELECT reference, customer_name, total_amount, status, created_at
            FROM orders ORDER BY created_at DESC LIMIT 5
        """))
        recent_orders = []
        for r in recent_r.mappings():
            d = dict(r)
            if d.get("created_at") and hasattr(d["created_at"], "isoformat"):
                d["created_at"] = d["created_at"].isoformat()
            if d.get("total_amount"):
                d["total_amount"] = float(d["total_amount"])
            recent_orders.append(d)

        # Employees (if table exists)
        total_employees = 0
        try:
            emp_r = await db.execute(
                text("SELECT COUNT(*) AS cnt FROM employees WHERE deleted_at IS NULL AND is_active = true")
            )
            total_employees = emp_r.mappings().first()["cnt"]
        except Exception:
            pass

        # Live catalog items
        live_r = await db.execute(
            text("SELECT COUNT(*) AS cnt FROM catalog_items WHERE deleted_at IS NULL AND is_live = true")
        )
        live_items = live_r.mappings().first()["cnt"]

    return {
        "total_items": total_items,
        "live_items": live_items,
        "total_orders": total_orders,
        "today_orders": today_orders,
        "total_revenue": total_revenue,
        "total_employees": total_employees,
        "monthly_revenue": monthly,
        "recent_orders": recent_orders,
    }


# ─── Temple Services ─────────────────────────────────────────────────────

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
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

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
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

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
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

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
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(
            text("UPDATE temple_services SET deleted_at = :now, is_active = false, updated_at = :now WHERE id = :sid"),
            {"now": now, "sid": service_id},
        )
        await db.commit()
    return {"deleted": True}


# ─── Kiosk Orders ───────────────────────────────────────────────────────

@router.get("/orders")
async def list_orders(limit: int = 50, offset: int = 0, status: str = "", branch_id: str = ""):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

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
                       device_id, device_label, source,
                       customer_name, customer_email, customer_phone, created_at, updated_at
                FROM orders {where}
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        )
        rows = result.mappings().all()
        count_result = await db.execute(text(f"SELECT COUNT(*) AS cnt FROM orders {where}"), params)
        _count_row = count_result.mappings().first()
        total = _count_row["cnt"] if _count_row is not None else 0

    return {"orders": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


# ─── Addresses ──────────────────────────────────────────────────────────

@router.get("/addresses")
async def list_addresses(q: str = "", contact_id: str = "", account_id: str = "", unlinked: bool = False, page: int = 1, per_page: int = 50):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    per_page = min(per_page, 200)
    offset = (page - 1) * per_page
    conditions: list[str] = []
    params: dict[str, Any] = {"limit": per_page, "offset": offset}

    if q:
        conditions.append("(a.formatted ILIKE :q OR a.postcode ILIKE :q OR c.full_name ILIKE :q OR c.email ILIKE :q)")
        params["q"] = f"%{q}%"
    if contact_id:
        conditions.append("a.contact_id = :cid")
        params["cid"] = contact_id
    if account_id:
        conditions.append("a.crm_account_id = :aid")
        params["aid"] = account_id
    if unlinked:
        conditions.append("a.crm_account_id IS NULL")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    async with SessionLocal() as db:
        result = await db.execute(text(f"""
            SELECT a.id, a.contact_id, a.formatted, a.postcode, a.uprn,
                   a.is_primary, a.lookup_source, a.created_at,
                   c.full_name AS contact_name, c.email AS contact_email
              FROM addresses a
              LEFT JOIN contacts c ON c.id = a.contact_id
              {where}
             ORDER BY a.created_at DESC
             LIMIT :limit OFFSET :offset
        """), params)
        rows = result.mappings().all()

        count_r = await db.execute(
            text(f"SELECT COUNT(*) AS cnt FROM addresses a LEFT JOIN contacts c ON c.id = a.contact_id {where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )
        count_row = count_r.mappings().first()
        total = int(count_row["cnt"]) if count_row else 0

    return {"addresses": [dict(r) for r in rows], "total": total, "page": page, "per_page": per_page}


# ─── Order Items ────────────────────────────────────────────────────────

@router.get("/order-items")
async def list_order_items(order_ref: str = "", branch_id: str = "", page: int = 1, per_page: int = 100):
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    per_page = min(per_page, 500)
    offset = (page - 1) * per_page
    conditions: list[str] = []
    params: dict[str, Any] = {"limit": per_page, "offset": offset}

    if order_ref:
        conditions.append("o.reference ILIKE :ref")
        params["ref"] = f"%{order_ref}%"
    if branch_id:
        conditions.append("o.branch_id = :bid")
        params["bid"] = branch_id

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    async with SessionLocal() as db:
        result = await db.execute(text(f"""
            SELECT
                bi.id, bi.basket_id, bi.item_type, bi.reference_id,
                bi.name, bi.description, bi.quantity,
                bi.unit_price, bi.total_price, bi.created_at,
                o.reference AS order_ref, o.status AS order_status,
                o.branch_id, o.customer_name, o.customer_email,
                o.payment_provider, o.created_at AS order_date
              FROM basket_items bi
              JOIN baskets b ON b.id = bi.basket_id
              JOIN orders o  ON o.basket_id = b.id
              {where}
             ORDER BY o.created_at DESC, bi.created_at ASC
             LIMIT :limit OFFSET :offset
        """), params)
        rows = result.mappings().all()

        count_r = await db.execute(
            text(f"""
                SELECT COUNT(*) AS cnt
                  FROM basket_items bi
                  JOIN baskets b ON b.id = bi.basket_id
                  JOIN orders o  ON o.basket_id = b.id
                  {where}
            """),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )
        count_row = count_r.mappings().first()
        total = int(count_row["cnt"]) if count_row else 0

    return {"items": [dict(r) for r in rows], "total": total, "page": page, "per_page": per_page}
