"""Mail Agent — agentic email triage.

For each new email in the watched mailboxes:
  1. Fetch body + attachments via Graph
  2. Hand the lot (text body + PDFs as document blocks + images as image
     blocks) to Claude Opus 4.7 with a toolbox of CRM / Finance / Helpdesk
     actions
  3. Let Claude decide: invoice → purchase invoice + line items; complaint →
     case; action item → task; payment confirmation → reconcile open invoice;
     statement → file; unrelated → skip
  4. Log every tool call as the audit trail for the resulting record(s)

Pure agentic — there is no rule pipeline. The system prompt tells Claude how
the business works; Claude reads each email like a member of the back office
would and calls the right tool(s).

Idempotency: `mail_agent_messages` records the Graph message_id; the poller
skips IDs that have a row, so re-running is safe.
"""
from __future__ import annotations

import base64
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any, cast

from anthropic import AsyncAnthropic
from anthropic.types import TextBlock, ToolUseBlock
from sqlalchemy import text

from shital.core.fabrics.config import settings
from shital.core.fabrics.database import SessionLocal
from shital.services import mailbox as mb
from shital.services import teams_webhook

logger = logging.getLogger("shital.mail_agent")

# ─── Anthropic client ────────────────────────────────────────────────────────

_client: AsyncAnthropic | None = None


def _claude() -> AsyncAnthropic:
    global _client
    if _client is None:
        if not settings.ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY not configured")
        _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


# ─── System prompt ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are the back-office assistant for ShitalEco — a UK charity ERP for Shirdi \
Sai Temple. Three shared mailboxes feed you:
  • accounts@shirdisai.org.uk — supplier invoices, statements, payment confirms
  • trustees@shirdisai.org.uk — governance, regulator notices, donor letters
  • info@shirdisai.org.uk     — public enquiries, complaints, volunteer offers

For EVERY email you process:

1. READ the body and any attachments carefully. Attachments may be PDFs (real \
invoices), images (photos of receipts), spreadsheets (statements), or scans.

2. CLASSIFY the email into ONE of:
   • invoice              — a supplier is billing us. Extract supplier, \
invoice number, date, due date, line items, totals, VAT. Match the supplier to \
a CRM account; if no confident match, create a new SUPPLIER account.
   • payment_confirmation — bank or supplier confirming a payment we made or \
received. Look up the open invoice by reference/amount/supplier and mark it paid.
   • complaint            — angry user, safeguarding concern, service issue. \
Create a case so the duty manager can respond.
   • action_item          — a specific task someone is asking us to do \
(e.g. "please send us a donation receipt for £200", "the boiler needs servicing"). \
Create a task assigned to the right role/person.
   • statement            — periodic account statement from a supplier. File it \
but no further action.
   • other                — newsletters, automated marketing, irrelevant. Skip.

3. ACT via the tool surface. ALWAYS:
   • Use `find_crm_account` BEFORE `create_crm_account` to avoid duplicates.
   • Use `find_open_purchase_invoice` BEFORE marking payments paid.
   • Attach the source email to every record you create with \
`attach_email_to_record` so trustees can see the original later.
   • Send a Teams alert for: invoices > £500, all complaints, payment \
mismatches, anything you escalate.
   • If you are not >70%% confident, call `escalate_to_human` with a clear \
reason — do NOT guess and create incorrect records.

4. FINISH by calling `finish` with a one-sentence human-readable summary of \
what you did. This becomes the audit-log entry.

Currencies: assume GBP unless the document says otherwise.
Dates: UK format (DD/MM/YYYY) in emails; convert to ISO (YYYY-MM-DD) for tools.
VAT: 0%% / 5%% / 20%% — most temple supplies are 20%%; food can be 0%%.

Be precise, be conservative, and when in doubt ESCALATE rather than fabricate."""

# ─── Tool definitions ───────────────────────────────────────────────────────

TOOLS: list[dict[str, Any]] = [
    {
        "name": "find_crm_account",
        "description": "Search CRM accounts (customers / suppliers / donors). Returns up to 10 candidates. Use BEFORE creating a new account.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name":         {"type": "string", "description": "Account name or trading name"},
                "account_type": {"type": "string", "enum": ["supplier", "customer", "donor", "partner", ""], "description": "Optional filter"},
                "vat_number":   {"type": "string", "description": "Optional VAT registration number"},
                "email":        {"type": "string", "description": "Optional contact email"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "create_crm_account",
        "description": "Create a new CRM account (supplier / customer / donor) when no existing match was found. Flagged needs_review so a human verifies it.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name":         {"type": "string"},
                "account_type": {"type": "string", "enum": ["supplier", "customer", "donor", "partner"]},
                "vat_number":   {"type": "string"},
                "email":        {"type": "string"},
                "phone":        {"type": "string"},
                "address":      {"type": "string", "description": "Full postal address as a single line"},
                "notes":        {"type": "string"},
            },
            "required": ["name", "account_type"],
        },
    },
    {
        "name": "create_purchase_invoice",
        "description": "Create a Purchase Invoice (status = PENDING_APPROVAL) with line items. A manager must approve before GL posting.",
        "input_schema": {
            "type": "object",
            "properties": {
                "supplier_account_id": {"type": "string", "description": "crm_accounts.id from find_crm_account / create_crm_account"},
                "invoice_number":      {"type": "string"},
                "invoice_date":        {"type": "string", "description": "ISO YYYY-MM-DD"},
                "due_date":            {"type": "string", "description": "ISO YYYY-MM-DD"},
                "currency":            {"type": "string", "description": "ISO 4217, default GBP"},
                "total_amount":        {"type": "number", "description": "Gross total including VAT"},
                "vat_amount":          {"type": "number"},
                "lines": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "quantity":    {"type": "number"},
                            "unit_price":  {"type": "number"},
                            "vat_rate":    {"type": "number", "description": "Percent: 0, 5, or 20"},
                            "line_total":  {"type": "number"},
                        },
                        "required": ["description", "line_total"],
                    },
                },
                "notes": {"type": "string"},
            },
            "required": ["supplier_account_id", "invoice_number", "invoice_date", "total_amount", "lines"],
        },
    },
    {
        "name": "find_open_purchase_invoice",
        "description": "Find unpaid purchase invoices matching the criteria — used to reconcile a payment confirmation against an invoice you already recorded.",
        "input_schema": {
            "type": "object",
            "properties": {
                "supplier_name":  {"type": "string"},
                "amount":         {"type": "number"},
                "invoice_number": {"type": "string"},
                "reference":      {"type": "string", "description": "Free-text — bank ref, payment ID, etc."},
            },
        },
    },
    {
        "name": "mark_invoice_paid",
        "description": "Mark an approved purchase invoice as PAID with the bank-side reconciliation details.",
        "input_schema": {
            "type": "object",
            "properties": {
                "invoice_id":        {"type": "string"},
                "paid_date":         {"type": "string", "description": "ISO YYYY-MM-DD"},
                "amount":            {"type": "number"},
                "payment_reference": {"type": "string"},
                "bank_account":      {"type": "string", "description": "Optional — which of our bank accounts paid it"},
            },
            "required": ["invoice_id", "paid_date", "amount", "payment_reference"],
        },
    },
    {
        "name": "create_case",
        "description": "Create a complaint / safeguarding / service case for the duty manager. Use for unhappy users or formal complaints.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title":          {"type": "string"},
                "description":    {"type": "string"},
                "category":       {"type": "string", "enum": ["complaint", "safeguarding", "service", "regulatory", "other"]},
                "severity":       {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                "customer_email": {"type": "string"},
                "customer_name":  {"type": "string"},
            },
            "required": ["title", "description", "category", "severity"],
        },
    },
    {
        "name": "create_task",
        "description": "Create a task for a specific person or role to action. Use for clear action items in the email.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title":          {"type": "string"},
                "description":    {"type": "string"},
                "due_date":       {"type": "string", "description": "ISO YYYY-MM-DD"},
                "assignee_email": {"type": "string", "description": "Specific user's email if known"},
                "assignee_role":  {"type": "string", "enum": ["SUPER_ADMIN", "ADMIN", "FINANCE_MANAGER", "HR_MANAGER", "VOLUNTEER_COORDINATOR", "TRUSTEE", ""], "description": "Or pick by role — first available user with that role is used"},
                "priority":       {"type": "string", "enum": ["low", "medium", "high"]},
            },
            "required": ["title", "description"],
        },
    },
    {
        "name": "attach_email_to_record",
        "description": "Link the source email to a record you just created so the original message is one click away from the record.",
        "input_schema": {
            "type": "object",
            "properties": {
                "record_type": {"type": "string", "enum": ["purchase_invoice", "case", "task", "crm_account"]},
                "record_id":   {"type": "string"},
                "note":        {"type": "string"},
            },
            "required": ["record_type", "record_id"],
        },
    },
    {
        "name": "send_teams_alert",
        "description": "Post a notification to the staff Microsoft Teams channel. Use sparingly — only for items needing attention (large invoices, complaints, escalations).",
        "input_schema": {
            "type": "object",
            "properties": {
                "title":     {"type": "string"},
                "message":   {"type": "string"},
                "severity":  {"type": "string", "enum": ["red", "amber", "green"]},
                "link_path": {"type": "string", "description": "Admin path to open, e.g. /finance/purchase-invoices/abc-123"},
            },
            "required": ["title", "message", "severity"],
        },
    },
    {
        "name": "escalate_to_human",
        "description": "Use when you are not confident enough to create records yourself. Flags the email for a human to review. ALWAYS prefer this over guessing.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reason":           {"type": "string"},
                "suggested_action": {"type": "string"},
            },
            "required": ["reason"],
        },
    },
    {
        "name": "finish",
        "description": "End the agent run with a one-sentence summary of what you did. Always call this last.",
        "input_schema": {
            "type": "object",
            "properties": {
                "classification": {"type": "string", "enum": ["invoice", "payment_confirmation", "complaint", "action_item", "statement", "other"]},
                "summary":        {"type": "string"},
            },
            "required": ["classification", "summary"],
        },
    },
]


# ─── Tool dispatch ──────────────────────────────────────────────────────────

async def _tool_find_crm_account(args: dict[str, Any]) -> dict[str, Any]:
    name = (args.get("name") or "").strip()
    if not name:
        return {"error": "name required"}
    acct_type = (args.get("account_type") or "").strip()
    vat = (args.get("vat_number") or "").strip()
    email = (args.get("email") or "").strip()

    where = ["deleted_at IS NULL"]
    params: dict[str, Any] = {"q": f"%{name}%"}
    where.append("(name ILIKE :q OR legal_name ILIKE :q)")
    if acct_type:
        where.append("account_type = :t")
        params["t"] = acct_type
    if vat:
        where.append("(vat_number = :v OR :v = '')")
        params["v"] = vat
    if email:
        where.append("(email ILIKE :e OR :e = '')")
        params["e"] = f"%{email}%"
    sql = f"""
        SELECT id, name, legal_name, account_type, vat_number, email, phone, branch_id
        FROM crm_accounts
        WHERE {' AND '.join(where)}
        ORDER BY (CASE WHEN name ILIKE :q THEN 0 ELSE 1 END), name
        LIMIT 10
    """
    async with SessionLocal() as db:
        rows = (await db.execute(text(sql), params)).mappings().all()
    return {"matches": [{
        "id":           str(r["id"]),
        "name":         r["name"],
        "legal_name":   r["legal_name"],
        "account_type": r["account_type"],
        "vat_number":   r["vat_number"],
        "email":        r["email"],
        "phone":        r["phone"],
    } for r in rows]}


async def _tool_create_crm_account(args: dict[str, Any]) -> dict[str, Any]:
    name = (args.get("name") or "").strip()
    acct_type = (args.get("account_type") or "supplier").strip()
    if not name:
        return {"error": "name required"}
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO crm_accounts (id, name, account_type, vat_number, email, phone, notes, needs_review, created_at, updated_at)
            VALUES (:id, :name, :t, :vat, :email, :phone, :notes, true, NOW(), NOW())
        """), {
            "id":    new_id,
            "name":  name,
            "t":     acct_type,
            "vat":   args.get("vat_number") or "",
            "email": args.get("email") or "",
            "phone": args.get("phone") or "",
            "notes": args.get("notes") or f"Auto-created by mail agent. Address: {args.get('address', '')}",
        })
        await db.commit()
    return {"id": new_id, "name": name, "needs_review": True}


async def _tool_create_purchase_invoice(args: dict[str, Any]) -> dict[str, Any]:
    supplier_id = args.get("supplier_account_id")
    invoice_number = (args.get("invoice_number") or "").strip()
    invoice_date = args.get("invoice_date")
    total_amount = args.get("total_amount")
    lines = args.get("lines") or []
    if not (supplier_id and invoice_number and invoice_date and total_amount and lines):
        return {"error": "supplier_account_id, invoice_number, invoice_date, total_amount, lines all required"}
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        # Column names match the main `purchase_invoices` schema in main.py
        # — `total`/`vat_total` (not total_amount/vat_amount), `paid_at`
        # (not paid_date), `reference` (not payment_reference). `source` is
        # added by ALTER for this integration.
        await db.execute(text("""
            INSERT INTO purchase_invoices
                (id, supplier_account_id, invoice_number, invoice_date, due_date,
                 currency, total, vat_total, status, notes, source, created_at, updated_at)
            VALUES
                (:id, :sid, :num, :idate, :ddate, :ccy, :total, :vat,
                 'PENDING_APPROVAL', :notes, 'mail_agent', NOW(), NOW())
        """), {
            "id":    new_id,
            "sid":   supplier_id,
            "num":   invoice_number,
            "idate": invoice_date,
            "ddate": args.get("due_date"),
            "ccy":   args.get("currency") or "GBP",
            "total": total_amount,
            "vat":   args.get("vat_amount") or 0,
            "notes": args.get("notes") or "",
        })
        for ln in lines:
            await db.execute(text("""
                INSERT INTO purchase_invoice_lines
                    (id, invoice_id, description, quantity, unit_price, vat_rate, line_total, created_at)
                VALUES (gen_random_uuid(), :iid, :desc, :qty, :up, :vr, :lt, NOW())
            """), {
                "iid":  new_id,
                "desc": ln.get("description") or "",
                "qty":  ln.get("quantity") or 1,
                "up":   ln.get("unit_price") or 0,
                "vr":   ln.get("vat_rate") or 0,
                "lt":   ln.get("line_total") or 0,
            })
        await db.commit()
    return {"id": new_id, "invoice_number": invoice_number, "total": total_amount,
            "status": "PENDING_APPROVAL"}


async def _tool_find_open_purchase_invoice(args: dict[str, Any]) -> dict[str, Any]:
    where = ["pi.status IN ('APPROVED', 'PENDING_APPROVAL')"]
    params: dict[str, Any] = {}
    if args.get("invoice_number"):
        where.append("pi.invoice_number ILIKE :num")
        params["num"] = f"%{args['invoice_number']}%"
    if args.get("supplier_name"):
        where.append("ca.name ILIKE :sn")
        params["sn"] = f"%{args['supplier_name']}%"
    if args.get("amount") is not None:
        where.append("ABS(pi.total - :amt) < 0.05")
        params["amt"] = args["amount"]
    sql = f"""
        SELECT pi.id, pi.invoice_number, pi.invoice_date, pi.total,
               pi.status, ca.name AS supplier_name
        FROM purchase_invoices pi
        LEFT JOIN crm_accounts ca ON ca.id = pi.supplier_account_id
        WHERE {' AND '.join(where)}
        ORDER BY pi.invoice_date DESC
        LIMIT 10
    """
    async with SessionLocal() as db:
        rows = (await db.execute(text(sql), params)).mappings().all()
    return {"matches": [{
        "id":             str(r["id"]),
        "invoice_number": r["invoice_number"],
        "invoice_date":   r["invoice_date"].isoformat() if r["invoice_date"] else None,
        "total":          float(r["total"]) if r["total"] is not None else None,
        "status":         r["status"],
        "supplier":       r["supplier_name"],
    } for r in rows]}


async def _tool_mark_invoice_paid(args: dict[str, Any]) -> dict[str, Any]:
    iid = args.get("invoice_id")
    if not iid:
        return {"error": "invoice_id required"}
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE purchase_invoices
            SET status='PAID', paid_at=:pd, reference=:pr, updated_at=NOW()
            WHERE id = :id
        """), {
            "id": iid,
            "pd": args.get("paid_date"),
            "pr": args.get("payment_reference") or "",
        })
        await db.commit()
    return {"id": iid, "status": "PAID"}


async def _tool_create_case(args: dict[str, Any]) -> dict[str, Any]:
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO cases (id, title, description, category, severity, status,
                               customer_email, customer_name, source, created_at, updated_at)
            VALUES (:id, :t, :d, :c, :s, 'open', :ce, :cn, 'mail_agent', NOW(), NOW())
        """), {
            "id": new_id,
            "t":  args.get("title") or "Untitled case",
            "d":  args.get("description") or "",
            "c":  args.get("category") or "other",
            "s":  args.get("severity") or "medium",
            "ce": args.get("customer_email") or "",
            "cn": args.get("customer_name") or "",
        })
        await db.commit()
    return {"id": new_id, "status": "open"}


async def _tool_create_task(args: dict[str, Any]) -> dict[str, Any]:
    new_id = str(uuid.uuid4())
    assignee_id: str | None = None
    assignee_email = (args.get("assignee_email") or "").strip()
    assignee_role = (args.get("assignee_role") or "").strip()
    async with SessionLocal() as db:
        if assignee_email:
            row = (await db.execute(text(
                "SELECT id FROM users WHERE LOWER(email) = LOWER(:e) AND is_active = true LIMIT 1"
            ), {"e": assignee_email})).first()
            if row:
                assignee_id = str(row[0])
        if not assignee_id and assignee_role:
            row = (await db.execute(text(
                "SELECT id FROM users WHERE role = :r AND is_active = true ORDER BY created_at LIMIT 1"
            ), {"r": assignee_role})).first()
            if row:
                assignee_id = str(row[0])
        await db.execute(text("""
            INSERT INTO agent_tasks (id, title, description, due_date, assignee_user_id,
                                     assignee_role, priority, status, source, created_at, updated_at)
            VALUES (:id, :t, :d, :due, :uid, :role, :pri, 'open', 'mail_agent', NOW(), NOW())
        """), {
            "id":   new_id,
            "t":    args.get("title") or "Untitled task",
            "d":    args.get("description") or "",
            "due":  args.get("due_date"),
            "uid":  assignee_id,
            "role": assignee_role,
            "pri":  args.get("priority") or "medium",
        })
        await db.commit()
    return {"id": new_id, "assignee_user_id": assignee_id, "status": "open"}


async def _tool_attach_email_to_record(args: dict[str, Any], *,
                                       mail_agent_message_id: str) -> dict[str, Any]:
    rt = args.get("record_type")
    rid = args.get("record_id")
    if not (rt and rid):
        return {"error": "record_type and record_id required"}
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO mail_agent_record_links (id, mail_agent_message_id, record_type, record_id, note, created_at)
            VALUES (gen_random_uuid(), :mid, :rt, :rid, :note, NOW())
        """), {"mid": mail_agent_message_id, "rt": rt, "rid": rid, "note": args.get("note") or ""})
        await db.commit()
    return {"ok": True}


async def _tool_send_teams_alert(args: dict[str, Any]) -> dict[str, Any]:
    link = args.get("link_path") or ""
    url = f"https://admin.shital.org.uk{link}" if link else ""
    ok = await teams_webhook.send_alert(
        title    = args.get("title") or "Mail agent alert",
        message  = args.get("message") or "",
        severity = args.get("severity") or "amber",
        link_url = url,
    )
    return {"ok": ok}


async def _tool_escalate(args: dict[str, Any], *,
                         mail_agent_message_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE mail_agent_messages
            SET needs_human_review = true,
                escalation_reason  = :r,
                suggested_action   = :s
            WHERE id = :id
        """), {
            "id": mail_agent_message_id,
            "r":  args.get("reason") or "",
            "s":  args.get("suggested_action") or "",
        })
        await db.commit()
    return {"escalated": True}


async def _dispatch(name: str, args: dict[str, Any], *,
                    mail_agent_message_id: str) -> dict[str, Any]:
    if name == "find_crm_account":
        return await _tool_find_crm_account(args)
    if name == "create_crm_account":
        return await _tool_create_crm_account(args)
    if name == "create_purchase_invoice":
        return await _tool_create_purchase_invoice(args)
    if name == "find_open_purchase_invoice":
        return await _tool_find_open_purchase_invoice(args)
    if name == "mark_invoice_paid":
        return await _tool_mark_invoice_paid(args)
    if name == "create_case":
        return await _tool_create_case(args)
    if name == "create_task":
        return await _tool_create_task(args)
    if name == "attach_email_to_record":
        return await _tool_attach_email_to_record(args, mail_agent_message_id=mail_agent_message_id)
    if name == "send_teams_alert":
        return await _tool_send_teams_alert(args)
    if name == "escalate_to_human":
        return await _tool_escalate(args, mail_agent_message_id=mail_agent_message_id)
    if name == "finish":
        return {"acknowledged": True}
    return {"error": f"unknown tool {name}"}


# ─── Per-email triage entry point ───────────────────────────────────────────

async def triage_email(mailbox: str, message_meta: dict[str, Any]) -> dict[str, Any]:
    """Run the agentic loop for one email. Idempotent — returns the existing
    row if this message_id was already processed.

    Returns the mail_agent_messages row as a dict."""
    msg_id = message_meta["id"]

    # Idempotency check
    async with SessionLocal() as db:
        existing = (await db.execute(text(
            "SELECT id, classification, agent_summary FROM mail_agent_messages WHERE graph_message_id = :gid"
        ), {"gid": msg_id})).mappings().first()
    if existing:
        return {"id": str(existing["id"]), "classification": existing["classification"],
                "agent_summary": existing["agent_summary"], "skipped": True}

    # Insert the audit row up front so escalations/tool-attach can reference it
    mail_agent_id = str(uuid.uuid4())
    sender = (message_meta.get("from") or {}).get("emailAddress") or {}
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO mail_agent_messages
                (id, mailbox, graph_message_id, conversation_id, internet_message_id,
                 subject, sender_email, sender_name, received_at, status, created_at)
            VALUES
                (:id, :mb, :gid, :cid, :imid, :subj, :se, :sn, :rcv, 'processing', NOW())
        """), {
            "id":   mail_agent_id,
            "mb":   mailbox,
            "gid":  msg_id,
            "cid":  message_meta.get("conversationId") or "",
            "imid": message_meta.get("internetMessageId") or "",
            "subj": (message_meta.get("subject") or "")[:500],
            "se":   sender.get("address") or "",
            "sn":   sender.get("name") or "",
            "rcv":  message_meta.get("receivedDateTime"),
        })
        await db.commit()

    try:
        full = await mb.get_message_body(mailbox, msg_id)
        atts_meta = await mb.list_attachments(mailbox, msg_id) if message_meta.get("hasAttachments") else []
    except Exception as exc:
        logger.exception("mail_agent.fetch_failed", extra={"mailbox": mailbox, "msg_id": msg_id})
        await _finalise(mail_agent_id, classification="other",
                        summary=f"Fetch failed: {exc}", status="error", tool_log=[])
        return {"id": mail_agent_id, "classification": "other", "agent_summary": str(exc), "error": True}

    # ─── Build the initial user content blocks ──────────────────────────────
    body_block = (full.get("body") or {})
    body_kind  = body_block.get("contentType", "text")
    body_text  = body_block.get("content", "")
    header_lines = [
        f"From: {sender.get('name') or ''} <{sender.get('address') or ''}>",
        "To: " + ", ".join((r.get('emailAddress') or {}).get('address', '') for r in (full.get('toRecipients') or [])),
        f"Date: {full.get('receivedDateTime', '')}",
        f"Subject: {full.get('subject', '')}",
        f"Mailbox: {mailbox}",
        "",
        f"[Body, format={body_kind}, {len(body_text)} chars]",
        body_text[:25000],  # hard cap so we never blow context
    ]
    content_blocks: list[dict[str, Any]] = [{"type": "text", "text": "\n".join(header_lines)}]

    # ─── Attach each attachment as a vision/document block ──────────────────
    for a in atts_meta:
        try:
            full_att = await mb.get_attachment(mailbox, msg_id, a["id"])
        except Exception:
            continue
        ct = (a.get("contentType") or "").lower()
        b64 = full_att.get("contentBytes") or ""
        if not b64:
            continue
        if ct == "application/pdf":
            content_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
                "title": a.get("name", "attachment.pdf"),
            })
        elif ct in ("image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"):
            content_blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": ct.replace("jpg", "jpeg"), "data": b64},
            })
        else:
            # Plain text-ish (csv, txt). Decode best-effort and inline.
            try:
                inline = base64.b64decode(b64).decode("utf-8", errors="replace")[:10000]
                content_blocks.append({"type": "text",
                                       "text": f"[Attachment {a.get('name', 'file')} ({ct})]\n{inline}"})
            except Exception:
                pass

    # ─── Agentic loop ───────────────────────────────────────────────────────
    client = _claude()
    messages: list[dict[str, Any]] = [{"role": "user", "content": content_blocks}]
    tool_log: list[dict[str, Any]] = []
    classification = "other"
    summary = "(agent did not call finish)"

    for turn in range(settings.MAIL_AGENT_MAX_ITER):
        try:
            resp = await client.messages.create(
                model      = settings.MAIL_AGENT_MODEL,
                max_tokens = 8000,
                system     = SYSTEM_PROMPT,
                tools      = TOOLS,  # type: ignore[arg-type]
                messages   = messages,  # type: ignore[arg-type]
            )
        except Exception as exc:
            logger.exception("mail_agent.claude_failed", extra={"msg_id": msg_id, "turn": turn})
            summary = f"Claude call failed at turn {turn}: {exc}"
            break

        # Capture assistant turn verbatim so tool_use blocks are preserved
        messages.append({"role": "assistant", "content": resp.content})

        # SDK content_block is a Pydantic discriminated union. Narrowing
        # via `b.type == "tool_use"` is the discriminator the SDK uses
        # internally — `isinstance(b, ToolUseBlock)` doesn't narrow for
        # mypy because the union members are TypeAliases under the hood.
        # We runtime-check `.type` and `cast()` for the type-checker.
        tool_uses: list[ToolUseBlock] = [
            cast(ToolUseBlock, b) for b in resp.content if b.type == "tool_use"
        ]
        if not tool_uses:
            # Pure-text reply with no tool call — extract any text and stop
            for b in resp.content:
                if b.type == "text":
                    summary = cast(TextBlock, b).text[:500]
                    break
            break

        tool_results: list[dict[str, Any]] = []
        finished = False
        for tu in tool_uses:
            name = tu.name
            # tu.input is typed as `object` by the SDK; runtime is always a
            # JSON dict produced from the tool schema. Cast after the
            # isinstance gate.
            raw_input = tu.input
            args: dict[str, Any] = (
                cast(dict[str, Any], raw_input) if isinstance(raw_input, dict) else {}
            )
            try:
                result = await _dispatch(name, args, mail_agent_message_id=mail_agent_id)
            except Exception as exc:
                result = {"error": str(exc)}
                logger.exception("mail_agent.tool_failed",
                                 extra={"tool": name, "msg_id": msg_id})
            tool_log.append({"turn": turn, "tool": name, "args": args, "result": result})

            if name == "finish":
                classification = str(args.get("classification") or "other")
                summary = str(args.get("summary") or summary)
                finished = True

            tool_results.append({
                "type":        "tool_result",
                "tool_use_id": tu.id,
                "content":     json.dumps(result)[:4000],
            })

        messages.append({"role": "user", "content": tool_results})
        if finished:
            break

    await _finalise(mail_agent_id, classification=classification, summary=summary,
                    status="done", tool_log=tool_log)
    return {"id": mail_agent_id, "classification": classification, "agent_summary": summary}


async def _finalise(mail_agent_id: str, *, classification: str, summary: str,
                    status: str, tool_log: list[dict[str, Any]]) -> None:
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE mail_agent_messages
            SET classification = :c,
                agent_summary  = :s,
                tool_log       = CAST(:tl AS JSONB),
                status         = :st,
                processed_at   = NOW()
            WHERE id = :id
        """), {
            "id": mail_agent_id, "c": classification, "s": summary[:2000],
            "tl": json.dumps(tool_log), "st": status,
        })
        await db.commit()


# ─── Mailbox sweep ──────────────────────────────────────────────────────────

async def sweep_once(lookback_days_override: int | None = None,
                     ignore_seen: bool = False) -> dict[str, Any]:
    """Poll all configured mailboxes, triage anything new. Returns per-mailbox
    counts so the dashboard can show last-sweep summary.

    `lookback_days_override` — when supplied, replaces MAIL_AGENT_LOOKBACK_DAYS
    for THIS run only. Useful when the operator wants a deep catch-up sweep
    ("scan the last 20 days") without changing the default.

    `ignore_seen` — when True, ignores the "last processed message" cursor
    and re-walks every message within the lookback window. The idempotency
    check inside triage_email() still prevents duplicate purchase_invoices
    rows; this just gives the poller a chance to re-look at older emails
    that were skipped by the cursor."""
    mailboxes = [m.strip() for m in (settings.MAIL_AGENT_MAILBOXES or "").split(",") if m.strip()]
    if not mailboxes:
        return {"skipped": "no MAIL_AGENT_MAILBOXES configured"}

    out: dict[str, Any] = {"swept_at": datetime.now(UTC).isoformat(), "mailboxes": {}}
    # Hard floor: never reach further back than MAIL_AGENT_LOOKBACK_DAYS. On
    # a first sweep (no rows in mail_agent_messages) this prevents the agent
    # from trying to triage years of accounts@ history. On a resumed sweep
    # where the agent has been paused longer than the floor, this keeps the
    # backlog bounded.
    from datetime import timedelta
    lookback = int(lookback_days_override) if lookback_days_override else settings.MAIL_AGENT_LOOKBACK_DAYS
    floor_dt = datetime.now(UTC) - timedelta(days=lookback)
    floor_iso = floor_dt.isoformat().replace("+00:00", "Z")

    for mailbox in mailboxes:
        # Resume from last successful processed message, but never further
        # back than the lookback floor. `ignore_seen` skips the cursor so we
        # walk the full window.
        if ignore_seen:
            since = floor_iso
        else:
            async with SessionLocal() as db:
                row = (await db.execute(text("""
                    SELECT MAX(received_at) AS last_rcv
                    FROM mail_agent_messages
                    WHERE mailbox = :mb AND status = 'done'
                """), {"mb": mailbox})).first()
            last_rcv: datetime | None = row[0] if row else None
            if last_rcv is None:
                since = floor_iso
            else:
                last_rcv_utc = last_rcv.astimezone(UTC)
                effective_since = max(last_rcv_utc, floor_dt)
                since = effective_since.isoformat().replace("+00:00", "Z")
        try:
            # Deep-sweep mode (20-day catch-up via the inbox UI) needs a
            # bigger pull than the default 25; an idle 5-min cadence only
            # ever has a handful so the bigger cap is harmless there too.
            top_cap = 500 if (ignore_seen or lookback > 10) else 25
            msgs = await mb.list_new_messages(mailbox, since_iso=since, top=top_cap)
        except Exception as exc:
            logger.exception("mail_agent.list_failed", extra={"mailbox": mailbox})
            out["mailboxes"][mailbox] = {"error": str(exc)}
            continue

        processed = 0
        skipped   = 0
        # Mode-aware dispatch: rules-based extractor when no LLM key (or
        # MAIL_AGENT_MODE=rules), Claude agentic loop otherwise. Imported
        # lazily to avoid a hard dep on this module from
        # mail_agent_rules.py.
        from shital.services.mail_agent_rules import triage_email_dispatch

        # Oldest-first so escalation order is chronological
        for m in reversed(msgs):
            r = await triage_email_dispatch(mailbox, m)
            if r.get("skipped"):
                skipped += 1
            else:
                processed += 1
        out["mailboxes"][mailbox] = {"fetched": len(msgs), "processed": processed, "skipped": skipped}
    return out
