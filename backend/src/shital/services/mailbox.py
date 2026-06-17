"""Microsoft Graph mailbox client — two auth paths for the mail agent.

Picks the auth mode at token time:

  • If MAIL_AGENT_USER + MAIL_AGENT_PASSWORD are set → uses ROPC (Resource
    Owner Password Credentials) delegated OAuth. The service account signs
    in as itself and must have FullAccess on each shared mailbox (set up
    via Exchange Online: `Add-MailboxPermission`). The account MUST NOT
    have MFA enabled — Microsoft blocks ROPC otherwise.

  • Else, falls back to client_credentials (app-only). Requires the Azure
    AD app to have Mail.Read APPLICATION permission with admin consent,
    plus an ApplicationAccessPolicy scoping the app to just the watched
    mailboxes. Microsoft's recommended long-term path, but needs IT admin
    setup before it'll work.

Both modes hit identical /users/{mailbox}/messages endpoints — the only
difference is how the bearer token is acquired. Caller code is unchanged.

Token is cached in-process for ~50 min (Graph tokens are 60-min). No DB
persistence — short-lived, refresh-on-demand.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from shital.core.fabrics.config import settings

logger = logging.getLogger("shital.mailbox")

_GRAPH = "https://graph.microsoft.com/v1.0"
_TOKEN_URL_FMT = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

_token_cache: dict[str, Any] = {"value": "", "exp": 0.0, "mode": ""}


async def _token() -> str:
    """Acquire a Graph bearer token. ROPC if MAIL_AGENT_USER is set, else
    client_credentials. Cached until 60s before expiry."""
    now = time.time()
    if _token_cache["value"] and _token_cache["exp"] > now + 60:
        return str(_token_cache["value"])

    # Resolve Graph credentials from the encrypted API-key store first, falling
    # back to env-var-loaded settings. The store is where the Admin → API Keys
    # page writes, so operators can configure the mail agent entirely from the
    # UI without setting container env vars or redeploying. SecretsManager.get
    # itself already layers store → os.environ → fallback.
    from shital.core.fabrics.secrets import SecretsManager
    tenant_id     = await SecretsManager.get("MS_TENANT_ID",       settings.MS_TENANT_ID)
    client_id     = await SecretsManager.get("MS_CLIENT_ID",       settings.MS_CLIENT_ID)
    client_secret = await SecretsManager.get("MS_CLIENT_SECRET",   settings.MS_CLIENT_SECRET)
    agent_user    = await SecretsManager.get("MAIL_AGENT_USER",    settings.MAIL_AGENT_USER)
    agent_pw      = await SecretsManager.get("MAIL_AGENT_PASSWORD", settings.MAIL_AGENT_PASSWORD)

    if not (tenant_id and client_id):
        raise RuntimeError("MS_CLIENT_ID / MS_TENANT_ID not configured")
    url = _TOKEN_URL_FMT.format(tenant=tenant_id)

    # ── Path A: service account ROPC (delegated) ────────────────────────────
    if agent_user and agent_pw:
        # Scope must be a SPECIFIC delegated permission for ROPC — `.default`
        # works for app-only but not reliably for ROPC unless the app has
        # admin-consented delegated perms. Asking for Mail.Read directly is
        # the well-trodden path.
        data: dict[str, str] = {
            "client_id":  client_id,
            "grant_type": "password",
            "username":   agent_user,
            "password":   agent_pw,
            "scope":      "https://graph.microsoft.com/Mail.Read offline_access",
        }
        # If the Azure AD app is a confidential client, include the secret.
        # Some tenants reject ROPC without it; some require its absence.
        if client_secret:
            data["client_secret"] = client_secret
        mode = "ropc"

    # ── Path B: app-only client_credentials (no user) ───────────────────────
    else:
        if not client_secret:
            raise RuntimeError("Need MAIL_AGENT_USER+PASSWORD (delegated) "
                               "or MS_CLIENT_SECRET (app-only) to acquire a token")
        data = {
            "client_id":     client_id,
            "client_secret": client_secret,
            "scope":         "https://graph.microsoft.com/.default",
            "grant_type":    "client_credentials",
        }
        mode = "app"

    async with httpx.AsyncClient(timeout=20) as cx:
        r = await cx.post(url, data=data)
    if r.status_code >= 400:
        # Surface AAD error code without leaking the password in the log line.
        err = r.json().get("error_description", "")[:160] if r.headers.get("content-type", "").startswith("application/json") else r.text[:160]
        raise RuntimeError(f"AAD token request failed ({r.status_code}, mode={mode}): {err}")

    body = r.json()
    _token_cache["value"] = body["access_token"]
    _token_cache["exp"]   = now + int(body.get("expires_in", 3600))
    if _token_cache["mode"] != mode:
        who = agent_user if mode == "ropc" else "<app-only>"
        logger.info("mailbox_auth_mode mode=%s user=%s", mode, who)
        _token_cache["mode"] = mode
    return str(body["access_token"])


async def list_new_messages(mailbox: str, *, since_iso: str | None = None,
                            top: int = 25) -> list[dict[str, Any]]:
    """Return messages from `mailbox` received after `since_iso` (UTC ISO 8601).

    Newest first. `top` caps results — agent processes one mailbox per poll and
    leaves the rest for next sweep, so 25 is plenty for a 5-min cadence."""
    tok = await _token()
    params: dict[str, str] = {
        "$select": "id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,conversationId",
        "$orderby": "receivedDateTime desc",
        "$top": str(top),
    }
    if since_iso:
        params["$filter"] = f"receivedDateTime ge {since_iso}"
    async with httpx.AsyncClient(timeout=30) as cx:
        r = await cx.get(f"{_GRAPH}/users/{mailbox}/messages", params=params,
                         headers={"Authorization": f"Bearer {tok}"})
    r.raise_for_status()
    return list(r.json().get("value", []))


async def get_message_body(mailbox: str, message_id: str) -> dict[str, Any]:
    """Full message with body (text + html). Separate call from list because
    Graph's $select on /messages returns bodyPreview only, not the full body."""
    tok = await _token()
    async with httpx.AsyncClient(timeout=30) as cx:
        r = await cx.get(
            f"{_GRAPH}/users/{mailbox}/messages/{message_id}",
            params={"$select": "id,subject,from,body,receivedDateTime,toRecipients,ccRecipients"},
            headers={"Authorization": f"Bearer {tok}"},
        )
    r.raise_for_status()
    return dict(r.json())


async def list_attachments(mailbox: str, message_id: str) -> list[dict[str, Any]]:
    """Attachment metadata only — `contentBytes` is fetched lazily by
    `get_attachment` because Graph base64-encodes inline and big PDFs balloon
    the response."""
    tok = await _token()
    async with httpx.AsyncClient(timeout=30) as cx:
        r = await cx.get(
            f"{_GRAPH}/users/{mailbox}/messages/{message_id}/attachments",
            params={"$select": "id,name,contentType,size,isInline"},
            headers={"Authorization": f"Bearer {tok}"},
        )
    r.raise_for_status()
    return list(r.json().get("value", []))


async def get_attachment(mailbox: str, message_id: str,
                         attachment_id: str) -> dict[str, Any]:
    """Single attachment with `contentBytes` (base64). Returns the raw Graph
    object — caller decodes."""
    tok = await _token()
    async with httpx.AsyncClient(timeout=60) as cx:
        r = await cx.get(
            f"{_GRAPH}/users/{mailbox}/messages/{message_id}/attachments/{attachment_id}",
            headers={"Authorization": f"Bearer {tok}"},
        )
    r.raise_for_status()
    return dict(r.json())
