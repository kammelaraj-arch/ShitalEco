"""One function (`dispatch_email`) that routes outbound mail to the
configured provider. Keeps the rest of the codebase blind to whether
a given send goes through Office365 SMTP or AWS SES.

Provider choice
---------------
Env / SecretsManager keys read at call time:
  MAIL_PROVIDER           — 'office365' (default) | 'ses' | 'notify' (GOV.UK, free for charities)
  NOTIFY_API_KEY          — live-xxxxxxxx-...
  NOTIFY_EMAIL_TEMPLATE_ID — uuid of a Notify template with ((subject))
                            and ((body)) personalisations; one generic
                            passthrough template is enough
  OFFICE365_EMAIL / _PASSWORD
  AWS_SES_SMTP_HOST       — e.g. email-smtp.eu-west-1.amazonaws.com
  AWS_SES_SMTP_PORT       — 587 (STARTTLS) default
  AWS_SES_SMTP_USER       — SES SMTP username (not an IAM key directly;
                            SES has a derivation step but the UI shows
                            you the SMTP credential pair)
  AWS_SES_SMTP_PASSWORD   — SES SMTP password
  AWS_SES_FROM            — verified sender (defaults to OFFICE365_EMAIL)

A caller can force a provider for one send with `provider=`.

Why SMTP against SES (not the HTTPS API)?
-----------------------------------------
smtplib is already in the deps and in the audit-logged send loop.
Swapping SMTP hosts keeps the retry / TLS / timeout behaviour
identical. The HTTPS API would cost boto3 + aiobotocore + credential
plumbing for negligible benefit at our volumes.
"""
from __future__ import annotations

import asyncio
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from shital.core.fabrics.secrets import SecretsManager


async def _env(name: str, fallback: str = "") -> str:
    return (await SecretsManager.get(name, fallback=fallback)) or fallback


def _build_msg(from_email: str, to_email: str, subject: str,
               html_body: str, text_body: str) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_email
    msg["To"]      = to_email
    if text_body:
        msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))
    return msg


def _smtp_send_sync(host: str, port: int, user: str, password: str,
                    from_email: str, to_email: str, msg: MIMEMultipart) -> None:
    with smtplib.SMTP(host, port, timeout=30) as srv:
        srv.ehlo()
        srv.starttls()
        srv.login(user, password)
        srv.sendmail(from_email, to_email, msg.as_string())


async def _send_via_notify(to_email: str, subject: str, body: str) -> dict[str, object]:
    """Send one email through GOV.UK Notify. Needs a template with
    ((subject)) and ((body)) personalisations configured in the Notify
    dashboard."""
    import httpx

    key = await _env("NOTIFY_API_KEY")
    tpl = await _env("NOTIFY_EMAIL_TEMPLATE_ID")
    if not key or not tpl:
        return {"ok": False, "provider": "notify",
                "error": "Notify not configured (NOTIFY_API_KEY + NOTIFY_EMAIL_TEMPLATE_ID)"}
    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.post(
                "https://api.notifications.service.gov.uk/v2/notifications/email",
                headers={"Authorization": f"ApiKey-v1 {key}",
                         "Content-Type": "application/json"},
                json={
                    "email_address":   to_email,
                    "template_id":     tpl,
                    "personalisation": {"subject": subject, "body": body},
                },
            )
            if r.status_code >= 400:
                return {"ok": False, "provider": "notify",
                        "error": f"notify_{r.status_code}: {r.text[:300]}"}
            return {"ok": True, "provider": "notify",
                    "id": r.json().get("id", "")}
    except Exception as exc:
        return {"ok": False, "provider": "notify", "error": str(exc)[:300]}


async def dispatch_email(
    *, to_email: str, subject: str,
    html_body: str, text_body: str = "",
    provider: str | None = None,
) -> dict[str, object]:
    """Send one email through whichever provider is configured.

    Returns {'ok': bool, 'provider': 'office365'|'ses'|'notify', 'error'?: str}.
    Never raises — callers (send_template, fanout) rely on a dict
    result to log success / failure uniformly.
    """
    chosen = (provider or await _env("MAIL_PROVIDER", "office365")).strip().lower()

    # Notify is HTTP, not SMTP — handle before the SMTP branch.
    if chosen == "notify":
        # Notify accepts plain text or Markdown as the body; HTML inside
        # the template is Notify's own branded wrapper. We pass html_body
        # verbatim — if it is pure HTML, Notify renders it as text in
        # the body cell, which is what a charity newsletter looks like
        # when the operator wrote it in Markdown anyway. Operators who
        # need full-HTML campaigns should use SES; Notify is the
        # transactional + notifications path.
        return await _send_via_notify(to_email, subject, text_body or html_body)

    # Resolve SMTP creds for the chosen provider.
    if chosen == "ses":
        host   = await _env("AWS_SES_SMTP_HOST", "email-smtp.eu-west-1.amazonaws.com")
        port   = int(await _env("AWS_SES_SMTP_PORT", "587") or "587")
        user   = await _env("AWS_SES_SMTP_USER")
        secret = await _env("AWS_SES_SMTP_PASSWORD")
        default_from = await _env("AWS_SES_FROM") or await _env("OFFICE365_EMAIL") or ""
    else:
        chosen = "office365"
        host   = "smtp.office365.com"
        port   = 587
        user   = await _env("OFFICE365_EMAIL")
        secret = await _env("OFFICE365_PASSWORD")
        default_from = user or "noreply@shital.org.uk"

    if not user or not secret:
        return {"ok": False, "provider": chosen,
                "error": f"{chosen.upper()} SMTP credentials not configured"}

    from_email = default_from
    msg = _build_msg(from_email, to_email, subject, html_body, text_body)

    try:
        await asyncio.get_event_loop().run_in_executor(
            None, _smtp_send_sync, host, port, user, secret, from_email, to_email, msg,
        )
    except Exception as exc:  # noqa: BLE001 — SMTPException catches most; retain fallback
        return {"ok": False, "provider": chosen, "error": str(exc)[:500]}
    return {"ok": True, "provider": chosen}
