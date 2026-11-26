"""Microsoft Graph SharePoint search — thin client used by the Board
Resolution wizard's "Pick from SharePoint" feature.

Reuses the same Azure AD App (MS_CLIENT_ID / MS_CLIENT_SECRET / MS_TENANT_ID)
the mailbox agent already uses. App-only mode via client_credentials; the
app registration needs `Files.Read.All` or `Sites.Read.All` consented.

Returns a trimmed set of fields safe to pass to the frontend — nothing
sensitive beyond the SharePoint webUrl, which a trustee would see in
SharePoint directly anyway.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from shital.core.fabrics.config import settings

logger = logging.getLogger("shital.graph_sharepoint")

_GRAPH = "https://graph.microsoft.com/v1.0"
_TOKEN_URL_FMT = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

_token_cache: dict[str, Any] = {"value": "", "exp": 0.0}


async def _token() -> str:
    """App-only Graph bearer token, cached until 60 s before expiry.

    Scope is ``.default`` which picks up every application permission
    admin-consented for the app registration — Sites.Read.All /
    Files.Read.All on the charity's M365 tenant.
    """
    now = time.time()
    if _token_cache["value"] and _token_cache["exp"] > now + 60:
        return str(_token_cache["value"])

    if not (settings.MS_TENANT_ID and settings.MS_CLIENT_ID and settings.MS_CLIENT_SECRET):
        raise RuntimeError(
            "SharePoint search needs MS_TENANT_ID + MS_CLIENT_ID + MS_CLIENT_SECRET",
        )

    url = _TOKEN_URL_FMT.format(tenant=settings.MS_TENANT_ID)
    data = {
        "client_id":     settings.MS_CLIENT_ID,
        "client_secret": settings.MS_CLIENT_SECRET,
        "scope":         "https://graph.microsoft.com/.default",
        "grant_type":    "client_credentials",
    }
    async with httpx.AsyncClient(timeout=20) as cx:
        r = await cx.post(url, data=data)
    if r.status_code >= 400:
        err = ""
        try:
            err = r.json().get("error_description", "")[:180]
        except Exception:  # noqa: BLE001
            err = r.text[:180]
        raise RuntimeError(f"AAD token request failed ({r.status_code}): {err}")

    body = r.json()
    _token_cache["value"] = body["access_token"]
    _token_cache["exp"]   = now + int(body.get("expires_in", 3600))
    return str(body["access_token"])


async def search_files(query: str, *, top: int = 25) -> list[dict[str, Any]]:
    """Search SharePoint + OneDrive-for-Business document libraries across
    the tenant for files matching ``query``. Returns up to ``top`` hits.

    Uses Graph's cross-service /search/query endpoint which hits the
    Microsoft 365 search index — same results the user would see in
    SharePoint's own search bar. Falls back to an empty list on any
    non-200 response rather than raising, so the UI stays usable when
    SharePoint is down or the app registration lacks permission.
    """
    q = (query or "").strip()
    if not q:
        return []

    top = max(1, min(int(top), 50))

    try:
        tok = await _token()
    except Exception as exc:  # noqa: BLE001
        logger.warning("sharepoint_search_token_failed", exc_info=True)
        raise RuntimeError(f"SharePoint search unavailable: {exc}") from exc

    payload = {
        "requests": [{
            "entityTypes": ["driveItem"],
            "query": {"queryString": q},
            "from": 0,
            "size": top,
            # Sort doesn't accept relevance, which is the default — leave it out.
            "fields": [
                "name", "webUrl", "lastModifiedDateTime", "size",
                "parentReference",
            ],
        }],
    }
    async with httpx.AsyncClient(timeout=20) as cx:
        r = await cx.post(
            f"{_GRAPH}/search/query",
            json=payload,
            headers={
                "Authorization": f"Bearer {tok}",
                "Content-Type":  "application/json",
            },
        )
    if r.status_code >= 400:
        snippet = ""
        try:
            snippet = r.json().get("error", {}).get("message", "")[:220]
        except Exception:  # noqa: BLE001
            snippet = r.text[:220]
        logger.warning("sharepoint_search_http_%s: %s", r.status_code, snippet)
        raise RuntimeError(f"SharePoint search failed ({r.status_code}): {snippet}")

    out: list[dict[str, Any]] = []
    data = r.json() or {}
    for resp in data.get("value") or []:
        for container in resp.get("hitsContainers") or []:
            for hit in container.get("hits") or []:
                res = hit.get("resource") or {}
                name = res.get("name") or ""
                web_url = res.get("webUrl") or ""
                if not web_url or not name:
                    continue
                parent = res.get("parentReference") or {}
                out.append({
                    "id":           hit.get("hitId") or res.get("id") or "",
                    "name":         name,
                    "web_url":      web_url,
                    "modified_at":  res.get("lastModifiedDateTime") or "",
                    "size_bytes":   int(res.get("size") or 0),
                    "site_path":    parent.get("path") or parent.get("name") or "",
                })
    return out
