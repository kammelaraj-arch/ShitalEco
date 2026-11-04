"""Email inbox → invoice / purchase order / receipt records.

User direction: "next read emails and identify payments, invoice,
purchase order and create records."

Pipeline per run:

  1. Open IMAP SSL to the configured mailbox (Office 365 by default;
     any IMAP host works). Credentials via SecretsManager:

       INBOX_IMAP_HOST            default outlook.office365.com
       INBOX_IMAP_PORT            default 993
       INBOX_IMAP_USERNAME        fallback to OFFICE365_EMAIL setting
       INBOX_IMAP_PASSWORD        fallback to OFFICE365_PASSWORD setting
       INBOX_IMAP_FOLDER          default INBOX
       INBOX_IMAP_PROCESSED       optional — move to this folder after
                                  classifying (e.g. "Shital/Processed")

  2. Search UNSEEN (cheap incremental poll). Fallback to date-window
     if the user hands us {"since": "YYYY-MM-DD"}.

  3. For each message:
       a. Parse headers, text body, attachments (PDF / image / text).
       b. Skip if Message-ID already in email_ingest_messages.
       c. Ask the AI assistant (Azure OpenAI via Microsoft org tenancy —
          see shital.core.fabrics.ai) to classify + extract fields as
          JSON — invoice number, total, VAT, dates, supplier name/email.
       d. INSERT email_ingest_messages row (idempotent via unique
          message_id).
       e. If classification is INVOICE / PURCHASE_ORDER / RECEIPT /
          STATEMENT, upsert a supplier_documents row (unique on
          supplier_email + doc_number) and copy attachments.
       f. Mark email read; optionally move to the processed folder.

Endpoints:
   POST /admin/finance/email-ingest/run         admin JWT
   POST /admin/finance/email-ingest/run/cron    X-Sync-Token header
   GET  /admin/finance/email-ingest/messages    admin JWT
   POST /admin/finance/email-ingest/messages/{id}/reprocess
   GET  /admin/finance/supplier-documents       admin JWT
   GET  /admin/finance/supplier-documents/{id}  admin JWT

The cron endpoint shares the PAYMENT_SYNC_TOKEN secret with the
nightly transaction sync so operators manage one token, not two.

Guardrails:
   - Hard cap MAX_MESSAGES_PER_RUN on each call so a stuck IMAP cursor
     can't blow the server up.
   - Skips AI altogether if no provider is configured (records the
     message with classification=UNCLASSIFIED so a human can label it).
"""
from __future__ import annotations

import email
import imaplib
import json
import re
import ssl
import uuid
from datetime import UTC, date, datetime
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.ai import AIProviderError, AIProviderUnavailable, ai_json_object
from shital.core.fabrics.config import settings
from shital.core.fabrics.database import SessionLocal
from shital.core.fabrics.secrets import SecretsManager

router = APIRouter(prefix="/admin/finance", tags=["finance", "email-ingest"])

MAX_MESSAGES_PER_RUN = 50
MAX_BODY_BYTES_FOR_AI = 12000
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
ALLOWED_ATTACHMENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
    "text/csv",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
}
CLASSIFICATIONS = {"INVOICE", "PURCHASE_ORDER", "RECEIPT", "STATEMENT", "OTHER"}


def _only_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="ADMIN required")


# ────────────────────────── IMAP helpers ─────────────────────────────────

async def _imap_config() -> dict[str, Any]:
    host = (await SecretsManager.get("INBOX_IMAP_HOST")) or "outlook.office365.com"
    port_raw = (await SecretsManager.get("INBOX_IMAP_PORT")) or "993"
    user = (await SecretsManager.get("INBOX_IMAP_USERNAME")) or settings.OFFICE365_EMAIL
    pwd = (await SecretsManager.get("INBOX_IMAP_PASSWORD")) or settings.OFFICE365_PASSWORD
    folder = (await SecretsManager.get("INBOX_IMAP_FOLDER")) or "INBOX"
    processed = (await SecretsManager.get("INBOX_IMAP_PROCESSED")) or ""
    try:
        port = int(port_raw)
    except ValueError:
        port = 993
    return {
        "host": host, "port": port, "user": user, "password": pwd,
        "folder": folder, "processed": processed,
    }


def _decode(val: Any) -> str:
    if val is None:
        return ""
    try:
        return str(make_header(decode_header(str(val)))).strip()
    except Exception:
        try:
            return str(val).strip()
        except Exception:
            return ""


def _extract_text(msg: Message) -> str:
    """Pull the best-effort plain-text body of an email."""
    if msg.is_multipart():
        texts: list[str] = []
        html_fallback = ""
        for part in msg.walk():
            ctype = (part.get_content_type() or "").lower()
            if part.get("Content-Disposition", "").lower().startswith("attachment"):
                continue
            if ctype == "text/plain":
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        texts.append(payload.decode(charset, errors="replace"))
                except Exception:
                    pass
            elif ctype == "text/html" and not texts:
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        html_fallback = payload.decode(charset, errors="replace")
                except Exception:
                    pass
        if texts:
            return "\n\n".join(texts)
        # Strip tags off HTML as a last-ditch fallback.
        return re.sub(r"<[^>]+>", " ", html_fallback)
    try:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace")
    except Exception:
        pass
    return str(msg.get_payload() or "")


def _extract_attachments(msg: Message) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not msg.is_multipart():
        return out
    for part in msg.walk():
        disp = (part.get("Content-Disposition") or "").lower()
        if "attachment" not in disp and part.get_filename() is None:
            continue
        ctype = (part.get_content_type() or "application/octet-stream").split(";")[0].strip().lower()
        if ctype not in ALLOWED_ATTACHMENT_TYPES:
            continue
        try:
            data = part.get_payload(decode=True) or b""
        except Exception:
            data = b""
        if not data or len(data) > MAX_ATTACHMENT_BYTES:
            continue
        fname = _decode(part.get_filename()) or f"attachment-{len(out) + 1}"
        out.append({"filename": fname[:255], "content_type": ctype, "data": data})
    return out


# ────────────────────────── AI classification ────────────────────────────

_CLASSIFY_SYS = (
    "You are the Finance Clerk AI for Shital Hindu Temple (UK charity). "
    "Classify a supplier/finance email and extract the structured fields "
    "finance needs to create a record. "
    "Respond with ONLY a single JSON object (no prose, no markdown fences) "
    "with these keys: "
    "classification (one of INVOICE, PURCHASE_ORDER, RECEIPT, STATEMENT, OTHER), "
    "confidence (0.0 to 1.0), "
    "supplier_name (string), supplier_email (string), supplier_vat_id (string), "
    "doc_number (string), issued_date (YYYY-MM-DD or empty), "
    "due_date (YYYY-MM-DD or empty), "
    "total_amount (number in major units, e.g. 123.45), "
    "net_amount (number), vat_amount (number), "
    "currency (ISO code, default GBP), "
    "notes (short string). "
    "If it isn't a finance document at all, use OTHER with low confidence. "
    "Never invent an invoice number — leave doc_number empty if the email "
    "doesn't state one."
)


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


async def _classify_with_ai(from_addr: str, subject: str, body: str) -> dict[str, Any]:
    body_trimmed = body[:MAX_BODY_BYTES_FOR_AI]
    user = f"FROM: {from_addr}\nSUBJECT: {subject}\n\nBODY:\n{body_trimmed}\n"

    try:
        parsed, model = await ai_json_object(_CLASSIFY_SYS, user, max_tokens=1000)
    except AIProviderUnavailable:
        return {"classification": "UNCLASSIFIED", "confidence": 0.0, "model": ""}
    except AIProviderError as exc:
        return {"classification": "UNCLASSIFIED", "confidence": 0.0, "error": str(exc), "model": ""}

    if not parsed:
        return {"classification": "UNCLASSIFIED", "confidence": 0.0, "error": "unparseable AI response", "model": model}

    cls = str(parsed.get("classification", "")).upper()
    if cls not in CLASSIFICATIONS:
        cls = "OTHER"
    parsed["classification"] = cls
    try:
        parsed["confidence"] = max(0.0, min(1.0, float(parsed.get("confidence", 0))))
    except (TypeError, ValueError):
        parsed["confidence"] = 0.0
    parsed["model"] = model
    return parsed


# ────────────────────────── Persistence helpers ──────────────────────────

async def _record_already_seen(db: Any, message_id: str) -> bool:
    row = (await db.execute(text("""
        SELECT id FROM email_ingest_messages WHERE message_id = :m
    """), {"m": message_id})).first()
    return bool(row)


async def _insert_email_row(db: Any, row: dict[str, Any]) -> str:
    new_id = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO email_ingest_messages
            (id, message_id, uid, folder, from_address, to_address, subject,
             received_at, body_excerpt, classification, confidence,
             extracted_json, status, error_message, raw_headers, model, processed_at)
        VALUES
            (:id, :mid, :uid, :folder, :frm, :to, :subj,
             :recv, :excerpt, :cls, :conf,
             CAST(:extracted AS JSONB), :status, :err,
             CAST(:headers AS JSONB), :model, :processed_at)
    """), {
        "id":        new_id,
        "mid":       row["message_id"],
        "uid":       row.get("uid", ""),
        "folder":    row["folder"],
        "frm":       row["from"][:500],
        "to":        row["to"][:500],
        "subj":      row["subject"][:500],
        "recv":      row["received_at"],
        "excerpt":   (row["body"] or "")[:2000],
        "cls":       row["classification"],
        "conf":      float(row.get("confidence") or 0),
        "extracted": json.dumps(row.get("extracted", {})),
        "status":    row.get("status", "processed"),
        "err":       (row.get("error") or "")[:2000],
        "headers":   json.dumps(row.get("headers", {})),
        "model":     row.get("model", ""),
        "processed_at": datetime.now(UTC),
    })
    return new_id


async def _upsert_supplier_document(
    db: Any, email_id: str, classification: str, extracted: dict[str, Any],
) -> str | None:
    """Return the supplier_documents id (newly created or merged into existing)."""
    if classification not in {"INVOICE", "PURCHASE_ORDER", "RECEIPT", "STATEMENT"}:
        return None

    supplier_email = str(extracted.get("supplier_email", "") or "")[:255].strip().lower()
    doc_number = str(extracted.get("doc_number", "") or "")[:120].strip()

    def _f(v: Any) -> float:
        try:
            return float(v) if v is not None else 0.0
        except (TypeError, ValueError):
            return 0.0

    params = {
        "doc_type":        classification,
        "doc_number":      doc_number,
        "supplier_name":   str(extracted.get("supplier_name", "") or "")[:255],
        "supplier_email":  supplier_email,
        "supplier_vat_id": str(extracted.get("supplier_vat_id", "") or "")[:64],
        "issued_date":     _parse_date(str(extracted.get("issued_date", "") or "")),
        "due_date":        _parse_date(str(extracted.get("due_date", "") or "")),
        "total":           _f(extracted.get("total_amount")),
        "net":             _f(extracted.get("net_amount")),
        "vat":             _f(extracted.get("vat_amount")),
        "currency":        (str(extracted.get("currency", "GBP") or "GBP").upper())[:3],
        "source_email_id": email_id,
        "notes":           str(extracted.get("notes", "") or "")[:1000],
        "raw":             json.dumps(extracted),
    }

    # Merge into an existing live row when we have both a supplier_email and a
    # doc_number (the natural de-dup key). Otherwise always create a new row
    # and leave finance to merge by hand.
    if doc_number and supplier_email:
        existing = (await db.execute(text("""
            SELECT id FROM supplier_documents
             WHERE doc_type = :doc_type
               AND supplier_email = :supplier_email
               AND doc_number = :doc_number
               AND deleted_at IS NULL
        """), params)).first()
        if existing:
            doc_id = str(existing[0])
            await db.execute(text("""
                UPDATE supplier_documents SET
                  supplier_name   = CASE WHEN :supplier_name <> '' THEN :supplier_name ELSE supplier_name END,
                  supplier_vat_id = CASE WHEN :supplier_vat_id <> '' THEN :supplier_vat_id ELSE supplier_vat_id END,
                  issued_date     = COALESCE(:issued_date, issued_date),
                  due_date        = COALESCE(:due_date, due_date),
                  total_amount    = CASE WHEN :total > 0 THEN :total ELSE total_amount END,
                  net_amount      = CASE WHEN :net   > 0 THEN :net   ELSE net_amount   END,
                  vat_amount      = CASE WHEN :vat   > 0 THEN :vat   ELSE vat_amount   END,
                  currency        = :currency,
                  source_email_id = COALESCE(:source_email_id, source_email_id),
                  notes           = CASE WHEN :notes <> '' THEN :notes ELSE notes END,
                  raw_fields      = CAST(:raw AS JSONB),
                  updated_at      = NOW()
                WHERE id = :id
            """), {**params, "id": doc_id})
            return doc_id

    new_id = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO supplier_documents (
            id, doc_type, doc_number, supplier_name, supplier_email, supplier_vat_id,
            issued_date, due_date, total_amount, net_amount, vat_amount, currency,
            source, source_email_id, notes, raw_fields
        ) VALUES (
            :id, :doc_type, :doc_number, :supplier_name, :supplier_email, :supplier_vat_id,
            :issued_date, :due_date, :total, :net, :vat, :currency,
            'email', :source_email_id, :notes, CAST(:raw AS JSONB)
        )
    """), {**params, "id": new_id})
    return new_id


async def _save_attachments(db: Any, doc_id: str | None, attachments: list[dict[str, Any]]) -> None:
    if not doc_id or not attachments:
        return
    for a in attachments:
        await db.execute(text("""
            INSERT INTO supplier_document_attachments
              (id, document_id, filename, content_type, size_bytes, data)
            VALUES (gen_random_uuid(), :did, :fn, :ct, :sz, :data)
        """), {
            "did":  doc_id,
            "fn":   a["filename"],
            "ct":   a["content_type"],
            "sz":   len(a["data"]),
            "data": a["data"],
        })


# ────────────────────────── IMAP run ─────────────────────────────────────

def _imap_connect_sync(cfg: dict[str, Any]) -> imaplib.IMAP4_SSL:
    ctx = ssl.create_default_context()
    conn = imaplib.IMAP4_SSL(cfg["host"], cfg["port"], ssl_context=ctx, timeout=30)
    conn.login(cfg["user"], cfg["password"])
    return conn


def _parse_received_at(msg: Message) -> datetime | None:
    raw = msg.get("Date")
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except Exception:
        return None


async def _run_once(window_since: date | None, triggered_by: str, limit: int) -> dict[str, Any]:
    cfg = await _imap_config()
    if not cfg["user"] or not cfg["password"]:
        return {"status": "skipped", "reason": "INBOX_IMAP_USERNAME/PASSWORD not configured"}

    import asyncio

    counts = {"fetched": 0, "classified": 0, "records_created": 0, "skipped_duplicates": 0, "errors": 0}

    def _fetch_sync() -> tuple[list[tuple[str, bytes]], str | None]:
        """Returns [(uid, raw_rfc822), …] plus an optional error string."""
        try:
            conn = _imap_connect_sync(cfg)
        except Exception as exc:
            return [], f"IMAP connect failed: {exc}"
        try:
            conn.select(cfg["folder"])
            if window_since:
                crit = f'(SINCE "{window_since.strftime("%d-%b-%Y")}")'
            else:
                crit = "(UNSEEN)"
            typ, data = conn.uid("SEARCH", None, crit)
            if typ != "OK" or not data or not data[0]:
                return [], None
            uids = data[0].split()
            uids = uids[:limit]
            out: list[tuple[str, bytes]] = []
            for uid_bytes in uids:
                uid = uid_bytes.decode("ascii", errors="replace")
                typ, parts = conn.uid("FETCH", uid_bytes, "(RFC822)")
                if typ != "OK" or not parts:
                    continue
                for p in parts:
                    if isinstance(p, tuple) and len(p) >= 2 and isinstance(p[1], (bytes, bytearray)):
                        out.append((uid, bytes(p[1])))
                        break
            return out, None
        finally:
            try:
                conn.logout()
            except Exception:
                pass

    messages, err = await asyncio.get_event_loop().run_in_executor(None, _fetch_sync)
    if err:
        return {"status": "error", "error": err, **counts}

    async with SessionLocal() as db:
        for uid, raw in messages:
            counts["fetched"] += 1
            try:
                msg = email.message_from_bytes(raw)
                message_id = _decode(msg.get("Message-ID")) or f"<no-id-{uid}@shital>"
                if await _record_already_seen(db, message_id):
                    counts["skipped_duplicates"] += 1
                    continue

                from_raw = _decode(msg.get("From"))
                from_addr = (parseaddr(from_raw)[1] or from_raw).strip().lower()
                to_addr = (parseaddr(_decode(msg.get("To")))[1] or "").strip().lower()
                subject = _decode(msg.get("Subject"))
                body = _extract_text(msg)
                attachments = _extract_attachments(msg)
                received_at = _parse_received_at(msg)

                ai = await _classify_with_ai(from_addr, subject, body)
                classification = ai.get("classification", "UNCLASSIFIED")
                confidence = ai.get("confidence", 0.0)
                if classification not in CLASSIFICATIONS and classification != "UNCLASSIFIED":
                    classification = "OTHER"

                email_id = await _insert_email_row(db, {
                    "message_id":    message_id,
                    "uid":           uid,
                    "folder":        cfg["folder"],
                    "from":          from_addr,
                    "to":            to_addr,
                    "subject":       subject,
                    "received_at":   received_at,
                    "body":          body,
                    "classification": classification,
                    "confidence":    confidence,
                    "extracted":     ai,
                    "status":        "processed" if classification != "UNCLASSIFIED" else "pending",
                    "model":         ai.get("model", ""),
                    "headers": {
                        "Message-ID":  message_id,
                        "From":        from_raw,
                        "Subject":     subject,
                        "Date":        _decode(msg.get("Date")),
                    },
                })
                counts["classified"] += 1

                doc_id = await _upsert_supplier_document(db, email_id, classification, ai)
                if doc_id:
                    await _save_attachments(db, doc_id, attachments)
                    counts["records_created"] += 1
                await db.commit()
            except Exception as exc:
                counts["errors"] += 1
                await db.rollback()
                await db.execute(text("""
                    INSERT INTO email_ingest_messages
                        (message_id, folder, from_address, subject, status, error_message, body_excerpt)
                    VALUES
                        (:mid, :folder, :frm, :subj, 'error', :err, :excerpt)
                    ON CONFLICT (message_id) DO NOTHING
                """), {
                    "mid":     f"<err-{uuid.uuid4()}@shital>",
                    "folder":  cfg["folder"],
                    "frm":     "",
                    "subj":    f"[error on uid {uid}]",
                    "err":     str(exc)[:2000],
                    "excerpt": "",
                })
                await db.commit()

    return {"status": "ok", **counts, "triggered_by": triggered_by, "limit": limit}


# ────────────────────────── Endpoints ────────────────────────────────────

class _RunIn(BaseModel):
    since: str | None = None   # YYYY-MM-DD; empty means UNSEEN only
    limit: int | None = None


def _parse_since(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s.strip(), "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="since must be YYYY-MM-DD") from exc


@router.post("/email-ingest/run")
async def run_ingest(ctx: CurrentSpace, body: _RunIn) -> dict[str, Any]:
    _only_admin(ctx)
    since = _parse_since(body.since)
    limit = max(1, min(body.limit or MAX_MESSAGES_PER_RUN, MAX_MESSAGES_PER_RUN))
    return await _run_once(since, triggered_by=f"user:{ctx.user_email}", limit=limit)


@router.post("/email-ingest/run/cron")
async def run_ingest_cron(
    request: Request,
    body: _RunIn | None = None,
    x_sync_token: str | None = Header(default=None, alias="X-Sync-Token"),
) -> dict[str, Any]:
    expected = await SecretsManager.get("PAYMENT_SYNC_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="PAYMENT_SYNC_TOKEN not configured")
    if not x_sync_token or x_sync_token.strip() != expected.strip():
        raise HTTPException(status_code=401, detail="Invalid sync token")
    since = _parse_since(body.since if body else None)
    limit = max(1, min((body.limit if body else None) or MAX_MESSAGES_PER_RUN, MAX_MESSAGES_PER_RUN))
    client = request.client.host if request.client else "unknown"
    return await _run_once(since, triggered_by=f"cron:{client}", limit=limit)


@router.get("/email-ingest/messages")
async def list_messages(
    ctx: CurrentSpace,
    classification: str = "",
    status: str = "",
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    _only_admin(ctx)
    limit = max(1, min(limit, 500))
    where = ["1=1"]
    params: dict[str, Any] = {"lim": limit, "off": max(0, offset)}
    if classification:
        where.append("classification = :c")
        params["c"] = classification
    if status:
        where.append("status = :s")
        params["s"] = status
    clause = " AND ".join(where)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id, message_id, from_address, subject, received_at,
                   classification, confidence, status, error_message,
                   extracted_json, model, created_at, processed_at
              FROM email_ingest_messages
             WHERE {clause}
             ORDER BY COALESCE(received_at, created_at) DESC
             LIMIT :lim OFFSET :off
        """), params)).mappings().all()
        total = (await db.execute(text(f"""
            SELECT COUNT(*) FROM email_ingest_messages WHERE {clause}
        """), params)).scalar()
    def _iso(v: Any) -> str:
        return v.isoformat() if v and hasattr(v, "isoformat") else ""
    return {
        "total": int(total or 0),
        "items": [
            {
                "id":             str(r["id"]),
                "message_id":     r["message_id"],
                "from_address":   r["from_address"],
                "subject":        r["subject"],
                "received_at":    _iso(r["received_at"]),
                "classification": r["classification"],
                "confidence":     float(r["confidence"] or 0),
                "status":         r["status"],
                "error_message":  r["error_message"] or "",
                "extracted":      r["extracted_json"] or {},
                "model":          r["model"] or "",
                "processed_at":   _iso(r["processed_at"]),
            }
            for r in rows
        ],
    }


@router.post("/email-ingest/messages/{mid}/reprocess")
async def reprocess_message(ctx: CurrentSpace, mid: str) -> dict[str, Any]:
    """Re-run the AI classifier against a stored email's body excerpt
    (useful after the user tweaks the prompt or fixes a misclassification)."""
    _only_admin(ctx)
    try:
        uuid.UUID(mid)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Message not found")
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT id, from_address, subject, body_excerpt
              FROM email_ingest_messages WHERE id = :id
        """), {"id": mid})).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Message not found")
        ai = await _classify_with_ai(row["from_address"], row["subject"], row["body_excerpt"] or "")
        classification = ai.get("classification", "UNCLASSIFIED")
        if classification not in CLASSIFICATIONS and classification != "UNCLASSIFIED":
            classification = "OTHER"
        await db.execute(text("""
            UPDATE email_ingest_messages SET
              classification = :c, confidence = :conf,
              extracted_json = CAST(:ex AS JSONB),
              model = :m, status = 'processed', processed_at = NOW()
            WHERE id = :id
        """), {
            "id": mid, "c": classification,
            "conf": float(ai.get("confidence") or 0),
            "ex": json.dumps(ai), "m": ai.get("model", ""),
        })
        doc_id = await _upsert_supplier_document(db, mid, classification, ai)
        await db.commit()
    return {"ok": True, "classification": classification, "document_id": doc_id}


@router.get("/supplier-documents")
async def list_supplier_documents(
    ctx: CurrentSpace,
    doc_type: str = "",
    status: str = "",
    supplier: str = "",
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    _only_admin(ctx)
    limit = max(1, min(limit, 500))
    where = ["deleted_at IS NULL"]
    params: dict[str, Any] = {"lim": limit, "off": max(0, offset)}
    if doc_type:
        where.append("doc_type = :dt")
        params["dt"] = doc_type
    if status:
        where.append("status = :s")
        params["s"] = status
    if supplier:
        where.append("(LOWER(supplier_name) LIKE :sup OR LOWER(supplier_email) LIKE :sup)")
        params["sup"] = f"%{supplier.lower()}%"
    clause = " AND ".join(where)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id, doc_type, doc_number, supplier_name, supplier_email,
                   issued_date, due_date, total_amount, vat_amount, currency,
                   status, source, created_at,
                   (SELECT COUNT(*) FROM supplier_document_attachments a WHERE a.document_id = supplier_documents.id) AS attachment_count
              FROM supplier_documents
             WHERE {clause}
             ORDER BY COALESCE(issued_date, created_at::date) DESC, created_at DESC
             LIMIT :lim OFFSET :off
        """), params)).mappings().all()
        total = (await db.execute(text(f"""
            SELECT COUNT(*) FROM supplier_documents WHERE {clause}
        """), params)).scalar()
    def _iso(v: Any) -> str:
        return v.isoformat() if v and hasattr(v, "isoformat") else ""
    return {
        "total": int(total or 0),
        "items": [
            {
                "id":                str(r["id"]),
                "doc_type":          r["doc_type"],
                "doc_number":        r["doc_number"] or "",
                "supplier_name":     r["supplier_name"] or "",
                "supplier_email":    r["supplier_email"] or "",
                "issued_date":       _iso(r["issued_date"]),
                "due_date":          _iso(r["due_date"]),
                "total_amount":      float(r["total_amount"] or 0),
                "vat_amount":        float(r["vat_amount"] or 0),
                "currency":          r["currency"],
                "status":            r["status"],
                "source":            r["source"],
                "attachment_count":  int(r["attachment_count"] or 0),
                "created_at":        _iso(r["created_at"]),
            }
            for r in rows
        ],
    }


@router.get("/supplier-documents/{did}")
async def get_supplier_document(ctx: CurrentSpace, did: str) -> dict[str, Any]:
    _only_admin(ctx)
    try:
        uuid.UUID(did)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Not found")
    async with SessionLocal() as db:
        d = (await db.execute(text("""
            SELECT * FROM supplier_documents WHERE id = :id AND deleted_at IS NULL
        """), {"id": did})).mappings().first()
        if not d:
            raise HTTPException(status_code=404, detail="Not found")
        atts = (await db.execute(text("""
            SELECT id, filename, content_type, size_bytes, created_at
              FROM supplier_document_attachments
             WHERE document_id = :did ORDER BY created_at
        """), {"did": did})).mappings().all()
    def _iso(v: Any) -> str:
        return v.isoformat() if v and hasattr(v, "isoformat") else ""
    doc = {k: str(v) if isinstance(v, uuid.UUID) else v for k, v in dict(d).items()}
    for k in ("issued_date", "due_date", "created_at", "updated_at", "deleted_at"):
        if doc.get(k):
            doc[k] = _iso(doc[k])
    for k in ("total_amount", "net_amount", "vat_amount"):
        doc[k] = float(doc.get(k) or 0)
    return {
        "document": doc,
        "attachments": [
            {
                "id":           str(a["id"]),
                "filename":     a["filename"],
                "content_type": a["content_type"],
                "size_bytes":   int(a["size_bytes"] or 0),
                "download_url": f"/api/v1/admin/finance/supplier-documents/{did}/attachments/{a['id']}/download",
                "created_at":   _iso(a["created_at"]),
            }
            for a in atts
        ],
    }


@router.get("/supplier-documents/{did}/attachments/{aid}/download")
async def download_supplier_attachment(ctx: CurrentSpace, did: str, aid: str):
    _only_admin(ctx)
    from fastapi.responses import Response
    try:
        uuid.UUID(did)
        uuid.UUID(aid)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Not found")
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT filename, content_type, data
              FROM supplier_document_attachments
             WHERE id = :aid AND document_id = :did
        """), {"aid": aid, "did": did})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    safe = (row["filename"] or "attachment").replace('"', "")
    return Response(
        content=bytes(row["data"]),
        media_type=row["content_type"] or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{safe}"'},
    )


__all__ = ["router"]
