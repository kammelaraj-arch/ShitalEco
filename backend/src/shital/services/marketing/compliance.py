"""Marketing-email compliance wrapper.

Every marketing message MUST:
  1. Check `is_opted_in(contact_id, channel)` before it fires.
  2. Carry a signed preference-centre URL in the footer so the donor
     can unsubscribe in one click (PECR / GDPR / CAN-SPAM).

`wrap_marketing_email()` does both. Transactional emails (receipts,
Gift Aid confirmations, volunteer onboarding) continue to call
`send_template()` / `send_raw_email()` directly — they are not marketing
and are not gated by opt-in.

Returned shape:
    {"ok": True,  "html": "<html>…", "text": "…"}  → caller sends it
    {"ok": False, "reason": "opted_out"}            → caller SKIPS this contact

The caller still owns the actual SMTP call (via `send_raw_email`) so
the compliance wrapper stays pure and testable without touching the
network.
"""
from __future__ import annotations

from typing import Any

from shital.api.routers.marketing_prefs import is_opted_in, prefs_url

# Footer appended to every marketing HTML body. Kept minimal — a line
# of attribution + the unsubscribe / preferences link. The donor's
# signed preference token is interpolated at send time.
_HTML_FOOTER_TMPL = """
<hr style="border:0;border-top:1px solid #e5e7eb;margin:32px 0 16px 0" />
<div style="font-family:system-ui,sans-serif;font-size:12px;color:#6b7280;line-height:1.5">
  You received this because you are a supporter of Shri Shirdi Saibaba Temple
  Association (UK charity 1138530). Update your preferences or
  <a href="{prefs_url}" style="color:#6b7280;text-decoration:underline">unsubscribe</a>
  — one click, no questions.
</div>
"""

_TEXT_FOOTER_TMPL = (
    "\n\n--\n"
    "Shri Shirdi Saibaba Temple Association (UK charity 1138530).\n"
    "Update preferences or unsubscribe: {prefs_url}\n"
)


async def wrap_marketing_email(
    *, contact_id: str, html: str, text: str = "",
    channel: str = "email",
) -> dict[str, Any]:
    """Opt-in-gate + footer-append a marketing email body.

    Returns a dict with `ok` indicating whether the send should proceed.
    On opt-out, body fields are omitted — the caller's job is to SKIP
    the send entirely (not send an empty email).
    """
    if not contact_id:
        return {"ok": False, "reason": "missing_contact_id"}

    if not await is_opted_in(contact_id, channel):
        return {"ok": False, "reason": "opted_out", "channel": channel}

    url = prefs_url(contact_id)
    html_out = (html or "") + _HTML_FOOTER_TMPL.format(prefs_url=url)
    text_out = (text or "") + _TEXT_FOOTER_TMPL.format(prefs_url=url)
    return {"ok": True, "html": html_out, "text": text_out, "prefs_url": url}


__all__ = ["wrap_marketing_email"]
