"""
Scheduled-deploy poller — sweeps the scheduled_deploys table once per minute,
fires any row whose scheduled_for is in the past, marks the row 'fired' before
calling the deployer to prevent double-fire if the deployer recreates the
backend mid-promote (the promote itself restarts THIS process; on restart the
row will no longer match the 'pending' filter).

Operator workflow:
  - POST /admin/system/deploy/prod with {"scheduled_for": "<UTC ISO>"} → row
    inserted with status='pending'.
  - This poller (started in main.lifespan) wakes every 60s, fires any due
    rows by calling deployer /promote-prod with the same X-Deploy-Secret the
    immediate-promote path uses.
  - Operator can cancel before fire-time via POST
    /admin/system/scheduled-deploys/{id}/cancel.

We deliberately do NOT store the admin PIN with the scheduled row — PIN
verification happens at schedule time, mirroring how an immediate Promote
verifies once and trusts the deployer thereafter. If you want a second PIN
prompt to confirm the firing, that's an explicit UX choice for the user to
take in System Ops, not a security gate (the row already exists; if an
attacker had your PIN, they would just promote immediately).
"""
from __future__ import annotations

import os
import urllib.error
import urllib.request

import structlog
from sqlalchemy import text

from shital.core.fabrics.database import SessionLocal

logger = structlog.get_logger()


def _deployer_url() -> str:
    return os.environ.get("DEPLOYER_URL", "http://deployer:9000").strip()


def _deploy_secret() -> str:
    return (
        os.environ.get("DEPLOY_SECRET", "").strip().strip('"').strip("'")
    )


async def poll_and_fire() -> int:
    """One sweep of the schedule table. Returns the number of rows that
    were fired (zero is the common case). Raises only on genuinely
    unexpected errors; per-row failures are recorded in the row's `error`
    column and do not abort the sweep."""
    secret = _deploy_secret()
    if not secret:
        # No deploy secret configured — quietly skip. Logged once by
        # lifespan; the poller doesn't need to spam on every tick.
        return 0

    async with SessionLocal() as db:
        # Lock the rows we're about to fire so a concurrent poller (e.g.
        # if the backend is briefly running both blue and green during a
        # cutover) can't double-fire. PostgreSQL's `FOR UPDATE SKIP LOCKED`
        # gives us each row to exactly one worker.
        rows = (await db.execute(text(
            "SELECT id, env, scheduled_for "
            "FROM scheduled_deploys "
            "WHERE status = 'pending' AND scheduled_for <= NOW() "
            "ORDER BY scheduled_for "
            "FOR UPDATE SKIP LOCKED"
        ))).all()

        fired = 0
        for row_id, env, scheduled_for in rows:
            # Mark fired BEFORE making the network call. If the deployer
            # response races with a backend restart from the promote
            # itself, the row is already out of the 'pending' filter.
            await db.execute(text(
                "UPDATE scheduled_deploys SET status='fired', fired_at=NOW() WHERE id=:id"
            ), {"id": row_id})
            await db.commit()

            try:
                _fire_deployer(env, secret)
                fired += 1
                logger.info("scheduled_deploy_fired",
                            id=str(row_id), env=env, scheduled_for=scheduled_for.isoformat())
            except Exception as exc:
                # Roll the row to 'failed' so the operator can see why.
                err = str(exc)[:500]
                await db.execute(text(
                    "UPDATE scheduled_deploys SET status='failed', error=:err WHERE id=:id"
                ), {"id": row_id, "err": err})
                await db.commit()
                logger.error("scheduled_deploy_fire_failed",
                             id=str(row_id), env=env, error=err)
        return fired


def _fire_deployer(env: str, secret: str) -> None:
    """Call the deployer for a due row. env in {'dev', 'prod'}.

    Matches the URL/header shape of system.py::trigger_deploy so behavior is
    identical to clicking "Promote now" / "Re-deploy Dev"."""
    if env == "prod":
        url = f"{_deployer_url()}/promote-prod"
        headers = {"X-Deploy-Secret": secret}
    else:
        url = f"{_deployer_url()}/deploy"
        headers = {"X-Deploy-Secret": secret, "X-Deploy-Target": "dev"}
    req = urllib.request.Request(url, method="POST", headers=headers, data=b"")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            # 2xx including 202 (the deployer fires-and-forgets).
            if not (200 <= r.status < 300):
                raise RuntimeError(f"deployer returned HTTP {r.status}")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            pass
        raise RuntimeError(f"deployer HTTP {e.code}: {body}") from e
