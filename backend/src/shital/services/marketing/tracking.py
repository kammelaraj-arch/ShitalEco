"""Open + click tracking helpers for marketing campaigns.

Design
------
* Tokens are purpose-scoped JWTs bound to (campaign_id, contact_id,
  kind). JWT_SECRET is shared with the rest of the magic-link stack
  but the purpose discriminator ('track_open' / 'track_click') means
  a token can't cross-replay against voting / prefs / info-request
  endpoints.
* Pixel: a 1×1 transparent GIF (43 bytes) served by the webhook on
  /api/v1/webhooks/marketing/open?t=<jwt>. We never 302 from the
  pixel — clients wouldn't follow — just record and return the bytes.
* Click: outbound links are rewritten to
  /api/v1/webhooks/marketing/click?t=<jwt>&u=<url_safe_base64 of real URL>.
  On GET, record and 302 to the decoded URL.
* Unsubscribe / preference-centre links are deliberately NOT rewritten
  — they live in the compliance footer and must work even if the
  tracker is down.

Pixel + click endpoints live in `api/routers/marketing_webhooks.py`
(same router as the SES bounce webhook).
"""
from __future__ import annotations

import base64
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from jose import JWTError, jwt

from shital.core.fabrics.config import settings

# 1×1 transparent GIF — 43 bytes, same as every tracker in the wild.
TRACKING_PIXEL_GIF = (
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!"
    b"\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00"
    b"\x00\x02\x02D\x01\x00;"
)

_TOKEN_TTL_DAYS = 90  # matches prefs token horizon


def _mint(contact_id: str | None, campaign_id: str, kind: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "cid": campaign_id,
        "sub": contact_id or "",
        "p":   kind,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=_TOKEN_TTL_DAYS)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def mint_open_token(contact_id: str | None, campaign_id: str) -> str:
    return _mint(contact_id, campaign_id, "track_open")


def mint_click_token(contact_id: str | None, campaign_id: str) -> str:
    return _mint(contact_id, campaign_id, "track_click")


def decode_token(token: str, expected_kind: str) -> tuple[str, str | None]:
    """Return (campaign_id, contact_id_or_None). Raise HTTPException on
    bad/wrong-purpose/expired. Never raises on a KNOWN-unknown contact
    (contact_id is '' for external-list sends — stored as '')."""
    try:
        payload: dict[str, Any] = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        raise HTTPException(401, detail="Bad tracking token") from None
    if payload.get("p") != expected_kind:
        raise HTTPException(401, detail="Wrong token purpose")
    cid = str(payload.get("cid") or "").strip()
    sub = str(payload.get("sub") or "").strip() or None
    if not cid:
        raise HTTPException(401, detail="Token missing campaign id")
    return cid, sub


# ─── URL rewriting ───────────────────────────────────────────────────────────
# Match every <a href="…"> where the href doesn't already point at the
# tracking endpoint and isn't the unsubscribe footer. Keep attributes
# that appear before AND after the href exactly as they were.
_HREF_RE = re.compile(
    r'(<a\b[^>]*?\bhref=")([^"]+)(")',
    re.IGNORECASE,
)


def _encode_url(url: str) -> str:
    return base64.urlsafe_b64encode(url.encode("utf-8")).rstrip(b"=").decode("ascii")


def decode_url_param(encoded: str) -> str:
    # Add back padding stripped by urlsafe_b64encode.
    pad = "=" * (-len(encoded) % 4)
    try:
        return base64.urlsafe_b64decode(encoded + pad).decode("utf-8")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, detail=f"Bad u param: {exc}") from exc


def rewrite_for_tracking(
    html: str, *, campaign_id: str, contact_id: str | None,
    tracker_base: str,
    skip_url_fragments: tuple[str, ...] = ("/prefs", "/unsubscribe", "/me/prefs"),
) -> str:
    """Wrap every tracked <a href> with the click endpoint and append a
    1×1 pixel at the end of the body. Returns the modified HTML."""
    if not html:
        return html

    click_tok = mint_click_token(contact_id, campaign_id)
    open_tok  = mint_open_token(contact_id, campaign_id)
    base = tracker_base.rstrip("/")

    def _wrap(m: re.Match[str]) -> str:
        prefix, raw_href, suffix = m.group(1), m.group(2), m.group(3)
        # Preserve already-wrapped / unsubscribe / mailto / anchors.
        if (
            raw_href.startswith("mailto:") or raw_href.startswith("#")
            or raw_href.startswith(f"{base}/api/v1/webhooks/marketing/")
            or any(f in raw_href for f in skip_url_fragments)
        ):
            return m.group(0)
        encoded = _encode_url(raw_href)
        new_url = f"{base}/api/v1/webhooks/marketing/click?t={click_tok}&u={encoded}"
        return f"{prefix}{new_url}{suffix}"

    rewritten = _HREF_RE.sub(_wrap, html)

    # Open pixel — append at the very end. Clients that don't render
    # HTML (Apple Mail Privacy pre-fetch aside) simply won't fetch it.
    pixel = (
        f'<img src="{base}/api/v1/webhooks/marketing/open?t={open_tok}" '
        f'width="1" height="1" alt="" style="display:none;border:0;max-width:0;max-height:0;overflow:hidden" />'
    )
    return rewritten + pixel


__all__ = [
    "TRACKING_PIXEL_GIF",
    "mint_open_token", "mint_click_token", "decode_token",
    "decode_url_param", "rewrite_for_tracking",
]
