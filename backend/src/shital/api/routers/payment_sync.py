"""Daily Stripe + SumUp transaction sync.

User direction: "sync/get all Sumup, Strip transaction every day for
financial clarity."

Idempotent, resumable sync of every money movement each provider has
seen, written to the unified `payment_transactions` ledger. From there
finance can reconcile against the `donations` table and the bank
statement without having to click around Stripe/SumUp dashboards.

Endpoints:
  POST /admin/finance/sync/stripe        { since?, until? }  — admin
  POST /admin/finance/sync/sumup         { since?, until? }  — admin
  POST /admin/finance/sync/all           { days?: int = 2 }  — admin
  GET  /admin/finance/sync/history       ?limit=50           — admin
  GET  /admin/finance/transactions       filters             — admin

  POST /admin/finance/sync/all/cron      X-Sync-Token header — service token

The "cron" variant is header-token gated instead of JWT so a nightly
GitHub Action can call it without a user session. Falls back to admin
JWT if no token is configured, so devs can still hit it by hand.

Cursor semantics: if `since` isn't given, we read
MAX(provider_created_at) for the provider from payment_transactions
and start one minute before that (small overlap for safety; UNIQUE
constraint stops duplicates). If the table is empty we default to
30 days back.

Stripe: `BalanceTransaction.list` is the authoritative source. It
covers charges, refunds, fees and payouts with amount_pence /
fee_pence / net_pence lining up to the bank statement. We also keep
the related `source` id so a reader can trace back to the charge.

SumUp: v2.1 /merchants/{code}/transactions/history. Uses cursor-style
pagination. We pull `oldest_time` first (ascending) so fresh runs are
incremental.
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.config import settings
from shital.core.fabrics.database import SessionLocal
from shital.core.fabrics.secrets import SecretsManager

router = APIRouter(prefix="/admin/finance", tags=["finance", "payment-sync"])

STRIPE_PAGE_SIZE = 100          # Stripe max per call
SUMUP_PAGE_SIZE = 100
MAX_PAGES = 200                 # Hard cap so a runaway can't eat the server
DEFAULT_LOOKBACK_DAYS = 30
OVERLAP_SECONDS = 60


def _only_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="ADMIN required")


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        # Accept both "YYYY-MM-DD" and full ISO 8601 with/without TZ.
        if len(s) == 10:
            dt = datetime.fromisoformat(s + "T00:00:00+00:00")
        else:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Bad date: {s!r}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


async def _cursor_from_last(db: Any, provider: str, explicit: datetime | None) -> datetime:
    if explicit:
        return explicit
    row = (await db.execute(text("""
        SELECT MAX(provider_created_at) AS last
          FROM payment_transactions WHERE provider = :p
    """), {"p": provider})).mappings().first()
    last = row["last"] if row else None
    if last:
        return (last - timedelta(seconds=OVERLAP_SECONDS)).astimezone(UTC)
    return datetime.now(UTC) - timedelta(days=DEFAULT_LOOKBACK_DAYS)


async def _start_run(db: Any, provider: str, triggered_by: str,
                     cursor_from: datetime, cursor_to: datetime | None) -> str:
    rid = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO payment_sync_log (id, provider, cursor_from, cursor_to, status, triggered_by)
        VALUES (:id, :p, :cf, :ct, 'running', :by)
    """), {"id": rid, "p": provider, "cf": cursor_from, "ct": cursor_to, "by": triggered_by[:60]})
    await db.commit()
    return rid


async def _finish_run(db: Any, run_id: str, status: str, counts: dict[str, int], error: str = "") -> None:
    await db.execute(text("""
        UPDATE payment_sync_log
           SET completed_at = NOW(),
               status = :st,
               rows_fetched = :fetched,
               rows_inserted = :ins,
               rows_updated = :upd,
               error_message = :err
         WHERE id = :id
    """), {
        "id":      run_id,
        "st":      status,
        "fetched": counts.get("fetched", 0),
        "ins":     counts.get("inserted", 0),
        "upd":     counts.get("updated", 0),
        "err":     (error or "")[:4000],
    })
    await db.commit()


async def _upsert_tx(db: Any, provider: str, external_id: str, row: dict[str, Any]) -> str:
    """Return 'inserted' or 'updated'."""
    existed = (await db.execute(text("""
        SELECT id FROM payment_transactions WHERE provider = :p AND external_id = :eid
    """), {"p": provider, "eid": external_id})).first()

    params = {
        "provider":   provider,
        "eid":        external_id,
        "kind":       row.get("kind", ""),
        "status":     row.get("status", ""),
        "amount":     int(row.get("amount_pence", 0) or 0),
        "currency":   (row.get("currency") or "GBP").upper(),
        "fee":        int(row.get("fee_pence", 0) or 0),
        "net":        int(row.get("net_pence", 0) or 0),
        "desc":       (row.get("description") or "")[:500],
        "cust":       (row.get("customer_hint") or "")[:200],
        "pmh":        (row.get("payment_method_hint") or "")[:120],
        "src":        (row.get("source_ref") or "")[:120],
        "payout":     (row.get("payout_ref") or "")[:120],
        "pca":        row["provider_created_at"],
        "raw":        json.dumps(row.get("raw", {})),
    }
    if existed:
        await db.execute(text("""
            UPDATE payment_transactions SET
              kind = :kind, status = :status,
              amount_pence = :amount, currency = :currency,
              fee_pence = :fee, net_pence = :net,
              description = :desc, customer_hint = :cust,
              payment_method_hint = :pmh, source_ref = :src,
              payout_ref = :payout, provider_created_at = :pca,
              raw = CAST(:raw AS JSONB), synced_at = NOW()
            WHERE provider = :provider AND external_id = :eid
        """), params)
        return "updated"
    await db.execute(text("""
        INSERT INTO payment_transactions
          (provider, external_id, kind, status, amount_pence, currency,
           fee_pence, net_pence, description, customer_hint,
           payment_method_hint, source_ref, payout_ref,
           provider_created_at, raw)
        VALUES
          (:provider, :eid, :kind, :status, :amount, :currency,
           :fee, :net, :desc, :cust,
           :pmh, :src, :payout,
           :pca, CAST(:raw AS JSONB))
    """), params)
    return "inserted"


# ────────────────────────────── Stripe sync ────────────────────────────────

async def _sync_stripe(since: datetime, until: datetime | None, triggered_by: str) -> dict[str, Any]:
    key = await SecretsManager.get("STRIPE_SECRET_KEY") or settings.STRIPE_SECRET_KEY
    if not key:
        return {"provider": "stripe", "status": "skipped", "reason": "STRIPE_SECRET_KEY not configured"}

    import stripe  # local import so the router imports even without the SDK
    stripe.api_key = key

    counts = {"fetched": 0, "inserted": 0, "updated": 0}
    async with SessionLocal() as db:
        run_id = await _start_run(db, "stripe", triggered_by, since, until)
        try:
            params: dict[str, Any] = {
                "limit": STRIPE_PAGE_SIZE,
                "created": {"gte": int(since.timestamp())},
            }
            if until:
                params["created"]["lte"] = int(until.timestamp())

            pages = 0
            starting_after: str | None = None
            while pages < MAX_PAGES:
                pages += 1
                call_params = dict(params)
                if starting_after:
                    call_params["starting_after"] = starting_after
                page = stripe.BalanceTransaction.list(**call_params)
                data = page.get("data") or []
                for bt in data:
                    counts["fetched"] += 1
                    created_at = datetime.fromtimestamp(bt.get("created") or 0, tz=UTC)
                    src = bt.get("source") or ""
                    if isinstance(src, dict):
                        src = src.get("id") or ""
                    payout_ref = ""
                    if bt.get("type") == "payout":
                        payout_ref = src
                    outcome = await _upsert_tx(db, "stripe", bt["id"], {
                        "kind":                bt.get("type", ""),
                        "status":              bt.get("status", ""),
                        "amount_pence":        bt.get("amount", 0),
                        "currency":            (bt.get("currency") or "gbp").upper(),
                        "fee_pence":           bt.get("fee", 0),
                        "net_pence":           bt.get("net", 0),
                        "description":         bt.get("description", "") or "",
                        "customer_hint":       "",
                        "payment_method_hint": "",
                        "source_ref":          src or "",
                        "payout_ref":          payout_ref,
                        "provider_created_at": created_at,
                        "raw": {
                            "type":          bt.get("type"),
                            "available_on":  bt.get("available_on"),
                            "reporting_category": bt.get("reporting_category"),
                            "exchange_rate": bt.get("exchange_rate"),
                        },
                    })
                    counts[outcome] += 1
                if not page.get("has_more") or not data:
                    break
                starting_after = data[-1]["id"]
            await db.commit()
            await _finish_run(db, run_id, "ok", counts)
            return {"provider": "stripe", "status": "ok", **counts}
        except Exception as exc:
            await _finish_run(db, run_id, "error", counts, error=str(exc))
            return {"provider": "stripe", "status": "error", "error": str(exc), **counts}


# ────────────────────────────── SumUp sync ─────────────────────────────────

async def _sync_sumup(since: datetime, until: datetime | None, triggered_by: str) -> dict[str, Any]:
    token = await SecretsManager.get("SUMUP_ACCESS_TOKEN") or settings.SUMUP_ACCESS_TOKEN
    merchant = await SecretsManager.get("SUMUP_MERCHANT_CODE") or settings.SUMUP_MERCHANT_CODE
    if not token or not merchant:
        return {"provider": "sumup", "status": "skipped", "reason": "SUMUP credentials not configured"}

    counts = {"fetched": 0, "inserted": 0, "updated": 0}
    async with SessionLocal() as db:
        run_id = await _start_run(db, "sumup", triggered_by, since, until)
        try:
            base = "https://api.sumup.com"
            url = f"{base}/v2.1/merchants/{merchant}/transactions/history"
            headers = {"Authorization": f"Bearer {token}"}
            params: dict[str, Any] = {
                "limit": SUMUP_PAGE_SIZE,
                "order": "ascending",
                "oldest_time": since.isoformat().replace("+00:00", "Z"),
            }
            if until:
                params["newest_time"] = until.isoformat().replace("+00:00", "Z")

            pages = 0
            async with httpx.AsyncClient(timeout=30) as client:
                while pages < MAX_PAGES:
                    pages += 1
                    resp = await client.get(url, headers=headers, params=params)
                    if resp.status_code == 401:
                        raise RuntimeError("SumUp auth rejected — refresh SUMUP_ACCESS_TOKEN")
                    if not resp.is_success:
                        raise RuntimeError(f"SumUp {resp.status_code}: {resp.text[:200]}")
                    data = resp.json()
                    items = data.get("items") or []
                    for it in items:
                        counts["fetched"] += 1
                        ext = str(it.get("transaction_code") or it.get("id") or "")
                        if not ext:
                            continue
                        ts_raw = it.get("timestamp") or it.get("date") or ""
                        try:
                            created_at = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                        except (ValueError, AttributeError):
                            created_at = datetime.now(UTC)
                        if created_at.tzinfo is None:
                            created_at = created_at.replace(tzinfo=UTC)
                        amount_decimal = float(it.get("amount", 0) or 0)
                        amount_pence = int(round(amount_decimal * 100))
                        outcome = await _upsert_tx(db, "sumup", ext, {
                            "kind":                (it.get("type") or "transaction").lower(),
                            "status":              (it.get("status") or "").upper(),
                            "amount_pence":        amount_pence,
                            "currency":            (it.get("currency") or "GBP").upper(),
                            "fee_pence":           0,                        # not provided on this endpoint
                            "net_pence":           amount_pence,
                            "description":         it.get("product_summary", "") or it.get("description", ""),
                            "customer_hint":       it.get("payment_type", "") or "",
                            "payment_method_hint": it.get("card_type", "") or "",
                            "source_ref":          it.get("merchant_code", "") or "",
                            "payout_ref":          it.get("payout_plan", "") or "",
                            "provider_created_at": created_at,
                            "raw": {
                                "payment_type":  it.get("payment_type"),
                                "entry_mode":    it.get("entry_mode"),
                                "installments_count": it.get("installments_count"),
                            },
                        })
                        counts[outcome] += 1
                    # v2.1 pagination: `links` has next; simpler: when fewer than limit, stop.
                    next_cursor = None
                    for link in data.get("links", []) or []:
                        if (link.get("rel") or "").lower() == "next" and link.get("href"):
                            next_cursor = link["href"]
                            break
                    if not next_cursor or len(items) < SUMUP_PAGE_SIZE:
                        break
                    # Next cursor is a full URL — swap it in, drop params.
                    url = next_cursor if next_cursor.startswith("http") else f"{base}{next_cursor}"
                    params = {}
            await db.commit()
            await _finish_run(db, run_id, "ok", counts)
            return {"provider": "sumup", "status": "ok", **counts}
        except Exception as exc:
            await _finish_run(db, run_id, "error", counts, error=str(exc))
            return {"provider": "sumup", "status": "error", "error": str(exc), **counts}


# ────────────────────────────── Endpoints ──────────────────────────────────

class _SyncIn(BaseModel):
    since: str | None = None
    until: str | None = None


class _SyncAllIn(BaseModel):
    days: int | None = None


@router.post("/sync/stripe")
async def sync_stripe(ctx: CurrentSpace, body: _SyncIn) -> dict[str, Any]:
    _only_admin(ctx)
    async with SessionLocal() as db:
        since = await _cursor_from_last(db, "stripe", _parse_iso(body.since))
    return await _sync_stripe(since, _parse_iso(body.until), triggered_by=f"user:{ctx.user_email}")


@router.post("/sync/sumup")
async def sync_sumup(ctx: CurrentSpace, body: _SyncIn) -> dict[str, Any]:
    _only_admin(ctx)
    async with SessionLocal() as db:
        since = await _cursor_from_last(db, "sumup", _parse_iso(body.since))
    return await _sync_sumup(since, _parse_iso(body.until), triggered_by=f"user:{ctx.user_email}")


async def _run_all(window_days: int | None, triggered_by: str) -> dict[str, Any]:
    out: dict[str, Any] = {"triggered_by": triggered_by, "results": []}
    for provider, runner in (("stripe", _sync_stripe), ("sumup", _sync_sumup)):
        async with SessionLocal() as db:
            cursor = (
                datetime.now(UTC) - timedelta(days=window_days)
                if window_days and window_days > 0
                else await _cursor_from_last(db, provider, None)
            )
        out["results"].append(await runner(cursor, None, triggered_by))  # type: ignore[arg-type]
    return out


@router.post("/sync/all")
async def sync_all(ctx: CurrentSpace, body: _SyncAllIn) -> dict[str, Any]:
    _only_admin(ctx)
    return await _run_all(body.days, triggered_by=f"user:{ctx.user_email}")


@router.post("/sync/all/cron")
async def sync_all_cron(
    request: Request,
    body: _SyncAllIn | None = None,
    x_sync_token: str | None = Header(default=None, alias="X-Sync-Token"),
) -> dict[str, Any]:
    """Header-token gated variant so a GitHub Action can run this nightly
    without a JWT. Falls back to the user-auth endpoint if no token has
    been configured — in that case callers must use /sync/all.
    """
    expected = await SecretsManager.get("PAYMENT_SYNC_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="PAYMENT_SYNC_TOKEN not configured — set it in Admin → API Keys")
    if not x_sync_token or x_sync_token.strip() != expected.strip():
        raise HTTPException(status_code=401, detail="Invalid sync token")
    days = (body.days if body else None) or 2
    return await _run_all(days, triggered_by=f"cron:{request.client.host if request.client else 'unknown'}")


@router.get("/sync/history")
async def sync_history(ctx: CurrentSpace, limit: int = 50) -> dict[str, Any]:
    _only_admin(ctx)
    limit = max(1, min(limit, 500))
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id, provider, started_at, completed_at,
                   cursor_from, cursor_to,
                   rows_fetched, rows_inserted, rows_updated,
                   status, error_message, triggered_by
              FROM payment_sync_log
             ORDER BY started_at DESC
             LIMIT :lim
        """), {"lim": limit})).mappings().all()
    def _iso(v: Any) -> str:
        if not v:
            return ""
        return v.isoformat() if hasattr(v, "isoformat") else str(v)
    return {
        "items": [
            {
                "id":            str(r["id"]),
                "provider":      r["provider"],
                "status":        r["status"],
                "started_at":    _iso(r["started_at"]),
                "completed_at":  _iso(r["completed_at"]),
                "cursor_from":   _iso(r["cursor_from"]),
                "cursor_to":     _iso(r["cursor_to"]),
                "rows_fetched":  int(r["rows_fetched"] or 0),
                "rows_inserted": int(r["rows_inserted"] or 0),
                "rows_updated":  int(r["rows_updated"] or 0),
                "error_message": r["error_message"] or "",
                "triggered_by":  r["triggered_by"] or "",
            }
            for r in rows
        ],
    }


@router.get("/transactions")
async def list_transactions(
    ctx: CurrentSpace,
    provider: str = "",
    kind: str = "",
    status: str = "",
    since: str | None = None,
    until: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    _only_admin(ctx)
    limit = max(1, min(limit, 1000))
    where = ["1=1"]
    params: dict[str, Any] = {"lim": limit, "off": max(0, offset)}
    if provider:
        if provider not in ("stripe", "sumup"):
            raise HTTPException(status_code=400, detail="provider must be 'stripe' or 'sumup'")
        where.append("provider = :p")
        params["p"] = provider
    if kind:
        where.append("kind = :k")
        params["k"] = kind
    if status:
        where.append("status = :s")
        params["s"] = status
    since_dt = _parse_iso(since)
    until_dt = _parse_iso(until)
    if since_dt:
        where.append("provider_created_at >= :sd")
        params["sd"] = since_dt
    if until_dt:
        where.append("provider_created_at <= :ud")
        params["ud"] = until_dt

    clause = " AND ".join(where)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id, provider, external_id, kind, status,
                   amount_pence, currency, fee_pence, net_pence,
                   description, customer_hint, payment_method_hint,
                   source_ref, payout_ref,
                   provider_created_at, synced_at
              FROM payment_transactions
             WHERE {clause}
             ORDER BY provider_created_at DESC
             LIMIT :lim OFFSET :off
        """), params)).mappings().all()
        total = (await db.execute(text(f"""
            SELECT COUNT(*) FROM payment_transactions WHERE {clause}
        """), params)).scalar()

    def _iso(v: Any) -> str:
        if not v:
            return ""
        return v.isoformat() if hasattr(v, "isoformat") else str(v)

    return {
        "total": int(total or 0),
        "items": [
            {
                "id":                   str(r["id"]),
                "provider":             r["provider"],
                "external_id":          r["external_id"],
                "kind":                 r["kind"],
                "status":               r["status"],
                "amount_pence":         int(r["amount_pence"] or 0),
                "currency":             r["currency"],
                "fee_pence":            int(r["fee_pence"] or 0),
                "net_pence":            int(r["net_pence"] or 0),
                "description":          r["description"] or "",
                "customer_hint":        r["customer_hint"] or "",
                "payment_method_hint":  r["payment_method_hint"] or "",
                "source_ref":           r["source_ref"] or "",
                "payout_ref":           r["payout_ref"] or "",
                "provider_created_at":  _iso(r["provider_created_at"]),
                "synced_at":            _iso(r["synced_at"]),
            }
            for r in rows
        ],
    }


__all__ = ["router"]
