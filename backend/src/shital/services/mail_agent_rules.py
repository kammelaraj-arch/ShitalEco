"""Mail Agent — RULES-BASED invoice extractor (no LLM key required).

Drop-in alternative to the Claude agentic loop in mail_agent.py. For each
inbound email with PDF/image attachments we:

  1. pdfplumber → extract raw text from each PDF (born-digital — covers >90%
     of charity invoices: Stripe, Amazon Business, EE, council bills, MS,
     British Gas etc.).
  2. Heuristic regex → pull vendor name, invoice number, dates, currency,
     totals, VAT. Designed for UK invoice formats.
  3. rapidfuzz → match the extracted vendor name against crm_accounts.name.
     Auto-link when similarity ≥ 85; otherwise stage for manual fix-up.
  4. INSERT a `purchase_invoices` row with `status='PENDING_APPROVAL'` and
     `source='mail_agent_rules'` so the existing /admin/mail-agent/inbox
     review UI surfaces it. No auto-post in v1.

What it does NOT do (vs the LLM agent): infer complex line-item tables,
reconcile payments, route complaints, escalate. Rules-mode purely
extracts invoices — anything else returns classification='other' and
stops, leaving the email visible for human review.

Tesseract is intentionally NOT a hard dep — when a PDF is image-only and
pdfplumber returns empty, we mark the row as 'needs_ocr' and the operator
processes it manually. (Adding Tesseract later is one apt-get + import.)
"""
from __future__ import annotations

import base64
import io
import logging
import re
import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import text

from shital.core.fabrics.database import SessionLocal
from shital.services import mailbox as mb

logger = logging.getLogger("shital.mail_agent_rules")


# ─── Field-level regex heuristics ────────────────────────────────────────────

# Greedy → non-greedy on quantity tags so "Total Amount" wins over "Total".
_TOTAL_RE = re.compile(
    r"(?:Total\s+(?:Amount\s+)?Due|Grand\s+Total|Amount\s+Due|Total\s+Payable|Total\s+Owed|Total)\s*"
    r"[:£$€]?\s*[£$€]?\s*([0-9]{1,3}(?:[,. ][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+(?:[.,][0-9]{2})?)",
    re.IGNORECASE,
)
_VAT_RE = re.compile(
    r"(?:VAT|Tax|GST|Sales\s+Tax)\s*(?:Total|Amount)?\s*[:£$€]?\s*[£$€]?\s*"
    r"([0-9]{1,3}(?:[,. ][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+(?:[.,][0-9]{2})?)",
    re.IGNORECASE,
)
_INV_NO_RE = re.compile(
    r"(?:Invoice|Tax\s+Invoice|Bill|Receipt)\s*(?:No\.?|Number|#|:)?\s*([A-Z0-9][A-Z0-9\-/_]{2,30})",
    re.IGNORECASE,
)
# UK date formats: 12 Jan 2026, 12/01/2026, 2026-01-12
_DATE_RE = re.compile(
    r"\b("
    r"\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4}"
    r"|\d{4}-\d{2}-\d{2}"
    r"|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}"
    r")\b",
    re.IGNORECASE,
)
_INV_DATE_RE = re.compile(
    r"(?:Invoice\s+Date|Date\s+of\s+Invoice|Bill\s+Date|Issue\s+Date|Date)\s*[:.]?\s*("
    r"\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4}"
    r"|\d{4}-\d{2}-\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}"
    r")",
    re.IGNORECASE,
)
_DUE_DATE_RE = re.compile(
    r"(?:Due\s+(?:Date|by)|Payment\s+Due|Pay\s+by)\s*[:.]?\s*("
    r"\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4}"
    r"|\d{4}-\d{2}-\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}"
    r")",
    re.IGNORECASE,
)
_VAT_NUM_RE = re.compile(r"VAT\s*(?:Reg\.?|Registration|No\.?|Number)?\s*[:.]?\s*(GB\s*\d{9,12})", re.IGNORECASE)
_COMPANY_NUM_RE = re.compile(r"(?:Company|Co\.)\s*(?:Reg\.?|Registration|No\.?|Number)?\s*[:.]?\s*(\d{6,10})", re.IGNORECASE)


def _to_decimal(s: str) -> Decimal | None:
    """Normalise "1,234.56" / "1 234,56" / "1234.56" / "1234,56" → Decimal."""
    if not s:
        return None
    s = s.strip().replace(" ", "")
    # If both . and , present, last one is decimal separator
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # Decide: 1,234 (en) vs 1,23 (eu). If exactly 2 digits after the
        # last comma and only one comma, treat as decimal.
        if re.fullmatch(r"\d+,\d{2}", s):
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _norm_date(s: str) -> str | None:
    """Best-effort ISO yyyy-mm-dd. Falls back to None on unparseable input."""
    if not s:
        return None
    s = s.strip().rstrip(".").rstrip(",")
    # ISO
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return s
    # 12/01/2026 (assume UK → dd/mm/yyyy because we're a UK charity)
    m = re.fullmatch(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})", s)
    if m:
        d, mo, y = m.group(1), m.group(2), m.group(3)
        if len(y) == 2:
            y = ("20" if int(y) < 70 else "19") + y
        try:
            datetime(int(y), int(mo), int(d))
            return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
        except ValueError:
            return None
    # 12 Jan 2026
    months = {m_: i + 1 for i, m_ in enumerate([
        "jan", "feb", "mar", "apr", "may", "jun",
        "jul", "aug", "sep", "oct", "nov", "dec",
    ])}
    m = re.fullmatch(r"(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{2,4})", s)
    if m:
        d, mo_s, y = m.group(1), m.group(2)[:3].lower(), m.group(3)
        if len(y) == 2:
            y = "20" + y
        mo = months.get(mo_s)
        if mo:
            try:
                datetime(int(y), int(mo), int(d))
                return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
            except ValueError:
                return None
    return None


# ─── PDF text extraction ─────────────────────────────────────────────────────

# ─── HTML stripping ──────────────────────────────────────────────────────────

# Many invoices arrive as HTML email bodies (Stripe, GoCardless, Amazon
# Business, GoDaddy, AWS, MS Azure). The same regex pipeline that handles
# PDF text works fine on plain text — we just need to strip the markup.
_HTML_SCRIPT_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_HTML_BR_RE     = re.compile(r"<br\s*/?>|</p>|</div>|</tr>|</h[1-6]>", re.IGNORECASE)
_HTML_TAG_RE    = re.compile(r"<[^>]+>")
_HTML_ENTITIES  = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&quot;": '"', "&#39;": "'", "&apos;": "'", "&pound;": "£",
    "&euro;":  "€", "&dollar;": "$", "&copy;": "©",
}


def _html_to_text(html: str) -> str:
    """Plain-text view of HTML — strip <script>/<style>, convert block tags
    to newlines, strip all other tags, decode the common entities."""
    if not html:
        return ""
    s = _HTML_SCRIPT_RE.sub("", html)
    s = _HTML_BR_RE.sub("\n", s)
    s = _HTML_TAG_RE.sub("", s)
    for k, v in _HTML_ENTITIES.items():
        s = s.replace(k, v)
    # Numeric entities (&#x163; / &#163;)
    s = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    # Collapse whitespace to keep regex anchors predictable, but preserve
    # newlines (the vendor-guess heuristic needs them).
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n\n", s)
    return s.strip()


def _pdf_to_text(data: bytes) -> str:
    """Best-effort: extract text from a PDF byte string. Empty string when
    the PDF is image-only (needs OCR) or unreadable. Imported lazily so
    the rest of the app boots even if pdfplumber is missing."""
    try:
        import pdfplumber  # type: ignore[import-untyped]
    except ImportError:
        logger.warning("pdfplumber not installed — rules pipeline will skip PDFs")
        return ""
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            pages = [(p.extract_text() or "") for p in pdf.pages]
        return "\n".join(pages).strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("pdf_extract_failed: %s", exc)
        return ""


# ─── Vendor guess + fuzzy CRM match ──────────────────────────────────────────

# Picks the most-likely vendor name from the top of the invoice. Real-world
# invoices put the supplier's company name in the first 10-30 lines, usually
# all-caps or title-case. We rank candidate lines by (a) appearing early,
# (b) word count 1-6, (c) not containing common keywords (Invoice / VAT /
# Total / Date / Page / etc).
_VENDOR_REJECT = re.compile(
    r"\b(invoice|tax\s+invoice|receipt|bill|statement|page|date|due|total|"
    r"amount|payment|customer|account|reference|number|vat\s+reg|terms|"
    r"description|quantity|qty|unit\s+price|line\s+total|subtotal|"
    r"shipping|delivery|address|registered\s+office)\b",
    re.IGNORECASE,
)


def _guess_vendor_name(pdf_text: str, sender_domain: str = "") -> str:
    """Heuristic: pick the strongest candidate vendor name from the first
    page. Falls back to the sender email's domain when no good candidate
    is found (which is almost always a sane guess for SaaS receipts)."""
    lines = [ln.strip() for ln in pdf_text.split("\n") if ln.strip()][:30]
    candidates: list[tuple[float, str]] = []
    for i, ln in enumerate(lines):
        if _VENDOR_REJECT.search(ln):
            continue
        if len(ln) < 3 or len(ln) > 80:
            continue
        words = ln.split()
        if not 1 <= len(words) <= 8:
            continue
        # Prefer lines that look like company names
        score = 10.0 - i * 0.3
        if ln.isupper():
            score += 1.5
        if any(s in ln for s in (" Ltd", " Limited", " LLP", " plc", " PLC", " Inc")):
            score += 4
        if not any(c.isdigit() for c in ln):
            score += 0.5
        candidates.append((score, ln))
    candidates.sort(reverse=True)
    if candidates and candidates[0][0] > 5:
        return candidates[0][1]
    # Fallback: derive from email domain ("noreply@stripe.com" → "Stripe")
    if sender_domain:
        first = sender_domain.split(".")[0]
        if first not in {"mail", "email", "noreply", "no-reply", "billing"}:
            return first.capitalize()
    return ""


async def _match_supplier(name: str) -> dict[str, Any] | None:
    """Fuzzy-match against crm_accounts.name. Returns the best hit when
    similarity ≥ 85; None otherwise. Limited to supplier/vendor types so
    we don't accidentally tag a donor as a vendor."""
    if not name:
        return None
    try:
        from rapidfuzz import fuzz, process
    except ImportError:
        logger.warning("rapidfuzz not installed — vendor matching disabled")
        return None
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT id::text, name, account_type
            FROM crm_accounts
            WHERE deleted_at IS NULL
              AND account_type IN ('supplier', 'vendor', 'partner')
        """))).mappings().all()
    if not rows:
        return None
    choices = {r["name"]: dict(r) for r in rows}
    hit = process.extractOne(name, choices.keys(), scorer=fuzz.WRatio)
    if hit and hit[1] >= 85:
        return choices[hit[0]]
    return None


# ─── Invoice extraction (the main public API of this module) ─────────────────

async def _extract_invoice_from_text(pdf_text: str, sender_domain: str = "") -> dict[str, Any]:
    """Apply the regex heuristics to extracted PDF text. Returns whatever it
    found (any subset may be missing). Caller decides if it's enough to
    create a purchase_invoices row."""
    out: dict[str, Any] = {"raw_text_chars": len(pdf_text)}
    if not pdf_text:
        return out

    # Vendor
    vendor = _guess_vendor_name(pdf_text, sender_domain=sender_domain)
    if vendor:
        out["vendor_name"] = vendor

    # Invoice number
    m = _INV_NO_RE.search(pdf_text)
    if m:
        out["invoice_number"] = m.group(1).strip()

    # Dates — preferred regex first, then fallback to "any date"
    m = _INV_DATE_RE.search(pdf_text)
    if m:
        out["invoice_date"] = _norm_date(m.group(1))
    else:
        # Fallback: first plausible date in the doc
        m = _DATE_RE.search(pdf_text)
        if m:
            out["invoice_date"] = _norm_date(m.group(1))
    m = _DUE_DATE_RE.search(pdf_text)
    if m:
        out["due_date"] = _norm_date(m.group(1))

    # Totals — strongest match wins; if multiple Total lines, last one is
    # usually the grand total (sub-totals come first).
    matches = list(_TOTAL_RE.finditer(pdf_text))
    if matches:
        last = matches[-1]
        amt = _to_decimal(last.group(1))
        if amt is not None:
            out["total_amount"] = float(amt)
    matches = list(_VAT_RE.finditer(pdf_text))
    if matches:
        amt = _to_decimal(matches[-1].group(1))
        if amt is not None:
            out["vat_amount"] = float(amt)

    # Currency — first symbol that appears anywhere in the text
    for sym, ccy in [("£", "GBP"), ("€", "EUR"), ("$", "USD")]:
        if sym in pdf_text:
            out["currency"] = ccy
            break
    else:
        out["currency"] = "GBP"

    # Supplier metadata
    m = _VAT_NUM_RE.search(pdf_text)
    if m:
        out["vat_number"] = m.group(1).strip().replace(" ", "")
    m = _COMPANY_NUM_RE.search(pdf_text)
    if m:
        out["company_number"] = m.group(1).strip()

    return out


# ─── Main entry point — equivalent of triage_email() in the LLM agent ────────

async def triage_email_rules(mailbox: str, message_meta: dict[str, Any]) -> dict[str, Any]:
    """Rules-based equivalent of mail_agent.triage_email(). Same signature,
    same return shape, so sweep_once() can call either implementation."""
    msg_id = message_meta["id"]

    # Idempotency check — share the same audit table as the LLM agent
    async with SessionLocal() as db:
        existing = (await db.execute(text(
            "SELECT id, classification, agent_summary FROM mail_agent_messages WHERE graph_message_id = :gid"
        ), {"gid": msg_id})).mappings().first()
    if existing:
        return {"id": str(existing["id"]), "classification": existing["classification"],
                "agent_summary": existing["agent_summary"], "skipped": True}

    # Stub audit row up-front so a mid-process crash still leaves a trace
    mail_agent_id = str(uuid.uuid4())
    sender = (message_meta.get("from") or {}).get("emailAddress") or {}
    sender_email = sender.get("address") or ""
    sender_domain = sender_email.split("@", 1)[1] if "@" in sender_email else ""

    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO mail_agent_messages
                (id, mailbox, graph_message_id, conversation_id, internet_message_id,
                 subject, sender_email, sender_name, received_at, status, created_at)
            VALUES
                (:id, :mb, :gid, :cid, :imid, :subj, :se, :sn, :rcv, 'processing', NOW())
        """), {
            "id":   mail_agent_id, "mb": mailbox, "gid": msg_id,
            "cid":  message_meta.get("conversationId") or "",
            "imid": message_meta.get("internetMessageId") or "",
            "subj": (message_meta.get("subject") or "")[:500],
            "se":   sender_email, "sn": sender.get("name") or "",
            "rcv":  message_meta.get("receivedDateTime"),
        })
        await db.commit()

    # Fetch body + attachments
    try:
        atts_meta = await mb.list_attachments(mailbox, msg_id) if message_meta.get("hasAttachments") else []
    except Exception as exc:  # noqa: BLE001
        await _finalise_rules(mail_agent_id, "other",
                              f"Attachment list failed: {exc}", "error", [])
        return {"id": mail_agent_id, "classification": "other", "error": True}

    pdf_atts = [a for a in atts_meta if (a.get("contentType") or "").lower() == "application/pdf"]
    img_atts = [a for a in atts_meta if (a.get("contentType") or "").lower()
                in {"image/png", "image/jpeg", "image/jpg", "image/webp"}]

    # ── Build a pool of candidate text sources, in extraction-priority order:
    #    1. each PDF (most accurate — original invoice document)
    #    2. the email body itself (online services like Stripe / PayPal /
    #       Amazon Business / GoCardless email the full invoice in HTML
    #       and only attach a PDF as a nicety — sometimes no PDF at all).
    #    First one to yield a usable invoice wins.
    tool_log: list[dict[str, Any]] = []
    try:
        full_msg = await mb.get_message_body(mailbox, msg_id)
    except Exception as exc:  # noqa: BLE001
        tool_log.append({"tool": "get_message_body", "error": str(exc)})
        full_msg = {}
    body_obj  = (full_msg.get("body") or {})
    body_kind = (body_obj.get("contentType") or "text").lower()
    body_raw  = body_obj.get("content") or ""
    body_text = _html_to_text(body_raw) if body_kind == "html" else body_raw

    candidate_sources: list[tuple[str, str, str]] = []  # (kind, label, text)
    for a in pdf_atts:
        try:
            full_att = await mb.get_attachment(mailbox, msg_id, a["id"])
        except Exception as exc:  # noqa: BLE001
            tool_log.append({"tool": "get_attachment", "error": str(exc), "filename": a.get("name")})
            continue
        b64 = full_att.get("contentBytes") or ""
        if not b64:
            continue
        pdf_text = _pdf_to_text(base64.b64decode(b64))
        if not pdf_text:
            tool_log.append({"tool": "pdf_extract", "filename": a.get("name"),
                             "result": "empty (likely scan — OCR needed)"})
            continue
        candidate_sources.append(("pdf", a.get("name") or "attachment.pdf", pdf_text))

    if body_text.strip():
        # Body usually has lots of marketing fluff — capping prevents the
        # vendor-guess heuristic latching onto headers/footers.
        candidate_sources.append(("body", "email body", body_text[:25000]))

    if not candidate_sources:
        if img_atts:
            await _finalise_rules(mail_agent_id, "needs_review",
                                  f"{len(img_atts)} image attachment(s) only — image OCR not enabled. Manual review needed.",
                                  "needs_review", tool_log)
            return {"id": mail_agent_id, "classification": "needs_review", "skipped": True}
        await _finalise_rules(mail_agent_id, "other",
                              "No usable text in PDF attachments or email body.",
                              "done", tool_log)
        return {"id": mail_agent_id, "classification": "other", "skipped": True}

    for src_kind, src_label, src_text in candidate_sources:
        fields = await _extract_invoice_from_text(src_text, sender_domain=sender_domain)
        tool_log.append({"tool": "extract_invoice_fields",
                         "source": src_kind, "label": src_label, "fields": fields})

        # Need at least a total + (number OR date) to create a row
        if not fields.get("total_amount"):
            continue
        if not (fields.get("invoice_number") or fields.get("invoice_date")):
            continue

        supplier_match = await _match_supplier(fields.get("vendor_name", ""))
        tool_log.append({"tool": "match_supplier",
                         "query": fields.get("vendor_name"),
                         "match": supplier_match})

        # Insert purchase_invoices row (matching the schema used by the LLM
        # agent so the inbox UI renders both kinds the same way).
        new_id = str(uuid.uuid4())
        async with SessionLocal() as db:
            await db.execute(text("""
                INSERT INTO purchase_invoices
                    (id, supplier_account_id, invoice_number, invoice_date, due_date,
                     currency, total, vat_total, status, notes, source, created_at, updated_at)
                VALUES
                    (:id,
                     CASE WHEN :sid <> '' THEN CAST(:sid AS UUID) ELSE NULL END,
                     :num, :idate, :ddate, :ccy, :total, :vat,
                     'PENDING_APPROVAL', :notes, 'mail_agent_rules', NOW(), NOW())
            """), {
                "id":    new_id,
                "sid":   (supplier_match or {}).get("id") or "",
                "num":   fields.get("invoice_number") or "(unknown)",
                "idate": fields.get("invoice_date"),
                "ddate": fields.get("due_date"),
                "ccy":   fields.get("currency") or "GBP",
                "total": fields.get("total_amount") or 0,
                "vat":   fields.get("vat_amount") or 0,
                "notes": (f"Extracted by rules from {src_kind} ({src_label}). "
                          f"Vendor guess: {fields.get('vendor_name', '?')}. "
                          f"Source email: {message_meta.get('subject', '')}."),
            })
            await db.commit()
        tool_log.append({"tool": "create_purchase_invoice", "id": new_id,
                         "source": src_kind, "status": "PENDING_APPROVAL"})

        summary = (f"Invoice extracted from {src_kind}: "
                   f"{fields.get('invoice_number', '?')} from "
                   f"{fields.get('vendor_name', '?')} for "
                   f"{fields.get('currency', '£')}{fields.get('total_amount', '?')}. "
                   f"{'Supplier auto-matched.' if supplier_match else 'Supplier needs manual link.'}")
        await _finalise_rules(mail_agent_id, "invoice", summary, "done", tool_log)
        return {"id": mail_agent_id, "classification": "invoice",
                "agent_summary": summary, "invoice_id": new_id}

    # Got candidate text but no extraction worked
    await _finalise_rules(mail_agent_id, "needs_review",
                          "Text extracted but no invoice total / number / date found. Manual review needed.",
                          "needs_review", tool_log)
    return {"id": mail_agent_id, "classification": "needs_review", "skipped": True}


async def _finalise_rules(mail_agent_id: str, classification: str, summary: str,
                          status: str, tool_log: list[dict[str, Any]]) -> None:
    """Finalise the audit row. Mirrors mail_agent._finalise() shape so the
    review UI doesn't care which pipeline ran."""
    import json as _json
    needs_review = status in {"needs_review", "error"}
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE mail_agent_messages SET
                classification     = :cls,
                agent_summary      = :sum,
                tool_log           = CAST(:log AS JSONB),
                status             = :st,
                needs_human_review = :review,
                processed_at       = NOW()
            WHERE id = CAST(:id AS UUID)
        """), {"id": mail_agent_id, "cls": classification,
               "sum": summary[:2000], "log": _json.dumps(tool_log),
               "st": status, "review": needs_review})
        await db.commit()


# ─── Mode-aware sweep ────────────────────────────────────────────────────────

async def is_rules_mode_active() -> bool:
    """Decide which triage path sweep_once() should call. Honoured by
    `mail_agent.sweep_once` through the wrapper in `triage_email_dispatch`.

    Checks both the env-var-loaded settings.ANTHROPIC_API_KEY and the
    encrypted SecretsManager store (where the API Keys admin page writes)
    so adding the key through the UI flips the agent on without a restart."""
    from shital.core.fabrics.config import settings
    mode = (settings.MAIL_AGENT_MODE or "auto").lower()
    if mode == "rules":
        return True
    if mode == "agent":
        return False
    # auto: rules iff no Anthropic key from either env OR SecretsManager
    if (settings.ANTHROPIC_API_KEY or "").strip():
        return False
    try:
        from shital.core.fabrics.secrets import SecretsManager
        stored = await SecretsManager.get("ANTHROPIC_API_KEY")
        if stored and stored.strip():
            return False
    except Exception:  # noqa: BLE001
        pass
    return True


async def triage_email_dispatch(mailbox: str, message_meta: dict[str, Any]) -> dict[str, Any]:
    """Single entry point that sweep_once() can call — picks rules vs agent
    based on MAIL_AGENT_MODE / ANTHROPIC_API_KEY presence."""
    if await is_rules_mode_active():
        return await triage_email_rules(mailbox, message_meta)
    from shital.services import mail_agent as _agent
    return await _agent.triage_email(mailbox, message_meta)
