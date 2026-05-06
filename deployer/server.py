import hmac
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

# Strip whitespace + surrounding quotes — .env files commonly leave these on
# values, and a stray newline here vs. on the backend side produces a silent
# 403 on every deployer call (Promote, Snapshots list, Restore, Status).
DEPLOY_SECRET = os.environ.get("DEPLOY_SECRET", "").strip().strip('"').strip("'")
_PLACEHOLDER_SECRETS = {"", "shital-deploy-secret-change-me", "change-me"}
if DEPLOY_SECRET in _PLACEHOLDER_SECRETS:
    print(
        "FATAL: DEPLOY_SECRET is empty or set to a placeholder value. "
        "Set DEPLOY_SECRET in /opt/shitaleco/.env to a real secret. "
        "GitHub Actions must send the SAME value via X-Deploy-Secret header.",
        file=sys.stderr,
    )
    sys.exit(2)

ENV_CONTAINERS = {
    "prod": "shitaleco-backend-1",
    "dev":  "shitaleco-dev-backend-dev-1",
}


def run_script(args):
    subprocess.Popen(
        ["/bin/bash", "/app/deploy.sh", *args],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


# ─── Ops / diagnostics ────────────────────────────────────────────────────────
# Admin → System → Ops can call POST /ops/run with {action, args}. Allowlist is
# defined here (defense-in-depth — backend also validates). Each handler returns
# {stdout, stderr, exit_code, duration_ms}.
import re
import shlex
import time
from datetime import datetime as _dt

OPS_LOG = "/var/log/shital-ops.log"

PROD_COMPOSE = "/workspace/docker-compose.prod.yml"
DEV_COMPOSE  = "/workspace/docker-compose.dev.yml"
PROD_ENV     = "/workspace/.env"
DEV_ENV      = "/workspace-dev/.env.dev"  # bind-mounted from /opt/shitaleco-dev

# Whitelisted container names per stack (prevents arbitrary container access).
PROD_CONTAINERS = {
    "shitaleco-backend-1", "shitaleco-admin-1", "shitaleco-quick-donation-1",
    "shitaleco-kiosk-1", "shitaleco-screen-1", "shitaleco-service-1",
    "shitaleco-nginx-1", "shitaleco-db-1", "shitaleco-deployer-1",
    "shitaleco-backups-1",
}
DEV_CONTAINERS = {
    "shitaleco-dev-backend-dev-1", "shitaleco-dev-admin-dev-1",
    "shitaleco-dev-quick-donation-dev-1", "shitaleco-dev-kiosk-dev-1",
    "shitaleco-dev-screen-dev-1", "shitaleco-dev-nginx-dev-1",
    "shitaleco-dev-db-dev-1",
}
ALL_CONTAINERS = PROD_CONTAINERS | DEV_CONTAINERS

# SELECT-only — anything starting with SELECT, EXPLAIN, \d (psql describe),
# WITH (CTEs) or SHOW. Multi-statement attempts (semicolons mid-query) are
# stripped to a single statement before running.
_READONLY_SQL_RE = re.compile(r"^\s*(SELECT|EXPLAIN|WITH|SHOW|\\d)\b", re.IGNORECASE)


def _audit(action, args, result):
    try:
        with open(OPS_LOG, "a") as f:
            f.write(json.dumps({
                "ts": _dt.utcnow().isoformat() + "Z",
                "action": action, "args": args,
                "exit_code": result.get("exit_code"),
                "duration_ms": result.get("duration_ms"),
            }) + "\n")
    except Exception:
        pass


def _exec(cmd, timeout=120):
    """Run a shell command list, return {stdout, stderr, exit_code, duration_ms}."""
    t0 = time.time()
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {
            "stdout":      r.stdout[-100_000:],
            "stderr":      r.stderr[-20_000:],
            "exit_code":   r.returncode,
            "duration_ms": int((time.time() - t0) * 1000),
        }
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": f"timeout after {timeout}s",
                "exit_code": -1, "duration_ms": int((time.time() - t0) * 1000)}
    except Exception as e:
        return {"stdout": "", "stderr": str(e),
                "exit_code": -2, "duration_ms": int((time.time() - t0) * 1000)}


def _read_env(path, key):
    try:
        with open(path) as f:
            for line in f:
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].rstrip("\n")
    except FileNotFoundError:
        return ""
    return ""


def op_list_containers(args):
    return _exec(["docker", "ps", "-a", "--format",
                  "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"])


def op_container_logs(args):
    name = args.get("container", "")
    tail = str(int(args.get("tail", 100)))
    if name not in ALL_CONTAINERS:
        return {"stdout": "", "stderr": f"container '{name}' not in allowlist",
                "exit_code": -3, "duration_ms": 0}
    return _exec(["docker", "logs", name, "--tail", tail], timeout=30)


def op_container_inspect(args):
    name = args.get("container", "")
    if name not in ALL_CONTAINERS:
        return {"stdout": "", "stderr": f"container '{name}' not in allowlist",
                "exit_code": -3, "duration_ms": 0}
    return _exec(["docker", "inspect", name,
                  "--format",
                  "image_sha={{.Image}}\nimage={{.Config.Image}}\nstatus={{.State.Status}}\nstarted={{.State.StartedAt}}\n"
                  "{{range .Config.Env}}env: {{.}}\n{{end}}"])


def op_restart_container(args):
    name = args.get("container", "")
    if name not in ALL_CONTAINERS:
        return {"stdout": "", "stderr": f"container '{name}' not in allowlist",
                "exit_code": -3, "duration_ms": 0}
    return _exec(["docker", "restart", name], timeout=60)


def op_disk_usage(args):
    df = _exec(["df", "-h", "/"])
    sysdf = _exec(["docker", "system", "df"])
    return {
        "stdout": (df["stdout"] or "") + "\n--- docker system df ---\n" + (sysdf["stdout"] or ""),
        "stderr": "\n".join(s for s in [df["stderr"], sysdf["stderr"]] if s),
        "exit_code": df["exit_code"] or sysdf["exit_code"],
        "duration_ms": df["duration_ms"] + sysdf["duration_ms"],
    }


def op_pull_images(args):
    target = args.get("target", "")
    if target not in ("dev", "prod"):
        return {"stdout": "", "stderr": "target must be 'dev' or 'prod'",
                "exit_code": -3, "duration_ms": 0}
    compose = DEV_COMPOSE if target == "dev" else PROD_COMPOSE
    env_file = DEV_ENV if target == "dev" else PROD_ENV
    return _exec(["docker", "compose", "--env-file", env_file, "-f", compose, "pull"], timeout=600)


def op_recreate_stack(args):
    target = args.get("target", "")
    if target not in ("dev", "prod"):
        return {"stdout": "", "stderr": "target must be 'dev' or 'prod'",
                "exit_code": -3, "duration_ms": 0}
    compose = DEV_COMPOSE if target == "dev" else PROD_COMPOSE
    env_file = DEV_ENV if target == "dev" else PROD_ENV
    return _exec(["docker", "compose", "--env-file", env_file, "-f", compose,
                  "up", "-d", "--force-recreate", "--remove-orphans"], timeout=600)


def op_psql_select(args):
    stack = args.get("stack", "prod")
    query = args.get("query", "").strip().rstrip(";")
    if not _READONLY_SQL_RE.match(query):
        return {"stdout": "", "stderr": "Only SELECT/EXPLAIN/WITH/SHOW/\\d allowed",
                "exit_code": -3, "duration_ms": 0}
    if ";" in query:
        return {"stdout": "", "stderr": "Multi-statement queries not allowed",
                "exit_code": -3, "duration_ms": 0}
    if stack == "dev":
        cont, usr, db, pw = ("shitaleco-dev-db-dev-1",
                             "shitaleco_dev_user", "shitaleco_dev_db",
                             "ShitalEcoDev2024!")
    else:
        usr = _read_env(PROD_ENV, "POSTGRES_USER") or "shitaleco_db_user"
        db  = _read_env(PROD_ENV, "POSTGRES_DB")   or "shitaleco_db"
        pw  = _read_env(PROD_ENV, "POSTGRES_PASSWORD")
        cont = "shitaleco-db-1"
    if not pw:
        return {"stdout": "", "stderr": "DB password not found",
                "exit_code": -4, "duration_ms": 0}
    return _exec([
        "docker", "exec", "-e", f"PGPASSWORD={pw}", cont,
        "psql", "-U", usr, "-d", db, "-c", query,
    ], timeout=30)


def op_ghcr_login_test(args):
    token = _read_env(PROD_ENV, "GITHUB_TOKEN")
    if not token:
        return {"stdout": "", "stderr": "GITHUB_TOKEN not set in /opt/shitaleco/.env",
                "exit_code": -4, "duration_ms": 0}
    p = subprocess.run(
        ["docker", "login", "ghcr.io", "-u", "kammelaraj-arch", "--password-stdin"],
        input=token, capture_output=True, text=True, timeout=30,
    )
    return {"stdout": p.stdout, "stderr": p.stderr,
            "exit_code": p.returncode, "duration_ms": 0}


OP_HANDLERS = {
    "list_containers":    op_list_containers,
    "container_logs":     op_container_logs,
    "container_inspect":  op_container_inspect,
    "restart_container":  op_restart_container,
    "disk_usage":         op_disk_usage,
    "pull_images":        op_pull_images,
    "recreate_stack":     op_recreate_stack,
    "psql_select":        op_psql_select,
    "ghcr_login_test":    op_ghcr_login_test,
}


def inspect_container(name: str) -> dict:
    try:
        r = subprocess.run(
            ["docker", "inspect", name, "--format",
             "{{.Image}}|{{.Config.Image}}|{{.State.StartedAt}}|{{.State.Status}}"],
            capture_output=True, text=True, timeout=8, check=False,
        )
        if r.returncode != 0 or not r.stdout.strip():
            return {"running": False}
        parts = r.stdout.strip().split("|")
        if len(parts) < 4:
            return {"running": False}
        return {
            "running": parts[3] == "running",
            "image_sha": parts[0].replace("sha256:", "")[:12],
            "image_tag": parts[1],
            "started_at": parts[2],
            "status": parts[3],
        }
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return {"running": False, "error": "docker unreachable"}


def image_metadata(tag: str) -> dict:
    """Return GIT_SHA + BUILD_TIME baked into a tagged backend image."""
    try:
        r = subprocess.run(
            ["docker", "image", "inspect",
             f"ghcr.io/kammelaraj-arch/shitaleco-backend:{tag}",
             "--format", "{{range .Config.Env}}{{println .}}{{end}}"],
            capture_output=True, text=True, timeout=8, check=False,
        )
        if r.returncode != 0:
            return {}
        out: dict[str, str] = {}
        for line in r.stdout.strip().splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                if k in {"GIT_SHA", "BUILD_TIME"}:
                    out[k] = v
        return out
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return {}


def container_metadata(name: str) -> dict:
    """Return GIT_SHA + BUILD_TIME of the *running* container's env.

    This is what we should report — the previous behaviour of reading the
    tagged image (:dev/:latest) lied when a tag was updated but the container
    hadn't been recreated to pick it up (Promote retag without restart, etc).
    """
    try:
        r = subprocess.run(
            ["docker", "inspect", name,
             "--format", "{{range .Config.Env}}{{println .}}{{end}}"],
            capture_output=True, text=True, timeout=8, check=False,
        )
        if r.returncode != 0:
            return {}
        out: dict[str, str] = {}
        for line in r.stdout.strip().splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                if k in {"GIT_SHA", "BUILD_TIME"}:
                    out[k] = v
        return out
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _check_secret(self) -> bool:
        sent = (self.headers.get("X-Deploy-Secret") or "").strip().strip('"').strip("'")
        if not sent or not DEPLOY_SECRET:
            return False
        return hmac.compare_digest(sent, DEPLOY_SECRET)

    def _send_json(self, code: int, body: dict):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/snapshots":
            if not self._check_secret():
                self.send_response(403); self.end_headers(); return
            # List promote-time DB dumps. Each is named promote-<ts>-<sha>.sql.gz.
            import glob
            import re as _re
            entries = []
            for path in sorted(glob.glob("/workspace/backups/promote-*.sql.gz"), reverse=True):
                name = os.path.basename(path)
                m = _re.match(r"^promote-(\d{8}T\d{6}Z)-([0-9a-f]{7,})\.sql\.gz$", name)
                if not m:
                    continue
                ts, sha = m.group(1), m.group(2)
                try:
                    size = os.path.getsize(path)
                except OSError:
                    size = 0
                entries.append({
                    "id":         ts,
                    "git_sha":    sha,
                    "db_dump":    name,
                    "size_bytes": size,
                    "created_at": ts,
                })
            self._send_json(200, {"snapshots": entries[:20]})
            return

        if self.path == "/status":
            if not self._check_secret():
                self.send_response(403); self.end_headers(); return
            envs = {}
            for env, container in ENV_CONTAINERS.items():
                running = inspect_container(container)
                # Prefer the running container's baked env (truth: what's
                # actually executing right now). Fall back to the tagged image
                # only if the container is down so the UI can still show what
                # *would* run if we deployed.
                live_meta = container_metadata(container) if running.get("running") else {}
                tag = "dev" if env == "dev" else "latest"
                tag_meta = image_metadata(tag)
                meta = live_meta or tag_meta
                sha = meta.get("GIT_SHA", "")
                envs[env] = {
                    "container": container,
                    **running,
                    "git_sha": sha,
                    "git_sha_short": sha[:7] if sha and sha != "dev" else sha,
                    "build_time": meta.get("BUILD_TIME"),
                    # If the running container's SHA differs from what's
                    # currently tagged, surface a warning the UI can show.
                    "stale": bool(
                        live_meta and tag_meta
                        and live_meta.get("GIT_SHA")
                        and tag_meta.get("GIT_SHA")
                        and live_meta["GIT_SHA"] != tag_meta["GIT_SHA"]
                    ),
                    "tag_git_sha": tag_meta.get("GIT_SHA", ""),
                    "url": "https://shital.org.uk" if env == "prod" else "https://dev.shital.org.uk",
                }
            self._send_json(200, {"environments": envs})
            return
        self.send_response(403); self.end_headers()

    def do_POST(self):
        if not self._check_secret():
            self.send_response(403); self.end_headers(); return

        if self.path == "/deploy":
            target = (self.headers.get("X-Deploy-Target") or "dev").lower()
            if target not in ("dev", "prod"):
                self.send_response(400); self.end_headers()
                self.wfile.write(b"X-Deploy-Target must be 'dev' or 'prod'")
                return
            run_script(["--target", target])
            self.send_response(202); self.end_headers()
            return

        if self.path == "/promote-prod":
            run_script(["--promote-prod"])
            self.send_response(202); self.end_headers()
            return

        if self.path == "/restore":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length).decode() or "{}")
            except json.JSONDecodeError:
                self.send_response(400); self.end_headers()
                self.wfile.write(b"invalid JSON body"); return
            sid = (body.get("snapshot_id") or "").strip()
            # Format guard — must look like 20260506T070000Z
            import re as _re
            if not _re.match(r"^\d{8}T\d{6}Z$", sid):
                self.send_response(400); self.end_headers()
                self.wfile.write(b"snapshot_id must be timestamp like 20260506T070000Z")
                return
            run_script(["--restore", sid])
            self.send_response(202); self.end_headers()
            return

        if self.path == "/ops/run":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length).decode() or "{}")
            except json.JSONDecodeError:
                self.send_response(400); self.end_headers()
                self.wfile.write(b"invalid JSON body"); return
            action = body.get("action", "")
            args   = body.get("args", {}) or {}
            handler = OP_HANDLERS.get(action)
            if not handler:
                self.send_response(400); self.end_headers()
                self.wfile.write(f"unknown action '{action}'".encode()); return
            result = handler(args)
            _audit(action, args, result)
            self._send_json(200, result)
            return

        self.send_response(404); self.end_headers()


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 9000), Handler)
    server.serve_forever()
