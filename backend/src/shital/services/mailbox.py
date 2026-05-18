"""Microsoft Graph mailbox client — app-only access for the mail agent.

Uses client_credentials grant against the Azure AD app already configured for
SSO (MS_CLIENT_ID / MS_TENANT_ID / MS_CLIENT_SECRET). Requires the app to
have the `Mail.Read` *application* permission granted with admin consent, and
an ApplicationAccessPolicy scoping it to the three shared mailboxes — otherwise
Graph rejects with 403 for any mailbox the policy doesn't include.

Token is cached in-process for ~50 min (Graph tokens are 60-min). No DB
persistence — short-lived, refresh-on-demand.
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from shital.core.fabrics.config import settings

_GRAPH = "https://graph.microsoft.com/v1.0"
_TOKEN_URL_FMT = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

_token_cache: dict[str, Any] = {"value": "", "exp": 0.0}


async def _token() -> str:
    """App-only access token via client_credentials. Cached in-process."""
    now = time.time()
    if _token_cache["value"] and _token_cache["exp"] > now + 60:
        return str(_token_cache["value"])
    if not (settings.MS_TENANT_ID and settings.MS_CLIENT_ID and settings.MS_CLIENT_SECRET):
        raise RuntimeError("MS_CLIENT_ID / MS_TENANT_ID / MS_CLIENT_SECRET not configured")
    url = _TOKEN_URL_FMT.format(tenant=settings.MS_TENANT_ID)
    async with httpx.AsyncClient(timeout=20) as cx:
        r = await cx.post(url, data={
            "client_id":     settings.MS_CLIENT_ID,
            "client_secret": settings.MS_CLIENT_SECRET,
            "scope":         "https://graph.microsoft.com/.default",
            "grant_type":    "client_credentials",
        })
    r.raise_for_status()
    body = r.json()
    _token_cache["value"] = body["access_token"]
    _token_cache["exp"]   = now + int(body.get("expires_in", 3600))
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
