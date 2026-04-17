import os
import threading
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

DEPLOY_SECRET = os.environ.get("DEPLOY_SECRET", "")


def run_deploy():
    subprocess.Popen(
        ["/bin/bash", "/app/deploy.sh"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        if self.path == "/deploy" and self.headers.get("X-Deploy-Secret") == DEPLOY_SECRET:
            threading.Thread(target=run_deploy, daemon=True).start()
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
