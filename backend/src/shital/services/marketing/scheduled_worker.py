"""Background loop that picks up SCHEDULED campaigns whose scheduled_at
has passed and fires them.

Mirrors the supervisor pattern of services/background_recovery.py:
  * main loop sleeps settings.MKT_SCHED_POLL_SECONDS (default 60s)
  * each tick finds up to N due campaigns, dispatches them one-by-one
  * if one crashes, we log + flip it back to DRAFT so an operator can
    retry; the loop itself survives
  * supervised wrapper restarts the loop if it exits unexpectedly

Idempotency: the first SELECT takes an advisory lock-equivalent by
immediately flipping the row to SENDING under WHERE status='SCHEDULED'
AND scheduled_at <= NOW(). A second worker (or a second tick) sees
the row as SENDING and skips it.
"""
from __future__ import annotations

import asyncio
import logging
import os

from sqlalchemy import text

from shital.core.fabrics.database import SessionLocal

logger = logging.getLogger(__name__)

_POLL_SECONDS = int(os.environ.get("MKT_SCHED_POLL_SECONDS", "60") or "60")
_BATCH = int(os.environ.get("MKT_SCHED_BATCH", "5") or "5")


async def _claim_due_campaigns(limit: int) -> list[str]:
    """Atomically flip up to `limit` due campaigns from SCHEDULED → SENDING,
    returning their ids. The UPDATE ... RETURNING pattern + the
    FOR UPDATE SKIP LOCKED hint keeps parallel workers safe (we don't
    run more than one worker today, but we may tomorrow and it costs
    nothing to be defensive)."""
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            WITH due AS (
                SELECT id FROM marketing_campaigns
                 WHERE status = 'SCHEDULED'
                   AND scheduled_at IS NOT NULL
                   AND scheduled_at <= NOW()
                 ORDER BY scheduled_at ASC
                 LIMIT :n
                 FOR UPDATE SKIP LOCKED
            )
            UPDATE marketing_campaigns c
               SET status = 'SENDING', updated_at = NOW()
              FROM due
             WHERE c.id = due.id
            RETURNING c.id
        """), {"n": limit})).scalars().all()
        await db.commit()
    return [str(r) for r in rows]


async def _dispatch_one(cid: str) -> None:
    """Fire a single campaign using the same logic the send-now endpoint
    uses. Isolates the heavy import inside the function so the loop can
    start even if the mail stack is borked."""
    # Import inline — this pulls in the templates module which registers
    # a FastAPI router at import time.
    from shital.api.routers.marketing_campaigns import _run_campaign_send
    try:
        await _run_campaign_send(cid, triggered_by="scheduler")
    except Exception as exc:
        logger.exception("marketing_campaign_dispatch_failed cid=%s err=%s", cid, exc)
        # Flip back to DRAFT so an operator can retry rather than leaving
        # the record stuck in SENDING forever.
        async with SessionLocal() as db:
            await db.execute(text("""
                UPDATE marketing_campaigns
                   SET status = 'DRAFT', updated_at = NOW()
                 WHERE id = CAST(:id AS uuid) AND status = 'SENDING'
            """), {"id": cid})
            await db.commit()


async def scheduled_loop() -> None:
    """Forever-loop. One tick = claim-and-dispatch a batch."""
    while True:
        try:
            due = await _claim_due_campaigns(_BATCH)
            for cid in due:
                await _dispatch_one(cid)
        except Exception:
            logger.exception("marketing_scheduled_loop_tick_failed")
        await asyncio.sleep(_POLL_SECONDS)


async def scheduled_loop_supervised() -> None:
    """Restart the scheduled_loop if it ever exits. Matches the shape
    the existing recovery / stripe loops in background_recovery.py use."""
    while True:
        try:
            await scheduled_loop()
        except Exception:
            logger.exception("marketing_scheduled_loop_crashed — restarting in 30s")
            await asyncio.sleep(30)


__all__ = ["scheduled_loop_supervised"]
