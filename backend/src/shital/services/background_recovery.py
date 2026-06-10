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

async def _sumup_reconcile_once() -> dict[str, Any]:
    """Sweep PENDING SumUp donations and resolve their status from SumUp's API.
    Returns counts so the caller can log a single summary line."""
    from shital.services.secrets_manager import SecretsManager

    access_token = await SecretsManager.get("SUMUP_ACCESS_TOKEN") or settings.SUMUP_ACCESS_TOKEN
    if not access_token:
        return {"skipped": "sumup_not_configured"}

    summary: dict[str, Any] = {
        "scanned": 0, "completed": 0, "failed": 0,
        "still_pending": 0, "not_found": 0, "errors": 0,
    }
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text AS id, payment_ref, amount
            FROM donations
            WHERE UPPER(COALESCE(status, '')) IN ('PENDING', '')
              AND UPPER(COALESCE(payment_provider, '')) IN ('SUMUP', 'KIOSK')
              AND deleted_at IS NULL
              AND created_at >= NOW() - INTERVAL '7 days'
              AND payment_ref <> ''
        """))).mappings().all()

        async with httpx.AsyncClient(timeout=10) as cx:
            for r in rows:
                summary["scanned"] += 1
                checkout_id = r["payment_ref"] or ""
                if not checkout_id:
                    summary["errors"] += 1
                    continue
                try:
                    resp = await cx.get(
                        f"https://api.sumup.com/v0.1/checkouts/{checkout_id}",
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                except Exception:  # noqa: BLE001 — transient network blip, move on
                    summary["errors"] += 1
                    continue
                if resp.status_code == 404:
                    summary["not_found"] += 1
                    continue
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
                elif sumup_status in {"FAILED", "EXPIRED", "CANCELLED", "CANCELED"}:
                    new_status = "FAILED" if sumup_status == "FAILED" else "CANCELLED"
                    await db.execute(text("""
                        UPDATE donations SET status = :st, updated_at = NOW()
                        WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
                    """), {"id": r["id"], "st": new_status})
                    summary["failed"] += 1
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
# Loop entry point — wired into main.py lifespan
# ─────────────────────────────────────────────────────────────────────────────

async def recovery_loop() -> None:
    """Forever-loop. Sleeps RECOVERY_INTERVAL_SECONDS between passes.
    Each pass runs the SumUp sweep then the alert digest, independently —
    a failure in one does not affect the other."""
    # Initial delay so the schema patch + Digital DNA load finish first.
    await asyncio.sleep(60)
    while True:
        try:
            sumup = await _sumup_reconcile_once()
            logger.info("recovery_sumup_sweep", result=sumup)
        except Exception as exc:  # noqa: BLE001
            logger.error("recovery_sumup_failed", error=str(exc))
        try:
            digest = await _alert_digest_once()
            logger.info("recovery_alert_digest", result=digest)
        except Exception as exc:  # noqa: BLE001
            logger.error("recovery_alert_digest_failed", error=str(exc))
        await asyncio.sleep(RECOVERY_INTERVAL_SECONDS)
