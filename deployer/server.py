import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

DEPLOY_SECRET = os.environ.get("DEPLOY_SECRET", "")

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


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _check_secret(self) -> bool:
        return self.headers.get("X-Deploy-Secret") == DEPLOY_SECRET

    def _send_json(self, code: int, body: dict):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/status":
            if not self._check_secret():
                self.send_response(403); self.end_headers(); return
            envs = {}
            for env, container in ENV_CONTAINERS.items():
                running = inspect_container(container)
                tag = "dev" if env == "dev" else "latest"
                meta = image_metadata(tag)
                sha = meta.get("GIT_SHA", "")
                envs[env] = {
                    "container": container,
                    **running,
                    "git_sha": sha,
                    "git_sha_short": sha[:7] if sha and sha != "dev" else sha,
                    "build_time": meta.get("BUILD_TIME"),
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

        self.send_response(404); self.end_headers()


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 9000), Handler)
    server.serve_forever()
