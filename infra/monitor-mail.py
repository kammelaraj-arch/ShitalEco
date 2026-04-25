#!/usr/bin/env python3
"""
Send a notification email via Microsoft Graph using application (client-credentials)
auth. Reads MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET from env (loaded from
/opt/shitaleco/.env). Stdin is the plain-text body. Exits non-zero on failure so
monitor.sh can log the error.

Requires the app registration to have `Mail.Send` *application* permission with
admin consent. Sends from a fixed mailbox so the recipients always see who it
came from.

Usage:
  echo "body text" | monitor-mail.py --to a@x.com,b@y.com --subject "Alert"
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

ENV_FILE = "/opt/shitaleco/.env"
SENDER = "it@shirdisai.org.uk"
GRAPH = "https://graph.microsoft.com/v1.0"
LOGIN = "https://login.microsoftonline.com"


def load_env() -> None:
    if not os.path.exists(ENV_FILE):
        return
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k.strip(), v)


def get_token(tenant: str, cid: str, secret: str) -> str:
    body = urllib.parse.urlencode({
        "client_id": cid,
        "client_secret": secret,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode()
    req = urllib.request.Request(
        f"{LOGIN}/{tenant}/oauth2/v2.0/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.load(r)
    return data["access_token"]


def send(token: str, recipients: list[str], subject: str, body_text: str) -> None:
    msg = {
        "message": {
            "subject": subject,
            "body": {"contentType": "Text", "content": body_text},
            "toRecipients": [{"emailAddress": {"address": a}} for a in recipients],
        },
        "saveToSentItems": True,
    }
    req = urllib.request.Request(
        f"{GRAPH}/users/{SENDER}/sendMail",
        data=json.dumps(msg).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        if r.status not in (202, 200):
            raise RuntimeError(f"Graph sendMail returned HTTP {r.status}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--to", required=True, help="Comma-separated recipient list")
    p.add_argument("--subject", required=True)
    args = p.parse_args()

    body = sys.stdin.read()
    if not body.strip():
        print("ERROR: empty body on stdin", file=sys.stderr)
        return 2

    load_env()
    tenant = os.environ.get("MS_TENANT_ID", "")
    cid = os.environ.get("MS_CLIENT_ID", "")
    secret = os.environ.get("MS_CLIENT_SECRET", "")
    missing = [k for k, v in (("MS_TENANT_ID", tenant), ("MS_CLIENT_ID", cid),
                              ("MS_CLIENT_SECRET", secret)) if not v]
    if missing:
        print(f"ERROR: missing env: {','.join(missing)}", file=sys.stderr)
        return 3

    recipients = [a.strip() for a in args.to.split(",") if a.strip()]
    if not recipients:
        print("ERROR: no recipients", file=sys.stderr)
        return 4

    try:
        token = get_token(tenant, cid, secret)
        send(token, recipients, args.subject, body)
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace")[:500]
        print(f"ERROR: HTTP {e.code} from {e.url}\n{body_err}", file=sys.stderr)
        return 5
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 6

    print(f"sent to {','.join(recipients)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
