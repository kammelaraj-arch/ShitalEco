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


@router.get("/environments")
async def get_environments(ctx: CurrentSpace) -> dict[str, Any]:
    """Return summary of dev + prod environments via the deployer's /status endpoint.

    The deployer runs in a container with the docker socket mounted; the backend
    doesn't have docker CLI, so we proxy through.
    """
    _require_admin(ctx)
    deployer_url = os.environ.get("DEPLOYER_URL", "http://deployer:9000")
    deploy_secret = os.environ.get("DEPLOY_SECRET", "")
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

    deployer_url = os.environ.get("DEPLOYER_URL", "http://deployer:9000")
    deploy_secret = os.environ.get("DEPLOY_SECRET", "")
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


# Backwards-compat: keep the old name (= deploy to dev)
@router.post("/trigger-deploy")
async def trigger_deploy_legacy(
    ctx: CurrentSpace,
    x_admin_pin: str | None = Header(default=None),
) -> dict[str, Any]:
    return await trigger_deploy("dev", ctx, x_admin_pin)
