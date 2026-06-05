"""YouTube Data API v3 client — minimal, just enough to detect when the
temple's channel is currently live-streaming and surface the active
video id to the public TV page.

Pull paths used:
  • GET /search?part=snippet&channelId=…&eventType=live&type=video
      Returns the currently-live broadcast(s) for the channel. Cheaper
      than calling /videos for every recent upload.

Auth: a YouTube Data API v3 API key (free tier 10,000 units/day).
Stored encrypted in api_keys_store under YOUTUBE_DATA_API_KEY.

Caching: the public /broadcast/now endpoint hits this every minute per
viewer. With dozens of viewers we'd burn the quota fast. The check_live()
function caches the answer for 30 seconds in-process so 100 concurrent
page loads = 1 API call per 30s.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger("shital.youtube")

_API = "https://www.googleapis.com/youtube/v3"

# Tiny in-process cache. Keys are channel_id, values are (timestamp, result).
_LIVE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 30  # seconds


async def _api_key() -> str | None:
    """Resolve the API key from SecretsManager first, env var fallback."""
    try:
        from shital.core.fabrics.secrets import SecretsManager
        stored = await SecretsManager.get("YOUTUBE_DATA_API_KEY")
        if stored and stored.strip():
            return stored.strip()
    except Exception:  # noqa: BLE001
        pass
    try:
        from shital.core.fabrics.config import settings
        v = getattr(settings, "YOUTUBE_DATA_API_KEY", "")
        if v and v.strip():
            return v.strip()
    except Exception:  # noqa: BLE001
        pass
    return None


async def _channel_id() -> str | None:
    """Resolve the configured channel ID."""
    try:
        from shital.core.fabrics.secrets import SecretsManager
        stored = await SecretsManager.get("YOUTUBE_CHANNEL_ID")
        if stored and stored.strip():
            return stored.strip()
    except Exception:  # noqa: BLE001
        pass
    return None


async def channel_handle() -> str | None:
    """Resolve the configured channel handle (e.g. '@ShirdiSaiTempleUK')."""
    try:
        from shital.core.fabrics.secrets import SecretsManager
        h = await SecretsManager.get("YOUTUBE_CHANNEL_HANDLE")
        if h and h.strip():
            return h.strip()
    except Exception:  # noqa: BLE001
        pass
    return None


async def check_live(channel_id: str | None = None) -> dict[str, Any]:
    """Return live-status info for the channel.

    Returns:
      {
        "configured":      bool,   # is the channel+key set up?
        "is_live":         bool,   # is a stream live right now?
        "video_id":        str,    # YouTube video ID of the live stream
        "title":           str,
        "thumbnail_url":   str,
        "channel_id":      str,
        "channel_handle":  str,
        "stale":           bool,   # served from cache
        "checked_at":      iso8601,
      }

    Never raises. Errors return {configured: ..., is_live: false, error: ...}.
    """
    from datetime import UTC, datetime

    cid = (channel_id or "").strip() or await _channel_id()
    api_key = await _api_key()
    handle = await channel_handle() or ""

    base: dict[str, Any] = {
        "configured":     bool(cid and api_key),
        "is_live":        False,
        "video_id":       "",
        "title":          "",
        "thumbnail_url":  "",
        "channel_id":     cid or "",
        "channel_handle": handle,
        "stale":          False,
        "checked_at":     datetime.now(UTC).isoformat(),
    }
    if not cid or not api_key:
        return base

    # Cache hit?
    cached = _LIVE_CACHE.get(cid)
    if cached and (time.time() - cached[0]) < _CACHE_TTL:
        out = dict(cached[1])
        out["stale"] = True
        return out

    try:
        async with httpx.AsyncClient(timeout=10) as cx:
            r = await cx.get(f"{_API}/search", params={
                "part":        "snippet",
                "channelId":   cid,
                "eventType":   "live",
                "type":        "video",
                "maxResults":  "1",
                "key":         api_key,
            })
        if r.status_code == 403:
            base["error"] = "API key rejected or quota exceeded"
            return base
        if r.status_code >= 400:
            base["error"] = f"YouTube API returned {r.status_code}"
            return base
        items = (r.json() or {}).get("items") or []
        if items:
            it = items[0]
            sn = it.get("snippet") or {}
            base["is_live"]       = True
            base["video_id"]      = (it.get("id") or {}).get("videoId") or ""
            base["title"]         = sn.get("title") or ""
            base["thumbnail_url"] = ((sn.get("thumbnails") or {}).get("medium") or {}).get("url") or ""
    except Exception as exc:  # noqa: BLE001
        base["error"] = f"YouTube fetch failed: {exc}"
        return base

    _LIVE_CACHE[cid] = (time.time(), base)
    return base
