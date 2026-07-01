"""Background recovery — keeps the platform self-healing without anyone watching.

Two loops run inside the backend process, every 15 min:

1. SumUp reconcile sweep
   Scans donations with status = PENDING + payment_provider in (SUMUP, KIOSK)
   from the last 7 days, queries the SumUp /checkouts/{id} endpoint for the
   real status, and updates donations.status to COMPLETED / FAILED / CANCELLED
   accordingly. Idempotent — already-COMPLETED rows are ignored. This is the
   safety net behind the webhook write that lands status on the row directly.

2. system_alerts digest mailer
   Picks up unresolved CRITICAL + ERROR rows from system_alerts older than
   5 min (gives the cron-driven self-heal a chance to fix the problem first
   so we don't spam transient blips). Sends ONE consolidated email per loop
   iteration to the recipients in settings.MONITOR_ALERT_RECIPIENTS, marks
   the rows as digested (digested_at) so the next loop doesn't re-send.

Both loops swallow their own exceptions — a transient SumUp 5xx or SMTP
hiccup should not kill the entire backend startup task.
"""
from __future__ import annotations

import asyncio
import os
import smtplib
from datetime import UTC, datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

import httpx
import structlog
from sqlalchemy import text

from shital.core.fabrics.config import settings
from shital.core.fabrics.database import SessionLocal

logger = structlog.get_logger()

# Loop pacing — long enough that we don't hammer SumUp's API or SMTP, short
# enough that a stuck donation isn't visibly broken for more than ~15 min.
RECOVERY_INTERVAL_SECONDS = 15 * 60

# System alerts older than this without being acknowledged trigger an email.
# Buffer prevents the watchdog's 2-min restart cycle from emailing about a
# transient outage that's already self-healing.
ALERT_DIGEST_GRACE_SECONDS = 5 * 60


# ─────────────────────────────────────────────────────────────────────────────
# SumUp reconcile
# ─────────────────────────────────────────────────────────────────────────────

async def _sumup_reconcile_once(days: int = 14) -> dict[str, Any]:
    """Sweep PENDING SumUp donations and resolve their status from SumUp's API.

    Two passes (mirror of the /sumup/reconcile-pending route — they should
    behave identically since both serve the same recovery purpose):

      Pass 1: checkouts API (covers ≤ 24h PENDING — those checkouts still
              exist on SumUp's side).
      Pass 2: transactions API (covers > 24h PENDING — SumUp purges old
              un-paid checkouts but keeps every transaction forever).

    Default window 14 days so an outage stretching over a few days still
    auto-resolves on the next cron tick without anyone clicking Reconcile.
    """
    from shital.services.secrets_manager import SecretsManager

    access_token = await SecretsManager.get("SUMUP_ACCESS_TOKEN") or settings.SUMUP_ACCESS_TOKEN
    merchant_code = await SecretsManager.get("SUMUP_MERCHANT_CODE") or settings.SUMUP_MERCHANT_CODE
    if not access_token:
        return {"skipped": "sumup_not_configured"}

    summary: dict[str, Any] = {
        "scanned": 0, "completed": 0, "failed": 0,
        "still_pending": 0, "not_found": 0, "errors": 0,
        "matched_via_transactions_api": 0, "days_window": days,
    }
    async with SessionLocal() as db:
        pending_rows = (await db.execute(text("""
            SELECT id::text AS id, payment_ref, amount, reference, created_at
            FROM donations
            WHERE UPPER(COALESCE(status, '')) IN ('PENDING', '')
              AND UPPER(COALESCE(payment_provider, '')) IN ('SUMUP', 'KIOSK')
              AND deleted_at IS NULL
              AND created_at >= NOW() - (:days || ' days')::interval
        """), {"days": str(days)})).mappings().all()

        resolved_ids: set[str] = set()

        async with httpx.AsyncClient(timeout=15) as cx:
            # ── Pass 1: checkouts API ─────────────────────────────────────────
            for r in pending_rows:
                summary["scanned"] += 1
                checkout_id = r["payment_ref"] or ""
                if not checkout_id:
                    continue
                try:
                    resp = await cx.get(
                        f"https://api.sumup.com/v0.1/checkouts/{checkout_id}",
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                except Exception:  # noqa: BLE001
                    summary["errors"] += 1
                    continue
                if resp.status_code == 404:
                    continue  # will be retried in pass 2
                if resp.status_code >= 400:
                    summary["errors"] += 1
                    continue
                sumup_status = ((resp.json() or {}).get("status") or "").upper()
                if sumup_status == "PAID":
                    await db.execute(text("""
                        UPDATE donations SET status = 'COMPLETED', updated_at = NOW()
                        WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
                    """), {"id": r["id"]})
                    summary["completed"] += 1
                    resolved_ids.add(r["id"])
                elif sumup_status in {"FAILED", "EXPIRED", "CANCELLED", "CANCELED"}:
                    new_status = "FAILED" if sumup_status == "FAILED" else "CANCELLED"
                    await db.execute(text("""
                        UPDATE donations SET status = :st, updated_at = NOW()
                        WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
                    """), {"id": r["id"], "st": new_status})
                    summary["failed"] += 1
                    resolved_ids.add(r["id"])

            # ── Pass 2: transactions API ──────────────────────────────────────
            unresolved = [r for r in pending_rows if r["id"] not in resolved_ids]
            if merchant_code and unresolved:
                tx_index: dict[int, list[tuple[Any, str, str, str]]] = {}
                ref_index: dict[str, tuple[Any, str, str]] = {}
                oldest_ref = ""
                cutoff = datetime.now(UTC) - timedelta(days=days)
                for _ in range(20):
                    url = (f"https://api.sumup.com/v2.1/merchants/{merchant_code}/"
                           f"transactions/history?limit=100&order=descending")
                    if oldest_ref:
                        url += f"&oldest_ref={oldest_ref}"
                    try:
                        resp = await cx.get(url, headers={"Authorization": f"Bearer {access_token}"})
                    except Exception:  # noqa: BLE001
                        break
                    if resp.status_code >= 400:
                        break
                    data = resp.json() or {}
                    items = data.get("items") or data.get("data") or []
                    if not items:
                        break
                    page_oldest = None
                    for tx in items:
                        ts_raw = tx.get("timestamp") or tx.get("created_at") or ""
                        try:
                            ts_dt = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")) if ts_raw else None
                        except (ValueError, AttributeError):
                            ts_dt = None
                        page_oldest = ts_dt or page_oldest
                        if ts_dt and ts_dt < cutoff:
                            continue
                        amount_pence = int(round(float(tx.get("amount") or 0) * 100))
                        sumup_status_tx = (tx.get("status") or "").upper()
                        tx_code = tx.get("transaction_code") or tx.get("transaction_id") or ""
                        foreign_ref = (tx.get("foreign_transaction_id")
                                       or tx.get("checkout_reference") or "")
                        tx_index.setdefault(amount_pence, []).append(
                            (ts_dt, sumup_status_tx, tx_code, foreign_ref))
                        if foreign_ref:
                            ref_index[foreign_ref] = (ts_dt, sumup_status_tx, tx_code)
                    if page_oldest and page_oldest < cutoff:
                        break
                    next_ref = data.get("next_ref") or data.get("oldest_ref")
                    if not next_ref or next_ref == oldest_ref:
                        break
                    oldest_ref = next_ref

                for r in unresolved:
                    amount_pence = int(round(float(r["amount"]) * 100))
                    matched: tuple[Any, str, str] | None = None
                    if r["reference"] and r["reference"] in ref_index:
                        matched = ref_index[r["reference"]]
                    else:
                        for ts_dt, sumup_status_tx, tx_code, _fref in tx_index.get(amount_pence, []):
                            if not ts_dt or not r["created_at"]:
                                continue
                            if abs((ts_dt - r["created_at"]).total_seconds()) <= 600:
                                matched = (ts_dt, sumup_status_tx, tx_code)
                                break
                    if matched is None:
                        summary["not_found"] += 1
                        continue
                    _ts, tx_status, tx_code = matched
                    if tx_status in {"SUCCESSFUL", "PAID"}:
                        await db.execute(text("""
                            UPDATE donations SET status = 'COMPLETED',
                                payment_ref = CASE WHEN :code != '' THEN :code ELSE payment_ref END,
                                updated_at = NOW()
                            WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
                        """), {"id": r["id"], "code": tx_code})
                        summary["completed"] += 1
                        summary["matched_via_transactions_api"] += 1
                    elif tx_status in {"FAILED", "CANCELLED", "CANCELED", "UNSUCCESSFUL",
                                       "EXPIRED", "DECLINED", "REFUSED", "VOIDED"}:
                        new_status = "FAILED" if tx_status == "FAILED" else "CANCELLED"
                        await db.execute(text("""
                            UPDATE donations SET status = :st,
                                payment_ref = CASE WHEN :code != '' THEN :code ELSE payment_ref END,
                                updated_at = NOW()
                            WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
                        """), {"id": r["id"], "st": new_status, "code": tx_code})
                        summary["failed"] += 1
                        summary["matched_via_transactions_api"] += 1
                    else:
                        summary["still_pending"] += 1
        await db.commit()
    return summary


# ─────────────────────────────────────────────────────────────────────────────
# Alert digest mailer
# ─────────────────────────────────────────────────────────────────────────────

def _send_smtp(to: str, subject: str, html: str) -> None:
    """Inline SMTP send (Office 365). Raises on failure so the caller can log
    and decide whether to mark the alerts as digested."""
    from_email = settings.OFFICE365_EMAIL or "noreply@shital.org.uk"
    password = settings.OFFICE365_PASSWORD
    if not password:
        raise RuntimeError("OFFICE365_PASSWORD not configured")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP("smtp.office365.com", 587, timeout=20) as srv:
        srv.ehlo()
        srv.starttls()
        srv.login(from_email, password)
        srv.sendmail(from_email, [r.strip() for r in to.split(",") if r.strip()], msg.as_string())


async def _alert_digest_once() -> dict[str, Any]:
    """Email a digest of unresolved CRITICAL/ERROR alerts to the configured
    recipients. Marks digested rows so we don't repeat. Returns counts."""
    recipients = os.environ.get("MONITOR_ALERT_RECIPIENTS", "").strip() \
        or "rajk@shirdisai.org.uk,it@shirdisai.org.uk"
    summary: dict[str, Any] = {"alerts": 0, "emailed": False, "skipped": ""}

    async with SessionLocal() as db:
        # Ensure the digested_at column exists (idempotent — runs once per backend boot
        # is fine; ALTER TABLE IF NOT EXISTS guards re-application).
        await db.execute(text("""
            ALTER TABLE system_alerts ADD COLUMN IF NOT EXISTS digested_at TIMESTAMPTZ
        """))
        await db.commit()

        rows = (await db.execute(text("""
            SELECT id::text AS id, host, check_name, severity, status, message, detail,
                   heal_attempts, heal_outcome, created_at
            FROM system_alerts
            WHERE UPPER(COALESCE(severity, '')) IN ('CRITICAL', 'ERROR', 'HIGH')
              AND COALESCE(status, '') NOT IN ('ok', 'OK')
              AND resolved_at IS NULL
              AND digested_at IS NULL
              AND created_at < NOW() - (:grace || ' seconds')::interval
            ORDER BY created_at DESC
            LIMIT 50
        """), {"grace": str(ALERT_DIGEST_GRACE_SECONDS)})).mappings().all()

        summary["alerts"] = len(rows)
        if not rows:
            return summary

        # Build a compact HTML table
        rows_html = "".join(
            f"<tr>"
            f"<td style='padding:6px 12px'>{r['created_at']}</td>"
            f"<td style='padding:6px 12px'><b>{r['severity']}</b></td>"
            f"<td style='padding:6px 12px'>{r['host']}</td>"
            f"<td style='padding:6px 12px'>{r['check_name']}</td>"
            f"<td style='padding:6px 12px'>{(r['message'] or '')[:200]}</td>"
            f"<td style='padding:6px 12px'>{r['heal_outcome'] or '—'}</td>"
            f"</tr>"
            for r in rows
        )
        html = f"""
        <p>{len(rows)} unresolved alert(s) older than {ALERT_DIGEST_GRACE_SECONDS // 60} min:</p>
        <table border='1' cellpadding='4' cellspacing='0' style='border-collapse:collapse;font-family:sans-serif;font-size:13px'>
          <tr style='background:#f0f0f0'>
            <th>When</th><th>Severity</th><th>Host</th><th>Check</th><th>Message</th><th>Heal</th>
          </tr>
          {rows_html}
        </table>
        <p style='color:#666;font-size:12px'>
          Sent by the backend recovery loop. Self-heal has already attempted to fix
          these — they're surfaced because automatic recovery did not succeed within
          the grace window. Acknowledge in Admin → System Ops → Alerts.
        </p>
        """

        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                _send_smtp,
                recipients,
                f"[ShitalEco] {len(rows)} unresolved alert(s)",
                html,
            )
            summary["emailed"] = True
        except Exception as exc:  # noqa: BLE001
            logger.error("alert_digest_send_failed", error=str(exc))
            summary["skipped"] = f"smtp_error: {exc}"[:200]
            return summary

        # Mark these rows so we don't email them again
        await db.execute(text("""
            UPDATE system_alerts SET digested_at = NOW()
            WHERE id::text = ANY(:ids)
        """), {"ids": [r["id"] for r in rows]})
        await db.commit()
    return summary


# ─────────────────────────────────────────────────────────────────────────────
# Daily SumUp digest — runs once per day, posts yesterday's reconciled
# transactions to the trustees email so they have a "yesterday's takings"
# summary without having to open the dashboard.
# ─────────────────────────────────────────────────────────────────────────────

# Run time in UTC. 23:30 UTC = 00:30 BST in summer / 23:30 GMT in winter —
# either way, the previous calendar day's transactions are all settled.
DAILY_DIGEST_HOUR_UTC   = 23
DAILY_DIGEST_MINUTE_UTC = 30

# State file so a backend restart mid-day doesn't re-send today's digest.
DAILY_DIGEST_STATE_FILE = "/tmp/shital-daily-sumup-digest.state"


async def _sumup_daily_digest(target_date: datetime | None = None) -> dict[str, Any]:
    """Fetch every SumUp transaction for the target calendar day (UTC),
    cross-check against the donations table, email a summary.

    If target_date is None, defaults to the day BEFORE today (UTC) — the
    "yesterday" semantics that make daily-digest natural.

    Output: stats dict for logging."""
    from shital.services.secrets_manager import SecretsManager

    if target_date is None:
        target_date = (datetime.now(UTC) - timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0)
    day_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end   = day_start + timedelta(days=1)

    access_token = await SecretsManager.get("SUMUP_ACCESS_TOKEN") or settings.SUMUP_ACCESS_TOKEN
    merchant_code = await SecretsManager.get("SUMUP_MERCHANT_CODE") or settings.SUMUP_MERCHANT_CODE
    if not access_token or not merchant_code:
        return {"skipped": "sumup_not_configured"}

    # ── 1. Pull all SumUp transactions for the day ──────────────────────────
    txs: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=15) as cx:
        oldest_ref = ""
        for _ in range(20):  # safety cap → up to 2000 transactions
            url = (f"https://api.sumup.com/v2.1/merchants/{merchant_code}/"
                   f"transactions/history?limit=100&order=descending")
            if oldest_ref:
                url += f"&oldest_ref={oldest_ref}"
            try:
                resp = await cx.get(url, headers={"Authorization": f"Bearer {access_token}"})
            except Exception as exc:  # noqa: BLE001
                return {"error": f"sumup_api_failed: {exc}"[:200]}
            if resp.status_code >= 400:
                return {"error": f"sumup_http_{resp.status_code}", "body": resp.text[:200]}
            data = resp.json() or {}
            items = data.get("items") or data.get("data") or []
            if not items:
                break
            page_oldest = None
            for tx in items:
                ts_raw = tx.get("timestamp") or tx.get("created_at") or ""
                try:
                    ts_dt = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")) if ts_raw else None
                except (ValueError, AttributeError):
                    ts_dt = None
                if not ts_dt:
                    continue
                page_oldest = ts_dt
                if ts_dt >= day_end:
                    continue  # newer than our window — keep paging
                if ts_dt < day_start:
                    # We've paged into the day before — stop entirely
                    page_oldest = ts_dt
                    break
                tx["_ts_dt"] = ts_dt
                txs.append(tx)
            if page_oldest and page_oldest < day_start:
                break
            next_ref = data.get("next_ref") or data.get("oldest_ref")
            if not next_ref or next_ref == oldest_ref:
                break
            oldest_ref = next_ref

    # ── 2. Cross-check against our donations table ──────────────────────────
    completed_count = 0
    completed_gross = 0.0
    failed_count    = 0
    failed_gross    = 0.0
    matched_in_db   = 0
    missing_in_db   = 0
    discrepancies: list[str] = []
    tx_rows_html:  list[str] = []

    async with SessionLocal() as db:
        for tx in sorted(txs, key=lambda t: t["_ts_dt"]):
            amount = float(tx.get("amount") or 0)
            sumup_status_tx = (tx.get("status") or "").upper()
            tx_code = tx.get("transaction_code") or tx.get("transaction_id") or ""
            card_type = (tx.get("card", {}) or {}).get("type", "") or tx.get("payment_type", "")
            ts_dt = tx["_ts_dt"]

            if sumup_status_tx in {"SUCCESSFUL", "PAID"}:
                completed_count += 1
                completed_gross += amount
                badge_color = "#16a34a"
                badge_text = "PAID"
            else:
                failed_count += 1
                failed_gross += amount
                badge_color = "#dc2626"
                badge_text = sumup_status_tx or "FAILED"

            # Try to find matching donation by transaction_code or amount+time
            row = (await db.execute(text("""
                SELECT id::text AS id, status, payment_ref
                FROM donations
                WHERE deleted_at IS NULL
                  AND UPPER(COALESCE(payment_provider, '')) IN ('SUMUP', 'KIOSK')
                  AND created_at BETWEEN :start AND :end
                  AND (payment_ref = :code OR ABS(EXTRACT(EPOCH FROM (created_at - :ts))) < 600)
                  AND ABS(amount - :amount) < 0.01
                ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - :ts))) ASC
                LIMIT 1
            """), {"code": tx_code, "ts": ts_dt, "amount": amount,
                   "start": day_start - timedelta(hours=2),
                   "end":   day_end + timedelta(hours=2)})).mappings().first()

            if row:
                matched_in_db += 1
                db_status = (row["status"] or "").upper()
                expected = "COMPLETED" if sumup_status_tx in {"SUCCESSFUL", "PAID"} else ("FAILED" if sumup_status_tx == "FAILED" else "CANCELLED")
                if db_status != expected:
                    discrepancies.append(
                        f"{tx_code} £{amount:.2f}: SumUp says {sumup_status_tx} but our DB says {db_status} (donation id {row['id'][:8]})"
                    )
            else:
                missing_in_db += 1
                discrepancies.append(
                    f"{tx_code} £{amount:.2f} at {ts_dt.strftime('%H:%M')}: no matching donation row in our DB"
                )

            tx_rows_html.append(
                f"<tr>"
                f"<td style='padding:4px 10px;border-bottom:1px solid #eee'>{ts_dt.strftime('%H:%M')}</td>"
                f"<td style='padding:4px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px'>{tx_code}</td>"
                f"<td style='padding:4px 10px;border-bottom:1px solid #eee'>{card_type}</td>"
                f"<td style='padding:4px 10px;border-bottom:1px solid #eee;text-align:right'>£{amount:.2f}</td>"
                f"<td style='padding:4px 10px;border-bottom:1px solid #eee'><span style='background:{badge_color};color:white;padding:1px 6px;border-radius:4px;font-size:11px'>{badge_text}</span></td>"
                f"</tr>"
            )

    # ── 3. Build the HTML digest ────────────────────────────────────────────
    discrepancies_html = ""
    if discrepancies:
        discrepancies_html = (
            "<h3 style='color:#dc2626;margin-top:24px'>⚠ Discrepancies — need attention</h3>"
            "<ul style='font-size:13px'>" +
            "".join(f"<li>{d}</li>" for d in discrepancies[:50]) +
            "</ul>"
        )

    html = f"""
    <div style='font-family:sans-serif;max-width:760px'>
      <h2>SumUp daily report — {day_start.strftime('%a %d %b %Y')}</h2>
      <p style='color:#666'>Merchant {merchant_code} · {len(txs)} transactions</p>
      <table style='border-collapse:collapse;margin:12px 0'>
        <tr style='background:#f0f0f0'>
          <td style='padding:8px 14px'><b>Paid (gross)</b></td>
          <td style='padding:8px 14px;text-align:right;color:#16a34a;font-weight:bold'>£{completed_gross:.2f} ({completed_count} txs)</td>
        </tr>
        <tr>
          <td style='padding:8px 14px'><b>Failed / Unsuccessful</b></td>
          <td style='padding:8px 14px;text-align:right;color:#dc2626;font-weight:bold'>£{failed_gross:.2f} ({failed_count} txs)</td>
        </tr>
        <tr style='background:#f0f0f0'>
          <td style='padding:8px 14px'><b>Matched in donations DB</b></td>
          <td style='padding:8px 14px;text-align:right'>{matched_in_db} / {len(txs)}</td>
        </tr>
        <tr>
          <td style='padding:8px 14px'><b>Missing from donations DB</b></td>
          <td style='padding:8px 14px;text-align:right;{"color:#dc2626;font-weight:bold" if missing_in_db else ""}'>{missing_in_db}</td>
        </tr>
      </table>

      {discrepancies_html}

      <h3 style='margin-top:24px'>All transactions</h3>
      <table style='border-collapse:collapse;font-size:13px;width:100%'>
        <tr style='background:#f0f0f0;text-align:left'>
          <th style='padding:6px 10px'>Time</th>
          <th style='padding:6px 10px'>Code</th>
          <th style='padding:6px 10px'>Card</th>
          <th style='padding:6px 10px;text-align:right'>Amount</th>
          <th style='padding:6px 10px'>Status</th>
        </tr>
        {''.join(tx_rows_html)}
      </table>

      <p style='color:#999;font-size:11px;margin-top:24px'>
        Generated by the backend daily-digest task. Reconciliation against
        the donations table is automatic — discrepancies above are the only
        items that need a human to look at.
      </p>
    </div>
    """

    recipients = os.environ.get("MONITOR_ALERT_RECIPIENTS", "").strip() \
        or "rajk@shirdisai.org.uk,it@shirdisai.org.uk,gtrustees@shirdisai.org.uk"
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            _send_smtp,
            recipients,
            f"[ShitalEco] SumUp daily report — {day_start.strftime('%a %d %b')} — £{completed_gross:.2f} paid, {failed_count} failed",
            html,
        )
        emailed = True
    except Exception as exc:  # noqa: BLE001
        logger.error("daily_sumup_digest_send_failed", error=str(exc))
        emailed = False

    return {
        "date": day_start.strftime("%Y-%m-%d"),
        "transactions": len(txs),
        "completed": completed_count, "completed_gross": round(completed_gross, 2),
        "failed":    failed_count,    "failed_gross":    round(failed_gross, 2),
        "matched_in_db": matched_in_db, "missing_in_db": missing_in_db,
        "discrepancies": len(discrepancies),
        "emailed": emailed,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Loop entry point — wired into main.py lifespan
# ─────────────────────────────────────────────────────────────────────────────

async def daily_digest_loop() -> None:
    """Separate loop that wakes once per day at DAILY_DIGEST_HOUR_UTC:MINUTE.
    Idempotent via state file — re-sending the same day's digest is blocked
    so a backend restart mid-day doesn't double-mail trustees."""
    # Initial 5-min delay so we don't fire seconds after a deploy.
    await asyncio.sleep(300)
    while True:
        now = datetime.now(UTC)
        target = now.replace(hour=DAILY_DIGEST_HOUR_UTC,
                             minute=DAILY_DIGEST_MINUTE_UTC,
                             second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        sleep_secs = max(60, int((target - now).total_seconds()))
        logger.info("daily_digest_scheduled", at=target.isoformat(), sleep_seconds=sleep_secs)
        await asyncio.sleep(sleep_secs)

        # Idempotency: only send each calendar day once
        today_key = datetime.now(UTC).strftime("%Y-%m-%d")
        already_sent = ""
        try:
            with open(DAILY_DIGEST_STATE_FILE) as f:
                already_sent = f.read().strip()
        except OSError:
            pass
        if already_sent == today_key:
            logger.info("daily_digest_skipped_already_sent_today", date=today_key)
            continue

        try:
            result = await _sumup_daily_digest()
            logger.info("daily_sumup_digest", result=result)
            with open(DAILY_DIGEST_STATE_FILE, "w") as f:
                f.write(today_key)
        except Exception as exc:  # noqa: BLE001
            logger.error("daily_sumup_digest_failed", error=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# Stripe account-health check  (15-Jun incident: account silently blocked from
# live charges → every Terminal tap declined at confirm, found out hours later.)
# ─────────────────────────────────────────────────────────────────────────────

async def _stripe_account_health_once() -> dict[str, Any]:
    """Ask Stripe whether the account can actually take live card charges, and
    raise/clear a system_alerts row accordingly. The digest mailer turns an open
    CRITICAL alert into an email to MONITOR_ALERT_RECIPIENTS, so a block pages ops
    within one loop iteration instead of hours. Reuses the same system_alerts →
    email path that infra/monitor.sh uses; auto-resolves when charges return.

    The stripe SDK is sync, so the blocking retrieve runs in a worker thread to
    avoid stalling the event loop.
    """
    import uuid as _uuid

    from shital.services.secrets_manager import SecretsManager

    api_key = await SecretsManager.get("STRIPE_SECRET_KEY") or settings.STRIPE_SECRET_KEY
    if not api_key:
        return {"skipped": "stripe_not_configured"}

    def _retrieve() -> dict[str, Any]:
        import stripe
        stripe.api_key = api_key
        acct = stripe.Account.retrieve()
        caps = dict(getattr(acct, "capabilities", {}) or {})
        reqs = dict(getattr(acct, "requirements", {}) or {})
        return {
            "charges_enabled": bool(getattr(acct, "charges_enabled", False)),
            "payouts_enabled": bool(getattr(acct, "payouts_enabled", False)),
            # 'active' once the account can take in-person card payments
            "card_present": (caps.get("card_present_payments")
                             or caps.get("card_payments") or ""),
            "disabled_reason": reqs.get("disabled_reason") or "",
            "currently_due": list(reqs.get("currently_due") or []),
        }

    try:
        info = await asyncio.to_thread(_retrieve)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}

    cp = (info["card_present"] or "").lower()
    # Healthy = can take charges AND (card-present active, or capability not
    # reported at all — then we trust charges_enabled alone).
    healthy = info["charges_enabled"] and cp in ("active", "")

    host, check = "stripe", "stripe_live_charges"
    async with SessionLocal() as db:
        if healthy:
            await db.execute(text("""
                UPDATE system_alerts SET resolved_at = NOW()
                WHERE host = :h AND check_name = :ck
                  AND resolved_at IS NULL AND status <> 'ok'
            """), {"h": host, "ck": check})
            await db.commit()
            return {"healthy": True, **info}

        # Unhealthy — raise exactly ONE open alert per episode (don't re-insert
        # while one is still open; the digest mailer de-dups sending via digested_at).
        existing = (await db.execute(text("""
            SELECT 1 FROM system_alerts
            WHERE host = :h AND check_name = :ck
              AND resolved_at IS NULL AND status <> 'ok'
            LIMIT 1
        """), {"h": host, "ck": check})).first()
        if existing:
            return {"healthy": False, "alert": "already_open", **info}

        due = ", ".join(info["currently_due"][:8]) or "—"
        msg = "Stripe CANNOT take live card donations — every card tap is being declined."
        detail = (
            f"charges_enabled={info['charges_enabled']}, "
            f"card_present_capability={cp or 'n/a'}, "
            f"disabled_reason={info['disabled_reason'] or 'n/a'}. "
            f"Requirements due: {due}. "
            f"FIX: complete account activation at "
            f"https://dashboard.stripe.com/account/onboarding"
        )
        await db.execute(text("""
            INSERT INTO system_alerts (id, host, check_name, severity, status, message, detail)
            VALUES (CAST(:id AS UUID), :h, :ck, 'critical', 'fail', :m, :d)
        """), {"id": str(_uuid.uuid4()), "h": host, "ck": check, "m": msg, "d": detail})
        await db.commit()
        logger.error("stripe_account_blocked", **info)
        return {"healthy": False, "alert": "raised", **info}


# ─────────────────────────────────────────────────────────────────────────────
# Stripe reconcile  (Stripe Terminal has NO webhook here, so this sweep is the
# ONLY thing that moves a Stripe donation off PENDING — the safety net SumUp
# already has. Captures real fee/net on success + decline reason on failure.)
# ─────────────────────────────────────────────────────────────────────────────

async def _stripe_reconcile_once(days: int = 14) -> dict[str, Any]:
    """Resolve PENDING Stripe Terminal donations from Stripe (source of truth).
    Mirrors _sumup_reconcile_once. Matches BOTH 'STRIPE' and 'STRIPE_TERMINAL'
    (the DB stores 'STRIPE_TERMINAL'). Idempotent: every UPDATE is guarded by
    `status IN ('PENDING','')` so it never clobbers an already-resolved row."""
    from shital.services.secrets_manager import SecretsManager

    api_key = await SecretsManager.get("STRIPE_SECRET_KEY") or settings.STRIPE_SECRET_KEY
    if not api_key:
        return {"skipped": "stripe_not_configured"}

    summary: dict[str, Any] = {
        "scanned": 0, "completed": 0, "failed": 0, "cancelled": 0,
        "still_pending": 0, "errors": 0, "no_ref": 0, "days_window": days,
    }

    def _retrieve_pi(pi_id: str) -> dict[str, Any]:
        import stripe
        stripe.api_key = api_key
        pi = stripe.PaymentIntent.retrieve(pi_id, expand=["latest_charge.balance_transaction"])
        out: dict[str, Any] = {"status": (pi.get("status") or ""),
                               "fee": None, "net": None, "card_type": None,
                               "err_code": None, "err_msg": None}
        lpe = pi.get("last_payment_error") or {}
        if lpe:
            out["err_code"] = (lpe.get("decline_code") or lpe.get("code") or "")[:60] or None
            out["err_msg"] = (lpe.get("message") or "")[:500] or None
        ch = pi.get("latest_charge")
        if isinstance(ch, dict):
            bt = ch.get("balance_transaction")
            if isinstance(bt, dict):
                if bt.get("fee") is not None:
                    out["fee"] = round(int(bt["fee"]) / 100, 2)
                if bt.get("net") is not None:
                    out["net"] = round(int(bt["net"]) / 100, 2)
            pmd = ch.get("payment_method_details") or {}
            card = pmd.get("card_present") or pmd.get("card") or {}
            if isinstance(card, dict) and card.get("brand"):
                out["card_type"] = str(card["brand"]).upper()[:30]
            if not out["err_msg"] and ch.get("failure_message"):
                out["err_code"] = (ch.get("failure_code") or "")[:60] or None
                out["err_msg"] = (ch.get("failure_message") or "")[:500] or None
        return out

    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text AS id, payment_ref, created_at
            FROM donations
            WHERE UPPER(COALESCE(status, '')) IN ('PENDING', '')
              AND UPPER(COALESCE(payment_provider, '')) IN ('STRIPE', 'STRIPE_TERMINAL')
              AND deleted_at IS NULL
              AND created_at >= NOW() - (:days || ' days')::interval
        """), {"days": str(days)})).mappings().all()

        for r in rows:
            summary["scanned"] += 1
            pi_id = (r["payment_ref"] or "").strip()
            if not pi_id.startswith("pi_"):
                summary["no_ref"] += 1
                continue
            try:
                info = await asyncio.to_thread(_retrieve_pi, pi_id)
            except Exception:  # noqa: BLE001
                summary["errors"] += 1
                continue
            st = (info["status"] or "").lower()
            params = {"id": r["id"], "fee": info["fee"], "net": info["net"],
                      "ct": info["card_type"], "ec": info["err_code"], "em": info["err_msg"]}
            if st == "succeeded":
                await db.execute(text("""
                    UPDATE donations SET status = 'COMPLETED',
                        actual_fee_amount = COALESCE(:fee, actual_fee_amount),
                        actual_net_amount = COALESCE(:net, actual_net_amount),
                        settled_at = CASE WHEN :net IS NOT NULL THEN NOW() ELSE settled_at END,
                        card_type  = COALESCE(:ct, card_type),
                        updated_at = NOW()
                    WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
                      AND UPPER(COALESCE(status, '')) IN ('PENDING', '')
                """), params)
                summary["completed"] += 1
            elif st in ("canceled", "requires_payment_method", "requires_confirmation", "requires_action"):
                # No capture. Only resolve if >15 min old so an in-progress tap
                # (kiosk session is 120s) is never cancelled mid-flight. A genuine
                # decline carries last_payment_error → FAILED; otherwise abandoned
                # → CANCELLED. A later retry is always a NEW pi_, so this is safe.
                age = datetime.now(UTC) - r["created_at"]
                if age <= timedelta(minutes=15) and st != "canceled":
                    summary["still_pending"] += 1
                    continue
                new_status = "FAILED" if info["err_msg"] else "CANCELLED"
                await db.execute(text("""
                    UPDATE donations SET status = :st,
                        last_failure_code    = COALESCE(:ec, last_failure_code),
                        last_failure_message = COALESCE(:em, last_failure_message),
                        card_type  = COALESCE(:ct, card_type),
                        updated_at = NOW()
                    WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
                      AND UPPER(COALESCE(status, '')) IN ('PENDING', '')
                """), {**params, "st": new_status})
                summary["failed" if new_status == "FAILED" else "cancelled"] += 1
            else:  # processing / unknown → leave for the next pass
                summary["still_pending"] += 1
        await db.commit()
    return summary


# ─────────────────────────────────────────────────────────────────────────────
# PayPal monthly-giving reconcile (production sync — PayPal is source of truth)
# ─────────────────────────────────────────────────────────────────────────────

_PAYPAL_SUB_STATUS_MAP = {
    "ACTIVE": "ACTIVE",
    "APPROVAL_PENDING": "PENDING_APPROVAL",
    "APPROVED": "PENDING_APPROVAL",
    "SUSPENDED": "SUSPENDED",
    "CANCELLED": "CANCELLED",
    "EXPIRED": "EXPIRED",
}


async def _paypal_token_and_base() -> tuple[str | None, str]:
    """Return (access_token, api_base). token is None when unconfigured."""
    from shital.core.fabrics.secrets import SecretsManager
    client_id = await SecretsManager.get("PAYPAL_CLIENT_ID") or ""
    secret    = await SecretsManager.get("PAYPAL_CLIENT_SECRET") or ""
    env       = await SecretsManager.get("PAYPAL_ENV") or "live"
    base = "https://api-m.paypal.com" if env == "live" else "https://api-m.sandbox.paypal.com"
    if not client_id or not secret:
        return None, base
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{base}/v1/oauth2/token", auth=(client_id, secret),
                             data={"grant_type": "client_credentials"})
            r.raise_for_status()
            return r.json()["access_token"], base
    except Exception as exc:  # noqa: BLE001
        logger.warning("paypal_token_failed", error=str(exc))
        return None, base


async def _paypal_reconcile_once(days: int = 35) -> dict[str, Any]:
    """Reconcile monthly-giving subscriptions against PayPal (source of truth).

    Two passes, both idempotent:
      1. STATUS — for every subscription row that is not in a terminal state,
         GET the subscription from PayPal and map APPROVAL_PENDING/APPROVED →
         PENDING_APPROVAL, ACTIVE → ACTIVE, CANCELLED/EXPIRED/SUSPENDED likewise.
         This unsticks rows that never received the BILLING webhook.
      2. PAYMENTS — for every ACTIVE subscription, pull its PayPal transactions
         for the window and record any captured payment not already present in
         `donations` (matched by payment_ref = the PayPal transaction id), so
         the books + Gift Aid reflect money that actually moved.

    Safe to run daily. Returns a summary dict.
    """
    token, base = await _paypal_token_and_base()
    if not token:
        return {"skipped": "paypal_not_configured"}

    summary: dict[str, Any] = {
        "scanned": 0, "status_updated": 0, "activated": 0, "cancelled": 0,
        "payments_recorded": 0, "errors": 0, "days_window": days,
        "orphans_expired": 0, "donor_backfilled": 0,
    }
    hdrs = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    now = datetime.now(UTC)
    start = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    end = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    # 0) Reap orphaned audit rows — PENDING_APPROVAL rows with NO PayPal id are
    #    the stranded halves of the old /monthly/ approve-duplicates-the-row bug.
    #    They can never activate (no id to check), so mark old ones EXPIRED so the
    #    admin list stops showing phantom "pending" donors. Recent ones are left
    #    alone in case an approve is still in flight.
    async with SessionLocal() as db:
        reaped = await db.execute(text("""
            UPDATE recurring_giving_subscriptions
            SET status = 'EXPIRED', updated_at = NOW()
            WHERE status = 'PENDING_APPROVAL'
              AND (paypal_subscription_id IS NULL OR paypal_subscription_id = '')
              AND created_at < NOW() - INTERVAL '2 days'
        """))
        await db.commit()
        summary["orphans_expired"] = reaped.rowcount or 0

    # 1) Pull non-terminal subscriptions with a PayPal id.
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text AS id, paypal_subscription_id AS sub_id,
                   UPPER(COALESCE(status,'')) AS status, branch_id, amount,
                   COALESCE(gift_aid_declared, false) AS ga,
                   COALESCE(donor_name,'') AS donor_name
            FROM recurring_giving_subscriptions
            WHERE paypal_subscription_id IS NOT NULL
              AND paypal_subscription_id <> ''
              AND UPPER(COALESCE(status,'')) NOT IN ('CANCELLED','EXPIRED')
              AND created_at >= NOW() - (:days || ' days')::interval
        """), {"days": str(days)})).mappings().all()

    async with httpx.AsyncClient(timeout=20) as c:
        for r in rows:
            summary["scanned"] += 1
            sub_id = r["sub_id"]
            try:
                sub = await c.get(f"{base}/v1/billing/subscriptions/{sub_id}", headers=hdrs)
                if sub.status_code == 404:
                    # PayPal doesn't know this id — abandoned before it was really
                    # created, or an unverified client id was stored. Reap old ones
                    # so they stop showing as "pending" forever.
                    async with SessionLocal() as db:
                        await db.execute(text("""
                            UPDATE recurring_giving_subscriptions
                            SET status = 'EXPIRED', updated_at = NOW()
                            WHERE id = CAST(:id AS UUID)
                              AND UPPER(COALESCE(status,'')) NOT IN ('ACTIVE','CANCELLED','EXPIRED')
                              AND created_at < NOW() - INTERVAL '1 day'
                        """), {"id": r["id"]})
                        await db.commit()
                    continue
                sub.raise_for_status()
                sub_json = sub.json()
                pp_status = (sub_json.get("status") or "").upper()
                mapped = _PAYPAL_SUB_STATUS_MAP.get(pp_status)

                # Backfill donor name/email from PayPal's subscriber block when we
                # don't have them (the simple /monthly/ page collects only amount).
                if not (r.get("donor_name") or "").strip():
                    _subr = sub_json.get("subscriber") or {}
                    _nm = _subr.get("name") or {}
                    _first = (_nm.get("given_name") or "").strip()
                    _surname = (_nm.get("surname") or "").strip()
                    _email = (_subr.get("email_address") or "").strip()
                    _full = f"{_first} {_surname}".strip()
                    if _full or _email:
                        async with SessionLocal() as db:
                            await db.execute(text("""
                                UPDATE recurring_giving_subscriptions
                                SET donor_name       = COALESCE(NULLIF(:name,''), donor_name),
                                    donor_first_name = COALESCE(NULLIF(:first,''), donor_first_name),
                                    donor_surname    = COALESCE(NULLIF(:surname,''), donor_surname),
                                    donor_email      = COALESCE(NULLIF(:email,''), donor_email),
                                    updated_at       = NOW()
                                WHERE id = CAST(:id AS UUID)
                            """), {"name": _full, "first": _first, "surname": _surname,
                                   "email": _email, "id": r["id"]})
                            await db.commit()
                        summary["donor_backfilled"] += 1
                if mapped and mapped != r["status"]:
                    async with SessionLocal() as db:
                        await db.execute(text("""
                            UPDATE recurring_giving_subscriptions
                            SET status = :st, updated_at = NOW()
                            WHERE id = CAST(:id AS UUID)
                        """), {"st": mapped, "id": r["id"]})
                        await db.commit()
                    summary["status_updated"] += 1
                    if mapped == "ACTIVE":
                        summary["activated"] += 1
                    elif mapped in ("CANCELLED", "EXPIRED"):
                        summary["cancelled"] += 1

                # 2) Payments — only for ACTIVE subs.
                if (mapped or r["status"]) == "ACTIVE":
                    txns = await c.get(
                        f"{base}/v1/billing/subscriptions/{sub_id}/transactions"
                        f"?start_time={start}&end_time={end}", headers=hdrs)
                    if not txns.is_success:
                        continue
                    for t in (txns.json().get("transactions") or []):
                        if (t.get("status") or "").upper() != "COMPLETED":
                            continue
                        txn_id = t.get("id") or ""
                        amt = (t.get("amount_with_breakdown") or {}).get("gross_amount") or {}
                        value = float(amt.get("value") or r["amount"] or 0)
                        if not txn_id or value <= 0:
                            continue
                        async with SessionLocal() as db:
                            exists = (await db.execute(text(
                                "SELECT 1 FROM donations WHERE payment_ref = :ref LIMIT 1"
                            ), {"ref": txn_id})).first()
                            if exists:
                                continue
                            await db.execute(text("""
                                INSERT INTO donations
                                    (id, branch_id, amount, currency, purpose,
                                     payment_provider, payment_ref, status, source,
                                     gift_aid_eligible, created_at, updated_at)
                                VALUES
                                    (gen_random_uuid(), :bid, :amt, 'GBP', 'Monthly Giving',
                                     'paypal', :ref, 'COMPLETED', 'monthly-giving',
                                     :ga, NOW(), NOW())
                            """), {"bid": r["branch_id"], "amt": value, "ref": txn_id, "ga": bool(r["ga"])})
                            await db.commit()
                        summary["payments_recorded"] += 1
            except Exception as exc:  # noqa: BLE001
                summary["errors"] += 1
                logger.warning("paypal_reconcile_row_failed", sub_id=sub_id, error=str(exc))

    return summary


async def recovery_loop() -> None:
    """Forever-loop. Sleeps RECOVERY_INTERVAL_SECONDS between passes.
    Each pass runs the SumUp sweep, the Stripe reconcile, the Stripe account-health
    check, then the alert digest, independently — a failure in one does not affect
    the others."""
    # Initial delay so the schema patch + Digital DNA load finish first.
    await asyncio.sleep(60)
    while True:
        try:
            sumup = await _sumup_reconcile_once()
            logger.info("recovery_sumup_sweep", result=sumup)
        except Exception as exc:  # noqa: BLE001
            logger.error("recovery_sumup_failed", error=str(exc))
        try:
            stripe_recon = await _stripe_reconcile_once()
            logger.info("recovery_stripe_sweep", result=stripe_recon)
        except Exception as exc:  # noqa: BLE001
            logger.error("recovery_stripe_sweep_failed", error=str(exc))
        try:
            stripe_health = await _stripe_account_health_once()
            logger.info("recovery_stripe_health", result=stripe_health)
        except Exception as exc:  # noqa: BLE001
            logger.error("recovery_stripe_health_failed", error=str(exc))
        try:
            paypal = await _paypal_reconcile_once()
            logger.info("recovery_paypal_reconcile", result=paypal)
        except Exception as exc:  # noqa: BLE001
            logger.error("recovery_paypal_reconcile_failed", error=str(exc))
        try:
            digest = await _alert_digest_once()
            logger.info("recovery_alert_digest", result=digest)
        except Exception as exc:  # noqa: BLE001
            logger.error("recovery_alert_digest_failed", error=str(exc))
        await asyncio.sleep(RECOVERY_INTERVAL_SECONDS)
