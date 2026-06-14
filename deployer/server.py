import hmac
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime as _dt
from http.server import BaseHTTPRequestHandler, HTTPServer

# Strip whitespace + surrounding quotes — .env files commonly leave these on
# values, and a stray newline here vs. on the backend side produces a silent
# 403 on every deployer call (Promote, Snapshots list, Restore, Status).
def _normalize_secret(s: str) -> str:
    return (s or "").strip().strip('"').strip("'")


# Loaded once at startup as a baseline. _read_secret_from_env_file() below
# re-reads /workspace/.env on each request so secret rotations take effect
# without needing to recreate the deployer container — same philosophy as
# bind-mounting deploy.sh / server.py (anything frozen at container build
# time goes stale).
DEPLOY_SECRET = _normalize_secret(os.environ.get("DEPLOY_SECRET", ""))
_PLACEHOLDER_SECRETS = {"", "shital-deploy-secret-change-me", "change-me"}
if DEPLOY_SECRET in _PLACEHOLDER_SECRETS:
    print(
        "FATAL: DEPLOY_SECRET is empty or set to a placeholder value. "
        "Set DEPLOY_SECRET in /opt/shitaleco/.env to a real secret. "
        "GitHub Actions must send the SAME value via X-Deploy-Secret header.",
        file=sys.stderr,
    )
    sys.exit(2)


def _read_secret_from_env_file() -> str:
    """Read the current DEPLOY_SECRET from /workspace/.env (bind-mounted from
    /opt/shitaleco/.env on the host). Returns "" if file missing or key absent.
    Cheap (small file) and only runs on auth checks."""
    try:
        with open("/workspace/.env") as f:
            for line in f:
                if line.startswith("DEPLOY_SECRET="):
                    return _normalize_secret(line.split("=", 1)[1].rstrip("\n"))
    except OSError:
        pass
    return ""

def _env_container(env: str) -> str:
    """Return the live backend container name for `env` ("prod"/"dev").

    For prod this is color-aware: post-cutover the active container is
    `shitaleco-backend-blue-1` or `shitaleco-backend-green-1`, read from
    `/workspace/active-color` (bind-mounted from `/opt/shitaleco/active-color`).
    When the marker file is absent we're still on the legacy single-container
    path → fall back to `shitaleco-backend-1`. Without this, System Ops shows
    prod "DOWN" after the cutover — cosmetic but the exact false-down signal
    that drove churn during the 12-Jun incident.
    """
    if env == "dev":
        return "shitaleco-dev-backend-dev-1"
    try:
        with open("/workspace/active-color") as fh:
            color = fh.read().strip().lower()
        if color in ("blue", "green"):
            return f"shitaleco-backend-{color}-1"
    except OSError:
        pass
    return "shitaleco-backend-1"


# Iteration helper — replaces the old ENV_CONTAINERS dict. Computed per-call
# so a cutover that writes /workspace/active-color is picked up immediately
# without a deployer restart.
def _env_containers() -> dict:
    return {"prod": _env_container("prod"), "dev": _env_container("dev")}


def run_script(args, script="/app/deploy.sh"):
    # Persist the script's stdout+stderr to a small ring of log files so the
    # System Ops panel (GET /last-deploy-log) can surface WHY a Promote /
    # Re-deploy click didn't take effect. Used to be DEVNULL — which is how
    # silent failures (bad GHCR auth, missing /workspace mount, immediate
    # `git fetch` crash, etc.) became "Promote triggered → nothing happens".
    log_dir = "/var/log/shital-deployer"
    os.makedirs(log_dir, exist_ok=True)
    ts = _dt.utcnow().strftime("%Y%m%dT%H%M%SZ")
    # Tag the log filename with the script name so blue/green runs don't get
    # mixed up with legacy deploy.sh runs in the directory listing.
    script_tag = os.path.basename(script).replace(".sh", "")
    safe_args = "-".join(a.lstrip("-").replace("/", "_") for a in args) or "deploy"
    log_path = os.path.join(log_dir, f"{ts}-{script_tag}-{safe_args}.log")
    # Symlink "latest" so /last-deploy-log doesn't need to scan the directory.
    latest = os.path.join(log_dir, "latest.log")
    log_fh = open(log_path, "wb")  # noqa: SIM115 — Popen owns the lifetime
    try:
        os.unlink(latest)
    except FileNotFoundError:
        pass
    try:
        os.symlink(log_path, latest)
    except OSError:
        pass
    subprocess.Popen(
        ["/bin/bash", script, *args],
        stdout=log_fh,
        stderr=subprocess.STDOUT,
    )


# ─── Promote strategy ─────────────────────────────────────────────────────────
# "legacy"   → deploy.sh --promote-prod  (existing recreate path, ~3min blip)
# "bluegreen"→ promote_bluegreen.sh      (zero-downtime, requires host cutover)
# Read at request time, not module load — so the operator can flip
# PROMOTE_STRATEGY in /opt/shitaleco/.env and the next click picks it up
# (after a deployer restart for env-var refresh, same as DEPLOY_SECRET).
def _promote_strategy() -> str:
    return (os.environ.get("PROMOTE_STRATEGY", "legacy") or "legacy").strip().lower()


def _promote_state() -> dict:
    """Read /workspace/.bluegreen-state.json if it exists, else return a
    legacy/idle stub. Cheap (small file). Used by /promote-status."""
    strategy = _promote_strategy()
    base = {"strategy": strategy}
    if strategy != "bluegreen":
        return base
    try:
        with open("/workspace/.bluegreen-state.json") as fh:
            base.update(json.load(fh))
    except (OSError, json.JSONDecodeError):
        # State file absent or unreadable — return what we know
        try:
            with open("/workspace/active-color") as fh:
                base["active_color"] = fh.read().strip() or None
        except OSError:
            base["active_color"] = None
        base["phase"] = "idle"
    return base


# ─── Ops / diagnostics ────────────────────────────────────────────────────────
# Admin → System → Ops can call POST /ops/run with {action, args}. Allowlist is
# defined here (defense-in-depth — backend also validates). Each handler returns
# {stdout, stderr, exit_code, duration_ms}.

OPS_LOG = "/var/log/shital-ops.log"

PROD_COMPOSE = "/workspace/docker-compose.prod.yml"
DEV_COMPOSE  = "/workspace/docker-compose.dev.yml"
PROD_ENV     = "/workspace/.env"
DEV_ENV      = "/workspace-dev/.env.dev"  # bind-mounted from /opt/shitaleco-dev

# Whitelisted container names per stack (prevents arbitrary container access).
PROD_CONTAINERS = {
    # Legacy single-container + new blue/green pair. All three listed so the
    # admin UI's Logs / Inspect / Restart pickers work either side of the
    # cutover. Backend code does not assume only one is running.
    "shitaleco-backend-1", "shitaleco-backend-blue-1", "shitaleco-backend-green-1",
    "shitaleco-admin-1", "shitaleco-quick-donation-1",
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
    # ⚠️ NEVER use --remove-orphans here. The dev compose references prod's
    # shitaleco_internal network as external; --remove-orphans then treats
    # every prod container on that shared network as an orphan and SIGKILLs
    # them (the 12-Jun all-day prod-outage bug). Always pass an explicit
    # project name and never sweep orphans across the shared network.
    project = "shitaleco-dev" if target == "dev" else "shitaleco"
    return _exec(["docker", "compose", "-p", project, "--env-file", env_file,
                  "-f", compose, "up", "-d", "--force-recreate"], timeout=600)


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
        sent = _normalize_secret(self.headers.get("X-Deploy-Secret") or "")
        if not sent:
            return False
        # Compare against startup value AND the current /workspace/.env value,
        # so rotating the secret in /opt/shitaleco/.env takes effect without
        # recreating this container. Both compares are constant-time.
        candidates = [s for s in (DEPLOY_SECRET, _read_secret_from_env_file()) if s]
        return any(hmac.compare_digest(sent, c) for c in candidates)

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
                self.send_response(403)
                self.end_headers()
                return
            # List promote-time snapshots. Two sources, merged by timestamp:
            #   1) DB dumps   — /workspace/backups/promote-<ts>-<sha>.sql.gz
            #   2) Image tags — ghcr.io/.../shitaleco-backend:promote-<ts>
            #
            # Listing BOTH means a snapshot remains visible even when
            # pg_dump silently fails (which was the original bug — the UI
            # showed "No snapshots yet" despite multiple successful image
            # promotions). `has_db` lets the UI grey out / warn on entries
            # that can't do a full restore.
            import glob
            import re as _re
            import subprocess

            entries_by_ts: dict[str, dict] = {}

            # 1) DB dumps
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
                entries_by_ts[ts] = {
                    "id":         ts,
                    "git_sha":    sha,
                    "db_dump":    name,
                    "size_bytes": size,
                    "created_at": ts,
                    "has_db":     True,
                    "has_images": False,
                }

            # 2) Image tags — survey the backend image (canonical reference,
            # the other 5 services get the same tag in lockstep)
            try:
                out = subprocess.check_output(
                    ["docker", "images",
                     "ghcr.io/kammelaraj-arch/shitaleco-backend",
                     "--format", "{{.Tag}}"],
                    timeout=15, stderr=subprocess.DEVNULL,
                ).decode()
                for tag in out.splitlines():
                    tag = tag.strip()
                    if not tag.startswith("promote-"):
                        continue
                    ts = tag[len("promote-"):]
                    if not _re.match(r"^\d{8}T\d{6}Z$", ts):
                        continue
                    existing = entries_by_ts.get(ts)
                    if existing:
                        existing["has_images"] = True
                    else:
                        # Image-only snapshot — pg_dump must have failed.
                        # We can still partially restore (images) — UI should
                        # warn but still let the operator pick this row.
                        entries_by_ts[ts] = {
                            "id":         ts,
                            "git_sha":    "",
                            "db_dump":    None,
                            "size_bytes": 0,
                            "created_at": ts,
                            "has_db":     False,
                            "has_images": True,
                        }
            except (subprocess.SubprocessError, OSError):
                # Docker socket might be unreachable from the deployer
                # (eg. socket not bind-mounted). Fall through with what we
                # have — DB-dump-only listing is still useful.
                pass

            entries = sorted(entries_by_ts.values(), key=lambda e: e["id"], reverse=True)
            self._send_json(200, {"snapshots": entries[:20]})
            return

        if self.path == "/promote-status":
            self._send_json(200, _promote_state())
            return

        if self.path == "/status":
            if not self._check_secret():
                self.send_response(403)
                self.end_headers()
                return
            envs = {}
            for env, container in _env_containers().items():
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

        if self.path.startswith("/last-deploy-log"):
            # Surface the tail of the most-recent deploy.sh run so the System
            # Ops panel can show WHY a Promote / Re-deploy click did or didn't
            # take effect — no SSH needed. Optional ?tail=N (default 200,
            # capped at 1000) bounds memory.
            from urllib.parse import parse_qs, urlsplit
            qs = parse_qs(urlsplit(self.path).query)
            try:
                tail = max(1, min(1000, int((qs.get("tail") or ["200"])[0])))
            except ValueError:
                tail = 200
            latest = "/var/log/shital-deployer/latest.log"
            if not os.path.exists(latest):
                self._send_json(200, {
                    "log_path": None,
                    "lines":    [],
                    "message":  "No deploy script has run yet on this deployer container.",
                })
                return
            try:
                with open(latest, "rb") as f:
                    raw = f.read()
                body = raw.decode("utf-8", errors="replace").splitlines()
                self._send_json(200, {
                    "log_path": os.path.realpath(latest),
                    "lines":    body[-tail:],
                    "size":     len(raw),
                })
            except OSError as e:
                self._send_json(500, {"error": str(e)})
            return

        self.send_response(403)
        self.end_headers()

    def do_POST(self):
        if not self._check_secret():
            self.send_response(403)
            self.end_headers()
            return

        if self.path == "/deploy":
            target = (self.headers.get("X-Deploy-Target") or "dev").lower()
            if target not in ("dev", "prod"):
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"X-Deploy-Target must be 'dev' or 'prod'")
                return
            run_script(["--target", target])
            self.send_response(202)
            self.end_headers()
            return

        if self.path == "/promote-prod":
            strategy = _promote_strategy()
            if strategy == "bluegreen":
                run_script([], script="/app/promote_bluegreen.sh")
            else:
                run_script(["--promote-prod"])
            self.send_response(202)
            self.end_headers()
            self.wfile.write(json.dumps({"strategy": strategy}).encode())
            return

        if self.path == "/promote-rollback":
            strategy = _promote_strategy()
            if strategy != "bluegreen":
                self.send_response(400)
                self.end_headers()
                self.wfile.write(
                    b"rollback only available when PROMOTE_STRATEGY=bluegreen"
                )
                return
            run_script(["--rollback"], script="/app/promote_bluegreen.sh")
            self.send_response(202)
            self.end_headers()
            return

        if self.path == "/restore":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length).decode() or "{}")
            except json.JSONDecodeError:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"invalid JSON body")
                return
            sid = (body.get("snapshot_id") or "").strip()
            # Format guard — must look like 20260506T070000Z
            import re as _re
            if not _re.match(r"^\d{8}T\d{6}Z$", sid):
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"snapshot_id must be timestamp like 20260506T070000Z")
                return
            run_script(["--restore", sid])
            self.send_response(202)
            self.end_headers()
            return

        if self.path == "/ops/run":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length).decode() or "{}")
            except json.JSONDecodeError:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"invalid JSON body")
                return
            action = body.get("action", "")
            args   = body.get("args", {}) or {}
            handler = OP_HANDLERS.get(action)
            if not handler:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(f"unknown action '{action}'".encode())
                return
            result = handler(args)
            _audit(action, args, result)
            self._send_json(200, result)
            return

        self.send_response(404)
        self.end_headers()


# ─── Autonomous watchdog REMOVED (12-Jun) ────────────────────────────────────
# This file used to run `_watchdog_loop()` in a daemon thread every 60s that
# `docker compose up -d --force-recreate`d any service it judged unhealthy or
# absent. That was THE cause of the all-day 12-Jun prod outage:
#
#   - The prod backend's cold start runs 571 schema patches (~3-4 min). After
#     the healthcheck start_period it reads as `unhealthy`, so the watchdog
#     force-recreated it → restarted the cold start → unhealthy again →
#     INFINITE crashloop. From outside, the backend container was being
#     DELETED and re-created every ~6 min (compose v5.1.3 = this container's
#     bundled compose).
#   - `docker inspect` (timeout=5s) under host load returned a timeout that
#     the loop treated as `absent`, force-recreating a perfectly HEALTHY
#     backend.
#
# Proven by isolation: with this deployer container STOPPED, the backend ran
# 9 min healthy with ZERO deletions (vs dying every ~6 min before).
#
# The deployer now acts ONLY on explicit operator commands (/deploy,
# /promote-prod, /ops/run). Crash recovery is delegated to docker's native
# `restart: unless-stopped` policy (set on every service in the compose
# files), which restarts a genuinely-crashed container IN PLACE — no
# force-recreate, no cold-start storm. The DEPLOY_WATCHDOG env var is gone;
# there is no autonomous loop to gate.


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 9000), Handler)
    server.serve_forever()
