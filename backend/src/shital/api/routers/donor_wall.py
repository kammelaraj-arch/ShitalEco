"""Donor Wall — Future Legacy Appeal recognition.

A donor who buys a Square Foot / Red / Bronze / Gold / Founder (or gives
any amount) may leave a dedication name. Each unit of their gift becomes
one row in ``donor_wall_entries`` — quantity 3 of Red Brick = 3 rows, so
each dedication is independent.

Policy
------
Dedications **under £101** auto-approve on capture. Dedications at £101
and above land in PENDING and need an admin to tick Approve before they
show up on the public wall. Rationale: small gifts shouldn't queue up for
review; large ones get a glance before they go public with their family
name on screen.

The threshold lives in ``DONOR_WALL_AUTO_APPROVE_THRESHOLD`` — edit here
when the policy changes.

Surfaces
--------
- ``GET  /api/v1/public/donor-wall``             — approved rows, grouped
  by tier, Cache-Control public 60s, CORS *.
- ``GET  /api/v1/admin/donor-wall``              — filterable list.
- ``PUT  /api/v1/admin/donor-wall/{id}``         — edit dedication/prefix.
- ``POST /api/v1/admin/donor-wall/{id}/approve`` — approve a PENDING row.
- ``POST /api/v1/admin/donor-wall/{id}/hide``    — hide any row.
- ``POST /api/v1/admin/donor-wall/{id}/unhide``  — restore a HIDDEN row to APPROVED.
- ``GET  /api/v1/admin/donor-wall/counts``       — badge counts per status.

The writer (``record_order_dedications``) is called by paypal.py /capture
after donations + orders are inserted; it reads the basket items and the
captured dedication/prefix for each unit.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

public_router = APIRouter(prefix="/public", tags=["public", "donor-wall"])
admin_router  = APIRouter(prefix="/admin/donor-wall", tags=["admin", "donor-wall"])


# ─── Policy ───────────────────────────────────────────────────────────────────

DONOR_WALL_AUTO_APPROVE_THRESHOLD = 101.00   # £ per unit


# Tier display order (big first) — matches the way the service site lists
# them and the way the TV page cycles.
TIER_ORDER = ["founder", "gold", "sqft", "bronze", "red", "anyamt"]
TIER_LABELS = {
    "founder": "Founder Panel",
    "gold":    "Gold Brick",
    "sqft":    "Square Foot",
    "bronze":  "Bronze Brick",
    "red":     "Red Brick",
    "anyamt":  "Dedication",
}


def tier_from_name(name: str, unit_price: float | int | None = None) -> tuple[str, str]:
    """Classify a basket-item name into (tier_key, tier_label).

    Falls back to matching the unit price when the name is unhelpful
    (e.g. "Future Legacy Appeal — any-amount gift").
    """
    n = (name or "").upper()
    if "FOUNDER" in n:
        return ("founder", "Founder Panel")
    if "GOLD" in n and "BRICK" in n:
        return ("gold", "Gold Brick")
    if "SQUARE FOOT" in n or "SQ FT" in n:
        return ("sqft", "Square Foot")
    if "BRONZE" in n and "BRICK" in n:
        return ("bronze", "Bronze Brick")
    if "RED" in n and "BRICK" in n:
        return ("red", "Red Brick")
    # Fallback by price (quantity-1 safe).
    p = int(round(float(unit_price or 0)))
    by_price = {
        5100: ("founder", "Founder Panel"),
        1008: ("gold",    "Gold Brick"),
        351:  ("sqft",    "Square Foot"),
        151:  ("bronze",  "Bronze Brick"),
        51:   ("red",     "Red Brick"),
    }
    return by_price.get(p, ("anyamt", "Dedication"))


# ─── Pydantic I/O ─────────────────────────────────────────────────────────────


class _EntryPatch(BaseModel):
    dedication: str | None = Field(default=None, max_length=200)
    prefix:     str | None = Field(default=None, max_length=40)
    display_order: int | None = None


def _only_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="ADMIN required")


# ─── Writer — called by paypal.py /capture ────────────────────────────────────


async def record_order_dedications(
    db: Any,
    *,
    order_id: str,
    donation_id: str | None,
    items: list[dict[str, Any]],
) -> int:
    """Create one donor_wall_entries row per unit for each basket item that
    carries a dedication. Returns the number of rows written.

    Idempotent per (order_id, tier_key, dedication) — safe to call twice
    if PayPal retries the capture. Approval status is decided per item
    unit_price against DONOR_WALL_AUTO_APPROVE_THRESHOLD.
    """
    if not items:
        return 0
    written = 0
    for it in items:
        dedication = str(it.get("dedication") or "").strip()[:200]
        if not dedication:
            continue
        prefix = str(it.get("prefix") or "").strip()[:40]
        qty = max(1, int(it.get("quantity") or 1))
        unit_price = float(it.get("unitPrice") or it.get("unit_price") or 0)
        name = str(it.get("name") or "")
        tier_key, tier_label = tier_from_name(name, unit_price)
        status = "APPROVED" if unit_price < DONOR_WALL_AUTO_APPROVE_THRESHOLD else "PENDING"
        approved_at_sql = "NOW()" if status == "APPROVED" else "NULL"
        approved_by     = "auto" if status == "APPROVED" else ""

        for _n in range(qty):
            # Check whether we've already written this exact row (same order,
            # tier, dedication). PayPal retries the capture when its
            # notifications flap, so we must not duplicate.
            existing = (await db.execute(text("""
                SELECT COUNT(*)::int FROM donor_wall_entries
                 WHERE order_id = :oid AND tier_key = :tk AND dedication = :ded
            """), {"oid": order_id, "tk": tier_key, "ded": dedication})).scalar() or 0
            if existing >= qty:
                continue
            await db.execute(text(f"""
                INSERT INTO donor_wall_entries
                    (id, order_id, donation_id, tier_key, tier_label,
                     amount, prefix, dedication, status,
                     approved_by, approved_at, created_at, updated_at)
                VALUES
                    (gen_random_uuid(), :oid, :did, :tk, :tl,
                     :amt, :pre, :ded, :st,
                     :by, {approved_at_sql}, NOW(), NOW())
            """), {
                "oid": order_id, "did": donation_id,
                "tk": tier_key, "tl": tier_label,
                "amt": unit_price, "pre": prefix, "ded": dedication,
                "st": status, "by": approved_by,
            })
            written += 1
    return written


# ─── Public endpoint ──────────────────────────────────────────────────────────


@public_router.get("/donor-wall")
async def public_donor_wall(
    response: Response,
    limit_per_tier: int = Query(500, ge=1, le=2000),
) -> dict[str, Any]:
    """Return approved dedications grouped by tier, big first.

    Shape:
      {
        "tiers": [
          { "key": "founder", "name": "Founder Panel", "amount": 5100,
            "count": 2, "items": [
              { "prefix": "In memory of", "dedication": "Smt Hansaben Patel",
                "date": "2026-09-14" }, ...
            ]
          },
          ...
        ],
        "total_entries": 143
      }
    """
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Cache-Control"] = "public, max-age=60"

    tiers_out: list[dict[str, Any]] = []
    total = 0
    try:
        async with SessionLocal() as db:
            for tk in TIER_ORDER:
                rows = (await db.execute(text("""
                    SELECT prefix, dedication, amount::float AS amount,
                           created_at::date AS date
                      FROM donor_wall_entries
                     WHERE status = 'APPROVED' AND tier_key = :tk
                     ORDER BY display_order DESC, created_at DESC
                     LIMIT :lim
                """), {"tk": tk, "lim": limit_per_tier})).mappings().all()
                items = [{
                    "prefix":     r["prefix"] or "",
                    "dedication": r["dedication"],
                    "date":       r["date"].isoformat() if r["date"] else "",
                } for r in rows]
                # Pick the representative amount for this tier from the first
                # row; fall back to the published price so an empty tier still
                # renders with a correct £ label.
                amt = float(rows[0]["amount"]) if rows else {
                    "founder": 5100, "gold": 1008, "sqft": 351,
                    "bronze": 151, "red": 51, "anyamt": 0,
                }[tk]
                tiers_out.append({
                    "key":    tk,
                    "name":   TIER_LABELS.get(tk, tk.title()),
                    "amount": amt,
                    "count":  len(items),
                    "items":  items,
                })
                total += len(items)
    except Exception as exc:
        # Public endpoint — never 500.
        return {"tiers": [], "total_entries": 0, "error": f"{type(exc).__name__}"}

    return {"tiers": tiers_out, "total_entries": total}


@public_router.options("/donor-wall")
async def public_donor_wall_cors() -> Response:
    headers = {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age":       "86400",
    }
    return Response(status_code=204, headers=headers)


# ─── Admin ────────────────────────────────────────────────────────────────────


@admin_router.get("")
async def admin_list(
    ctx: CurrentSpace,
    status_filter: str = Query("", description="PENDING|APPROVED|HIDDEN|''=all"),
    tier: str = Query("", description="founder|gold|sqft|bronze|red|anyamt|''=all"),
    search: str = "",
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    _only_admin(ctx)
    where = ["1=1"]
    params: dict[str, Any] = {"lim": limit, "off": offset}
    if status_filter in ("PENDING", "APPROVED", "HIDDEN"):
        where.append("status = :st")
        params["st"] = status_filter
    if tier in TIER_ORDER:
        where.append("tier_key = :tk")
        params["tk"] = tier
    if search.strip():
        where.append("(dedication ILIKE :q OR prefix ILIKE :q)")
        params["q"] = f"%{search.strip()}%"
    sql = text(f"""
        SELECT id::text, order_id, donation_id::text, tier_key, tier_label,
               amount::float AS amount, prefix, dedication, status,
               display_order, approved_by,
               approved_at, created_at, updated_at,
               COUNT(*) OVER() AS total
          FROM donor_wall_entries
         WHERE {' AND '.join(where)}
         ORDER BY
           CASE status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
           amount DESC, created_at DESC
         LIMIT :lim OFFSET :off
    """)
    async with SessionLocal() as db:
        rows = (await db.execute(sql, params)).mappings().all()
    items = []
    total = int(rows[0]["total"]) if rows else 0
    for r in rows:
        items.append({
            "id":            r["id"],
            "order_id":      r["order_id"],
            "donation_id":   r["donation_id"] or "",
            "tier_key":      r["tier_key"],
            "tier_label":    r["tier_label"],
            "amount":        r["amount"],
            "prefix":        r["prefix"] or "",
            "dedication":    r["dedication"],
            "status":        r["status"],
            "display_order": r["display_order"],
            "approved_by":   r["approved_by"] or "",
            "approved_at":   r["approved_at"].isoformat() if r["approved_at"] else "",
            "created_at":    r["created_at"].isoformat() if r["created_at"] else "",
            "updated_at":    r["updated_at"].isoformat() if r["updated_at"] else "",
        })
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@admin_router.get("/counts")
async def admin_counts(ctx: CurrentSpace) -> dict[str, int]:
    _only_admin(ctx)
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT status, COUNT(*)::int AS n
              FROM donor_wall_entries
             GROUP BY status
        """))).mappings().all()
    out = {"PENDING": 0, "APPROVED": 0, "HIDDEN": 0, "TOTAL": 0}
    for r in rows:
        out[r["status"]] = int(r["n"])
        out["TOTAL"] += int(r["n"])
    return out


@admin_router.put("/{entry_id}")
async def admin_update(ctx: CurrentSpace, entry_id: str, body: _EntryPatch) -> dict[str, Any]:
    _only_admin(ctx)
    try:
        uuid.UUID(entry_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="entry_id must be UUID") from exc
    sets: list[str] = ["updated_at = NOW()"]
    params: dict[str, Any] = {"id": entry_id}
    if body.dedication is not None:
        sets.append("dedication = :ded")
        params["ded"] = body.dedication.strip()[:200]
    if body.prefix is not None:
        sets.append("prefix = :pre")
        params["pre"] = body.prefix.strip()[:40]
    if body.display_order is not None:
        sets.append("display_order = :ord")
        params["ord"] = int(body.display_order)
    if not params or len(sets) == 1:
        raise HTTPException(status_code=400, detail="nothing to update")
    async with SessionLocal() as db:
        result = await db.execute(text(f"""
            UPDATE donor_wall_entries SET {', '.join(sets)}
             WHERE id = CAST(:id AS UUID)
             RETURNING id
        """), params)
        row = result.first()
        await db.commit()
    if not row:
        raise HTTPException(status_code=404, detail="entry not found")
    return {"id": entry_id, "updated": True}


async def _set_status(entry_id: str, status: str, actor: str) -> None:
    try:
        uuid.UUID(entry_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="entry_id must be UUID") from exc
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE donor_wall_entries
               SET status = :st,
                   approved_by = CASE WHEN :st = 'APPROVED' THEN :by ELSE approved_by END,
                   approved_at = CASE WHEN :st = 'APPROVED' THEN NOW() ELSE approved_at END,
                   updated_at = NOW()
             WHERE id = CAST(:id AS UUID)
             RETURNING id
        """), {"id": entry_id, "st": status, "by": actor})
        row = result.first()
        await db.commit()
    if not row:
        raise HTTPException(status_code=404, detail="entry not found")


@admin_router.post("/{entry_id}/approve")
async def admin_approve(ctx: CurrentSpace, entry_id: str) -> dict[str, Any]:
    _only_admin(ctx)
    await _set_status(entry_id, "APPROVED", ctx.user_email or "admin")
    return {"id": entry_id, "status": "APPROVED"}


@admin_router.post("/{entry_id}/hide")
async def admin_hide(ctx: CurrentSpace, entry_id: str) -> dict[str, Any]:
    _only_admin(ctx)
    await _set_status(entry_id, "HIDDEN", ctx.user_email or "admin")
    return {"id": entry_id, "status": "HIDDEN"}


@admin_router.post("/{entry_id}/unhide")
async def admin_unhide(ctx: CurrentSpace, entry_id: str) -> dict[str, Any]:
    _only_admin(ctx)
    await _set_status(entry_id, "APPROVED", ctx.user_email or "admin")
    return {"id": entry_id, "status": "APPROVED"}
