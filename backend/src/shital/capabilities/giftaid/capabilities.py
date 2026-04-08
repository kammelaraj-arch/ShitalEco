"""
Gift Aid capabilities — HMRC Gift Aid submission via SOAP API (Charities Online).
Also provides GetAddress.io postcode lookup proxy.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

import httpx
import structlog
from pydantic import BaseModel

from shital.core.dna.registry import Fabric, capability
from shital.core.fabrics.config import settings
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()


# ─── HMRC Gift Aid ────────────────────────────────────────────────────────────

class GiftAidDeclaration(BaseModel):
    """A single Gift Aid declaration from a donor."""
    title: str = ""
    first_name: str
    last_name: str
    house_name_or_number: str
    postcode: str
    donation_date: date
    amount: Decimal
    order_ref: str = ""
    sponsored: bool = False           # True if part of a sponsored event


class GiftAidSubmission(BaseModel):
    """A batch of Gift Aid declarations for HMRC submission."""
    charity_ref: str = ""             # HMRC charity reference (overrides settings)
    declarations: list[GiftAidDeclaration]
    claim_to_date: date | None = None


class GiftAidSubmissionResult(BaseModel):
    correlation_id: str
    status: str                       # submitted | failed | pending
    amount_claimed: Decimal
    declarations_count: int
    hmrc_reference: str = ""
    errors: list[str] = []


def _escape_xml(value: str) -> str:
    """Escape special XML characters in text content."""
    return (value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;"))


def _build_govtalk_xml(submission: GiftAidSubmission, correlation_id: str) -> str:
    """Build HMRC GovTalk XML envelope for Gift Aid R68 claim (Charities Online format).

    Uses GovTalkMessage wrapper as required by HMRC — NOT SOAP.
    Reference: https://www.gov.uk/government/publications/charities-online-gift-aid
    """
    charity_ref = submission.charity_ref or settings.HMRC_GIFT_AID_CHARITY_HMO_REF
    claim_date = (submission.claim_to_date or date.today()).isoformat()
    total = sum(d.amount for d in submission.declarations)
    user_id = settings.HMRC_GIFT_AID_USER_ID
    password = settings.HMRC_GIFT_AID_PASSWORD

    declarations_xml = "\n".join([
        f"""            <Repayment>
              <Donor>
                <Fore>{_escape_xml(d.first_name)}</Fore>
                <Sur>{_escape_xml(d.last_name)}</Sur>
                <House>{_escape_xml(d.house_name_or_number)}</House>
                <Postcode>{_escape_xml(d.postcode.upper().strip())}</Postcode>
              </Donor>
              <AggDonation>
                <GiftAidDate>{d.donation_date.isoformat()}</GiftAidDate>
                <Total>{d.amount:.2f}</Total>
              </AggDonation>
            </Repayment>"""
        for d in submission.declarations
    ])

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>CHARITIESR68</Class>
      <Qualifier>request</Qualifier>
      <Function>submit</Function>
      <CorrelationID>{correlation_id}</CorrelationID>
      <Transformation>XML</Transformation>
      <GatewayTest>0</GatewayTest>
    </MessageDetails>
    <SenderDetails>
      <IDAuthentication>
        <SenderID>{_escape_xml(user_id)}</SenderID>
        <Authentication>
          <Method>clear</Method>
          <Role>principal</Role>
          <Value>{_escape_xml(password)}</Value>
        </Authentication>
      </IDAuthentication>
      <EmailAddress></EmailAddress>
    </SenderDetails>
  </Header>
  <GovTalkDetails>
    <Keys/>
    <ChannelRouting>
      <Channel>
        <URI>https://online.hmrc.gov.uk/charities</URI>
        <Product>Shital Temple ERP</Product>
        <Version>1.0</Version>
      </Channel>
    </ChannelRouting>
  </GovTalkDetails>
  <Body>
    <IRenvelope xmlns="http://www.govtalk.gov.uk/taxation/charities/r68/2">
      <IRheader>
        <Keys>
          <Key Type="CharityRef">{_escape_xml(charity_ref)}</Key>
        </Keys>
        <PeriodEnd>{claim_date}</PeriodEnd>
        <DefaultCurrency>GBP</DefaultCurrency>
        <IRmark Type="generic">generic</IRmark>
        <Sender>Charity</Sender>
      </IRheader>
      <R68>
        <AuthOfficialCorrelationID>{correlation_id}</AuthOfficialCorrelationID>
        <Claim>
          <OfficialName>{_escape_xml(charity_ref)}</OfficialName>
          <Amount>{total:.2f}</Amount>
{declarations_xml}
        </Claim>
      </R68>
    </IRenvelope>
  </Body>
</GovTalkMessage>"""


def build_gift_aid_xml_preview(submission: GiftAidSubmission, correlation_id: str = "PREVIEW") -> str:
    """Public wrapper — returns the GovTalk XML that would be sent to HMRC (credentials masked)."""
    xml = _build_govtalk_xml(submission, correlation_id)
    # Mask the password in the preview
    if settings.HMRC_GIFT_AID_PASSWORD:
        xml = xml.replace(
            _escape_xml(settings.HMRC_GIFT_AID_PASSWORD),
            "***MASKED***",
        )
    return xml


@capability(
    name="submit_gift_aid_claim",
    description="Submit a batch of Gift Aid declarations to HMRC Charities Online (R68). Returns correlation ID and claim status.",
    fabric=Fabric.COMPLIANCE,
    requires=["gift_aid:submit"],
    human_in_loop=True,
    tags=["gift_aid", "hmrc", "compliance"],
)
async def submit_gift_aid_claim(
    ctx: DigitalSpace,
    submission: GiftAidSubmission,
) -> GiftAidSubmissionResult:
    correlation_id = str(uuid.uuid4()).replace("-", "").upper()[:20]
    total = sum(d.amount for d in submission.declarations)

    endpoint = (
        "https://online.hmrc.gov.uk/hmrc/submit"
        if settings.HMRC_GIFT_AID_ENVIRONMENT == "live"
        else "https://test-transaction-engine.tax.service.gov.uk/submission"
    )

    govtalk_xml = _build_govtalk_xml(submission, correlation_id)

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                endpoint,
                content=govtalk_xml.encode("utf-8"),
                headers={
                    "Content-Type": "text/xml; charset=utf-8",
                    "Accept": "text/xml",
                },
            )

        if response.status_code in (200, 201):
            logger.info("gift_aid_submitted", correlation_id=correlation_id, total=str(total))
            return GiftAidSubmissionResult(
                correlation_id=correlation_id,
                status="submitted",
                amount_claimed=total * Decimal("0.25"),
                declarations_count=len(submission.declarations),
                hmrc_reference=correlation_id,
            )
        else:
            logger.error("gift_aid_hmrc_error", status=response.status_code, body=response.text[:500])
            return GiftAidSubmissionResult(
                correlation_id=correlation_id,
                status="failed",
                amount_claimed=Decimal("0"),
                declarations_count=0,
                errors=[f"HMRC returned HTTP {response.status_code}: {response.text[:200]}"],
            )

    except Exception as exc:
        logger.error("gift_aid_exception", error=str(exc))
        return GiftAidSubmissionResult(
            correlation_id=correlation_id,
            status="failed",
            amount_claimed=Decimal("0"),
            declarations_count=0,
            errors=[str(exc)],
        )


async def _postcodes_io_fallback(postcode: str, reason: str = "") -> dict[str, Any]:
    """Fallback to postcodes.io (free, no API key) when getAddress.io is unavailable.
    Returns street-level addresses based on the postcode's locality data."""
    clean = postcode.strip().upper().replace(" ", "")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(f"https://api.postcodes.io/postcodes/{clean}")
        if resp.status_code == 200:
            data = resp.json().get("result", {})
            town = data.get("admin_ward", "") or data.get("parish", "") or data.get("admin_district", "") or ""
            county = data.get("admin_county", "") or data.get("admin_district", "") or ""
            pc = data.get("postcode", postcode.upper().strip())
            # Build a set of plausible address stubs — user can still type house number
            addresses = [
                f"{town}, {county}, {pc}".replace(", ,", ",").strip(", "),
            ]
            # Also return a prompt-style entry so the user knows to type their number
            return {
                "postcode": pc,
                "addresses": addresses,
                "source": "postcodes_io",
                "note": reason,
            }
    except Exception:
        pass
    # Last resort — return empty so frontend shows manual text input
    return {"postcode": postcode, "addresses": [], "error": reason}


async def _ideal_postcodes_lookup(postcode: str, api_key: str) -> dict[str, Any]:
    """Look up UK addresses via Ideal Postcodes API."""
    clean = postcode.strip().upper().replace(" ", "")
    url = f"https://api.ideal-postcodes.co.uk/v1/postcodes/{clean}?api_key={api_key}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
        if resp.status_code == 404:
            return {"postcode": clean, "addresses": [], "error": "Postcode not found"}
        if resp.status_code in (400, 402):
            return await _postcodes_io_fallback(postcode, reason=f"ideal-postcodes HTTP {resp.status_code}")
        if resp.status_code in (401, 403):
            return await _postcodes_io_fallback(postcode, reason="ideal-postcodes key invalid or limit reached")
        if resp.status_code != 200:
            return await _postcodes_io_fallback(postcode, reason=f"ideal-postcodes HTTP {resp.status_code}")

        data = resp.json()
        addresses = []
        for r in (data.get("result") or []):
            parts = [
                r.get("line_1", ""), r.get("line_2", ""), r.get("line_3", ""),
                r.get("post_town", ""), r.get("county", ""), r.get("postcode", clean),
            ]
            formatted = ", ".join(p for p in parts if p)
            if formatted:
                addresses.append(formatted)
        if not addresses:
            return await _postcodes_io_fallback(postcode, reason="ideal-postcodes returned empty")
        return {"postcode": clean, "addresses": addresses, "source": "ideal_postcodes"}
    except Exception as exc:
        return await _postcodes_io_fallback(postcode, reason=str(exc))


@capability(
    name="lookup_postcode",
    description="Look up UK addresses by postcode using the configured provider (GetAddress.io or Ideal Postcodes). Returns list of formatted addresses.",
    fabric=Fabric.PAYMENTS,
    requires=[],
    tags=["address", "gift_aid"],
)
async def lookup_postcode(ctx: DigitalSpace, postcode: str) -> dict[str, Any]:
    """Proxy postcode lookup — provider determined by ADDRESS_LOOKUP_PROVIDER setting."""
    from shital.core.fabrics.secrets import SecretsManager

    provider = await SecretsManager.get("ADDRESS_LOOKUP_PROVIDER", fallback="") or "getaddress"

    # ── Ideal Postcodes ──────────────────────────────────────────────────────
    if provider == "ideal_postcodes":
        api_key = await SecretsManager.get("IDEAL_POSTCODES_API_KEY", fallback="")
        if not api_key:
            # Key not set — fall back to postcodes.io
            return await _postcodes_io_fallback(postcode, reason="IDEAL_POSTCODES_API_KEY not set")
        return await _ideal_postcodes_lookup(postcode, api_key)

    # ── GetAddress.io (default) ──────────────────────────────────────────────
    api_key = await SecretsManager.get("GETADDRESS_API_KEY", fallback="") or settings.GETADDRESS_API_KEY
    if not api_key:
        return {
            "postcode": postcode.upper().strip(),
            "addresses": [
                f"1 Temple Lane, Wembley, {postcode}",
                f"2 Shital Close, Wembley, {postcode}",
                f"3 Community Road, Wembley, {postcode}",
            ],
            "source": "mock",
        }

    # getAddress.io requires lowercase postcode with NO space (e.g. "hp79nq")
    clean = postcode.strip().lower().replace(" ", "")
    url = f"https://api.getaddress.io/find/{clean}?api-key={api_key}"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)

        if resp.status_code == 400:
            return {"postcode": postcode, "addresses": [], "error": "Invalid postcode format"}
        if resp.status_code in (401, 403, 404):
            return await _postcodes_io_fallback(postcode, reason=f"getAddress HTTP {resp.status_code}")
        if resp.status_code in (402, 429):
            return await _postcodes_io_fallback(postcode, reason="getAddress limit reached")
        if resp.status_code != 200:
            return await _postcodes_io_fallback(postcode, reason=f"getAddress HTTP {resp.status_code}")

        data = resp.json()
        pc = postcode.upper().strip()
        raw = data.get("addresses", [])
        addresses = []
        for a in raw:
            if isinstance(a, str):
                parts = [p.strip() for p in a.split(",") if p.strip()]
                parts.append(pc)
                addresses.append(", ".join(parts))
            elif isinstance(a, dict):
                parts = [
                    a.get("line_1", ""), a.get("line_2", ""), a.get("line_3", ""),
                    a.get("town_or_city", ""), a.get("county", ""), pc,
                ]
                formatted = ", ".join(p for p in parts if p)
                if formatted:
                    addresses.append(formatted)

        if not addresses:
            return await _postcodes_io_fallback(postcode, reason="getAddress returned empty")

        return {"postcode": pc, "addresses": addresses, "source": "getaddress"}

    except Exception as exc:
        return await _postcodes_io_fallback(postcode, reason=str(exc))
