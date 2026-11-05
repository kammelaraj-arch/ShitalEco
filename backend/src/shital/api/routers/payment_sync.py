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


async def _primary_account_id_for_provider(db: Any, provider: str) -> str | None:
    """Pick the account every row of this provider should link to.

    Chooses the lowest-sort_order active, non-deleted account whose type
    matches the provider. Returns None if no match (e.g. the operator
    deleted all their Stripe accounts) — the row still inserts with
    account_id NULL and the admin UI shows "—".
    """
    has_table = bool((await db.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables WHERE table_name = 'finance_accounts'
        )
    """))).scalar())
    if not has_table:
        return None
    row = (await db.execute(text("""
        SELECT id::text AS id FROM finance_accounts
         WHERE deleted_at IS NULL
           AND is_active = true
           AND UPPER(account_type) = :t
         ORDER BY sort_order ASC, name ASC
         LIMIT 1
    """), {"t": provider.upper()})).first()
    return str(row[0]) if row else None


async def _backfill_account_ids(db: Any, provider: str) -> int:
    """Link every orphan row (account_id IS NULL) for this provider to the
    provider's primary finance_account. Returns the count linked.

    Called at the start of every provider sync so the "No transactions"
    view with a specific account selected doesn't hide historical rows
    that were synced before that account entry was created.
    """
    account_id = await _primary_account_id_for_provider(db, provider)
    if not account_id:
        return 0
    result = await db.execute(text("""
        UPDATE payment_transactions
           SET account_id = :aid
         WHERE provider = :p
           AND account_id IS NULL
    """), {"aid": account_id, "p": provider})
    # SQLAlchemy returns .rowcount for UPDATE under asyncpg.
    linked = int(getattr(result, "rowcount", 0) or 0)
    if linked:
        await db.commit()
    return linked


async def _upsert_tx(db: Any, provider: str, external_id: str, row: dict[str, Any]) -> str:
    """Return 'inserted' or 'updated'. Links new rows to the provider's primary
    finance_account; existing rows have their account_id backfilled only when
    it is still NULL (so operators can retag a specific row without the sync
    stomping on it)."""
    existed = (await db.execute(text("""
        SELECT id FROM payment_transactions WHERE provider = :p AND external_id = :eid
    """), {"p": provider, "eid": external_id})).first()

    account_id = await _primary_account_id_for_provider(db, provider)

    params = {
        "account":    account_id,
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
        # Rich detail (migration 046) — all tolerant of absence.
        "cust_name":      (row.get("customer_name") or "")[:200],
        "cust_email":     (row.get("customer_email") or "")[:200].lower(),
        "cust_phone":     (row.get("customer_phone") or "")[:50],
        "bill_country":   (row.get("billing_country") or "")[:4].upper(),
        "bill_postcode":  (row.get("billing_postcode") or "")[:20],
        "pm_type":        (row.get("payment_method_type") or "")[:40],
        "card_brand":     (row.get("card_brand") or "")[:30],
        "card_last4":     (row.get("card_last4") or "")[:4],
        "card_country":   (row.get("card_country") or "")[:4].upper(),
        "card_funding":   (row.get("card_funding") or "")[:20],
        "receipt_url":    (row.get("receipt_url") or "")[:500],
        "stmt_desc":      (row.get("statement_descriptor") or "")[:200],
        "available_at":   row.get("available_at"),
        "refunded":       bool(row.get("refunded", False)),
        "refund_amount":  int(row.get("refund_amount_pence", 0) or 0),
        "disputed":       bool(row.get("disputed", False)),
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
              raw = CAST(:raw AS JSONB), synced_at = NOW(),
              account_id = COALESCE(account_id, :account),
              customer_name     = CASE WHEN :cust_name <> ''     THEN :cust_name     ELSE customer_name     END,
              customer_email    = CASE WHEN :cust_email <> ''    THEN :cust_email    ELSE customer_email    END,
              customer_phone    = CASE WHEN :cust_phone <> ''    THEN :cust_phone    ELSE customer_phone    END,
              billing_country   = CASE WHEN :bill_country <> ''  THEN :bill_country  ELSE billing_country   END,
              billing_postcode  = CASE WHEN :bill_postcode <> '' THEN :bill_postcode ELSE billing_postcode  END,
              payment_method_type = CASE WHEN :pm_type <> ''     THEN :pm_type       ELSE payment_method_type END,
              card_brand        = CASE WHEN :card_brand <> ''    THEN :card_brand    ELSE card_brand        END,
              card_last4        = CASE WHEN :card_last4 <> ''    THEN :card_last4    ELSE card_last4        END,
              card_country      = CASE WHEN :card_country <> ''  THEN :card_country  ELSE card_country      END,
              card_funding      = CASE WHEN :card_funding <> ''  THEN :card_funding  ELSE card_funding      END,
              receipt_url       = CASE WHEN :receipt_url <> ''   THEN :receipt_url   ELSE receipt_url       END,
              statement_descriptor = CASE WHEN :stmt_desc <> ''  THEN :stmt_desc     ELSE statement_descriptor END,
              available_at      = COALESCE(:available_at, available_at),
              refunded          = CASE WHEN :refunded THEN true ELSE refunded END,
              refund_amount_pence = GREATEST(refund_amount_pence, :refund_amount),
              disputed          = CASE WHEN :disputed THEN true ELSE disputed END
            WHERE provider = :provider AND external_id = :eid
        """), params)
        return "updated"
    await db.execute(text("""
        INSERT INTO payment_transactions
          (provider, external_id, kind, status, amount_pence, currency,
           fee_pence, net_pence, description, customer_hint,
           payment_method_hint, source_ref, payout_ref,
           provider_created_at, raw, account_id,
           customer_name, customer_email, customer_phone,
           billing_country, billing_postcode,
           payment_method_type, card_brand, card_last4, card_country, card_funding,
           receipt_url, statement_descriptor, available_at,
           refunded, refund_amount_pence, disputed)
        VALUES
          (:provider, :eid, :kind, :status, :amount, :currency,
           :fee, :net, :desc, :cust,
           :pmh, :src, :payout,
           :pca, CAST(:raw AS JSONB), :account,
           :cust_name, :cust_email, :cust_phone,
           :bill_country, :bill_postcode,
           :pm_type, :card_brand, :card_last4, :card_country, :card_funding,
           :receipt_url, :stmt_desc, :available_at,
           :refunded, :refund_amount, :disputed)
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
        counts["backfilled"] = await _backfill_account_ids(db, "stripe")
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
                # Stripe's ListObject is dict-like for attribute access but
                # doesn't implement .get() — use attribute access (or
                # .to_dict()). Using attrs keeps the inner BalanceTransaction
                # objects unmodified so their own .get("amount") etc. still
                # works.
                data = list(page.data) if hasattr(page, "data") else (page.to_dict().get("data") or [])
                has_more = bool(getattr(page, "has_more", False))
                for bt_obj in data:
                    counts["fetched"] += 1
                    bt = bt_obj.to_dict() if hasattr(bt_obj, "to_dict") else dict(bt_obj)
                    created_at = datetime.fromtimestamp(bt.get("created") or 0, tz=UTC)
                    src = bt.get("source") or ""
                    if isinstance(src, dict):
                        src = src.get("id") or ""
                    payout_ref = ""
                    if bt.get("type") == "payout":
                        payout_ref = src

                    # For charge-type transactions, fetch the Charge for the
                    # rich detail (billing details, payment-method details,
                    # receipt URL, refund / dispute flags). Skip for payouts
                    # and non-charge movements — those don't carry customer
                    # information. Failures on the detail call must not fail
                    # the sync — the base row still goes in without them.
                    extra: dict[str, Any] = {}
                    if bt.get("type") == "charge" and src and src.startswith("ch_"):
                        try:
                            ch_obj = stripe.Charge.retrieve(
                                src,
                                expand=["payment_method_details", "billing_details"],
                            )
                            ch = ch_obj.to_dict() if hasattr(ch_obj, "to_dict") else dict(ch_obj)
                            bd = ch.get("billing_details") or {}
                            bd_addr = bd.get("address") or {}
                            pmd = ch.get("payment_method_details") or {}
                            card = pmd.get("card") or {}
                            extra = {
                                "customer_name":        bd.get("name") or "",
                                "customer_email":       bd.get("email") or ch.get("receipt_email") or "",
                                "customer_phone":       bd.get("phone") or "",
                                "billing_country":      bd_addr.get("country") or "",
                                "billing_postcode":     bd_addr.get("postal_code") or "",
                                "payment_method_type":  pmd.get("type") or "",
                                "card_brand":           card.get("brand") or "",
                                "card_last4":           card.get("last4") or "",
                                "card_country":         card.get("country") or "",
                                "card_funding":         card.get("funding") or "",
                                "receipt_url":          ch.get("receipt_url") or "",
                                "statement_descriptor": ch.get("statement_descriptor") or "",
                                "refunded":             bool(ch.get("refunded")),
                                "refund_amount_pence":  ch.get("amount_refunded") or 0,
                                "disputed":             bool(ch.get("disputed")),
                            }
                        except Exception:
                            extra = {}
                    available_at = None
                    if bt.get("available_on"):
                        try:
                            available_at = datetime.fromtimestamp(int(bt["available_on"]), tz=UTC)
                        except (TypeError, ValueError):
                            available_at = None

                    outcome = await _upsert_tx(db, "stripe", bt["id"], {
                        "kind":                bt.get("type", ""),
                        "status":              bt.get("status", ""),
                        "amount_pence":        bt.get("amount", 0),
                        "currency":            (bt.get("currency") or "gbp").upper(),
                        "fee_pence":           bt.get("fee", 0),
                        "net_pence":           bt.get("net", 0),
                        "description":         bt.get("description", "") or "",
                        "customer_hint":       extra.get("customer_email") or extra.get("customer_name") or "",
                        "payment_method_hint": extra.get("card_brand", "") + (" •••• " + extra.get("card_last4", "") if extra.get("card_last4") else ""),
                        "source_ref":          src or "",
                        "payout_ref":          payout_ref,
                        "provider_created_at": created_at,
                        "available_at":        available_at,
                        "raw": {
                            "type":          bt.get("type"),
                            "available_on":  bt.get("available_on"),
                            "reporting_category": bt.get("reporting_category"),
                            "exchange_rate": bt.get("exchange_rate"),
                        },
                        **extra,
                    })
                    counts[outcome] += 1
                if not has_more or not data:
                    break
                # data[-1] is still the Stripe object; __getitem__["id"] works
                # on StripeObjects, but be safe with to_dict() fallback.
                last_obj = data[-1]
                last_id = last_obj["id"] if "id" in last_obj else last_obj.to_dict().get("id")
                starting_after = last_id
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
        counts["backfilled"] = await _backfill_account_ids(db, "sumup")
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

            detail_url = f"{base}/v2.1/merchants/{merchant}/transactions"
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

                        # Fetch per-tx detail for the fee. SumUp's history
                        # endpoint omits fees (they're charged per deposit),
                        # but the detail endpoint lists them under `events`.
                        # One extra HTTP round-trip per tx is acceptable at
                        # charity volume (hundreds per day, not millions).
                        fee_pence = 0
                        card_type = (it.get("card_type") or "") or ""
                        entry_mode = (it.get("entry_mode") or "") or ""
                        card_brand = ""
                        card_last4 = ""
                        card_country = ""
                        payout_date: datetime | None = None
                        try:
                            det_resp = await client.get(
                                detail_url,
                                headers=headers,
                                params={"transaction_code": ext},
                            )
                            if det_resp.is_success:
                                det = det_resp.json() or {}
                                # Some tenants return a list; normalise.
                                if isinstance(det, list):
                                    det = det[0] if det else {}
                                # Fee: prefer direct field, else sum events
                                # of type 'CHARGE_BACK'/'REFUND' are NOT fees;
                                # true fee lives on events with type 'PAYOUT'
                                # (or a `fee_amount` key) — both are seen in
                                # production SumUp payloads depending on
                                # merchant country.
                                fa = det.get("fee_amount")
                                if fa is not None:
                                    try:
                                        fee_pence = int(round(float(fa) * 100))
                                    except (TypeError, ValueError):
                                        fee_pence = 0
                                if fee_pence == 0:
                                    for ev in det.get("events") or []:
                                        ev_fa = ev.get("fee_amount") if isinstance(ev, dict) else None
                                        if ev_fa:
                                            try:
                                                fee_pence += int(round(float(ev_fa) * 100))
                                            except (TypeError, ValueError):
                                                pass
                                card_type = card_type or det.get("card", {}).get("type", "") or det.get("card_type", "")
                                entry_mode = entry_mode or det.get("entry_mode", "")
                                card_obj = det.get("card") or {}
                                card_brand = card_obj.get("type", "") or card_type
                                card_last4 = card_obj.get("last_4_digits") or card_obj.get("last4") or ""
                                card_country = card_obj.get("country") or ""
                                # Payout/available date — use the latest
                                # PAYOUT event timestamp if present.
                                for ev in det.get("events") or []:
                                    if isinstance(ev, dict) and (ev.get("type") or "").upper() == "PAYOUT":
                                        ts_val = ev.get("timestamp") or ev.get("payout_date") or ""
                                        try:
                                            payout_date = datetime.fromisoformat(str(ts_val).replace("Z", "+00:00"))
                                            if payout_date.tzinfo is None:
                                                payout_date = payout_date.replace(tzinfo=UTC)
                                        except (ValueError, AttributeError, TypeError):
                                            pass
                        except httpx.HTTPError:
                            # Network blip on the detail call must not fail
                            # the whole sync — fee just stays 0 for this row.
                            pass

                        # SumUp fee is the merchant's cost, so subtract from
                        # gross to get net banked. fee_pence is always a
                        # positive integer here.
                        net_pence = amount_pence - abs(fee_pence) if amount_pence > 0 else amount_pence + abs(fee_pence)

                        is_refund = (it.get("status") or "").upper() in ("REFUNDED", "REFUND") or amount_pence < 0
                        outcome = await _upsert_tx(db, "sumup", ext, {
                            "kind":                (it.get("type") or "transaction").lower(),
                            "status":              (it.get("status") or "").upper(),
                            "amount_pence":        amount_pence,
                            "currency":            (it.get("currency") or "GBP").upper(),
                            "fee_pence":           abs(fee_pence),
                            "net_pence":           net_pence,
                            "description":         it.get("product_summary", "") or it.get("description", ""),
                            "customer_hint":       it.get("payment_type", "") or "",
                            "payment_method_hint": (card_brand or card_type) + (" •••• " + card_last4 if card_last4 else ""),
                            "source_ref":          it.get("merchant_code", "") or "",
                            "payout_ref":          it.get("payout_plan", "") or "",
                            "provider_created_at": created_at,
                            # Rich detail
                            "payment_method_type": "card",
                            "card_brand":          card_brand or card_type,
                            "card_last4":          card_last4,
                            "card_country":        card_country,
                            "available_at":        payout_date,
                            "refunded":            is_refund,
                            "refund_amount_pence": abs(amount_pence) if is_refund else 0,
                            "raw": {
                                "payment_type":  it.get("payment_type"),
                                "entry_mode":    entry_mode,
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


# ────────────────────────────── PayPal sync ────────────────────────────────

PAYPAL_PAGE_SIZE = 100


async def _paypal_base() -> str:
    env = (await SecretsManager.get("PAYPAL_ENV")) or getattr(settings, "PAYPAL_MODE", "sandbox")
    return "https://api-m.paypal.com" if env.lower() in ("live", "production") else "https://api-m.sandbox.paypal.com"


async def _paypal_token() -> str:
    client_id = (await SecretsManager.get("PAYPAL_CLIENT_ID")) or settings.PAYPAL_CLIENT_ID
    client_secret = (await SecretsManager.get("PAYPAL_CLIENT_SECRET")) or settings.PAYPAL_CLIENT_SECRET
    if not client_id or not client_secret:
        return ""
    base = await _paypal_base()
    async with httpx.AsyncClient(timeout=20) as c:
        resp = await c.post(
            f"{base}/v1/oauth2/token",
            auth=(client_id, client_secret),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json"},
        )
        if not resp.is_success:
            raise RuntimeError(f"PayPal auth {resp.status_code}: {resp.text[:200]}")
        return resp.json().get("access_token", "") or ""


async def _sync_paypal(since: datetime, until: datetime | None, triggered_by: str) -> dict[str, Any]:
    """Pull PayPal money movements via Transaction Search v1 into the unified
    ledger. 31-day max window per call (PayPal rule) — we chunk whatever the
    caller asked for into ≤31-day slices.
    """
    try:
        token = await _paypal_token()
    except Exception as exc:  # noqa: BLE001
        return {"provider": "paypal", "status": "error", "error": str(exc)}
    if not token:
        return {"provider": "paypal", "status": "skipped", "reason": "PAYPAL_CLIENT_ID / _SECRET not configured"}

    base = await _paypal_base()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    now_utc = datetime.now(UTC)
    final_until = (until or now_utc).astimezone(UTC)
    final_since = since.astimezone(UTC)
    if final_since >= final_until:
        return {"provider": "paypal", "status": "ok", "fetched": 0, "inserted": 0, "updated": 0, "reason": "empty window"}

    counts = {"fetched": 0, "inserted": 0, "updated": 0}
    async with SessionLocal() as db:
        run_id = await _start_run(db, "paypal", triggered_by, final_since, final_until)
        counts["backfilled"] = await _backfill_account_ids(db, "paypal")
        try:
            cur_from = final_since
            async with httpx.AsyncClient(timeout=40) as client:
                while cur_from < final_until:
                    chunk_end = min(cur_from + timedelta(days=30), final_until)
                    page = 1
                    while True:
                        params: dict[str, Any] = {
                            "start_date":     cur_from.strftime("%Y-%m-%dT%H:%M:%S.000%z") or cur_from.isoformat(),
                            "end_date":       chunk_end.strftime("%Y-%m-%dT%H:%M:%S.000%z") or chunk_end.isoformat(),
                            "fields":         "all",
                            "page_size":      PAYPAL_PAGE_SIZE,
                            "page":           page,
                        }
                        # Normalise tz offset to +0000 (PayPal is picky).
                        params["start_date"] = cur_from.strftime("%Y-%m-%dT%H:%M:%S") + "Z"
                        params["end_date"]   = chunk_end.strftime("%Y-%m-%dT%H:%M:%S") + "Z"
                        resp = await client.get(f"{base}/v1/reporting/transactions", headers=headers, params=params)
                        if resp.status_code == 429:
                            # Rate limited — stop this chunk, let the next cron pick up.
                            break
                        if resp.status_code == 403:
                            # Transaction Search is a separate scope the REST
                            # app has to enable — most apps have it OFF by
                            # default. Give the operator the exact fix path
                            # instead of the raw PayPal error blob.
                            raise RuntimeError(
                                "PayPal 403 NOT_AUTHORIZED — the REST app is missing the "
                                "'Transaction Search' permission. Fix: developer.paypal.com "
                                "→ My Apps & Credentials → open your Live app → scroll to "
                                "Features → enable 'Transaction Search' → Save, then refresh "
                                "the admin client token in Admin → API Keys."
                            )
                        if not resp.is_success:
                            raise RuntimeError(f"PayPal {resp.status_code}: {resp.text[:200]}")
                        body_json = resp.json()
                        details = body_json.get("transaction_details") or []
                        for d in details:
                            counts["fetched"] += 1
                            tx = d.get("transaction_info") or {}
                            payer = d.get("payer_info") or {}
                            ship = d.get("shipping_info") or {}
                            txn_id = str(tx.get("transaction_id") or tx.get("paypal_reference_id") or "")
                            if not txn_id:
                                continue
                            ts_raw = tx.get("transaction_initiation_date") or tx.get("transaction_updated_date") or ""
                            try:
                                created_at = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                            except (ValueError, AttributeError):
                                created_at = datetime.now(UTC)
                            if created_at.tzinfo is None:
                                created_at = created_at.replace(tzinfo=UTC)
                            amount = tx.get("transaction_amount") or {}
                            fee = tx.get("fee_amount") or {}
                            try:
                                amount_pence = int(round(float(amount.get("value", 0) or 0) * 100))
                            except (TypeError, ValueError):
                                amount_pence = 0
                            try:
                                fee_pence = int(round(float(fee.get("value", 0) or 0) * 100))
                            except (TypeError, ValueError):
                                fee_pence = 0
                            # PayPal reports fee as a NEGATIVE number from merchant POV.
                            fee_pence_abs = -fee_pence if fee_pence < 0 else fee_pence
                            net_pence = amount_pence + fee_pence  # fee already signed
                            cust = (
                                (payer.get("payer_name") or {}).get("alternate_full_name")
                                or (payer.get("payer_name") or {}).get("given_name") or ""
                            ) + (" " + ((payer.get("payer_name") or {}).get("surname") or "")).rstrip()
                            email = (payer.get("email_address") or "").strip()
                            # Rich shipping address — PayPal only exposes
                            # address at the payer/shipping level, not the
                            # payment method, so use whichever is available.
                            ship_addr = ship.get("address") or {}
                            payer_addr = (payer.get("address") or {}) if isinstance(payer.get("address"), dict) else {}
                            bill_country = (ship_addr.get("country_code") or payer_addr.get("country_code") or "")
                            bill_postcode = (ship_addr.get("postal_code") or payer_addr.get("postal_code") or "")
                            # Refund / dispute state when PayPal exposes it.
                            status_code = (tx.get("transaction_status") or "").upper()
                            is_refund = status_code in ("P", "RETURNED", "REFUNDED", "R") or amount_pence < 0
                            pm_type_val = tx.get("payment_method_type") or ("paypal" if email else "")
                            outcome = await _upsert_tx(db, "paypal", txn_id, {
                                "kind":                (tx.get("transaction_event_code") or "")[:40],
                                "status":              status_code,
                                "amount_pence":        amount_pence,
                                "currency":            (amount.get("currency_code") or "GBP").upper(),
                                "fee_pence":           fee_pence_abs,
                                "net_pence":           net_pence,
                                "description":        (tx.get("transaction_subject")
                                                       or tx.get("transaction_note")
                                                       or ship.get("name", "") or "")[:500],
                                "customer_hint":       (cust or email)[:200],
                                "payment_method_hint": pm_type_val[:120],
                                "source_ref":          (tx.get("invoice_id") or tx.get("custom_field") or "")[:120],
                                "payout_ref":          "",
                                "provider_created_at": created_at,
                                # Rich detail
                                "customer_name":       cust,
                                "customer_email":      email,
                                "customer_phone":      (payer.get("phone_number") or {}).get("national_number", "") if isinstance(payer.get("phone_number"), dict) else "",
                                "billing_country":     bill_country,
                                "billing_postcode":    bill_postcode,
                                "payment_method_type": pm_type_val,
                                "statement_descriptor": tx.get("bank_reference_id") or "",
                                "refunded":            is_refund,
                                "refund_amount_pence": abs(amount_pence) if is_refund else 0,
                                "raw": {
                                    "event_code":   tx.get("transaction_event_code"),
                                    "payer_email":  email,
                                    "protection":   tx.get("protection_eligibility"),
                                    "custom_field": tx.get("custom_field"),
                                    "invoice_id":   tx.get("invoice_id"),
                                },
                            })
                            counts[outcome] += 1
                        total_pages = int(body_json.get("total_pages") or 1)
                        if page >= total_pages or not details:
                            break
                        page += 1
                        if page > MAX_PAGES:
                            break
                    cur_from = chunk_end
            await db.commit()
            await _finish_run(db, run_id, "ok", counts)
            return {"provider": "paypal", "status": "ok", **counts}
        except Exception as exc:
            await _finish_run(db, run_id, "error", counts, error=str(exc))
            return {"provider": "paypal", "status": "error", "error": str(exc), **counts}


# ────────────────────────────── Endpoints ──────────────────────────────────

class _SyncIn(BaseModel):
    since: str | None = None
    until: str | None = None


class _SyncAllIn(BaseModel):
    days: int | None = None


@router.post("/transactions/backfill-accounts")
async def backfill_accounts(ctx: CurrentSpace) -> dict[str, Any]:
    """Link every orphan payment_transactions row to its provider's primary
    finance_account.

    Operator-triggered — no sync is performed, no external APIs are hit.
    Safe to call repeatedly: rows already linked are untouched.
    """
    _only_admin(ctx)
    per_provider: dict[str, int] = {}
    async with SessionLocal() as db:
        for provider in ("stripe", "sumup", "paypal"):
            per_provider[provider] = await _backfill_account_ids(db, provider)
    return {
        "linked": sum(per_provider.values()),
        "per_provider": per_provider,
    }


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


@router.post("/sync/paypal")
async def sync_paypal(ctx: CurrentSpace, body: _SyncIn) -> dict[str, Any]:
    _only_admin(ctx)
    async with SessionLocal() as db:
        since = await _cursor_from_last(db, "paypal", _parse_iso(body.since))
    return await _sync_paypal(since, _parse_iso(body.until), triggered_by=f"user:{ctx.user_email}")


async def _run_all(window_days: int | None, triggered_by: str) -> dict[str, Any]:
    out: dict[str, Any] = {"triggered_by": triggered_by, "results": []}
    for provider, runner in (("stripe", _sync_stripe), ("sumup", _sync_sumup), ("paypal", _sync_paypal)):
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


@router.get("/transactions/summary")
async def transactions_summary(
    ctx: CurrentSpace,
    provider: str = "",
    kind: str = "",
    status: str = "",
    account_id: str = "",
    since: str | None = None,
    until: str | None = None,
    search: str = "",
) -> dict[str, Any]:
    """Totals matching the same filters list_transactions uses. Used by the
    admin page to show how much is being lost to processor fees.

    Returns per-provider gross/fee/net pennies and an overall row. Money
    movements that are inherently negative from our POV (refunds, chargebacks)
    are counted into the respective buckets as-is so finance can see the
    whole picture.
    """
    _only_admin(ctx)
    where = ["1=1"]
    params: dict[str, Any] = {}
    if provider:
        if provider not in ("stripe", "sumup", "paypal"):
            raise HTTPException(status_code=400, detail="provider must be 'stripe', 'sumup' or 'paypal'")
        where.append("provider = :p")
        params["p"] = provider
    if kind:
        where.append("kind = :k")
        params["k"] = kind
    if status:
        where.append("status = :s")
        params["s"] = status
    if account_id:
        if account_id == "__unlinked__":
            where.append("account_id IS NULL")
        else:
            try:
                uuid.UUID(account_id)
            except (ValueError, TypeError) as exc:
                raise HTTPException(status_code=400, detail="account_id must be a UUID") from exc
            where.append("account_id = :aid")
            params["aid"] = account_id
    since_dt = _parse_iso(since)
    until_dt = _parse_iso(until)
    if since_dt:
        where.append("provider_created_at >= :sd")
        params["sd"] = since_dt
    if until_dt:
        where.append("provider_created_at <= :ud")
        params["ud"] = until_dt
    if search.strip():
        q = search.strip()
        where.append("""(
             LOWER(customer_name)  LIKE :q
          OR LOWER(customer_email) LIKE :q
          OR LOWER(customer_phone) LIKE :q
          OR LOWER(description)    LIKE :q
          OR LOWER(external_id)    LIKE :q
          OR LOWER(source_ref)     LIKE :q
          OR LOWER(payout_ref)     LIKE :q
          OR UPPER(card_last4)       = :q_up
          OR UPPER(billing_postcode) LIKE :q_up
        )""")
        params["q"] = f"%{q.lower()}%"
        params["q_up"] = q.upper().replace(" ", "")

    clause = " AND ".join(where)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT provider,
                   COUNT(*)                     AS tx_count,
                   SUM(amount_pence)            AS gross,
                   SUM(fee_pence)               AS fee,
                   SUM(net_pence)               AS net,
                   COALESCE(MIN(currency), 'GBP') AS currency
              FROM payment_transactions
             WHERE {clause}
             GROUP BY provider
             ORDER BY provider
        """), params)).mappings().all()

    def _bucket(r: Any) -> dict[str, Any]:
        return {
            "provider": r["provider"],
            "count":    int(r["tx_count"] or 0),
            "gross":    int(r["gross"] or 0),
            "fee":      int(r["fee"] or 0),
            "net":      int(r["net"] or 0),
            "currency": r["currency"] or "GBP",
        }

    buckets = [_bucket(r) for r in rows]
    total = {
        "count":    sum(b["count"] for b in buckets),
        "gross":    sum(b["gross"] for b in buckets),
        "fee":      sum(b["fee"]   for b in buckets),
        "net":      sum(b["net"]   for b in buckets),
        "currency": (buckets[0]["currency"] if buckets else "GBP"),
    }
    return {"providers": buckets, "total": total}


@router.get("/transactions/export.csv")
async def export_transactions_csv(
    ctx: CurrentSpace,
    provider: str = "",
    kind: str = "",
    status: str = "",
    account_id: str = "",
    since: str | None = None,
    until: str | None = None,
    search: str = "",
) -> Any:
    """CSV export using the same filter set as /transactions. Returns up to
    50 000 rows ordered newest-first — suitable for monthly/yearly reports."""
    _only_admin(ctx)
    import csv
    import io

    from fastapi.responses import StreamingResponse
    where = ["1=1"]
    params: dict[str, Any] = {}
    if provider:
        if provider not in ("stripe", "sumup", "paypal"):
            raise HTTPException(status_code=400, detail="provider must be 'stripe', 'sumup' or 'paypal'")
        where.append("pt.provider = :p")
        params["p"] = provider
    if kind:
        where.append("pt.kind = :k")
        params["k"] = kind
    if status:
        where.append("pt.status = :s")
        params["s"] = status
    if account_id:
        if account_id == "__unlinked__":
            where.append("pt.account_id IS NULL")
        else:
            try:
                uuid.UUID(account_id)
            except (ValueError, TypeError) as exc:
                raise HTTPException(status_code=400, detail="account_id must be a UUID") from exc
            where.append("pt.account_id = :aid")
            params["aid"] = account_id
    since_dt = _parse_iso(since)
    until_dt = _parse_iso(until)
    if since_dt:
        where.append("pt.provider_created_at >= :sd")
        params["sd"] = since_dt
    if until_dt:
        where.append("pt.provider_created_at <= :ud")
        params["ud"] = until_dt
    if search.strip():
        q = search.strip()
        where.append("""(
             LOWER(pt.customer_name)  LIKE :q
          OR LOWER(pt.customer_email) LIKE :q
          OR LOWER(pt.customer_phone) LIKE :q
          OR LOWER(pt.description)    LIKE :q
          OR LOWER(pt.external_id)    LIKE :q
          OR LOWER(pt.source_ref)     LIKE :q
          OR LOWER(pt.payout_ref)     LIKE :q
          OR UPPER(pt.card_last4)        = :q_up
          OR UPPER(pt.billing_postcode)  LIKE :q_up
        )""")
        params["q"] = f"%{q.lower()}%"
        params["q_up"] = q.upper().replace(" ", "")

    clause = " AND ".join(where)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT pt.provider_created_at, pt.provider, pt.external_id, pt.kind,
                   pt.status, pt.currency,
                   pt.amount_pence, pt.fee_pence, pt.net_pence,
                   fa.name          AS account_name,
                   pt.customer_name, pt.customer_email, pt.customer_phone,
                   pt.billing_country, pt.billing_postcode,
                   pt.card_brand, pt.card_last4,
                   pt.description, pt.source_ref, pt.payout_ref,
                   pt.refunded, pt.refund_amount_pence, pt.disputed,
                   pt.receipt_url, pt.statement_descriptor, pt.available_at,
                   d.gift_aid_eligible, d.gift_aid_amount::numeric AS gift_aid_amount,
                   d.purpose AS donation_purpose
              FROM payment_transactions pt
              LEFT JOIN finance_accounts fa ON fa.id = pt.account_id
              LEFT JOIN donations       d  ON d.deleted_at IS NULL
                                           AND (
                                             d.payment_ref = pt.external_id
                                             OR (pt.source_ref <> '' AND d.payment_ref = pt.source_ref)
                                           )
             WHERE {clause}
             ORDER BY pt.provider_created_at DESC
             LIMIT 50000
        """), params)).mappings().all()

    buf = io.StringIO()
    buf.write("﻿")  # UTF-8 BOM so Excel reads non-ASCII correctly
    w = csv.writer(buf)
    w.writerow([
        "date", "provider", "external_id", "kind", "status", "currency",
        "gross", "fee", "net", "account",
        "donor_name", "donor_email", "donor_phone",
        "billing_country", "billing_postcode",
        "card_brand", "card_last4",
        "description", "source_ref", "payout_ref",
        "refunded", "refund_amount", "disputed",
        "receipt_url", "statement_descriptor", "available_at",
        "gift_aid_eligible", "gift_aid_amount", "donation_purpose",
    ])
    for r in rows:
        dt = r["provider_created_at"]
        w.writerow([
            dt.strftime("%Y-%m-%d %H:%M:%S") if dt else "",
            r["provider"], r["external_id"], r["kind"], r["status"], r["currency"],
            f"{(r['amount_pence'] or 0) / 100:.2f}",
            f"{(r['fee_pence'] or 0) / 100:.2f}",
            f"{(r['net_pence'] or 0) / 100:.2f}",
            r["account_name"] or "",
            r["customer_name"] or "", r["customer_email"] or "", r["customer_phone"] or "",
            r["billing_country"] or "", r["billing_postcode"] or "",
            r["card_brand"] or "", r["card_last4"] or "",
            (r["description"] or "").replace("\n", " "),
            r["source_ref"] or "", r["payout_ref"] or "",
            "true" if r["refunded"] else "false",
            f"{(r['refund_amount_pence'] or 0) / 100:.2f}",
            "true" if r["disputed"] else "false",
            r["receipt_url"] or "", r["statement_descriptor"] or "",
            r["available_at"].isoformat() if r["available_at"] else "",
            "true" if r["gift_aid_eligible"] else "false",
            f"{float(r['gift_aid_amount'] or 0):.2f}",
            r["donation_purpose"] or "",
        ])

    fname_parts = ["transactions"]
    if provider:
        fname_parts.append(provider)
    if since:
        fname_parts.append(f"from-{since}")
    if until:
        fname_parts.append(f"to-{until}")
    fname = "-".join(fname_parts) + ".csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


_SORT_WHITELIST = {
    "date":        "pt.provider_created_at",
    "amount":      "pt.amount_pence",
    "net":         "pt.net_pence",
    "status":      "pt.status",
    "kind":        "pt.kind",
    "provider":    "pt.provider",
    "account":     "fa.name",
}


@router.get("/transactions")
async def list_transactions(
    ctx: CurrentSpace,
    provider: str = "",
    kind: str = "",
    status: str = "",
    account_id: str = "",
    since: str | None = None,
    until: str | None = None,
    search: str = "",
    limit: int = 100,
    offset: int = 0,
    sort: str = "date",
    order: str = "desc",
) -> dict[str, Any]:
    _only_admin(ctx)
    limit = max(1, min(limit, 1000))
    where = ["1=1"]
    params: dict[str, Any] = {"lim": limit, "off": max(0, offset)}
    if provider:
        if provider not in ("stripe", "sumup", "paypal"):
            raise HTTPException(status_code=400, detail="provider must be 'stripe', 'sumup' or 'paypal'")
        where.append("pt.provider = :p")
        params["p"] = provider
    if kind:
        where.append("pt.kind = :k")
        params["k"] = kind
    if status:
        where.append("pt.status = :s")
        params["s"] = status
    if account_id:
        if account_id == "__unlinked__":
            where.append("pt.account_id IS NULL")
        else:
            try:
                uuid.UUID(account_id)
            except (ValueError, TypeError) as exc:
                raise HTTPException(status_code=400, detail="account_id must be a UUID") from exc
            where.append("pt.account_id = :aid")
            params["aid"] = account_id
    since_dt = _parse_iso(since)
    until_dt = _parse_iso(until)
    if since_dt:
        where.append("pt.provider_created_at >= :sd")
        params["sd"] = since_dt
    if until_dt:
        where.append("pt.provider_created_at <= :ud")
        params["ud"] = until_dt
    if search.strip():
        # Case-insensitive match across donor identity + the common ref
        # fields. Postcode and last4 are exact (uppercased) so a 4-digit
        # search for a card number works without false positives.
        q = search.strip()
        where.append("""(
             LOWER(pt.customer_name)     LIKE :q
          OR LOWER(pt.customer_email)    LIKE :q
          OR LOWER(pt.customer_phone)    LIKE :q
          OR LOWER(pt.description)       LIKE :q
          OR LOWER(pt.external_id)       LIKE :q
          OR LOWER(pt.source_ref)        LIKE :q
          OR LOWER(pt.payout_ref)        LIKE :q
          OR LOWER(pt.statement_descriptor) LIKE :q
          OR UPPER(pt.card_last4)        = :q_up
          OR UPPER(pt.billing_postcode)  LIKE :q_up
        )""")
        params["q"] = f"%{q.lower()}%"
        params["q_up"] = q.upper().replace(" ", "")

    sort_col = _SORT_WHITELIST.get(sort.lower(), "pt.provider_created_at")
    sort_dir = "ASC" if order.lower() == "asc" else "DESC"

    clause = " AND ".join(where)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT pt.id, pt.provider, pt.external_id, pt.kind, pt.status,
                   pt.amount_pence, pt.currency, pt.fee_pence, pt.net_pence,
                   pt.description, pt.customer_hint, pt.payment_method_hint,
                   pt.source_ref, pt.payout_ref,
                   pt.provider_created_at, pt.synced_at,
                   pt.account_id::text AS account_id,
                   fa.name          AS account_name,
                   fa.account_type  AS account_type,
                   pt.customer_name, pt.customer_email, pt.customer_phone,
                   pt.billing_country, pt.billing_postcode,
                   pt.payment_method_type, pt.card_brand, pt.card_last4,
                   pt.card_country, pt.card_funding,
                   pt.receipt_url, pt.statement_descriptor, pt.available_at,
                   pt.refunded, pt.refund_amount_pence, pt.disputed,
                   d.id::text       AS donation_id,
                   COALESCE(d.gift_aid_eligible, false) AS gift_aid_eligible,
                   d.gift_aid_amount::numeric            AS gift_aid_amount,
                   d.purpose                             AS donation_purpose,
                   d.contact_id::text                    AS contact_id,
                   c.full_name                           AS contact_name,
                   c.email                               AS contact_email
              FROM payment_transactions pt
              LEFT JOIN finance_accounts fa ON fa.id = pt.account_id
              LEFT JOIN donations       d  ON d.deleted_at IS NULL
                                           AND (
                                             d.payment_ref = pt.external_id
                                             OR (pt.source_ref <> '' AND d.payment_ref = pt.source_ref)
                                           )
              LEFT JOIN contacts        c  ON c.id = d.contact_id
             WHERE {clause}
             ORDER BY {sort_col} {sort_dir} NULLS LAST, pt.provider_created_at DESC
             LIMIT :lim OFFSET :off
        """), params)).mappings().all()
        total = (await db.execute(text(f"""
            SELECT COUNT(*) FROM payment_transactions pt WHERE {clause}
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
                "account_id":           r["account_id"] or "",
                "account_name":         r["account_name"] or "",
                "account_type":         r["account_type"] or "",
                "donation_id":          r["donation_id"] or "",
                "gift_aid_eligible":    bool(r["gift_aid_eligible"]),
                "gift_aid_amount":      float(r["gift_aid_amount"] or 0),
                "donation_purpose":     r["donation_purpose"] or "",
                "contact_id":           r["contact_id"] or "",
                "contact_name":         r["contact_name"] or "",
                "contact_email":        r["contact_email"] or "",
                # Rich detail
                "customer_name":        r["customer_name"] or "",
                "customer_email":       r["customer_email"] or "",
                "customer_phone":       r["customer_phone"] or "",
                "billing_country":      r["billing_country"] or "",
                "billing_postcode":     r["billing_postcode"] or "",
                "payment_method_type":  r["payment_method_type"] or "",
                "card_brand":           r["card_brand"] or "",
                "card_last4":           r["card_last4"] or "",
                "card_country":         r["card_country"] or "",
                "card_funding":         r["card_funding"] or "",
                "receipt_url":          r["receipt_url"] or "",
                "statement_descriptor": r["statement_descriptor"] or "",
                "available_at":         _iso(r["available_at"]),
                "refunded":             bool(r["refunded"]),
                "refund_amount_pence":  int(r["refund_amount_pence"] or 0),
                "disputed":             bool(r["disputed"]),
            }
            for r in rows
        ],
    }


__all__ = ["router"]
