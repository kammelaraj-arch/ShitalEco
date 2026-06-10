"""Bank statement CSV import — multi-format parser + dedup + commit flow.

Supports:
  - PayPal Activity Download CSV (Date / Type / Gross / Fee / Net / etc.)
  - Stripe Balance / Payouts CSV
  - SumUp Transactions CSV
  - NatWest Online Banking CSV
  - Generic UK bank fallback (Date / Description / Amount / Balance)

Flow:
  POST /admin/bank-accounts/{id}/import           upload + parse + preview
  POST /admin/bank-accounts/{id}/import/commit    commit a parsed statement
  GET  /admin/bank-accounts/{id}/statements       list past imports
  DELETE /admin/bank-statements/{id}              undo: delete statement +
                                                  cascade rollback its
                                                  bank_transactions

Dedup:
  - file_hash (SHA-256) blocks re-uploading the same file by accident.
  - Per-row dedup against existing bank_transactions by composite
    (account_id, txn_date, amount, reference). Duplicate rows are
    counted but skipped on commit.

PR 3 will add PDF parsing on top of this same framework.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["bank-imports"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )


def _looks_uuid(s: str | None) -> bool:
    if not s:
        return False
    try:
        uuid.UUID(s)
        return True
    except (ValueError, AttributeError):
        return False


# ─── Parsing helpers ──────────────────────────────────────────────────────────

DATE_FORMATS = (
    "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y",
    "%m/%d/%Y", "%Y/%m/%d", "%d %b %y", "%d-%b-%Y",
)


def _parse_date(s: str) -> date | None:
    s = (s or "").strip().strip('"').split(" ")[0]
    if not s:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


_AMOUNT_RE = re.compile(r"[^\d\.\-]")


def _parse_amount(s: str | None) -> Decimal | None:
    """Parse a money string. Accepts £1,234.56 / -1,234.56 / (1,234.56) / etc."""
    if s is None:
        return None
    raw = str(s).strip()
    if not raw:
        return None
    negative = False
    if raw.startswith("(") and raw.endswith(")"):
        negative = True
        raw = raw[1:-1]
    cleaned = _AMOUNT_RE.sub("", raw.replace(",", ""))
    if not cleaned or cleaned in {"-", "."}:
        return None
    try:
        v = Decimal(cleaned)
        return -v if negative else v
    except (InvalidOperation, ValueError):
        return None


def _row_get(row: dict[str, str], *keys: str, default: str = "") -> str:
    """Tolerant row[key] — case-insensitive, tries multiple aliases."""
    lower = {k.lower().strip(): v for k, v in row.items()}
    for k in keys:
        v = lower.get(k.lower().strip())
        if v is not None and v.strip():
            return v.strip()
    return default


# ─── Format detection ─────────────────────────────────────────────────────────

def _detect_provider(headers: list[str]) -> str:
    """Inspect column headers (lowercased) to pick a parser."""
    h = {x.lower().strip().strip('"') for x in headers}
    if {"gross", "fee", "net"}.issubset(h) and "transaction id" in h:
        return "PAYPAL"
    if "reporting category" in h or {"created (utc)", "available on (utc)"}.issubset(h):
        return "STRIPE"
    if "transaction code" in h or ("payment type" in h and "transaction type" in h):
        return "SUMUP"
    # NatWest exports include 'Date,Type,Description,Value,Balance,Account Name,Account Number'
    if {"value", "balance"}.issubset(h) and "type" in h and "description" in h:
        return "NATWEST"
    return "GENERIC"


# ─── Per-format parsers ───────────────────────────────────────────────────────

def _parse_paypal_row(row: dict[str, str]) -> dict[str, Any] | None:
    d = _parse_date(_row_get(row, "Date"))
    if not d:
        return None
    # PayPal "Net" is the amount the account moved by. "Type" is the txn label.
    amount = _parse_amount(_row_get(row, "Net"))
    if amount is None:
        # Fall back to Gross when Net is empty
        amount = _parse_amount(_row_get(row, "Gross"))
    if amount is None:
        return None
    return {
        "txn_date": d,
        "description": _row_get(row, "Type", "Item Title"),
        "counterparty": _row_get(row, "Name", "From Email Address", "To Email Address"),
        "reference": _row_get(row, "Transaction ID", "Reference Txn ID"),
        "amount": amount,
        "balance_after": _parse_amount(_row_get(row, "Balance")),
        "currency": _row_get(row, "Currency", default="GBP"),
        "txn_type": _classify_txn_type(_row_get(row, "Type"), amount),
    }


def _parse_stripe_row(row: dict[str, str]) -> dict[str, Any] | None:
    d = _parse_date(_row_get(row, "Created (UTC)", "Created", "Date"))
    if not d:
        return None
    amount = _parse_amount(_row_get(row, "Amount", "Net"))
    if amount is None:
        return None
    return {
        "txn_date": d,
        "description": _row_get(row, "Description", "Reporting Category", "Type"),
        "counterparty": _row_get(row, "Customer Description", "Customer", "Source"),
        "reference": _row_get(row, "id", "ID", "Transaction ID"),
        "amount": amount,
        "balance_after": None,
        "currency": _row_get(row, "Currency", default="GBP").upper(),
        "txn_type": _classify_txn_type(_row_get(row, "Reporting Category", "Type"), amount),
    }


def _parse_sumup_row(row: dict[str, str]) -> dict[str, Any] | None:
    d = _parse_date(_row_get(row, "Date", "Transaction Date"))
    if not d:
        return None
    amount = _parse_amount(_row_get(row, "Amount", "Total"))
    if amount is None:
        return None
    return {
        "txn_date": d,
        "description": _row_get(row, "Description", "Payment Type", "Type"),
        "counterparty": _row_get(row, "Customer", "Email", "Description"),
        "reference": _row_get(row, "Transaction Code", "ID"),
        "amount": amount,
        "balance_after": None,
        "currency": _row_get(row, "Currency", default="GBP").upper(),
        "txn_type": _classify_txn_type(_row_get(row, "Type", "Payment Type"), amount),
    }


def _parse_natwest_row(row: dict[str, str]) -> dict[str, Any] | None:
    d = _parse_date(_row_get(row, "Date"))
    if not d:
        return None
    amount = _parse_amount(_row_get(row, "Value"))
    if amount is None:
        return None
    return {
        "txn_date": d,
        "description": _row_get(row, "Description"),
        "counterparty": _row_get(row, "Description").split(",")[0].strip(),
        "reference": _row_get(row, "Type"),
        "amount": amount,
        "balance_after": _parse_amount(_row_get(row, "Balance")),
        "currency": "GBP",
        "txn_type": _classify_txn_type(_row_get(row, "Type"), amount),
    }


def _parse_generic_row(row: dict[str, str]) -> dict[str, Any] | None:
    """Best-effort parser — accepts Date / Description / Amount / Balance,
    works for most UK banks that don't match one of the named formats above."""
    d = _parse_date(_row_get(row, "Date", "Transaction Date", "Posted"))
    if not d:
        return None
    # Some banks split debit / credit into separate columns.
    debit = _parse_amount(_row_get(row, "Debit", "Money Out", "Paid Out", "Withdrawal"))
    credit = _parse_amount(_row_get(row, "Credit", "Money In", "Paid In", "Deposit"))
    amount: Decimal | None
    if debit is not None and debit != 0:
        amount = -abs(debit)
    elif credit is not None and credit != 0:
        amount = abs(credit)
    else:
        amount = _parse_amount(_row_get(row, "Amount", "Value", "Total"))
    if amount is None:
        return None
    return {
        "txn_date": d,
        "description": _row_get(row, "Description", "Details", "Memo", "Narrative"),
        "counterparty": _row_get(row, "Counterparty", "Payee", "Name"),
        "reference": _row_get(row, "Reference", "Reference Number", "Type"),
        "amount": amount,
        "balance_after": _parse_amount(_row_get(row, "Balance", "Running Balance")),
        "currency": _row_get(row, "Currency", default="GBP").upper(),
        "txn_type": _classify_txn_type(_row_get(row, "Type", "Transaction Type"), amount),
    }


def _classify_txn_type(label: str, amount: Decimal | None) -> str:
    """Map provider-specific labels to our internal taxonomy."""
    s = (label or "").lower()
    if any(w in s for w in ("fee", "charge", "commission")):
        return "FEE"
    if "interest" in s:
        return "INTEREST"
    if "transfer" in s:
        return "TRANSFER"
    if any(w in s for w in ("refund", "reversal", "chargeback")):
        return "REFUND"
    if amount is None:
        return "OTHER"
    return "CREDIT" if amount > 0 else "DEBIT"


PARSERS = {
    "PAYPAL":  _parse_paypal_row,
    "STRIPE":  _parse_stripe_row,
    "SUMUP":   _parse_sumup_row,
    "NATWEST": _parse_natwest_row,
    "GENERIC": _parse_generic_row,
}


# ─── PDF → row-list converter ────────────────────────────────────────────────
# pdfplumber's extract_tables() works well on born-digital bank statements
# (Natwest, HSBC, Barclays, Lloyds all produce regular column layouts).
# For scanned statements (image-only PDFs) it returns nothing — the operator
# is told to export CSV from online banking instead.
#
# We DON'T try to parse provider-specific layouts here — we just produce a
# list-of-lists (header row + transaction rows) that the existing CSV
# pipeline (`_parse_natwest_row` / `_parse_generic_row`) understands. That
# keeps PDFs and CSVs sharing 100% of the downstream logic.

def _pdf_to_rows(raw: bytes, provider_hint: str = "") -> list[list[str]]:
    """Extract transaction rows from a bank-statement PDF. Returns the same
    row-list shape as csv.reader: first row is the header, the rest are
    transactions. Returns [] when the PDF has no extractable tables (image
    scans, password-protected, exotic layouts)."""
    import io as _io

    try:
        import pdfplumber  # type: ignore[import-untyped]
    except ImportError:
        return []

    out: list[list[str]] = []
    header: list[str] | None = None
    try:
        with pdfplumber.open(_io.BytesIO(raw)) as pdf:
            for page in pdf.pages:
                # extract_tables() is the heavy hitter — it groups text into
                # rows and columns based on ruling lines + alignment. Returns
                # one or more 2D arrays per page.
                tables = page.extract_tables() or []
                for tbl in tables:
                    if not tbl or not tbl[0]:
                        continue
                    # Normalise cells — pdfplumber may return None for empty
                    # cells, and individual cells often contain newlines from
                    # multi-line descriptions.
                    norm = [
                        [(c or "").replace("\n", " ").strip() for c in row]
                        for row in tbl
                    ]
                    # Is this the header row? Look for words like Date /
                    # Description / Amount / Balance.
                    first = " ".join(norm[0]).lower()
                    is_header_row = any(k in first for k in (
                        "date", "description", "details", "type",
                        "amount", "balance", "money in", "money out",
                        "paid in", "paid out", "credit", "debit",
                    ))
                    if is_header_row:
                        if header is None:
                            header = norm[0]
                            out.append(header)
                        # Append data rows from this table (skip the header itself)
                        for r in norm[1:]:
                            if any(c.strip() for c in r):
                                out.append(r)
                    else:
                        # Table without a recognisable header — assume it's a
                        # continuation of the previous page's table.
                        if header is not None:
                            for r in norm:
                                if any(c.strip() for c in r):
                                    out.append(r)
    except Exception:  # noqa: BLE001
        return []

    # Drop rows that are too short to be transactions (e.g. carried-balance
    # summary lines that pdfplumber sometimes pulls in as 2-col rows).
    if header is None:
        return []
    expected = len(header)
    cleaned: list[list[str]] = [header]
    for r in out[1:]:
        if len(r) >= max(3, expected - 1):
            # Right-pad short rows so the header → column mapping in
            # _parse_*_row() doesn't index-error.
            while len(r) < expected:
                r.append("")
            cleaned.append(r[:expected])
    return cleaned


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/admin/bank-accounts/{account_id}/import")
async def import_csv(
    account_id: str, ctx: CurrentSpace,
    file: UploadFile = File(...),
    provider_hint: str = Form(""),
) -> dict[str, Any]:
    """Upload a CSV statement. Parses it, returns a preview with detected
    provider + row sample + duplicate count. Nothing is committed here —
    call /commit to write the transactions."""
    _require_admin(ctx)
    if not _looks_uuid(account_id):
        raise HTTPException(400, detail="account_id must be UUID")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, detail="empty file")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, detail="file too large (25 MB max)")

    file_hash = hashlib.sha256(raw).hexdigest()
    file_name = (file.filename or "statement.csv")[:500]

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    # Detect PDF vs CSV. PDFs start with '%PDF-' magic bytes; everything else
    # is treated as CSV/text. The PDF branch converts the document to a
    # CSV-style row list in-memory, then merges back into the same parsing
    # pipeline so dedup / preview / commit semantics stay identical.
    is_pdf = raw[:5] == b"%PDF-" or file_name.lower().endswith(".pdf")
    if is_pdf:
        rows = _pdf_to_rows(raw, provider_hint=provider_hint)
        if not rows:
            raise HTTPException(400, detail=(
                "Could not extract a transactions table from this PDF. "
                "Possible reasons: image-only scan (needs OCR), unusual "
                "layout, or password-protected. Try exporting CSV from "
                "online banking instead."
            ))
    else:
        # Decode + parse the CSV. Try utf-8 then fall back to latin-1 (some
        # bank exports use Windows-1252 which is a superset).
        try:
            text_content = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text_content = raw.decode("latin-1", errors="replace")

        reader = csv.reader(io.StringIO(text_content))
        rows = list(reader)
        if not rows:
            raise HTTPException(400, detail="CSV is empty")

    # Some bank exports prefix metadata lines before the header. Find the
    # header by looking for the first row with >= 3 non-empty cells AND a
    # 'Date'-like column.
    header_idx = 0
    for i, r in enumerate(rows[:20]):
        if len([c for c in r if c.strip()]) >= 3 and any(
            "date" in (c or "").lower() for c in r
        ):
            header_idx = i
            break

    headers = [c.strip() for c in rows[header_idx]]
    detected = provider_hint.upper() if provider_hint else _detect_provider(headers)
    if detected not in PARSERS:
        detected = "GENERIC"
    parser = PARSERS[detected]

    parsed: list[dict[str, Any]] = []
    parse_errors: list[str] = []
    for line_idx, r in enumerate(rows[header_idx + 1:], start=header_idx + 2):
        if not any((c or "").strip() for c in r):
            continue
        # Pad / truncate so dict zip doesn't lose tail columns.
        cells = list(r)
        if len(cells) < len(headers):
            cells.extend([""] * (len(headers) - len(cells)))
        elif len(cells) > len(headers):
            cells = cells[: len(headers)]
        record = dict(zip(headers, cells, strict=False))
        try:
            tx = parser(record)
        except Exception as exc:  # parser bug, log and continue
            parse_errors.append(f"line {line_idx}: {exc}")
            continue
        if tx:
            parsed.append(tx)

    period_start = min((p["txn_date"] for p in parsed), default=None)
    period_end = max((p["txn_date"] for p in parsed), default=None)

    # Duplicate detection against existing committed transactions.
    duplicates_count = 0
    async with SessionLocal() as db:
        # Verify account
        acct = (await db.execute(
            text("SELECT id, currency, is_active FROM bank_accounts WHERE id::text = :id"),
            {"id": account_id},
        )).mappings().one_or_none()
        if not acct:
            raise HTTPException(404, detail="Account not found")
        if not acct["is_active"]:
            raise HTTPException(400, detail="Account is inactive")

        # Same-file dedup
        prior = (await db.execute(
            text("""SELECT id, status, transaction_count
                    FROM bank_statements
                    WHERE account_id::text = :acc AND file_hash = :h
                    ORDER BY created_at DESC LIMIT 1"""),
            {"acc": account_id, "h": file_hash},
        )).mappings().one_or_none()
        if prior and prior["status"] == "COMMITTED":
            raise HTTPException(409, detail={
                "errors": [
                    f"This file has already been imported (statement_id={prior['id']}, "
                    f"{prior['transaction_count']} transactions). "
                    f"Use the statements list to review.",
                ],
            })

        # Per-row dedup against existing transactions
        for p in parsed:
            existing = (await db.execute(text("""
                SELECT 1 FROM bank_transactions
                WHERE  account_id::text = :acc AND txn_date = :d
                  AND  amount = :amt AND reference = :ref
                LIMIT 1
            """), {
                "acc": account_id, "d": p["txn_date"],
                "amt": p["amount"], "ref": p.get("reference") or "",
            })).first()
            p["is_duplicate"] = existing is not None
            if existing:
                duplicates_count += 1

        # Persist the statement preview
        stmt_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO bank_statements
                (id, account_id, file_name, file_hash, file_format,
                 detected_provider, period_start, period_end,
                 transaction_count, duplicates_count, status,
                 uploaded_by_user_id, uploaded_by_name,
                 error_message, created_at)
            VALUES
                (:id, :acc, :name, :hash, 'CSV',
                 :prov, :ps, :pe,
                 :tc, :dc, 'PARSED',
                 :uid, :uname,
                 :errs, :now)
        """), {
            "id": stmt_id, "acc": account_id, "name": file_name,
            "hash": file_hash, "prov": detected,
            "ps": period_start, "pe": period_end,
            "tc": len(parsed), "dc": duplicates_count,
            "uid": str(ctx.user_id) if _looks_uuid(str(ctx.user_id)) else None,
            "uname": (ctx.user_email or "")[:255],
            "errs": " | ".join(parse_errors[:20])[:5000],
            "now": datetime.now(UTC),
        })
        await db.commit()

    return {
        "statement_id": stmt_id,
        "detected_provider": detected,
        "file_name": file_name,
        "file_hash": file_hash,
        "header_row": header_idx + 1,
        "headers": headers,
        "transaction_count": len(parsed),
        "duplicates_count": duplicates_count,
        "parse_errors": parse_errors,
        "period_start": period_start.isoformat() if period_start else None,
        "period_end": period_end.isoformat() if period_end else None,
        "preview": [_serialise_preview(p) for p in parsed[:50]],
        "_full": [_serialise_preview(p) for p in parsed],  # used by commit
    }


def _serialise_preview(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "txn_date": p["txn_date"].isoformat(),
        "description": p["description"],
        "counterparty": p["counterparty"],
        "reference": p["reference"],
        "amount": float(p["amount"]),
        "balance_after": float(p["balance_after"]) if p.get("balance_after") is not None else None,
        "currency": p["currency"],
        "txn_type": p["txn_type"],
        "is_duplicate": p.get("is_duplicate", False),
    }


@router.post("/admin/bank-accounts/{account_id}/import/commit")
async def import_commit(
    account_id: str, ctx: CurrentSpace,
    file: UploadFile = File(...),
    statement_id: str = Form(...),
    skip_duplicates: bool = Form(True),
) -> dict[str, Any]:
    """Re-parse the file and commit the rows into bank_transactions. The
    statement_id refers to the row created by /import; we re-parse the
    same file so the preview-side data doesn't have to be round-tripped
    via a giant client payload. multipart/form-data (file + statement_id +
    skip_duplicates) — JSON body + multipart can't coexist on the same
    endpoint in FastAPI."""
    _require_admin(ctx)
    if not _looks_uuid(account_id):
        raise HTTPException(400, detail="account_id must be UUID")
    if not _looks_uuid(statement_id):
        raise HTTPException(400, detail="statement_id must be UUID")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    raw = await file.read()
    if not raw:
        raise HTTPException(400, detail="empty file on commit")
    file_hash = hashlib.sha256(raw).hexdigest()

    async with SessionLocal() as db:
        stmt = (await db.execute(
            text("""SELECT id, account_id, file_hash, status, detected_provider
                    FROM bank_statements WHERE id::text = :id"""),
            {"id": statement_id},
        )).mappings().one_or_none()
        if not stmt:
            raise HTTPException(404, detail="Statement not found")
        if str(stmt["account_id"]) != account_id:
            raise HTTPException(400, detail="Statement does not belong to this account")
        if stmt["status"] == "COMMITTED":
            raise HTTPException(409, detail="Statement already committed")
        if stmt["file_hash"] != file_hash:
            raise HTTPException(400, detail=(
                "File hash differs from preview. Re-upload the same file you "
                "previewed, then click commit."
            ))

        # Same PDF / CSV branch logic as the preview endpoint — keep them in
        # sync so /commit re-parses the file the same way as /import did.
        is_pdf_commit = raw[:5] == b"%PDF-"
        if is_pdf_commit:
            rows = _pdf_to_rows(raw)
            if not rows:
                raise HTTPException(400, detail="Could not extract a transactions table from this PDF on re-parse.")
        else:
            try:
                text_content = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text_content = raw.decode("latin-1", errors="replace")

            reader = csv.reader(io.StringIO(text_content))
            rows = list(reader)
        header_idx = 0
        for i, r in enumerate(rows[:20]):
            if len([c for c in r if c.strip()]) >= 3 and any(
                "date" in (c or "").lower() for c in r
            ):
                header_idx = i
                break
        headers = [c.strip() for c in rows[header_idx]]
        parser = PARSERS.get(stmt["detected_provider"], PARSERS["GENERIC"])

        inserted = 0
        skipped = 0
        now = datetime.now(UTC)
        for r in rows[header_idx + 1:]:
            if not any((c or "").strip() for c in r):
                continue
            cells = list(r)
            if len(cells) < len(headers):
                cells.extend([""] * (len(headers) - len(cells)))
            elif len(cells) > len(headers):
                cells = cells[: len(headers)]
            record = dict(zip(headers, cells, strict=False))
            try:
                tx = parser(record)
            except Exception:
                continue
            if not tx:
                continue
            if skip_duplicates:
                existing = (await db.execute(text("""
                    SELECT 1 FROM bank_transactions
                    WHERE  account_id::text = :acc AND txn_date = :d
                      AND  amount = :amt AND reference = :ref
                    LIMIT 1
                """), {
                    "acc": account_id, "d": tx["txn_date"],
                    "amt": tx["amount"], "ref": tx.get("reference") or "",
                })).first()
                if existing:
                    skipped += 1
                    continue
            await db.execute(text("""
                INSERT INTO bank_transactions (
                    id, account_id, txn_date, value_date, description, counterparty,
                    reference, amount, balance_after, currency, txn_type, source,
                    statement_id, raw_data, reconciled, notes, created_at, updated_at
                ) VALUES (
                    :id, :acc, :d, :d, :desc, :cp,
                    :ref, :amt, :bal, :cur, :ttype, 'CSV_IMPORT',
                    :sid, CAST('{}' AS jsonb), false, '', :now, :now
                )
            """), {
                "id": str(uuid.uuid4()), "acc": account_id,
                "d": tx["txn_date"], "desc": tx["description"], "cp": tx["counterparty"],
                "ref": tx["reference"], "amt": tx["amount"],
                "bal": tx.get("balance_after"), "cur": tx["currency"],
                "ttype": tx["txn_type"], "sid": stmt["id"], "now": now,
            })
            inserted += 1

        # Recompute account balance
        await db.execute(text("""
            UPDATE bank_accounts
            SET    current_balance = opening_balance + COALESCE(
                       (SELECT SUM(amount) FROM bank_transactions WHERE account_id::text = :acc),
                       0
                   ),
                   updated_at = :now
            WHERE  id::text = :acc
        """), {"acc": account_id, "now": now})

        await db.execute(text("""
            UPDATE bank_statements
            SET    status = 'COMMITTED',
                   committed_at = :now,
                   transaction_count = :n
            WHERE  id::text = :id
        """), {"id": statement_id, "n": inserted, "now": now})

        await db.commit()

    return {
        "statement_id": statement_id,
        "inserted": inserted,
        "skipped_duplicates": skipped,
        "success": True,
    }


@router.get("/admin/bank-accounts/{account_id}/statements")
async def list_statements(account_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if not _looks_uuid(account_id):
        raise HTTPException(400, detail="account_id must be UUID")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        rows = await db.execute(text("""
            SELECT id, file_name, file_format, detected_provider,
                   period_start, period_end, transaction_count,
                   duplicates_count, status, uploaded_by_name,
                   error_message, created_at, committed_at
            FROM   bank_statements
            WHERE  account_id::text = :acc
            ORDER  BY created_at DESC
            LIMIT  100
        """), {"acc": account_id})
        items = [_stmt_row(r._mapping) for r in rows]
    return {"items": items, "total": len(items)}


def _stmt_row(r: Any) -> dict[str, Any]:
    d = dict(r)
    d["id"] = str(d["id"])
    for k in ("period_start", "period_end", "created_at", "committed_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
    return d


@router.delete("/admin/bank-statements/{statement_id}")
async def delete_statement(statement_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Delete a statement and roll back its transactions. ON DELETE SET NULL
    on bank_transactions.statement_id leaves the underlying transactions
    in place by default — we use this hard delete only when the import
    was wrong; subsequent transaction list shows them as 'manual' rows
    that the operator can clean up."""
    _require_admin(ctx)
    if not _looks_uuid(statement_id):
        raise HTTPException(400, detail="statement_id must be UUID")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        stmt = (await db.execute(
            text("SELECT id, account_id FROM bank_statements WHERE id::text = :id"),
            {"id": statement_id},
        )).mappings().one_or_none()
        if not stmt:
            raise HTTPException(404, detail="Statement not found")
        # Delete the statement's imported transactions, then the statement.
        await db.execute(
            text("DELETE FROM bank_transactions WHERE statement_id::text = :sid"),
            {"sid": statement_id},
        )
        await db.execute(
            text("DELETE FROM bank_statements WHERE id::text = :id"),
            {"id": statement_id},
        )
        # Recompute balance
        await db.execute(text("""
            UPDATE bank_accounts
            SET    current_balance = opening_balance + COALESCE(
                       (SELECT SUM(amount) FROM bank_transactions WHERE account_id = :acc),
                       0
                   ),
                   updated_at = :now
            WHERE  id = :acc
        """), {"acc": stmt["account_id"], "now": datetime.now(UTC)})
        await db.commit()
    return {"success": True}
