"""
System version + multi-environment deploy management.

Endpoints:
  GET  /admin/system/version         — current backend version (env vars)
  GET  /admin/system/environments    — dev + prod state (image SHA, age, container)
  GET  /admin/system/deploys         — last N deploys from on-disk JSONL log
  POST /admin/system/deploy/{env}    — trigger deploy (env=dev|prod). Prod
                                        promotes :dev → :latest before restart.

Image flow:
  CI builds main → pushes :dev → auto-deploys to dev stack
  Admin clicks "Promote to Prod" → retag :dev→:latest → restart prod
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/admin/system", tags=["system"])

DEPLOY_HISTORY_FILE = "/opt/shitaleco/backups/deploy-history.jsonl"


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires SUPER_ADMIN or ADMIN role",
        )


@router.get("/version")
async def get_version(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    git_sha = os.environ.get("GIT_SHA", "dev")
    build_time = os.environ.get("BUILD_TIME", "unknown")
    short = git_sha[:7] if git_sha and git_sha != "dev" else git_sha
    return {
        "git_sha": git_sha,
        "git_sha_short": short,
        "build_time": build_time,
        "branch": os.environ.get("DEPLOY_BRANCH", "main"),
        "now": datetime.now(UTC).isoformat(),
    }


@router.get("/environments")
async def get_environments(ctx: CurrentSpace) -> dict[str, Any]:
    """Return summary of dev + prod environments via the deployer's /status endpoint.

    The deployer runs in a container with the docker socket mounted; the backend
    doesn't have docker CLI, so we proxy through.
    """
    _require_admin(ctx)
    deployer_url = os.environ.get("DEPLOYER_URL", "http://deployer:9000").strip()
    deploy_secret = os.environ.get("DEPLOY_SECRET", "").strip().strip('"').strip("'")
    if not deploy_secret:
        return {"environments": {}, "error": "DEPLOY_SECRET not configured"}

    req = urllib.request.Request(
        f"{deployer_url}/status",
        headers={"X-Deploy-Secret": deploy_secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 403:
            return {"environments": {}, "error": (
                "Deployer rejected request: DEPLOY_SECRET mismatch — "
                "recreate the deployer container after rotating the secret."
            )}
        return {"environments": {}, "error": f"Deployer HTTP {e.code}"}
    except Exception as e:
        return {"environments": {}, "error": f"Deployer unreachable: {e}"}


@router.get("/deploys")
async def list_deploys(ctx: CurrentSpace, limit: int = 20, env: str | None = None) -> dict[str, Any]:
    _require_admin(ctx)
    if not os.path.exists(DEPLOY_HISTORY_FILE):
        return {"deploys": [], "total": 0}
    events: list[dict[str, Any]] = []
    try:
        with open(DEPLOY_HISTORY_FILE) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                    if env and e.get("env") != env:
                        continue
                    events.append(e)
                except json.JSONDecodeError:
                    continue
    except OSError:
        return {"deploys": [], "total": 0}
    events.reverse()
    return {"deploys": events[:limit], "total": len(events)}


@router.post("/deploy/{env}")
async def trigger_deploy(
    env: str,
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Trigger a deploy.
      env=dev   → pull latest :dev images, restart dev stack
      env=prod  → retag :dev → :latest, restart prod stack (image promotion)
    """
    _require_admin(ctx)
    if env not in ("dev", "prod"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="env must be 'dev' or 'prod'",
        )
    if not x_admin_pin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin PIN required (X-Admin-Pin header)",
        )
    from shital.core.fabrics.secrets import SecretsManager
    if not await SecretsManager.verify_pin(x_admin_pin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Incorrect admin PIN",
        )

    deployer_url = os.environ.get("DEPLOYER_URL", "http://deployer:9000").strip()
    deploy_secret = os.environ.get("DEPLOY_SECRET", "").strip().strip('"').strip("'")
    if not deploy_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DEPLOY_SECRET not configured",
        )

    if env == "prod":
        # Prod = image promotion (retag :dev → :latest, restart prod)
        url = f"{deployer_url}/promote-prod"
        headers = {"X-Deploy-Secret": deploy_secret}
    else:
        # Dev = standard deploy
        url = f"{deployer_url}/deploy"
        headers = {"X-Deploy-Secret": deploy_secret, "X-Deploy-Target": "dev"}

    req = urllib.request.Request(url, method="POST", headers=headers, data=b"")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Deployer rejected: HTTP {e.code}",
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not reach deployer: {e}",
        ) from e

    triggered_at = datetime.now(UTC).isoformat()
    return {
        "ok": True,
        "env": env,
        "deployer_status": code,
        "triggered_at": triggered_at,
        "triggered_by": ctx.user_email,
        "message": (
            "Deploy started. Containers will restart in 1-2 min. "
            "Check /admin/system/environments for status."
        ),
    }


# ─── Snapshots / restore (deploy-time DB + image snapshots) ───────────────────

@router.get("/snapshots")
async def list_snapshots(ctx: CurrentSpace) -> dict[str, Any]:
    """List promote-time snapshots (DB dump + image tags) available for restore."""
    _require_admin(ctx)
    deployer_url = os.environ.get("DEPLOYER_URL", "http://deployer:9000").strip()
    # Strip whitespace/quotes that .env files commonly leave on values — a stray
    # newline or quote here vs. on the deployer side produces a silent 403.
    deploy_secret = os.environ.get("DEPLOY_SECRET", "").strip().strip('"').strip("'")
    if not deploy_secret:
        return {"snapshots": [], "error": "DEPLOY_SECRET not configured"}
    req = urllib.request.Request(
        f"{deployer_url}/snapshots",
        headers={"X-Deploy-Secret": deploy_secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 403:
            return {"snapshots": [], "error": (
                "Deployer rejected request: DEPLOY_SECRET mismatch. "
                "Backend and deployer container must share the same value — "
                "recreate the deployer container after rotating the secret "
                "(`docker compose up -d --force-recreate deployer`)."
            )}
        return {"snapshots": [], "error": f"Deployer rejected: HTTP {e.code}"}
    except Exception as e:
        return {"snapshots": [], "error": f"Deployer unreachable: {e}"}


@router.post("/restore/{snapshot_id}")
async def restore_snapshot(
    snapshot_id: str,
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Restore prod from a previous promote snapshot (DB + images). PIN-gated.
    snapshot_id is the timestamp portion, e.g. 20260506T070000Z.
    """
    _require_admin(ctx)
    if not x_admin_pin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin PIN required (X-Admin-Pin header)",
        )
    from shital.core.fabrics.secrets import SecretsManager
    if not await SecretsManager.verify_pin(x_admin_pin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Incorrect admin PIN",
        )

    deployer_url = os.environ.get("DEPLOYER_URL", "http://deployer:9000").strip()
    deploy_secret = os.environ.get("DEPLOY_SECRET", "").strip().strip('"').strip("'")
    if not deploy_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DEPLOY_SECRET not configured",
        )
    payload = json.dumps({"snapshot_id": snapshot_id}).encode()
    req = urllib.request.Request(
        f"{deployer_url}/restore",
        method="POST",
        headers={"X-Deploy-Secret": deploy_secret, "Content-Type": "application/json"},
        data=payload,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Deployer rejected: HTTP {e.code}",
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not reach deployer: {e}",
        ) from e
    return {
        "ok": True,
        "snapshot_id": snapshot_id,
        "deployer_status": code,
        "triggered_at": datetime.now(UTC).isoformat(),
        "triggered_by": ctx.user_email,
        "message": (
            "Restore started. Containers will restart in 1-2 min. "
            "Current state was snapshotted as :pre-restore-* before changing."
        ),
    }


# Backwards-compat: keep the old name (= deploy to dev)
@router.post("/trigger-deploy")
async def trigger_deploy_legacy(
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    return await trigger_deploy("dev", ctx, x_admin_pin)


# ─── Ops / diagnostics ────────────────────────────────────────────────────────
# Thin proxy to the deployer's /ops/run. SUPER_ADMIN required. Allowlist is
# enforced *both* here and in the deployer (defense in depth).
_OPS_ALLOWED = {
    "list_containers", "container_logs", "container_inspect",
    "restart_container", "disk_usage",
    "pull_images", "recreate_stack",
    "psql_select", "ghcr_login_test",
}


@router.post("/ops/run")
async def ops_run(
    ctx: CurrentSpace,
    body: dict,
) -> dict[str, Any]:
    """Run an allowlisted ops action via the deployer. SUPER_ADMIN only."""
    _require_admin(ctx)

    action = body.get("action", "")
    args   = body.get("args", {}) or {}
    if action not in _OPS_ALLOWED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown or not-allowed action '{action}'. "
                   f"Allowed: {sorted(_OPS_ALLOWED)}",
        )

    deployer_url  = os.environ.get("DEPLOYER_URL", "http://deployer:9000")
    deploy_secret = os.environ.get("DEPLOY_SECRET", "")
    if not deploy_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DEPLOY_SECRET not configured",
        )

    payload = json.dumps({"action": action, "args": args}).encode()
    req = urllib.request.Request(
        f"{deployer_url}/ops/run", method="POST",
        headers={
            "X-Deploy-Secret": deploy_secret,
            "Content-Type":    "application/json",
        },
        data=payload,
    )
    # Long timeout — pull_images / recreate_stack can take minutes.
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            result = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=e.code, detail=f"Deployer HTTP {e.code}: {e.reason}") from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not reach deployer: {e}",
        ) from e

    return {
        "ok": True,
        "action": action,
        "args": args,
        "triggered_by": ctx.user_email,
        "triggered_at": datetime.now(UTC).isoformat(),
        **result,  # stdout, stderr, exit_code, duration_ms
    }


@router.get("/deployer/last-log")
async def deployer_last_log(ctx: CurrentSpace, tail: int = 200) -> dict[str, Any]:
    """
    Surface the tail of the deployer's most-recent deploy.sh run. Lets an
    operator triage a silent Promote / Re-deploy failure without SSH —
    server.py used to swallow script output to /dev/null, so failures like
    bad GHCR auth / missing /workspace mount / immediate `git fetch` crash
    appeared as "Promote triggered → nothing happens". The deployer now
    writes to /var/log/shital-deployer/latest.log; this proxies to it.
    """
    _require_admin(ctx)
    deployer_url  = os.environ.get("DEPLOYER_URL", "http://deployer:9000").strip()
    deploy_secret = os.environ.get("DEPLOY_SECRET", "").strip().strip('"').strip("'")
    if not deploy_secret:
        return {"lines": [], "error": "DEPLOY_SECRET not configured"}
    tail = max(1, min(1000, int(tail)))
    req = urllib.request.Request(
        f"{deployer_url}/last-deploy-log?tail={tail}",
        headers={"X-Deploy-Secret": deploy_secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"lines": [], "error": f"Deployer HTTP {e.code}"}
    except Exception as e:
        return {"lines": [], "error": f"Deployer unreachable: {e}"}


# ─── Kiosk health (Quick Donation + Full Kiosk fleet) ─────────────────────────
# Classification proxies kiosk_devices.last_seen_at — which is bumped whenever
# the device fetches its config (login / refresh / config poll). No dedicated
# heartbeat yet, so "online" means "interacted with the API recently".

_KIOSK_ONLINE_MAX_SECONDS = 5 * 60       # ≤ 5 min  → ONLINE
_KIOSK_STALE_MAX_SECONDS  = 60 * 60      # 5-60 min → STALE; > 60 min → OFFLINE


def _classify_seen(seconds_since: int | None) -> str:
    if seconds_since is None:
        return "OFFLINE"
    if seconds_since <= _KIOSK_ONLINE_MAX_SECONDS:
        return "ONLINE"
    if seconds_since <= _KIOSK_STALE_MAX_SECONDS:
        return "STALE"
    return "OFFLINE"


@router.get("/kiosks/status")
async def kiosks_status(ctx: CurrentSpace) -> dict[str, Any]:
    """
    Health snapshot for every configured kiosk (Quick Donation + Full Kiosk)
    and its paired card reader. ONLINE / STALE / OFFLINE based on last_seen_at.
    """
    _require_admin(ctx)

    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT
                kd.id::text                                AS id,
                COALESCE(kd.name, '')                      AS name,
                COALESCE(kd.device_type, '')               AS device_type,
                COALESCE(UPPER(kd.status), 'UNKNOWN')      AS status,
                kd.branch_id                               AS branch_code,
                COALESCE(b.name, kd.branch_id)             AS branch_name,
                kd.latitude                                AS latitude,
                kd.longitude                               AS longitude,
                kd.last_seen_at                            AS last_seen_at,
                td.label                                   AS reader_label,
                COALESCE(td.provider, '')                  AS reader_provider,
                LOWER(COALESCE(td.status, ''))             AS reader_status,
                td.last_seen_at                            AS reader_last_seen_at
            FROM kiosk_devices kd
            LEFT JOIN terminal_devices td ON td.id = kd.card_reader_id
            LEFT JOIN branches b ON b.branch_id = kd.branch_id
            WHERE kd.deleted_at IS NULL
            ORDER BY kd.branch_id, kd.device_type, kd.name
        """))).mappings().all()

    now = datetime.now(UTC)
    kiosks: list[dict[str, Any]] = []
    summary = {"total": 0, "online": 0, "stale": 0, "offline": 0, "inactive": 0}

    for r in rows:
        last_seen = r["last_seen_at"]
        seconds_since = int((now - last_seen).total_seconds()) if last_seen else None
        health = _classify_seen(seconds_since)

        reader_seen = r["reader_last_seen_at"]
        reader_seconds = int((now - reader_seen).total_seconds()) if reader_seen else None

        is_inactive = r["status"] != "ACTIVE"
        if is_inactive:
            summary["inactive"] += 1
        else:
            summary[health.lower()] += 1
        summary["total"] += 1

        kiosks.append({
            "id":               r["id"],
            "name":             r["name"],
            "device_type":      r["device_type"],
            "status":           r["status"],
            "branch_code":      r["branch_code"],
            "branch_name":      r["branch_name"],
            "latitude":         float(r["latitude"])  if r["latitude"]  is not None else None,
            "longitude":        float(r["longitude"]) if r["longitude"] is not None else None,
            "last_seen_at":     last_seen.isoformat() if last_seen else None,
            "seconds_since_seen": seconds_since,
            "health":           "INACTIVE" if is_inactive else health,
            "reader_label":     r["reader_label"],
            "reader_provider":  r["reader_provider"] or None,
            "reader_status":    r["reader_status"] or None,
            "reader_last_seen_at": reader_seen.isoformat() if reader_seen else None,
            "reader_seconds_since_seen": reader_seconds,
        })

    return {
        "kiosks": kiosks,
        "summary": summary,
        "thresholds": {
            "online_max_seconds": _KIOSK_ONLINE_MAX_SECONDS,
            "stale_max_seconds":  _KIOSK_STALE_MAX_SECONDS,
        },
        "now": now.isoformat(),
    }
