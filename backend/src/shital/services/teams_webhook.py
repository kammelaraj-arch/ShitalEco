"""Microsoft Teams Incoming Webhook — alert sink for the mail agent.

No-ops silently when TEAMS_WEBHOOK_URL is unset so dev stacks don't fail.
"""
from __future__ import annotations

import httpx

from shital.core.fabrics.config import settings


_THEME = {
    "red":   "D13438",
    "amber": "FF8C00",
    "green": "107C10",
}


async def send_alert(title: str, message: str, *, severity: str = "amber",
                     facts: dict[str, str] | None = None,
                     link_url: str = "", link_label: str = "Open in Admin") -> bool:
    """Post a MessageCard to the configured Teams channel. Returns True if
    Teams accepted (200), False otherwise. Never raises — alerts are best-effort."""
    if not settings.TEAMS_WEBHOOK_URL:
        return False
    payload: dict[str, object] = {
        "@type":      "MessageCard",
        "@context":   "https://schema.org/extensions",
        "themeColor": _THEME.get(severity, _THEME["amber"]),
        "summary":    title,
        "title":      title,
        "text":       message,
    }
    if facts:
        payload["sections"] = [{"facts": [{"name": k, "value": v} for k, v in facts.items()]}]
    if link_url:
        payload["potentialAction"] = [{
            "@type": "OpenUri",
            "name":  link_label,
            "targets": [{"os": "default", "uri": link_url}],
        }]
    try:
        async with httpx.AsyncClient(timeout=10) as cx:
            r = await cx.post(settings.TEAMS_WEBHOOK_URL, json=payload)
        return r.status_code in (200, 202)
    except Exception:
        return False
