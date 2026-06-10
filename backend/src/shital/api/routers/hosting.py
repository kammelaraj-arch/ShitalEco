"""Hosting cost helpers — pulls real spend from cloud providers
(currently only Vultr) and syncs the rows into the existing
recurring_payments table so the Finance → Hosting Costs page reflects
actual cost, not a hand-typed estimate.

Endpoints:
  GET  /admin/hosting/vultr/snapshot   — read-only: account + instances + spend
  POST /admin/hosting/vultr/sync       — upsert each instance into recurring_payments

Re-using the existing recurring_payments table avoids creating a parallel
data model; the Hosting page already reads from it. We tag synced rows
with reference='vultr:<instance_id>' so a second sync updates the same
row instead of duplicating, and so the operator can tell which rows
came from Vultr vs hand-entered.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal
from shital.services import vultr

router = APIRouter(tags=["hosting"])

# Vultr bills in USD. We display in GBP on the page; using a conservative
# fixed rate keeps the picture stable from one sync to the next. The
# operator can override per-row by editing the recurring_payments row.
_USD_TO_GBP = 0.80


def _require_admin(ctx: CurrentSpace) -> None:
    if getattr(ctx, "role", "") not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(status_code=403, detail="admin only")


@router.get("/admin/hosting/vultr/snapshot")
async def vultr_snapshot(ctx: CurrentSpace) -> dict[str, Any]:
    """Live pull from Vultr — account credit, every instance + monthly_cost,
    actual last-30-day charge. No DB writes; the Sync button below is the
    one that mutates recurring_payments."""
    _require_admin(ctx)
    try:
        snap = await vultr.cost_snapshot()
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        **snap,
        "usd_to_gbp_rate": _USD_TO_GBP,
        "monthly_forecast_gbp": round(snap["monthly_forecast_usd"] * _USD_TO_GBP, 2),
        "last_30_days_charge_gbp": round(snap["last_30_days_charge_usd"] * _USD_TO_GBP, 2),
    }


@router.post("/admin/hosting/vultr/sync")
async def vultr_sync(ctx: CurrentSpace) -> dict[str, Any]:
    """Upsert every Vultr instance into recurring_payments as a HOSTING
    category line. Uses reference='vultr:<instance_id>' as the dedupe
    key so a second sync updates the existing row instead of creating
    a duplicate.

    Returns counts of created vs updated rows + any instances skipped."""
    _require_admin(ctx)
    try:
        instances = await vultr.list_instances()
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    created = 0
    updated = 0
    rows: list[dict[str, Any]] = []
    async with SessionLocal() as db:
        for inst in instances:
            ref = f"vultr:{inst.get('id', '')}"
            label = inst.get("label") or inst.get("hostname") or inst.get("main_ip") or "Vultr instance"
            region = inst.get("region") or ""
            ram = inst.get("ram") or 0          # in MB
            vcpu = inst.get("vcpu_count") or 0
            disk = inst.get("disk") or 0
            plan = inst.get("plan") or ""
            monthly_usd = float(inst.get("monthly_cost") or 0)
            monthly_gbp = round(monthly_usd * _USD_TO_GBP, 2)
            notes = (
                f"Auto-synced from Vultr. plan={plan}, region={region}, "
                f"vCPU={vcpu}, RAM={ram} MB, disk={disk} GB. "
                f"Original price: ${monthly_usd}/mo USD (converted at "
                f"{_USD_TO_GBP} GBP/USD)."
            )
            existing = (await db.execute(text("""
                SELECT id FROM recurring_payments
                WHERE reference = :ref AND deleted_at IS NULL
            """), {"ref": ref})).first()
            if existing:
                await db.execute(text("""
                    UPDATE recurring_payments SET
                        name        = :name,
                        category    = 'HOSTING',
                        payee       = 'Vultr Holdings, LLC',
                        amount      = :amt,
                        currency    = 'GBP',
                        frequency   = 'MONTHLY',
                        notes       = :notes,
                        is_active   = true,
                        updated_at  = NOW()
                    WHERE id = :id
                """), {"name": f"Vultr — {label}", "amt": monthly_gbp,
                       "notes": notes, "id": existing[0]})
                updated += 1
                rows.append({"id": str(existing[0]), "action": "updated",
                             "name": label, "monthly_gbp": monthly_gbp})
            else:
                await db.execute(text("""
                    INSERT INTO recurring_payments
                        (id, branch_id, name, category, is_critical, amount, currency,
                         frequency, start_date, payee, reference, notes, is_active, created_by)
                    VALUES
                        (gen_random_uuid(), 'main', :name, 'HOSTING', true, :amt, 'GBP',
                         'MONTHLY', CURRENT_DATE, 'Vultr Holdings, LLC', :ref, :notes, true, 'vultr-sync')
                """), {"name": f"Vultr — {label}", "amt": monthly_gbp,
                       "ref": ref, "notes": notes})
                created += 1
                rows.append({"action": "created", "name": label,
                             "monthly_gbp": monthly_gbp})
        await db.commit()

    return {
        "ok": True,
        "instances_seen": len(instances),
        "created": created,
        "updated": updated,
        "rows": rows,
    }
