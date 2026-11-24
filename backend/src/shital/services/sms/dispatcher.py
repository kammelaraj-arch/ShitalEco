"""One function (`dispatch_sms`) routes outbound SMS to GOV.UK Notify or
Twilio based on `SMS_PROVIDER`. Both talk plain HTTPS — no SDKs needed,
keeps the dep surface small.

Config surface (env or admin Secrets Manager):
  SMS_PROVIDER             'notify' (default — UK charity, free up to
                            250k/yr) | 'twilio'
  NOTIFY_API_KEY           full key from the Notify dashboard —
                            "live-xxxxxxxx-xxxx-xxxx-..." OR
                            "test-xxxxxxxx-..." for sandboxing
  NOTIFY_TEMPLATE_ID       template UUID from the Notify dashboard that
                            carries a {{ body }} personalisation
                            placeholder (Notify doesn't send raw body
                            text — every message goes through a
                            pre-approved template)
  NOTIFY_SMS_SENDER_ID     optional sender id to pin a specific sender
                            (otherwise Notify's default is used)

  TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER — only
  used when SMS_PROVIDER=twilio.

Return shape is always `{ok, provider, id?, reason?, detail?}`:
Never raises; the caller logs status without needing to care about
which adapter ran.
"""
from __future__ import annotations

from typing import Any

import httpx

from shital.core.fabrics.secrets import SecretsManager


async def _env(name: str, fallback: str = "") -> str:
    return (await SecretsManager.get(name, fallback=fallback)) or fallback


async def _send_via_notify(to_phone: str, body: str) -> dict[str, Any]:
    key   = await _env("NOTIFY_API_KEY")
    tpl   = await _env("NOTIFY_TEMPLATE_ID")
    sender = await _env("NOTIFY_SMS_SENDER_ID")  # optional
    if not key or not tpl:
        return {"ok": False, "provider": "notify",
                "reason": "notify_not_configured",
                "detail": "Set NOTIFY_API_KEY and NOTIFY_TEMPLATE_ID"}

    # Notify's API expects personalisation keyed to placeholders in
    # the approved template. We ship every SMS through one `generic`
    # template with a single `{{ body }}` placeholder — the operator
    # creates it once in the Notify dashboard.
    payload: dict[str, Any] = {
        "phone_number":    to_phone,
        "template_id":     tpl,
        "personalisation": {"body": body},
    }
    if sender:
        payload["sms_sender_id"] = sender

    headers = {
        "Authorization": f"ApiKey-v1 {key}",
        "Content-Type":  "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.post(
                "https://api.notifications.service.gov.uk/v2/notifications/sms",
                headers=headers, json=payload,
            )
            if r.status_code >= 400:
                return {"ok": False, "provider": "notify",
                        "reason": f"notify_{r.status_code}",
                        "detail": r.text[:500]}
            body = r.json()
            return {"ok": True, "provider": "notify", "id": body.get("id", "")}
    except Exception as exc:
        return {"ok": False, "provider": "notify",
                "reason": "notify_error", "detail": str(exc)[:300]}


async def _send_via_twilio(to_phone: str, body: str) -> dict[str, Any]:
    sid = await _env("TWILIO_ACCOUNT_SID")
    tok = await _env("TWILIO_AUTH_TOKEN")
    frm = await _env("TWILIO_FROM_NUMBER")
    if not (sid and tok and frm):
        return {"ok": False, "provider": "twilio",
                "reason": "twilio_not_configured"}
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.post(url, auth=(sid, tok),
                               data={"To": to_phone, "From": frm, "Body": body})
            if r.status_code >= 400:
                return {"ok": False, "provider": "twilio",
                        "reason": f"twilio_{r.status_code}",
                        "detail": r.text[:300]}
            return {"ok": True, "provider": "twilio", "id": r.json().get("sid", "")}
    except Exception as exc:
        return {"ok": False, "provider": "twilio",
                "reason": "twilio_error", "detail": str(exc)[:300]}


async def dispatch_sms(
    *, to_phone: str, body: str, provider: str | None = None,
) -> dict[str, Any]:
    chosen = (provider or await _env("SMS_PROVIDER", "notify")).strip().lower()
    if chosen == "twilio":
        return await _send_via_twilio(to_phone, body)
    # Notify is the default — cheapest + UK-native for a registered charity.
    return await _send_via_notify(to_phone, body)
