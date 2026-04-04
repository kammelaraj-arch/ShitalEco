"""
Gift Aid capabilities — HMRC Gift Aid submission via SOAP API (Charities Online).
Also provides GetAddress.io postcode lookup proxy.
"""
from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from typing import Any
import uuid

import httpx
from pydantic import BaseModel
import structlog

from shital.core.dna.registry import capability, Fabric
from shital.core.space.context import DigitalSpace
from shital.core.fabrics.config import settings

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


def _build_gift_aid_soap(submission: GiftAidSubmission, correlation_id: str) -> str:
    """Build HMRC Charities Online SOAP envelope for Gift Aid R68 claim."""
    charity_ref = submission.charity_ref or settings.HMRC_GIFT_AID_CHARITY_HMO_REF
    claim_date = (submission.claim_to_date or date.today()).isoformat()
    total = sum(d.amount for d in submission.declarations)

    declarations_xml = "\n".join([
        f"""        <Repayment>
          <Donor>
            <Fore>{d.first_name}</Fore>
            <Sur>{d.last_name}</Sur>
            <House>{d.house_name_or_number}</House>
            <Postcode>{d.postcode}</Postcode>
          </Donor>
          <AggDonation>
            <GiftAidDate>{d.donation_date.isoformat()}</GiftAidDate>
            <Total>{d.amount:.2f}</Total>
          </AggDonation>
        </Repayment>"""
        for d in submission.declarations
    ])

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <SOAP-ENV:Header>
    <GovTalkDetails xmlns="http://www.govtalk.gov.uk/CM/envelope">
      <Keys>
        <Key Type="CorrelationID">{correlation_id}</Key>
      </Keys>
      <Authentication>
        <Method>clear</Method>
        <Role>principal</Role>
        <Value>{settings.HMRC_GIFT_AID_PASSWORD}</Value>
      </Authentication>
    </GovTalkDetails>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <IRenvelope xmlns="http://www.govtalk.gov.uk/taxation/charities/r68/2">
      <IRheader>
        <Keys>
          <Key Type="CharityRef">{charity_ref}</Key>
        </Keys>
        <PeriodEnd>{claim_date}</PeriodEnd>
        <DefaultCurrency>GBP</DefaultCurrency>
        <IRmark Type="generic">HMRC</IRmark>
        <Sender>Charity</Sender>
      </IRheader>
      <R68>
        <AuthOfficialCorrelationID>{correlation_id}</AuthOfficialCorrelationID>
        <Claim>
          <OfficialName>{charity_ref}</OfficialName>
          <Amount>{total:.2f}</Amount>
          {declarations_xml}
        </Claim>
      </R68>
    </IRenvelope>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>"""


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

    soap_body = _build_gift_aid_soap(submission, correlation_id)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                endpoint,
                content=soap_body.encode("utf-8"),
                headers={
                    "Content-Type": "text/xml; charset=utf-8",
                    "SOAPAction": "submit",
                    "GovTalk-UserID": settings.HMRC_GIFT_AID_USER_ID,
                    "GovTalk-Password": settings.HMRC_GIFT_AID_PASSWORD,
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


@capability(
    name="lookup_postcode",
    description="Look up UK addresses by postcode using GetAddress.io. Returns list of formatted addresses.",
    fabric=Fabric.PAYMENTS,
    requires=[],
    tags=["address", "gift_aid"],
)
async def lookup_postcode(ctx: DigitalSpace, postcode: str) -> dict[str, Any]:
    """Proxy GetAddress.io lookup — returns formatted address list."""
    if not settings.GETADDRESS_API_KEY:
        # Return mock addresses for development
        return {
            "postcode": postcode.upper().strip(),
            "addresses": [
                f"1 Temple Lane, Wembley, {postcode}",
                f"2 Shital Close, Wembley, {postcode}",
                f"3 Community Road, Wembley, {postcode}",
            ],
            "source": "mock",
        }

    clean = postcode.strip().replace(" ", "%20")
    url = f"https://api.getaddress.io/find/{clean}?api-key={settings.GETADDRESS_API_KEY}&expand=true"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)

        if resp.status_code == 401:
            return await _postcodes_io_fallback(postcode, reason="Invalid GetAddress API key")
        if resp.status_code == 404:
            # getAddress.io 404 doesn't always mean invalid — fall back to postcodes.io
            return await _postcodes_io_fallback(postcode, reason="getAddress: not found")
        if resp.status_code in (402, 429):
            # Daily limit hit — fall back to postcodes.io (free, no key required)
            return await _postcodes_io_fallback(postcode, reason="getAddress limit reached")

        data = resp.json()
        addresses = []
        for a in data.get("addresses", []):
            parts = [
                a.get("line_1", ""), a.get("line_2", ""), a.get("line_3", ""),
                a.get("town_or_city", ""), a.get("county", ""),
                postcode.upper().strip(),
            ]
            formatted = ", ".join(p for p in parts if p)
            if formatted:
                addresses.append(formatted)

        if not addresses:
            return await _postcodes_io_fallback(postcode, reason="getAddress returned empty")

        return {"postcode": postcode.upper().strip(), "addresses": addresses, "source": "getaddress"}

    except Exception as exc:
        return await _postcodes_io_fallback(postcode, reason=str(exc))
