import os
import threading
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

DEPLOY_SECRET = os.environ.get("DEPLOY_SECRET", "")

# Map of webhook path → script to run inside the deployer container.
# /workspace is the host's /opt/shitaleco bind-mount, so the Neuron
# script is reachable as a normal file.
DEPLOY_TARGETS = {
    "/deploy":         "/app/deploy.sh",
    "/deploy/neuron":  "/app/deploy_neuron.sh",
}


def run_deploy(script_path: str):
    subprocess.Popen(
        ["/bin/bash", script_path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        script = DEPLOY_TARGETS.get(self.path)
        if script and self.headers.get("X-Deploy-Secret") == DEPLOY_SECRET:
            threading.Thread(target=run_deploy, args=(script,), daemon=True).start()
            self.send_response(202)
            self.end_headers()
        else:
            self.send_response(403)
            self.end_headers()

    def do_GET(self):
        self.send_response(403)
        self.end_headers()


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 9000), Handler)
    server.serve_forever()
