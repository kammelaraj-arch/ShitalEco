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

from shital.api.deps import CurrentSpace, OptionalSpace

router = APIRouter(prefix="/items", tags=["items"])


# ─── Enums ────────────────────────────────────────────────────────────────────

class ItemCategory(str, Enum):
    GENERAL_DONATION = "GENERAL_DONATION"
    SOFT_DONATION = "SOFT_DONATION"
    PROJECT_DONATION = "PROJECT_DONATION"
    SHOP = "SHOP"
    SERVICE = "SERVICE"
    SPONSORSHIP = "SPONSORSHIP"


class ItemScope(str, Enum):
    GLOBAL = "GLOBAL"
    BRANCH = "BRANCH"


# ─── Pydantic Models ──────────────────────────────────────────────────────────

class DisplayChannel(str, Enum):
    KIOSK = "kiosk"
    WEB = "web"
    BOTH = "both"


class ItemBase(BaseModel):
    name: str
    name_gu: str = ""
    name_hi: str = ""
    name_te: str = ""
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
    available_from: datetime | None = None
    available_until: datetime | None = None
    display_channel: DisplayChannel = DisplayChannel.BOTH
    branch_stock: dict = {}
    is_live: bool = True


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    name: str | None = None
    name_gu: str | None = None
    name_hi: str | None = None
    name_te: str | None = None
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
    available_from: datetime | None = None
    available_until: datetime | None = None
    display_channel: DisplayChannel | None = None
    branch_stock: dict | None = None
    is_live: bool | None = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _row_to_dict(row: Any) -> dict:
    d = dict(row)
    if "price" in d and d["price"] is not None:
        d["price"] = float(d["price"])
    if "metadata_json" in d and isinstance(d["metadata_json"], str):
        try:
            d["metadata_json"] = json.loads(d["metadata_json"])
        except Exception:
            d["metadata_json"] = {}
    if "branch_stock" in d and isinstance(d["branch_stock"], str):
        try:
            d["branch_stock"] = json.loads(d["branch_stock"])
        except Exception:
            d["branch_stock"] = {}
    # Serialise datetimes to ISO strings
    for col in ("available_from", "available_until", "created_at", "updated_at"):
        if col in d and d[col] is not None and hasattr(d[col], "isoformat"):
            d[col] = d[col].isoformat()
    return d


# Date-range + channel + live filter fragment for kiosk endpoints
_KIOSK_SCHEDULE_FILTER = """
  AND (is_live IS NULL OR is_live = true)
  AND (available_from IS NULL OR available_from <= NOW())
  AND (available_until IS NULL OR available_until >= NOW())
  AND (display_channel = 'both' OR display_channel = 'kiosk')
"""


# ─── Admin: CRUD endpoints (require auth) ─────────────────────────────────────

@router.get("/ping")
async def ping_items():
    """No-DB health check for items router."""
    return {"ok": True, "msg": "items router alive"}


@router.get("/schema-check")
async def schema_check():
    """Return catalog_items column list from information_schema."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    try:
        async with SessionLocal() as db:
            r = await db.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'catalog_items' AND table_schema = current_schema()
                ORDER BY ordinal_position
            """))
            cols = [row[0] for row in r.fetchall()]
        return {"columns": cols, "count": len(cols)}
    except Exception as exc:
        return {"error": str(exc)}


@router.get("/")
async def list_items(
    ctx: OptionalSpace,
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

    try:
        async with SessionLocal() as db:
            result = await db.execute(
                text(f"""
                    SELECT id, name, name_gu, name_hi, '' AS name_te, description, category,
                           price, currency, unit, emoji, image_url,
                           gift_aid_eligible, is_active, scope, branch_id,
                           stock_qty, sort_order, metadata_json,
                           available_from, available_until, display_channel, branch_stock, is_live,
                           created_at, updated_at
                    FROM catalog_items
                    WHERE {where}
                    ORDER BY sort_order, category, name
                """),
                params,
            )
            rows = result.mappings().all()
        return {"items": [_row_to_dict(r) for r in rows], "total": len(rows)}
    except Exception as exc:
        # Try a minimal query to check if table exists and what columns are available
        try:
            async with SessionLocal() as db2:
                cols_result = await db2.execute(text("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'catalog_items' AND table_schema = current_schema()
                    ORDER BY ordinal_position
                """))
                cols = [r[0] for r in cols_result.fetchall()]
                cnt_result = await db2.execute(text("SELECT COUNT(*) FROM catalog_items WHERE deleted_at IS NULL"))
                cnt = cnt_result.scalar()
        except Exception as exc2:
            raise HTTPException(status_code=500, detail=f"DB error: {exc} / schema error: {exc2}")
        raise HTTPException(status_code=500, detail={"error": str(exc), "columns": cols, "row_count": cnt})


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
                           gift_aid_eligible, stock_qty, sort_order, metadata_json,
                           available_from, available_until, display_channel, branch_stock
                    FROM catalog_items
                    WHERE category = 'SOFT_DONATION'
                      AND is_active = true
                      AND deleted_at IS NULL
                      AND (scope = 'GLOBAL' OR (scope = 'BRANCH' AND branch_id = :bid))
                """ + _KIOSK_SCHEDULE_FILTER + """
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
                           gift_aid_eligible, stock_qty, sort_order, metadata_json,
                           available_from, available_until, display_channel, branch_stock
                    FROM catalog_items
                    WHERE category = 'PROJECT_DONATION'
                      AND is_active = true
                      AND deleted_at IS NULL
                      AND (scope = 'GLOBAL' OR (scope = 'BRANCH' AND branch_id = :bid))
                """ + _KIOSK_SCHEDULE_FILTER + """
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
                           gift_aid_eligible, stock_qty, sort_order, metadata_json,
                           available_from, available_until, display_channel, branch_stock
                    FROM catalog_items
                    WHERE category = 'SHOP'
                      AND is_active = true
                      AND deleted_at IS NULL
                      AND (scope = 'GLOBAL' OR (scope = 'BRANCH' AND branch_id = :bid))
                """ + _KIOSK_SCHEDULE_FILTER + """
                    ORDER BY sort_order, name
                """),
                {"bid": branch_id},
            )
            rows = result.mappings().all()
        items = [_row_to_dict(r) for r in rows]
        # For shop items, use branch_stock qty if set for this branch
        for item in items:
            bs = item.get("branch_stock") or {}
            if isinstance(bs, dict) and branch_id in bs:
                item["stock_qty"] = bs[branch_id]
        return {"items": items, "branch_id": branch_id}
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
                           gift_aid_eligible, sort_order, metadata_json,
                           available_from, available_until, display_channel
                    FROM catalog_items
                    WHERE category = 'GENERAL_DONATION'
                      AND is_active = true
                      AND deleted_at IS NULL
                """ + _KIOSK_SCHEDULE_FILTER + """
                    ORDER BY sort_order, price
                """),
            )
            rows = result.mappings().all()
        return {"items": [_row_to_dict(r) for r in rows]}
    except Exception:
        return {"items": []}


@router.get("/{item_id}")
async def get_item(item_id: str, ctx: OptionalSpace):
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
async def create_item(body: ItemCreate, ctx: OptionalSpace):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    item_id = str(uuid.uuid4())
    now = datetime.utcnow()

    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO catalog_items
                (id, name, name_gu, name_hi, name_te, description, category, price, currency,
                 unit, emoji, image_url, gift_aid_eligible, is_active, scope, branch_id,
                 stock_qty, sort_order, metadata_json,
                 available_from, available_until, display_channel, branch_stock, is_live,
                 created_at, updated_at)
                VALUES
                (:id, :name, :name_gu, :name_hi, :name_te, :desc, :category, :price, :currency,
                 :unit, :emoji, :image_url, :gift_aid, :is_active, :scope, :branch_id,
                 :stock_qty, :sort_order, :metadata_json::jsonb,
                 :available_from, :available_until, :display_channel, :branch_stock::jsonb, :is_live,
                 :now, :now)
            """),
            {
                "id": item_id,
                "name": body.name,
                "name_gu": body.name_gu,
                "name_hi": body.name_hi,
                "name_te": body.name_te,
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
                "available_from": body.available_from,
                "available_until": body.available_until,
                "display_channel": body.display_channel.value,
                "branch_stock": json.dumps(body.branch_stock),
                "is_live": body.is_live,
                "now": now,
            },
        )
        await db.commit()

    return {"id": item_id, "created": True}


@router.put("/{item_id}")
async def update_item(item_id: str, body: ItemUpdate, ctx: OptionalSpace):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    # Build dynamic SET clause from non-None fields
    updates: dict[str, Any] = {}
    field_map = {
        "name": body.name,
        "name_gu": body.name_gu,
        "name_hi": body.name_hi,
        "name_te": body.name_te,
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
        "available_from": body.available_from,
        "available_until": body.available_until,
        "display_channel": body.display_channel.value if body.display_channel else None,
        "is_live": body.is_live,
    }
    for col, val in field_map.items():
        if val is not None:
            updates[col] = val

    if body.metadata_json is not None:
        updates["metadata_json"] = json.dumps(body.metadata_json)
    if body.branch_stock is not None:
        updates["branch_stock"] = json.dumps(body.branch_stock)

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
async def delete_item(item_id: str, ctx: OptionalSpace):
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

# Default catalog seed data — full catalog with Gujarati/Hindi translations
_SEED_ITEMS: list[dict] = [
    # ── SOFT_DONATION: Grains ──────────────────────────────────────────────
    {"name": "Rice Bag 10kg",          "name_gu": "ચોખા 10kg",           "name_hi": "चावल 10kg",          "emoji": "🌾", "category": "SOFT_DONATION",    "price": "15.00",  "unit": "10kg",    "gift_aid_eligible": True,  "description": "White rice bag 10kg",                        "sort_order": 10},
    {"name": "Rice Bag 25kg",          "name_gu": "ચોખા 25kg",           "name_hi": "चावल 25kg",          "emoji": "🌾", "category": "SOFT_DONATION",    "price": "35.00",  "unit": "25kg",    "gift_aid_eligible": True,  "description": "White rice bag 25kg",                        "sort_order": 11},
    {"name": "Basmati Rice 5kg",       "name_gu": "બાસમતી 5kg",          "name_hi": "बासमती 5kg",         "emoji": "🌾", "category": "SOFT_DONATION",    "price": "18.00",  "unit": "5kg",     "gift_aid_eligible": True,  "description": "Premium basmati rice 5kg",                   "sort_order": 12},
    {"name": "Atta (Wheat Flour) 10kg","name_gu": "આટો 10kg",            "name_hi": "आटा 10kg",           "emoji": "🌿", "category": "SOFT_DONATION",    "price": "12.00",  "unit": "10kg",    "gift_aid_eligible": True,  "description": "Chapati flour 10kg",                         "sort_order": 13},
    {"name": "Atta 20kg",              "name_gu": "આટો 20kg",            "name_hi": "आटा 20kg",           "emoji": "🌿", "category": "SOFT_DONATION",    "price": "22.00",  "unit": "20kg",    "gift_aid_eligible": True,  "description": "Chapati flour 20kg",                         "sort_order": 14},
    # ── SOFT_DONATION: Oil & Essentials ───────────────────────────────────
    {"name": "Sunflower Oil 5L",       "name_gu": "સૂર્યમુખી તેલ 5L",   "name_hi": "सूरजमुखी तेल 5L",   "emoji": "🌻", "category": "SOFT_DONATION",    "price": "8.00",   "unit": "5L",      "gift_aid_eligible": True,  "description": "Pure sunflower oil 5 litres",                "sort_order": 15},
    {"name": "Mustard Oil 5L",         "name_gu": "સરસવ તેલ 5L",        "name_hi": "सरसों का तेल 5L",   "emoji": "🌼", "category": "SOFT_DONATION",    "price": "9.00",   "unit": "5L",      "gift_aid_eligible": True,  "description": "Pure mustard oil 5 litres",                  "sort_order": 16},
    {"name": "Sugar 5kg",              "name_gu": "ખાંડ 5kg",            "name_hi": "चीनी 5kg",           "emoji": "🍬", "category": "SOFT_DONATION",    "price": "6.00",   "unit": "5kg",     "gift_aid_eligible": True,  "description": "White granulated sugar 5kg",                 "sort_order": 17},
    {"name": "Salt 2kg",               "name_gu": "મીઠું 2kg",           "name_hi": "नमक 2kg",            "emoji": "🧂", "category": "SOFT_DONATION",    "price": "2.00",   "unit": "2kg",     "gift_aid_eligible": True,  "description": "Table salt 2kg",                             "sort_order": 18},
    {"name": "Tea (Loose) 500g",       "name_gu": "ચા 500g",             "name_hi": "चाय 500g",           "emoji": "🍵", "category": "SOFT_DONATION",    "price": "5.00",   "unit": "500g",    "gift_aid_eligible": True,  "description": "Loose leaf tea 500g",                        "sort_order": 19},
    {"name": "Biscuits (Assorted)",    "name_gu": "બિસ્કિટ",             "name_hi": "बिस्कुट",            "emoji": "🍪", "category": "SOFT_DONATION",    "price": "4.00",   "unit": "pack",    "gift_aid_eligible": True,  "description": "Assorted biscuit pack",                      "sort_order": 20},
    {"name": "Milk Powder 400g",       "name_gu": "દૂધ પાવડર",           "name_hi": "दूध पाउडर",          "emoji": "🥛", "category": "SOFT_DONATION",    "price": "7.00",   "unit": "400g",    "gift_aid_eligible": True,  "description": "Full fat milk powder 400g",                  "sort_order": 21},
    {"name": "Tinned Tomatoes (6 pack)","name_gu": "ટિન ટામેટા",         "name_hi": "टिन टमाटर",          "emoji": "🍅", "category": "SOFT_DONATION",    "price": "5.00",   "unit": "6 pack",  "gift_aid_eligible": True,  "description": "Chopped tinned tomatoes 6 pack",             "sort_order": 22},
    # ── SOFT_DONATION: Pulses ──────────────────────────────────────────────
    {"name": "Chana Daal 5kg",         "name_gu": "ચણા દાળ 5kg",         "name_hi": "चना दाल 5kg",        "emoji": "🫘", "category": "SOFT_DONATION",    "price": "10.00",  "unit": "5kg",     "gift_aid_eligible": True,  "description": "Split chana daal 5kg",                       "sort_order": 23},
    {"name": "Toor Daal 5kg",          "name_gu": "તુવેર દાળ 5kg",       "name_hi": "तुअर दाल 5kg",       "emoji": "🫘", "category": "SOFT_DONATION",    "price": "12.00",  "unit": "5kg",     "gift_aid_eligible": True,  "description": "Split toor daal 5kg",                        "sort_order": 24},
    {"name": "Masoor Daal 5kg",        "name_gu": "મસૂર દાળ 5kg",        "name_hi": "मसूर दाल 5kg",       "emoji": "🫘", "category": "SOFT_DONATION",    "price": "9.00",   "unit": "5kg",     "gift_aid_eligible": True,  "description": "Red lentils 5kg",                            "sort_order": 25},
    {"name": "Urad Daal 5kg",          "name_gu": "અડદ દાળ 5kg",         "name_hi": "उड़द दाल 5kg",       "emoji": "🫘", "category": "SOFT_DONATION",    "price": "11.00",  "unit": "5kg",     "gift_aid_eligible": True,  "description": "Split black urad daal 5kg",                  "sort_order": 26},

    # ── PROJECT_DONATION: Brick Tiers ──────────────────────────────────────
    {"name": "Red Brick",       "name_gu": "લાલ ઈંટ",       "name_hi": "लाल ईंट",       "emoji": "🧱", "category": "PROJECT_DONATION", "price": "1.00",    "unit": "per brick", "gift_aid_eligible": True, "description": "Every penny counts towards our temple",             "sort_order": 30, "metadata_json": {"brick_tier": "red"}},
    {"name": "Bronze Brick",    "name_gu": "કાંસ્ય ઈંટ",   "name_hi": "कांस्य ईंट",   "emoji": "🧱", "category": "PROJECT_DONATION", "price": "5.00",    "unit": "per brick", "gift_aid_eligible": True, "description": "Help lay the foundations",                           "sort_order": 31, "metadata_json": {"brick_tier": "bronze"}},
    {"name": "Silver Brick",    "name_gu": "ચાંદી ઈંટ",    "name_hi": "चांदी ईंट",    "emoji": "🧱", "category": "PROJECT_DONATION", "price": "11.00",   "unit": "per brick", "gift_aid_eligible": True, "description": "Build the walls of our community",                  "sort_order": 32, "metadata_json": {"brick_tier": "silver"}},
    {"name": "Gold Brick",      "name_gu": "સોના ઈંટ",     "name_hi": "सोना ईंट",     "emoji": "🧱", "category": "PROJECT_DONATION", "price": "51.00",   "unit": "per brick", "gift_aid_eligible": True, "description": "A golden contribution to our temple",               "sort_order": 33, "metadata_json": {"brick_tier": "gold"}},
    {"name": "Platinum Brick",  "name_gu": "પ્લૈટિનમ ઈંટ", "name_hi": "प्लेटिनम ईंट", "emoji": "🧱", "category": "PROJECT_DONATION", "price": "101.00",  "unit": "per brick", "gift_aid_eligible": True, "description": "Platinum patron of our sacred building",            "sort_order": 34, "metadata_json": {"brick_tier": "platinum"}},
    {"name": "Diamond Brick",   "name_gu": "હીરા ઈંટ",     "name_hi": "हीरा ईंट",     "emoji": "💎", "category": "PROJECT_DONATION", "price": "251.00",  "unit": "per brick", "gift_aid_eligible": True, "description": "Diamond sponsor — your legacy endures",             "sort_order": 35, "metadata_json": {"brick_tier": "diamond"}},
    {"name": "Shree Brick",     "name_gu": "શ્રી ઈંટ",     "name_hi": "श्री ईंट",     "emoji": "🕉", "category": "PROJECT_DONATION", "price": "501.00",  "unit": "per brick", "gift_aid_eligible": True, "description": "The highest honour — blessed by Sri",               "sort_order": 36, "metadata_json": {"brick_tier": "shree"}},

    # ── SHOP: Puja Items ───────────────────────────────────────────────────
    {"name": "Coconut (small)",        "name_gu": "નારિયળ (નાનો)",       "name_hi": "नारियल (छोटा)",      "emoji": "🥥", "category": "SHOP", "price": "1.00",   "gift_aid_eligible": False, "description": "Small fresh coconut for puja",       "sort_order": 40},
    {"name": "Coconut (large)",        "name_gu": "નારિયળ (મોટો)",       "name_hi": "नारियल (बड़ा)",      "emoji": "🥥", "category": "SHOP", "price": "2.00",   "gift_aid_eligible": False, "description": "Large fresh coconut for puja",       "sort_order": 41},
    {"name": "Incense Sticks Pack",    "name_gu": "અગરબત્તી",            "name_hi": "अगरबत्ती",           "emoji": "🕯", "category": "SHOP", "price": "3.00",   "gift_aid_eligible": False, "description": "Pack of mixed incense sticks",       "sort_order": 42},
    {"name": "Premium Agarbatti",      "name_gu": "ઉત્કૃષ્ટ અગરબત્તી",  "name_hi": "प्रीमियम अगरबत्ती", "emoji": "🕯", "category": "SHOP", "price": "5.00",   "gift_aid_eligible": False, "description": "Premium quality incense sticks",     "sort_order": 43},
    {"name": "Camphor Tabs",           "name_gu": "કાફૂર",               "name_hi": "कपूर",               "emoji": "⬜", "category": "SHOP", "price": "2.00",   "gift_aid_eligible": False, "description": "Pure camphor tablets for aarti",     "sort_order": 44},
    # ── SHOP: Prasad ──────────────────────────────────────────────────────
    {"name": "Prasad Box (assorted)",  "name_gu": "પ્રસાદ",              "name_hi": "प्रसाद",             "emoji": "🍮", "category": "SHOP", "price": "5.00",   "gift_aid_eligible": False, "description": "Assorted prasad box",                "sort_order": 45},
    {"name": "Modak (6 pcs)",          "name_gu": "મોદક",                "name_hi": "मोदक",               "emoji": "🍡", "category": "SHOP", "price": "4.00",   "gift_aid_eligible": False, "description": "Sweet modak — 6 pieces",             "sort_order": 46},
    # ── SHOP: Books ───────────────────────────────────────────────────────
    {"name": "Bhagavad Gita (English)","name_gu": "ભગવદ ગીતા (અંગ્રેજી)","name_hi": "भगवद गीता (अंग्रेजी)","emoji": "📖","category": "SHOP", "price": "8.00",   "gift_aid_eligible": False, "description": "Bhagavad Gita in English",           "sort_order": 47},
    {"name": "Bhagavad Gita (Gujarati)","name_gu":"ભગવદ ગીતા (ગુજરાતી)","name_hi": "भगवद गीता (गुजराती)","emoji": "📖","category": "SHOP", "price": "9.00",   "gift_aid_eligible": False, "description": "Bhagavad Gita in Gujarati",          "sort_order": 48},
    {"name": "Ramayana",               "name_gu": "રામાયણ",              "name_hi": "रामायण",             "emoji": "📜", "category": "SHOP", "price": "10.00",  "gift_aid_eligible": False, "description": "The Ramayana scripture",             "sort_order": 49},
    {"name": "Hanuman Chalisa",        "name_gu": "હનુમાન ચાલીસા",      "name_hi": "हनुमान चालीसा",      "emoji": "📜", "category": "SHOP", "price": "3.00",   "gift_aid_eligible": False, "description": "Hanuman Chalisa prayer book",        "sort_order": 50},
    # ── SHOP: Murtis ──────────────────────────────────────────────────────
    {"name": "Ganesh Murti (small)",   "name_gu": "ગણેશ મૂર્તિ",        "name_hi": "गणेश मूर्ति",        "emoji": "🐘", "category": "SHOP", "price": "15.00",  "gift_aid_eligible": False, "description": "Small Ganesh murti for home",        "sort_order": 51},
    {"name": "Lakshmi Murti",          "name_gu": "લક્ષ્મી મૂર્તિ",     "name_hi": "लक्ष्मी मूर्ति",    "emoji": "🪷", "category": "SHOP", "price": "20.00",  "gift_aid_eligible": False, "description": "Lakshmi murti for prosperity",       "sort_order": 52},
    {"name": "Radha-Krishna Murti",    "name_gu": "રાધા-કૃષ્ણ",         "name_hi": "राधा-कृष्ण",         "emoji": "🫶", "category": "SHOP", "price": "25.00",  "gift_aid_eligible": False, "description": "Radha-Krishna murti set",            "sort_order": 53},
    # ── SHOP: Malas ───────────────────────────────────────────────────────
    {"name": "Rudraksha Mala (108)",   "name_gu": "રુદ્રાક્ષ માળા",     "name_hi": "रुद्राक्ष माला",    "emoji": "📿", "category": "SHOP", "price": "12.00",  "gift_aid_eligible": False, "description": "108 bead rudraksha mala",            "sort_order": 54},
    {"name": "Crystal Mala",           "name_gu": "ક્રિસ્ટલ માળા",      "name_hi": "क्रिस्टल माला",     "emoji": "📿", "category": "SHOP", "price": "8.00",   "gift_aid_eligible": False, "description": "Clear crystal prayer mala",          "sort_order": 55},
    # ── SHOP: Puja Accessories ────────────────────────────────────────────
    {"name": "Puja Thali Set",         "name_gu": "પૂજા થાળ",            "name_hi": "पूजा थाल",           "emoji": "🥘", "category": "SHOP", "price": "18.00",  "gift_aid_eligible": False, "description": "Complete puja thali set",            "sort_order": 56},
    {"name": "Kalash",                 "name_gu": "કળશ",                 "name_hi": "कलश",                "emoji": "🏺", "category": "SHOP", "price": "10.00",  "gift_aid_eligible": False, "description": "Sacred water pot",                   "sort_order": 57},
    {"name": "Sindoor",                "name_gu": "સિંદૂર",              "name_hi": "सिंदूर",             "emoji": "🔴", "category": "SHOP", "price": "3.00",   "gift_aid_eligible": False, "description": "Vermilion powder",                   "sort_order": 58},
    {"name": "Kumkum",                 "name_gu": "કુમકુમ",              "name_hi": "कुमकुम",             "emoji": "🔴", "category": "SHOP", "price": "2.00",   "gift_aid_eligible": False, "description": "Sacred kumkum powder",               "sort_order": 59},
    {"name": "Diya (clay, 12pk)",      "name_gu": "દીવો",                "name_hi": "दिया",               "emoji": "🪔", "category": "SHOP", "price": "4.00",   "gift_aid_eligible": False, "description": "Clay diya 12 pack",                  "sort_order": 60},
    {"name": "Brass Diya",             "name_gu": "પિત્તળ દીવો",        "name_hi": "पीतल दिया",          "emoji": "🪔", "category": "SHOP", "price": "8.00",   "gift_aid_eligible": False, "description": "Premium brass diya",                 "sort_order": 61},

    # ── GENERAL_DONATION ───────────────────────────────────────────────────
    {"name": "Test Donation £1",         "name_gu": "પરીક્ષણ દાન £1",   "name_hi": "परीक्षण दान £1",   "emoji": "🧪", "category": "GENERAL_DONATION", "price": "1.00",   "gift_aid_eligible": False, "description": "Test payment — £1",                  "sort_order": 69},
    {"name": "General Donation £5",      "name_gu": "સામાન્ય દાન £5",   "name_hi": "सामान्य दान £5",   "emoji": "🙏", "category": "GENERAL_DONATION", "price": "5.00",   "gift_aid_eligible": True,  "description": "General donation to the temple",     "sort_order": 70},
    {"name": "General Donation £10",     "name_gu": "સામાન્ય દાન £10",  "name_hi": "सामान्य दान £10",  "emoji": "🙏", "category": "GENERAL_DONATION", "price": "10.00",  "gift_aid_eligible": True,  "description": "General donation to the temple",     "sort_order": 71},
    {"name": "General Donation £25",     "name_gu": "સામાન્ય દાન £25",  "name_hi": "सामान्य दान £25",  "emoji": "🙏", "category": "GENERAL_DONATION", "price": "25.00",  "gift_aid_eligible": True,  "description": "General donation to the temple",     "sort_order": 72},
    {"name": "General Donation £50",     "name_gu": "સામાન્ય દાન £50",  "name_hi": "सामान्य दान £50",  "emoji": "🙏", "category": "GENERAL_DONATION", "price": "50.00",  "gift_aid_eligible": True,  "description": "General donation to the temple",     "sort_order": 73},
    {"name": "General Donation £100",    "name_gu": "સામાન્ય દાન £100", "name_hi": "सामान्य दान £100", "emoji": "🙏", "category": "GENERAL_DONATION", "price": "100.00", "gift_aid_eligible": True,  "description": "General donation to the temple",     "sort_order": 74},
    {"name": "General Donation £250",    "name_gu": "સામાન્ય દાન £250", "name_hi": "सामान्य दान £250", "emoji": "🙏", "category": "GENERAL_DONATION", "price": "250.00", "gift_aid_eligible": True,  "description": "General donation to the temple",     "sort_order": 75},
    {"name": "Gau Seva (Cow Care) £11",  "name_gu": "ગૌ સેવા £11",      "name_hi": "गौ सेवा £11",      "emoji": "🐄", "category": "GENERAL_DONATION", "price": "11.00",  "gift_aid_eligible": True,  "description": "Sponsor care for sacred cows",       "sort_order": 76},
    {"name": "Gau Seva (Cow Care) £21",  "name_gu": "ગૌ સેવા £21",      "name_hi": "गौ सेवा £21",      "emoji": "🐄", "category": "GENERAL_DONATION", "price": "21.00",  "gift_aid_eligible": True,  "description": "Sponsor care for sacred cows",       "sort_order": 77},
    {"name": "Anna Daan £11",            "name_gu": "અન્ન દાન £11",      "name_hi": "अन्न दान £11",      "emoji": "🍛", "category": "GENERAL_DONATION", "price": "11.00",  "gift_aid_eligible": True,  "description": "Food for all — anna daan",           "sort_order": 78},
    {"name": "Anna Daan £21",            "name_gu": "અન્ન દાન £21",      "name_hi": "अन्न दान £21",      "emoji": "🍛", "category": "GENERAL_DONATION", "price": "21.00",  "gift_aid_eligible": True,  "description": "Food for all — anna daan",           "sort_order": 79},
    {"name": "Anna Daan £51",            "name_gu": "અન્ન દાન £51",      "name_hi": "अन्न दान £51",      "emoji": "🍛", "category": "GENERAL_DONATION", "price": "51.00",  "gift_aid_eligible": True,  "description": "Food for all — anna daan",           "sort_order": 80},
    {"name": "Lamp Sponsorship £11/month","name_gu":"દીપ પ્રાયોજન",     "name_hi": "दीपक प्रायोजन",    "emoji": "🪔", "category": "GENERAL_DONATION", "price": "11.00",  "gift_aid_eligible": True,  "description": "Sponsor a lamp in the temple — monthly", "unit": "/month", "sort_order": 81},

    # ── SPONSORSHIP ────────────────────────────────────────────────────────
    # Satcharitra Books
    {"name": "Satcharitra Books (11)",   "name_gu": "સતચરિત્ર ૧૧ પ્રત",  "name_hi": "सतचरित्र 11 प्रतियां",   "emoji": "📖", "category": "SPONSORSHIP", "price": "21.00",   "unit": "11 books",  "gift_aid_eligible": False, "description": "Sponsor 11 Shri Sai Satcharitra books",     "sort_order": 90},
    {"name": "Satcharitra Books (51)",   "name_gu": "સતચરિત્ર ૫૧ પ્રત",  "name_hi": "सतचरित्र 51 प्रतियां",   "emoji": "📖", "category": "SPONSORSHIP", "price": "101.00",  "unit": "51 books",  "gift_aid_eligible": False, "description": "Sponsor 51 Sai Satcharitra books",          "sort_order": 91},
    {"name": "Satcharitra Books (101)",  "name_gu": "સતચરિત્ર ૧૦૧ પ્રત", "name_hi": "सतचरित्र 101 प्रतियां",  "emoji": "📖", "category": "SPONSORSHIP", "price": "201.00",  "unit": "101 books", "gift_aid_eligible": False, "description": "Sponsor 101 Sai Satcharitra books",         "sort_order": 92},
    {"name": "Satcharitra Books (501)",  "name_gu": "સતચરિત્ર ૫૦૧ પ્રત", "name_hi": "सतचरित्र 501 प्रतियां",  "emoji": "📖", "category": "SPONSORSHIP", "price": "1001.00", "unit": "501 books", "gift_aid_eligible": False, "description": "Sponsor 501 Sai Satcharitra books",         "sort_order": 93},
    {"name": "Satcharitra Books (1001)", "name_gu": "સતચરિત્ર ૧૦૦૧ પ્રત","name_hi": "सतचरित्र 1001 प्रतियां", "emoji": "📖", "category": "SPONSORSHIP", "price": "2001.00", "unit": "1001 books","gift_aid_eligible": False, "description": "Sponsor 1001 Sai Satcharitra books",        "sort_order": 94},
    # Baba's Shawls
    {"name": "Baba's Shawl (1 Day)",    "name_gu": "બાબાની ચાદર (1 દિવસ)","name_hi": "बाबा का शॉल (1 दिन)",    "emoji": "🧣", "category": "SPONSORSHIP", "price": "41.00",   "unit": "1 day",     "gift_aid_eligible": False, "description": "Sponsor Baba's shawl for one day",          "sort_order": 95},
    {"name": "Baba's Shawl (1 Week)",   "name_gu": "બાબાની ચાદર (1 અઠવ)", "name_hi": "बाबा का शॉल (1 सप्ताह)","emoji": "🧣", "category": "SPONSORSHIP", "price": "151.00",  "unit": "1 week",    "gift_aid_eligible": False, "description": "Sponsor Baba's shawl for one week",         "sort_order": 96},
    {"name": "Baba's Shawl (Fortnight)","name_gu": "ચાદર (2 અઠવ)",        "name_hi": "बाबा का शॉल (2 सप्ताह)","emoji": "🧣", "category": "SPONSORSHIP", "price": "251.00",  "unit": "2 weeks",   "gift_aid_eligible": False, "description": "Sponsor Baba's shawl for a fortnight",      "sort_order": 97},
    {"name": "Baba's Shawl (1 Month)",  "name_gu": "ચાદર (1 મહિનો)",      "name_hi": "बाबा का शॉल (1 महीना)", "emoji": "🧣", "category": "SPONSORSHIP", "price": "651.00",  "unit": "1 month",   "gift_aid_eligible": False, "description": "Sponsor Baba's shawl for one month",        "sort_order": 98},
    # Flower Garlands
    {"name": "Flower Garland (1 Day)",  "name_gu": "ફૂલ માળા (1 દિવસ)",  "name_hi": "फूल माला (1 दिन)",        "emoji": "💐", "category": "SPONSORSHIP", "price": "21.00",   "unit": "1 day",     "gift_aid_eligible": False, "description": "Sponsor flower garlands for one day",        "sort_order": 99},
    {"name": "Flower Garland (1 Week)", "name_gu": "ફૂલ માળા (1 અઠવ)",   "name_hi": "फूल माला (1 सप्ताह)",    "emoji": "💐", "category": "SPONSORSHIP", "price": "101.00",  "unit": "1 week",    "gift_aid_eligible": False, "description": "Sponsor flower garlands for one week",       "sort_order": 100},
    {"name": "Flower Garland (Fortnight)","name_gu":"ફૂલ માળા (2 અઠવ)",  "name_hi": "फूल माला (2 सप्ताह)",    "emoji": "💐", "category": "SPONSORSHIP", "price": "201.00",  "unit": "2 weeks",   "gift_aid_eligible": False, "description": "Sponsor flower garlands for a fortnight",    "sort_order": 101},
    {"name": "Flower Garland (1 Month)","name_gu": "ફૂલ માળા (1 મહિનો)", "name_hi": "फूल माला (1 महीना)",      "emoji": "💐", "category": "SPONSORSHIP", "price": "651.00",  "unit": "1 month",   "gift_aid_eligible": False, "description": "Sponsor flower garlands for a full month",   "sort_order": 102},
]


@router.get("/kiosk/sponsorship")
async def kiosk_sponsorship(branch_id: str = "main"):
    """Public: SPONSORSHIP items."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    try:
        async with SessionLocal() as db:
            result = await db.execute(
                text("""
                    SELECT id, name, name_gu, name_hi, description,
                           price, currency, unit, emoji, image_url,
                           gift_aid_eligible, stock_qty, sort_order, metadata_json,
                           available_from, available_until, display_channel, branch_stock
                    FROM catalog_items
                    WHERE category = 'SPONSORSHIP'
                      AND is_active = true
                      AND deleted_at IS NULL
                      AND (scope = 'GLOBAL' OR (scope = 'BRANCH' AND branch_id = :bid))
                """ + _KIOSK_SCHEDULE_FILTER + """
                    ORDER BY sort_order, price
                """),
                {"bid": branch_id},
            )
            rows = result.mappings().all()
        return {"items": [_row_to_dict(r) for r in rows], "branch_id": branch_id}
    except Exception:
        return {"items": [], "branch_id": branch_id}


@router.post("/seed")
async def seed_items(ctx: OptionalSpace, force: bool = False):
    """Seed the catalog_items table with default items. Use force=true to replace existing data."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    async with SessionLocal() as db:
        # Check if table already has data
        count_result = await db.execute(
            text("SELECT COUNT(*) AS cnt FROM catalog_items WHERE deleted_at IS NULL")
        )
        count_row = count_result.mappings().first()
        existing_count = count_row["cnt"] if count_row else 0

        if existing_count > 0 and not force:
            return {
                "seeded": False,
                "message": f"Table already contains {existing_count} items. Use force=true to replace.",
                "existing_count": existing_count,
            }

        if force and existing_count > 0:
            # Soft-delete all existing items
            await db.execute(
                text("UPDATE catalog_items SET deleted_at = NOW() WHERE deleted_at IS NULL")
            )
            await db.commit()

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
                    (:id, :name, :name_gu, :name_hi, :description, :category, :price, 'GBP',
                     :unit, :emoji, :image_url, :gift_aid, true, 'GLOBAL', '',
                     NULL, :sort_order, :metadata_json::jsonb, :now, :now)
                """),
                {
                    "id": item_id,
                    "name": item["name"],
                    "name_gu": item.get("name_gu", ""),
                    "name_hi": item.get("name_hi", ""),
                    "description": item.get("description", ""),
                    "category": item["category"],
                    "price": item["price"],
                    "unit": item.get("unit", ""),
                    "emoji": item.get("emoji", ""),
                    "image_url": item.get("image_url", ""),
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
