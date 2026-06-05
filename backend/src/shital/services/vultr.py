"""Vultr API client — pulls real hosting cost from Vultr so the
Finance → Hosting Costs page reflects actual spend, not hand-typed
estimates.

API docs: https://www.vultr.com/api/
Auth: Personal Access Token in `Authorization: Bearer <token>` header.
      Token is obtained from https://my.vultr.com/settings/#settingsapi
      and stored encrypted in api_keys_store under VULTR_API_KEY (set
      via the admin → Settings → API Keys page).

Three things we pull:
  1. /v2/account                  — current credit balance + total pending
  2. /v2/instances                — every running instance + monthly_cost
  3. /v2/billing/history          — actual £ billed (rolling 12 months)

The instance list is the source of truth for the recurring_payments rows.
The billing history gives a sanity check ("you're paying £X actual vs
£Y forecast from instances"). Other Vultr resources (load balancers,
managed databases, block storage, snapshots, DNS, object storage) also
contribute to the monthly bill and have their own endpoints — we'll add
them as we see them appear on actual invoices, to keep the first cut
small.
"""
from __future__ import annotations

import logging
from datetime import UTC
from typing import Any

import httpx

from shital.core.fabrics.config import settings

logger = logging.getLogger("shital.vultr")

_API = "https://api.vultr.com/v2"


async def _token() -> str:
    """Fetch the Vultr API token. Prefers the encrypted SecretsManager store
    (Settings → API Keys page) over the env var so the operator can rotate
    it from the UI without a redeploy."""
    try:
        from shital.core.fabrics.secrets import SecretsManager
        stored = await SecretsManager.get("VULTR_API_KEY")
        if stored and stored.strip():
            return stored.strip()
    except Exception:  # noqa: BLE001 — fall through to env
        pass
    if (settings.VULTR_API_KEY or "").strip():
        return settings.VULTR_API_KEY.strip()
    raise RuntimeError("VULTR_API_KEY not configured — add it under Settings → API Keys")


async def _get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    tok = await _token()
    async with httpx.AsyncClient(timeout=30) as cx:
        r = await cx.get(f"{_API}{path}",
                         headers={"Authorization": f"Bearer {tok}"},
                         params=params or {})
    if r.status_code == 401:
        raise RuntimeError("Vultr API rejected the token — check it's still active in my.vultr.com/settings/#settingsapi")
    r.raise_for_status()
    return dict(r.json())


# ─── Public API ──────────────────────────────────────────────────────────────

async def get_account() -> dict[str, Any]:
    """Account summary: name, email, balance (credit remaining), pending_charges."""
    data = await _get("/account")
    return dict(data.get("account", {}))


async def list_instances() -> list[dict[str, Any]]:
    """Every cloud instance (VPS) on the account, with monthly_cost in USD."""
    out: list[dict[str, Any]] = []
    cursor: str | None = None
    # Paginate — accounts with many instances need the cursor; ours probably
    # doesn't but it's cheap to handle the API correctly.
    for _ in range(20):
        params: dict[str, Any] = {"per_page": 100}
        if cursor:
            params["cursor"] = cursor
        d = await _get("/instances", params=params)
        out.extend(d.get("instances") or [])
        meta = (d.get("meta") or {}).get("links") or {}
        cursor = meta.get("next") or ""
        if not cursor:
            break
    return out


async def billing_history(limit: int = 12) -> list[dict[str, Any]]:
    """Most recent billing events (charges, credits, refunds). The amounts
    are in USD with a negative sign for charges. Used for the "actual
    spend last 30 days" tile on the hosting page."""
    d = await _get("/billing/history", params={"per_page": limit})
    return list(d.get("billing_history") or [])


# ─── Convenience: roll-up suitable for the hosting page ──────────────────────

async def cost_snapshot() -> dict[str, Any]:
    """One-shot fetch used by the /admin/hosting/vultr-snapshot endpoint —
    everything the page needs without three round-trips from the frontend.

    Returns:
      account:                {balance, pending_charges, name, ...}
      instances:              [{id, label, plan_id, region, monthly_cost, ...}]
      monthly_forecast_usd:   sum of all instance.monthly_cost
      billing_history:        [{date, type, description, amount}]
      last_30_days_charge:    abs total of negative-amount events in last 30d
    """
    from datetime import datetime, timedelta

    acct, instances, history = await get_account(), await list_instances(), await billing_history(50)
    forecast = sum(float(i.get("monthly_cost") or 0) for i in instances)

    cutoff = datetime.now(UTC) - timedelta(days=30)
    last_30 = 0.0
    for h in history:
        when = h.get("date") or ""
        try:
            dt = datetime.fromisoformat(when.replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt < cutoff:
            continue
        amt = float(h.get("amount") or 0)
        if amt < 0:        # charges are negative in Vultr's API
            last_30 += abs(amt)

    return {
        "account": acct,
        "instances": instances,
        "monthly_forecast_usd": round(forecast, 2),
        "last_30_days_charge_usd": round(last_30, 2),
        "billing_history": history[:12],
    }
