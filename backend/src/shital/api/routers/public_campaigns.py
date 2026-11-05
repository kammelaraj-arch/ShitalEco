"""Public campaign progress — no auth, read-only.

Powers the Future Legacy Appeal thermometer (3D vision page + any other
embedded widget). Sums COMPLETED donations from the service portal and
buckets each one into the mortgage bucket (Square Foot tier) or the
extension bucket (any brick tier: Red / Bronze / Gold / Founder).

Classification:
- If the linked orders row has an `items` JSONB array (new payment path),
  each item is classified by its name. This is the authoritative source.
- Otherwise falls back to matching the donation amount against known tier
  prices. Quantity multiples (two Red Bricks = £102) aren't captured on
  this path — accept this as "close enough" for a public counter.

CORS: this endpoint sets Access-Control-Allow-Origin: * explicitly so the
shared 3D vision artifact on claude.ai (and any other embed) can fetch it
without the charity having to maintain a CORS allow-list for every
donor-facing surface.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response
from sqlalchemy import text

from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/public/campaigns", tags=["public", "campaigns"])


# Goal amounts (£, pounds). Edit here when the campaign targets change.
# These are deliberately in code, not in the DB, so the counter can't be
# accidentally reset to zero from the admin UI by a mis-click.
LEGACY_MORTGAGE_GOAL   = 850_000.00  # Clear the next-door property mortgage
LEGACY_EXTENSION_GOAL  = 250_000.00  # Build shoe-rack + back hall + kitchen


# Known tier prices (used in the fallback classifier only).
SQFT_PRICE    = 351
BRICK_PRICES  = {51, 151, 1008, 5100}


@router.get("/legacy/progress")
async def legacy_progress(response: Response) -> dict[str, Any]:
    """Return the live Future Legacy Appeal totals.

    Response shape:
      {
        "mortgage":  { "raised": <float £>, "goal": <float £> },
        "extension": { "raised": <float £>, "goal": <float £> },
        "total_raised":  <float £>,
        "total_goal":    <float £>,
        "donor_count":   <int>,
        "last_gift_at":  <ISO-8601 str | null>,
        "currency":      "GBP"
      }
    """
    # Public resource — allow any origin to fetch it. The response is a
    # read-only aggregate: no PII, no per-row data.
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Cache-Control"] = "public, max-age=120"

    sql = text("""
        WITH legacy_dons AS (
            SELECT
                don.id,
                don.amount::numeric                    AS amount,
                don.reference,
                don.created_at,
                o.items                                AS items
            FROM donations don
            LEFT JOIN orders o ON o.reference = don.reference
            WHERE don.deleted_at IS NULL
              AND UPPER(COALESCE(don.status, '')) = 'COMPLETED'
              AND (
                   COALESCE(don.source, '')  = 'service-portal'
                OR UPPER(COALESCE(don.purpose, '')) LIKE '%LEGACY%'
                OR UPPER(COALESCE(don.purpose, '')) LIKE '%APPEAL%'
                OR UPPER(COALESCE(don.purpose, '')) = 'SERVICE PORTAL'
              )
        )
        SELECT
            -- Mortgage bucket: everything named "Square Foot" (any case).
            -- Fallback when there are no items: a bare £351 gift.
            COALESCE(SUM(
                CASE
                    WHEN d.items IS NOT NULL AND jsonb_typeof(d.items) = 'array' THEN (
                        SELECT COALESCE(SUM(
                            COALESCE((it->>'unitPrice')::numeric,
                                     (it->>'totalPrice')::numeric,
                                     0)
                            * GREATEST(COALESCE((it->>'quantity')::int, 1), 1)
                        ), 0)
                        FROM jsonb_array_elements(d.items) it
                        WHERE  UPPER(COALESCE(it->>'name', '')) LIKE '%SQUARE FOOT%'
                            OR UPPER(COALESCE(it->>'name', '')) LIKE '%SQ FT%'
                            OR UPPER(COALESCE(it->>'tier', '')) LIKE '%SQUARE FOOT%'
                    )
                    WHEN (d.items IS NULL OR jsonb_typeof(d.items) <> 'array')
                         AND d.amount = :sqft_price THEN d.amount
                    ELSE 0
                END
            ), 0) AS mortgage_raised,

            -- Extension bucket: everything named with a brick tier.
            -- Fallback when there are no items: a bare £51/£151/£1008/£5100 gift.
            COALESCE(SUM(
                CASE
                    WHEN d.items IS NOT NULL AND jsonb_typeof(d.items) = 'array' THEN (
                        SELECT COALESCE(SUM(
                            COALESCE((it->>'unitPrice')::numeric,
                                     (it->>'totalPrice')::numeric,
                                     0)
                            * GREATEST(COALESCE((it->>'quantity')::int, 1), 1)
                        ), 0)
                        FROM jsonb_array_elements(d.items) it
                        WHERE  UPPER(COALESCE(it->>'name', '')) LIKE '%BRICK%'
                            OR UPPER(COALESCE(it->>'name', '')) LIKE '%FOUNDER%'
                            OR UPPER(COALESCE(it->>'tier', '')) LIKE '%BRICK%'
                    )
                    WHEN (d.items IS NULL OR jsonb_typeof(d.items) <> 'array')
                         AND d.amount::int = ANY(:brick_prices) THEN d.amount
                    ELSE 0
                END
            ), 0) AS extension_raised,

            COUNT(DISTINCT d.id)       AS donor_count,
            MAX(d.created_at)          AS last_gift_at
        FROM legacy_dons d
    """)

    try:
        async with SessionLocal() as db:
            row = (await db.execute(sql, {
                "sqft_price":    SQFT_PRICE,
                "brick_prices":  list(BRICK_PRICES),
            })).mappings().first()
    except Exception as exc:
        # Public endpoint — never 500 on the donor-facing page. Return
        # zeroed totals with a reason so the UI stays graceful.
        return {
            "mortgage":     {"raised": 0, "goal": LEGACY_MORTGAGE_GOAL},
            "extension":    {"raised": 0, "goal": LEGACY_EXTENSION_GOAL},
            "total_raised": 0,
            "total_goal":   LEGACY_MORTGAGE_GOAL + LEGACY_EXTENSION_GOAL,
            "donor_count":  0,
            "last_gift_at": None,
            "currency":     "GBP",
            "error":        f"progress unavailable: {type(exc).__name__}",
        }

    mortgage_raised  = float(row["mortgage_raised"] or 0) if row else 0.0
    extension_raised = float(row["extension_raised"] or 0) if row else 0.0
    last_gift        = row["last_gift_at"] if row else None
    donor_count      = int(row["donor_count"] or 0) if row else 0

    return {
        "mortgage":     {"raised": round(mortgage_raised,  2), "goal": LEGACY_MORTGAGE_GOAL},
        "extension":    {"raised": round(extension_raised, 2), "goal": LEGACY_EXTENSION_GOAL},
        "total_raised": round(mortgage_raised + extension_raised, 2),
        "total_goal":   LEGACY_MORTGAGE_GOAL + LEGACY_EXTENSION_GOAL,
        "donor_count":  donor_count,
        "last_gift_at": last_gift.isoformat() if last_gift else None,
        "currency":     "GBP",
    }


@router.options("/legacy/progress")
async def legacy_progress_cors(response: Response) -> Response:
    """CORS preflight for cross-origin fetches from the vision artifact."""
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Max-Age"]       = "86400"
    return Response(status_code=204, headers=response.headers)
