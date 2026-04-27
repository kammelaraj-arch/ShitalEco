"""
System version + deploy management.

  GET  /system/version      — current backend version (built-in env vars)
  GET  /system/deploys      — last N deploy events from the on-disk log
  POST /system/trigger-deploy  — fire the deployer webhook (PIN-protected)

Deploy events are appended to /opt/shitaleco/backups/deploy-history.jsonl by
the deployer's deploy.sh after each successful deploy.
"""
from __future__ import annotations

import json
import os
import urllib.request
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException, status

from shital.api.deps import CurrentSpace

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


@router.get("/deploys")
async def list_deploys(ctx: CurrentSpace, limit: int = 20) -> dict[str, Any]:
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
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return {"deploys": [], "total": 0}
    events.reverse()
    return {"deploys": events[:limit], "total": len(events)}


@router.post("/trigger-deploy")
async def trigger_deploy(
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
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

    deployer_url = os.environ.get("DEPLOYER_URL", "http://deployer:9000")
    deploy_secret = os.environ.get("DEPLOY_SECRET", "")
    if not deploy_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DEPLOY_SECRET not configured on backend",
        )

    req = urllib.request.Request(
        f"{deployer_url}/deploy",
        method="POST",
        headers={"X-Deploy-Secret": deploy_secret},
        data=b"",
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

    triggered_at = datetime.now(UTC).isoformat()
    return {
        "ok": True,
        "deployer_status": code,
        "triggered_at": triggered_at,
        "triggered_by": ctx.user_email,
        "message": "Deploy started. Check /admin/system/deploys for status.",
    }
