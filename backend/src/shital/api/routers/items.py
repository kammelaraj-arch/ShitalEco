"""
Items / Catalog router — admin item management + public kiosk catalog endpoints.
Admin endpoints require auth. Kiosk endpoints are public (no auth).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(prefix="/items", tags=["items"])


# ─── Enums ────────────────────────────────────────────────────────────────────

class ItemCategory(str, Enum):
    GENERAL_DONATION = "GENERAL_DONATION"
    SOFT_DONATION = "SOFT_DONATION"
    PROJECT_DONATION = "PROJECT_DONATION"
    SHOP = "SHOP"
    SERVICE = "SERVICE"


class ItemScope(str, Enum):
    GLOBAL = "GLOBAL"
    BRANCH = "BRANCH"


# ─── Pydantic Models ──────────────────────────────────────────────────────────

class ItemBase(BaseModel):
    name: str
    name_gu: str = ""
    name_hi: str = ""
    description: str = ""
    category: ItemCategory
    price: Decimal
    currency: str = "GBP"
    unit: str = ""
    emoji: str = ""
    image_url: str = ""
    gift_aid_eligible: bool = False
    is_active: bool = True
    scope: ItemScope = ItemScope.GLOBAL
    branch_id: str = ""
    stock_qty: int | None = None
    sort_order: int = 0
    metadata_json: dict = {}


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    name: str | None = None
    name_gu: str | None = None
    name_hi: str | None = None
    description: str | None = None
    category: ItemCategory | None = None
    price: Decimal | None = None
    currency: str | None = None
    unit: str | None = None
    emoji: str | None = None
    image_url: str | None = None
    gift_aid_eligible: bool | None = None
    is_active: bool | None = None
    scope: ItemScope | None = None
    branch_id: str | None = None
    stock_qty: int | None = None
    sort_order: int | None = None
    metadata_json: dict | None = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _row_to_dict(row: Any) -> dict:
    d = dict(row)
    # Convert Decimal to float for JSON serialisation
    if "price" in d and d["price"] is not None:
        d["price"] = float(d["price"])
    if "metadata_json" in d and isinstance(d["metadata_json"], str):
        try:
            d["metadata_json"] = json.loads(d["metadata_json"])
        except Exception:
            d["metadata_json"] = {}
    return d


# ─── Admin: CRUD endpoints (require auth) ─────────────────────────────────────

@router.get("/")
async def list_items(
    ctx: CurrentSpace,
    category: str = "",
    branch_id: str = "",
    scope: str = "",
    active_only: bool = True,
):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    conditions = ["deleted_at IS NULL"]
    params: dict[str, Any] = {}

    if active_only:
        conditions.append("is_active = true")
    if category:
        conditions.append("category = :category")
        params["category"] = category
    if branch_id:
        conditions.append("branch_id = :branch_id")
        params["branch_id"] = branch_id
    if scope:
        conditions.append("scope = :scope")
        params["scope"] = scope

    where = " AND ".join(conditions)

    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT id, name, name_gu, name_hi, description, category,
                       price, currency, unit, emoji, image_url,
                       gift_aid_eligible, is_active, scope, branch_id,
                       stock_qty, sort_order, metadata_json,
                       created_at, updated_at
                FROM catalog_items
                WHERE {where}
                ORDER BY sort_order, category, name
            """),
            params,
        )
        rows = result.mappings().all()

    return {"items": [_row_to_dict(r) for r in rows], "total": len(rows)}


@router.get("/kiosk/soft-donations")
async def kiosk_soft_donations(branch_id: str = "main"):
    """Public: SOFT_DONATION items for a branch (global + branch-specific)."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    try:
        async with SessionLocal() as db:
            result = await db.execute(
                text("""
                    SELECT id, name, name_gu, name_hi, description,
                           price, currency, unit, emoji, image_url,
                           gift_aid_eligible, stock_qty, sort_order, metadata_json
                    FROM catalog_items
                    WHERE category = 'SOFT_DONATION'
                      AND is_active = true
                      AND deleted_at IS NULL
                      AND (scope = 'GLOBAL' OR (scope = 'BRANCH' AND branch_id = :bid))
                    ORDER BY sort_order, name
                """),
                {"bid": branch_id},
            )
            rows = result.mappings().all()
        return {"items": [_row_to_dict(r) for r in rows], "branch_id": branch_id}
    except Exception:
        return {"items": [], "branch_id": branch_id}


@router.get("/kiosk/projects")
async def kiosk_projects(branch_id: str = "main"):
    """Public: PROJECT_DONATION items + project list."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    try:
        async with SessionLocal() as db:
            result = await db.execute(
                text("""
                    SELECT id, name, name_gu, name_hi, description,
                           price, currency, unit, emoji, image_url,
                           gift_aid_eligible, stock_qty, sort_order, metadata_json
                    FROM catalog_items
                    WHERE category = 'PROJECT_DONATION'
                      AND is_active = true
                      AND deleted_at IS NULL
                      AND (scope = 'GLOBAL' OR (scope = 'BRANCH' AND branch_id = :bid))
                    ORDER BY sort_order, price
                """),
                {"bid": branch_id},
            )
            rows = result.mappings().all()
        items = [_row_to_dict(r) for r in rows]
        # Collect distinct project references from metadata_json
        projects = []
        seen_project_ids: set[str] = set()
        for item in items:
            meta = item.get("metadata_json") or {}
            pid = meta.get("project_id", "")
            if pid and pid not in seen_project_ids:
                seen_project_ids.add(pid)
                projects.append({"id": pid, "name": meta.get("project_name", pid)})
        return {"items": items, "projects": projects, "branch_id": branch_id}
    except Exception:
        return {"items": [], "projects": [], "branch_id": branch_id}


@router.get("/kiosk/shop")
async def kiosk_shop(branch_id: str = "main"):
    """Public: SHOP items for a branch."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    try:
        async with SessionLocal() as db:
            result = await db.execute(
                text("""
                    SELECT id, name, name_gu, name_hi, description,
                           price, currency, unit, emoji, image_url,
                           gift_aid_eligible, stock_qty, sort_order, metadata_json
                    FROM catalog_items
                    WHERE category = 'SHOP'
                      AND is_active = true
                      AND deleted_at IS NULL
                      AND (scope = 'GLOBAL' OR (scope = 'BRANCH' AND branch_id = :bid))
                    ORDER BY sort_order, name
                """),
                {"bid": branch_id},
            )
            rows = result.mappings().all()
        return {"items": [_row_to_dict(r) for r in rows], "branch_id": branch_id}
    except Exception:
        return {"items": [], "branch_id": branch_id}


@router.get("/kiosk/general-donations")
async def kiosk_general_donations():
    """Public: GENERAL_DONATION preset items."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    try:
        async with SessionLocal() as db:
            result = await db.execute(
                text("""
                    SELECT id, name, name_gu, name_hi, description,
                           price, currency, unit, emoji, image_url,
                           gift_aid_eligible, sort_order, metadata_json
                    FROM catalog_items
                    WHERE category = 'GENERAL_DONATION'
                      AND is_active = true
                      AND deleted_at IS NULL
                    ORDER BY sort_order, price
                """),
            )
            rows = result.mappings().all()
        return {"items": [_row_to_dict(r) for r in rows]}
    except Exception:
        return {"items": []}


@router.get("/{item_id}")
async def get_item(item_id: str, ctx: CurrentSpace):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT id, name, name_gu, name_hi, description, category,
                       price, currency, unit, emoji, image_url,
                       gift_aid_eligible, is_active, scope, branch_id,
                       stock_qty, sort_order, metadata_json,
                       created_at, updated_at
                FROM catalog_items
                WHERE id = :id AND deleted_at IS NULL
            """),
            {"id": item_id},
        )
        row = result.mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Item not found")
    return _row_to_dict(row)


@router.post("/")
async def create_item(body: ItemCreate, ctx: CurrentSpace):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    item_id = str(uuid.uuid4())
    now = datetime.utcnow()

    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO catalog_items
                (id, name, name_gu, name_hi, description, category, price, currency,
                 unit, emoji, image_url, gift_aid_eligible, is_active, scope, branch_id,
                 stock_qty, sort_order, metadata_json, created_at, updated_at)
                VALUES
                (:id, :name, :name_gu, :name_hi, :desc, :category, :price, :currency,
                 :unit, :emoji, :image_url, :gift_aid, :is_active, :scope, :branch_id,
                 :stock_qty, :sort_order, :metadata_json::jsonb, :now, :now)
            """),
            {
                "id": item_id,
                "name": body.name,
                "name_gu": body.name_gu,
                "name_hi": body.name_hi,
                "desc": body.description,
                "category": body.category.value,
                "price": str(body.price),
                "currency": body.currency,
                "unit": body.unit,
                "emoji": body.emoji,
                "image_url": body.image_url,
                "gift_aid": body.gift_aid_eligible,
                "is_active": body.is_active,
                "scope": body.scope.value,
                "branch_id": body.branch_id,
                "stock_qty": body.stock_qty,
                "sort_order": body.sort_order,
                "metadata_json": json.dumps(body.metadata_json),
                "now": now,
            },
        )
        await db.commit()

    return {"id": item_id, "created": True}


@router.put("/{item_id}")
async def update_item(item_id: str, body: ItemUpdate, ctx: CurrentSpace):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    # Build dynamic SET clause from non-None fields
    updates: dict[str, Any] = {}
    field_map = {
        "name": body.name,
        "name_gu": body.name_gu,
        "name_hi": body.name_hi,
        "description": body.description,
        "category": body.category.value if body.category else None,
        "price": str(body.price) if body.price is not None else None,
        "currency": body.currency,
        "unit": body.unit,
        "emoji": body.emoji,
        "image_url": body.image_url,
        "gift_aid_eligible": body.gift_aid_eligible,
        "is_active": body.is_active,
        "scope": body.scope.value if body.scope else None,
        "branch_id": body.branch_id,
        "stock_qty": body.stock_qty,
        "sort_order": body.sort_order,
    }
    for col, val in field_map.items():
        if val is not None:
            updates[col] = val

    if body.metadata_json is not None:
        updates["metadata_json"] = json.dumps(body.metadata_json)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    now = datetime.utcnow()
    updates["updated_at"] = now
    updates["id"] = item_id

    set_clause = ", ".join(
        f"{col} = :{col}" + ("::jsonb" if col == "metadata_json" else "")
        for col in updates
        if col != "id"
    )

    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                UPDATE catalog_items
                SET {set_clause}
                WHERE id = :id AND deleted_at IS NULL
            """),
            updates,
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Item not found")

    return {"id": item_id, "updated": True}


@router.delete("/{item_id}")
async def delete_item(item_id: str, ctx: CurrentSpace):
    """Soft delete — sets deleted_at timestamp."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    now = datetime.utcnow()

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                UPDATE catalog_items
                SET deleted_at = :now, updated_at = :now
                WHERE id = :id AND deleted_at IS NULL
            """),
            {"now": now, "id": item_id},
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Item not found")

    return {"id": item_id, "deleted": True}


# ─── Seed endpoint ────────────────────────────────────────────────────────────

# Default catalog seed data
_SEED_ITEMS: list[dict] = [
    # ── SOFT_DONATION ──────────────────────────────────────────────────────
    {"name": "Rice Bag 10kg",         "category": "SOFT_DONATION", "price": "15.00", "unit": "10kg bag",  "gift_aid_eligible": False, "sort_order": 10},
    {"name": "Rice Bag 25kg",         "category": "SOFT_DONATION", "price": "35.00", "unit": "25kg bag",  "gift_aid_eligible": False, "sort_order": 11},
    {"name": "Basmati Rice 5kg",      "category": "SOFT_DONATION", "price": "18.00", "unit": "5kg bag",   "gift_aid_eligible": False, "sort_order": 12},
    {"name": "Atta 10kg",             "category": "SOFT_DONATION", "price": "12.00", "unit": "10kg bag",  "gift_aid_eligible": False, "sort_order": 13},
    {"name": "Atta 20kg",             "category": "SOFT_DONATION", "price": "22.00", "unit": "20kg bag",  "gift_aid_eligible": False, "sort_order": 14},
    {"name": "Sunflower Oil 5L",      "category": "SOFT_DONATION", "price": "8.00",  "unit": "5L",        "gift_aid_eligible": False, "sort_order": 15},
    {"name": "Mustard Oil 5L",        "category": "SOFT_DONATION", "price": "9.00",  "unit": "5L",        "gift_aid_eligible": False, "sort_order": 16},
    {"name": "Chana Daal 5kg",        "category": "SOFT_DONATION", "price": "10.00", "unit": "5kg bag",   "gift_aid_eligible": False, "sort_order": 17},
    {"name": "Toor Daal 5kg",         "category": "SOFT_DONATION", "price": "12.00", "unit": "5kg bag",   "gift_aid_eligible": False, "sort_order": 18},
    {"name": "Masoor Daal 5kg",       "category": "SOFT_DONATION", "price": "9.00",  "unit": "5kg bag",   "gift_aid_eligible": False, "sort_order": 19},
    {"name": "Urad Daal 5kg",         "category": "SOFT_DONATION", "price": "11.00", "unit": "5kg bag",   "gift_aid_eligible": False, "sort_order": 20},
    {"name": "Sugar 5kg",             "category": "SOFT_DONATION", "price": "6.00",  "unit": "5kg bag",   "gift_aid_eligible": False, "sort_order": 21},
    {"name": "Salt 2kg",              "category": "SOFT_DONATION", "price": "2.00",  "unit": "2kg bag",   "gift_aid_eligible": False, "sort_order": 22},
    {"name": "Tea Loose 500g",        "category": "SOFT_DONATION", "price": "5.00",  "unit": "500g",      "gift_aid_eligible": False, "sort_order": 23},
    {"name": "Biscuits Assorted",     "category": "SOFT_DONATION", "price": "4.00",  "unit": "",          "gift_aid_eligible": False, "sort_order": 24},
    {"name": "Milk Powder 400g",      "category": "SOFT_DONATION", "price": "7.00",  "unit": "400g",      "gift_aid_eligible": False, "sort_order": 25},
    {"name": "Tinned Tomatoes 6pk",   "category": "SOFT_DONATION", "price": "5.00",  "unit": "6 pack",    "gift_aid_eligible": False, "sort_order": 26},

    # ── PROJECT_DONATION ───────────────────────────────────────────────────
    {"name": "Red Brick",       "category": "PROJECT_DONATION", "price": "1.00",   "unit": "per brick", "gift_aid_eligible": True, "sort_order": 30, "metadata_json": {"brick_tier": "red"}},
    {"name": "Bronze Brick",    "category": "PROJECT_DONATION", "price": "5.00",   "unit": "per brick", "gift_aid_eligible": True, "sort_order": 31, "metadata_json": {"brick_tier": "bronze"}},
    {"name": "Silver Brick",    "category": "PROJECT_DONATION", "price": "11.00",  "unit": "per brick", "gift_aid_eligible": True, "sort_order": 32, "metadata_json": {"brick_tier": "silver"}},
    {"name": "Gold Brick",      "category": "PROJECT_DONATION", "price": "51.00",  "unit": "per brick", "gift_aid_eligible": True, "sort_order": 33, "metadata_json": {"brick_tier": "gold"}},
    {"name": "Platinum Brick",  "category": "PROJECT_DONATION", "price": "101.00", "unit": "per brick", "gift_aid_eligible": True, "sort_order": 34, "metadata_json": {"brick_tier": "platinum"}},
    {"name": "Diamond Brick",   "category": "PROJECT_DONATION", "price": "251.00", "unit": "per brick", "gift_aid_eligible": True, "sort_order": 35, "metadata_json": {"brick_tier": "diamond"}},
    {"name": "Shree Brick",     "category": "PROJECT_DONATION", "price": "501.00", "unit": "per brick", "gift_aid_eligible": True, "sort_order": 36, "metadata_json": {"brick_tier": "shree"}},

    # ── SHOP ───────────────────────────────────────────────────────────────
    {"name": "Coconut small",          "category": "SHOP", "price": "1.00",  "gift_aid_eligible": False, "sort_order": 40},
    {"name": "Coconut large",          "category": "SHOP", "price": "2.00",  "gift_aid_eligible": False, "sort_order": 41},
    {"name": "Incense Sticks",         "category": "SHOP", "price": "3.00",  "gift_aid_eligible": False, "sort_order": 42},
    {"name": "Premium Agarbatti",      "category": "SHOP", "price": "5.00",  "gift_aid_eligible": False, "sort_order": 43},
    {"name": "Camphor Tabs",           "category": "SHOP", "price": "2.00",  "gift_aid_eligible": False, "sort_order": 44},
    {"name": "Prasad Box",             "category": "SHOP", "price": "5.00",  "gift_aid_eligible": False, "sort_order": 45},
    {"name": "Modak 6pcs",             "category": "SHOP", "price": "4.00",  "gift_aid_eligible": False, "sort_order": 46},
    {"name": "Bhagavad Gita (Eng)",    "category": "SHOP", "price": "8.00",  "gift_aid_eligible": False, "sort_order": 47},
    {"name": "Bhagavad Gita (Gu)",     "category": "SHOP", "price": "9.00",  "gift_aid_eligible": False, "sort_order": 48},
    {"name": "Ramayana",               "category": "SHOP", "price": "10.00", "gift_aid_eligible": False, "sort_order": 49},
    {"name": "Hanuman Chalisa",        "category": "SHOP", "price": "3.00",  "gift_aid_eligible": False, "sort_order": 50},
    {"name": "Ganesh Murti small",     "category": "SHOP", "price": "15.00", "gift_aid_eligible": False, "sort_order": 51},
    {"name": "Lakshmi Murti",          "category": "SHOP", "price": "20.00", "gift_aid_eligible": False, "sort_order": 52},
    {"name": "Radha-Krishna Murti",    "category": "SHOP", "price": "25.00", "gift_aid_eligible": False, "sort_order": 53},
    {"name": "Rudraksha Mala",         "category": "SHOP", "price": "12.00", "gift_aid_eligible": False, "sort_order": 54},
    {"name": "Crystal Mala",           "category": "SHOP", "price": "8.00",  "gift_aid_eligible": False, "sort_order": 55},
    {"name": "Puja Thali Set",         "category": "SHOP", "price": "18.00", "gift_aid_eligible": False, "sort_order": 56},
    {"name": "Kalash",                 "category": "SHOP", "price": "10.00", "gift_aid_eligible": False, "sort_order": 57},
    {"name": "Sindoor",                "category": "SHOP", "price": "3.00",  "gift_aid_eligible": False, "sort_order": 58},
    {"name": "Kumkum",                 "category": "SHOP", "price": "2.00",  "gift_aid_eligible": False, "sort_order": 59},
    {"name": "Clay Diya 12pk",         "category": "SHOP", "price": "4.00",  "gift_aid_eligible": False, "sort_order": 60},
    {"name": "Brass Diya",             "category": "SHOP", "price": "8.00",  "gift_aid_eligible": False, "sort_order": 61},

    # ── GENERAL_DONATION ───────────────────────────────────────────────────
    {"name": "General Donation",    "category": "GENERAL_DONATION", "price": "5.00",   "gift_aid_eligible": True, "sort_order": 70},
    {"name": "General Donation",    "category": "GENERAL_DONATION", "price": "10.00",  "gift_aid_eligible": True, "sort_order": 71},
    {"name": "General Donation",    "category": "GENERAL_DONATION", "price": "25.00",  "gift_aid_eligible": True, "sort_order": 72},
    {"name": "General Donation",    "category": "GENERAL_DONATION", "price": "50.00",  "gift_aid_eligible": True, "sort_order": 73},
    {"name": "General Donation",    "category": "GENERAL_DONATION", "price": "100.00", "gift_aid_eligible": True, "sort_order": 74},
    {"name": "General Donation",    "category": "GENERAL_DONATION", "price": "250.00", "gift_aid_eligible": True, "sort_order": 75},
    {"name": "Gau Seva",            "category": "GENERAL_DONATION", "price": "11.00",  "gift_aid_eligible": True, "sort_order": 76},
    {"name": "Gau Seva",            "category": "GENERAL_DONATION", "price": "21.00",  "gift_aid_eligible": True, "sort_order": 77},
    {"name": "Anna Daan",           "category": "GENERAL_DONATION", "price": "11.00",  "gift_aid_eligible": True, "sort_order": 78},
    {"name": "Anna Daan",           "category": "GENERAL_DONATION", "price": "21.00",  "gift_aid_eligible": True, "sort_order": 79},
    {"name": "Anna Daan",           "category": "GENERAL_DONATION", "price": "51.00",  "gift_aid_eligible": True, "sort_order": 80},
    {"name": "Lamp Sponsorship",    "category": "GENERAL_DONATION", "price": "11.00",  "gift_aid_eligible": True, "sort_order": 81},
]


@router.post("/seed")
async def seed_items(ctx: CurrentSpace):
    """Seed the catalog_items table with default items if empty."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    async with SessionLocal() as db:
        # Check if table already has data
        count_result = await db.execute(
            text("SELECT COUNT(*) AS cnt FROM catalog_items WHERE deleted_at IS NULL")
        )
        count_row = count_result.mappings().first()
        existing_count = count_row["cnt"] if count_row else 0

        if existing_count > 0:
            return {
                "seeded": False,
                "message": f"Table already contains {existing_count} items. Skipping seed.",
                "existing_count": existing_count,
            }

        now = datetime.utcnow()
        inserted = 0

        for item in _SEED_ITEMS:
            item_id = str(uuid.uuid4())
            meta = item.get("metadata_json", {})
            await db.execute(
                text("""
                    INSERT INTO catalog_items
                    (id, name, name_gu, name_hi, description, category, price, currency,
                     unit, emoji, image_url, gift_aid_eligible, is_active, scope, branch_id,
                     stock_qty, sort_order, metadata_json, created_at, updated_at)
                    VALUES
                    (:id, :name, '', '', '', :category, :price, 'GBP',
                     :unit, '', '', :gift_aid, true, 'GLOBAL', '',
                     NULL, :sort_order, :metadata_json::jsonb, :now, :now)
                """),
                {
                    "id": item_id,
                    "name": item["name"],
                    "category": item["category"],
                    "price": item["price"],
                    "unit": item.get("unit", ""),
                    "gift_aid": item.get("gift_aid_eligible", False),
                    "sort_order": item.get("sort_order", 0),
                    "metadata_json": json.dumps(meta),
                    "now": now,
                },
            )
            inserted += 1

        await db.commit()

    return {
        "seeded": True,
        "inserted": inserted,
        "message": f"Successfully seeded {inserted} catalog items.",
    }
