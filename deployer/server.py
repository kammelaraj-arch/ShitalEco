"""
ShitalEco webhook deployer.

Endpoints (all secret-gated except /healthz):
  POST /deploy                — run /app/deploy.sh in background, returns 202
                                Optional header X-Deploy-Target: dev
                                triggers a dev-only restart (no GHCR pull).
  GET  /status                — JSON snapshot of dev + prod environments
  GET  /snapshots             — list :promote-<ts> tagged images
  GET  /healthz               — liveness ping (open, no secret)

The /status + /snapshots routes were added so the admin "System Ops"
panel stops mis-reporting "DEPLOY_SECRET mismatch" — the previous
deployer only implemented POST /deploy, so every read-only call from
the panel hit do_GET which always 403'd. The backend interprets a
403 as a secret mismatch, hence the misleading red banner.
"""
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

DEPLOY_SECRET = os.environ.get("DEPLOY_SECRET", "")
WORKSPACE = os.environ.get("WORKSPACE", "/workspace")

# Container names that represent "is the env up?" for the panel.
PROD_BACKEND = "shitaleco-backend-1"
DEV_BACKEND  = "shitaleco-dev-backend-dev-1"


def run_deploy(target: str = "prod"):
    script = "/app/deploy.sh"
    env = os.environ.copy()
    env["DEPLOY_TARGET"] = target
    subprocess.Popen(
        ["/bin/bash", script],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )


def _docker(*args: str) -> str:
    try:
        return subprocess.check_output(
            ["docker", *args], stderr=subprocess.DEVNULL, timeout=10
        ).decode().strip()
    except Exception:
        return ""


def _container_running(name: str) -> bool:
    return _docker("inspect", "-f", "{{.State.Running}}", name) == "true"


def _container_image_id(name: str) -> str:
    return _docker("inspect", "-f", "{{.Image}}", name)[:19]  # sha256:xxxxxxxxxxxxx


def _git_commit(short: bool = True) -> str:
    args = ["git", "-C", WORKSPACE, "rev-parse"]
    if short:
        args.append("--short")
    args.append("HEAD")
    try:
        return subprocess.check_output(args, stderr=subprocess.DEVNULL, timeout=5).decode().strip()
    except Exception:
        return "unknown"


def collect_status() -> dict:
    commit = _git_commit()
    return {
        "environments": {
            "prod": {
                "status": "up" if _container_running(PROD_BACKEND) else "down",
                "commit": commit,
                "container": PROD_BACKEND,
            },
            "dev": {
                "status": "up" if _container_running(DEV_BACKEND) else "down",
                "commit": commit,
                "container": DEV_BACKEND,
            },
        }
    }


def collect_snapshots() -> dict:
    """Return :promote-<ts> tagged images as snapshot entries."""
    raw = _docker(
        "image", "ls",
        "--format",
        "{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedAt}}",
    )
    snapshots = []
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        repo, tag, image_id, size, created = parts[:5]
        if not tag.startswith("promote-"):
            continue
        snapshots.append({
            "when":   created,
            "commit": tag.removeprefix("promote-"),
            "image":  f"{repo}:{tag}",
            "id":     image_id,
            "size":   size,
            "db_dump": "",
        })
    snapshots.sort(key=lambda s: s["when"], reverse=True)
    return {"snapshots": snapshots[:10]}


def _check_secret(self) -> bool:
    return bool(DEPLOY_SECRET) and self.headers.get("X-Deploy-Secret") == DEPLOY_SECRET


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self._json(200, {"status": "ok", "service": "shitaleco-deployer"})
            return
        if not _check_secret(self):
            self.send_response(403)
            self.end_headers()
            return
        if self.path == "/status":
            self._json(200, collect_status())
        elif self.path == "/snapshots":
            self._json(200, collect_snapshots())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if not _check_secret(self):
            self.send_response(403)
            self.end_headers()
            return
        if self.path == "/deploy":
            target = self.headers.get("X-Deploy-Target", "prod")
            threading.Thread(target=run_deploy, args=(target,), daemon=True).start()
            self.send_response(202)
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 9000), Handler).serve_forever()
