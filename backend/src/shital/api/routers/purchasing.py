"""Purchasing & Sales — Purchase Orders + Sales Invoices (MVP).

Header + lines pattern for both. Lines carry their own VAT + nominal-code
so a single PO/Invoice can mix funds, activities, and VAT rates (eg. a
mixed catering order with zero-rated food + 20% service charge).

Suppliers + customers live in `contacts` — no separate supplier table.
Front-end picks via the existing contacts typeahead.

Status machine (PO):
    DRAFT  ── send  ──▶ SENT ──── receive ────▶ RECEIVED
       │                  │                       │
       └── delete         └── cancel ──▶ CANCELLED

Status machine (Invoice):
    DRAFT  ── send ──▶ SENT ──── pay ────▶ PAID
       │                  │
       └── delete         └── void ──▶ VOID

Numbering: auto-generated `PO-YYYY-NNNN` / `INV-YYYY-NNNN` per branch,
sequence is "next integer after the highest existing for the year".
Not perfectly gap-free under concurrent inserts; ON CONFLICT (po_number)
retries with the next number if there's a clash.

This is the MVP — part-receive and per-payment matching land in a
follow-up. Today `/receive` and `/pay` mark the whole header in one shot.
"""
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["purchasing"])

VALID_VAT_CODES   = {"STANDARD", "REDUCED", "ZERO", "EXEMPT", "OUT_OF_SCOPE", "REVERSE_CHARGE"}
PO_STATUSES       = {"DRAFT", "SENT", "PART_RECEIVED", "RECEIVED", "CANCELLED"}
INVOICE_STATUSES  = {"DRAFT", "SENT", "PART_PAID", "PAID", "VOID"}
PRIVILEGED        = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "AUDITOR"}


def _require_priv(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Privileged role required")


# ─── Pydantic models ─────────────────────────────────────────────────────────

class LineIn(BaseModel):
    description: str
    nominal_code_id: str | None = None
    nominal_code: str = ""
    quantity: float = 1
    unit_price: float = 0
    vat_rate: float = 0
    vat_code: str = "OUT_OF_SCOPE"


class POIn(BaseModel):
    branch_id: str = "main"
    supplier_contact_id: str | None = None
    supplier_name: str = ""
    order_date: str = ""    # YYYY-MM-DD; defaults to today
    expected_date: str = ""
    currency: str = "GBP"
    notes: str = ""
    reference: str = ""
    delivery_address: str = ""
    lines: list[LineIn] = Field(default_factory=list)


class InvoiceIn(BaseModel):
    branch_id: str = "main"
    customer_contact_id: str | None = None
    customer_name: str = ""
    invoice_date: str = ""
    due_date: str = ""
    currency: str = "GBP"
    notes: str = ""
    reference: str = ""
    billing_address: str = ""
    lines: list[LineIn] = Field(default_factory=list)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _parse_date(s: str, default: date | None = None) -> date | None:
    s = (s or "").strip()
    if not s:
        return default
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, detail=f"Invalid date '{s}' (expected YYYY-MM-DD)") from None


def _validate_lines(lines: list[LineIn]) -> list[str]:
    errs: list[str] = []
    if not lines:
        errs.append("At least one line is required")
    for i, ln in enumerate(lines, start=1):
        if not ln.description.strip():
            errs.append(f"Line {i}: description is required")
        if ln.quantity <= 0:
            errs.append(f"Line {i}: quantity must be > 0")
        if ln.unit_price < 0:
            errs.append(f"Line {i}: unit_price must be >= 0")
        if ln.vat_code not in VALID_VAT_CODES:
            errs.append(f"Line {i}: vat_code must be one of {sorted(VALID_VAT_CODES)}")
        if ln.vat_rate < 0 or ln.vat_rate > 100:
            errs.append(f"Line {i}: vat_rate must be 0-100")
    return errs


def _compute_line_money(ln: LineIn) -> tuple[float, float, float]:
    """Return (net, vat, total) rounded to 2dp."""
    net = round(float(ln.quantity) * float(ln.unit_price), 2)
    vat = round(net * float(ln.vat_rate) / 100.0, 2)
    return net, vat, round(net + vat, 2)


def _row(r: Any) -> dict[str, Any]:
    if r is None:
        return {}
    d = dict(r)
    for k, v in list(d.items()):
        if isinstance(v, UUID):
            d[k] = str(v)
        elif isinstance(v, date) and not isinstance(v, datetime):
            d[k] = v.isoformat()
        elif isinstance(v, datetime):
            d[k] = v.isoformat()
        elif hasattr(v, "normalize"):  # Decimal
            try:
                d[k] = float(v)
            except (TypeError, ValueError):
                d[k] = str(v)
    return d


async def _next_number(db: Any, prefix: str, branch_id: str) -> str:
    """Generate next `PO-YYYY-NNNN` / `INV-YYYY-NNNN`. Not gap-free under
    concurrent inserts — callers MUST retry on UniqueViolation."""
    from sqlalchemy import text

    year = datetime.now(UTC).year
    table = "purchase_orders" if prefix == "PO" else "sales_invoices"
    col   = "po_number"      if prefix == "PO" else "invoice_number"
    like  = f"{prefix}-{year}-%"
    row = (await db.execute(text(f"""
        SELECT {col} AS num
        FROM   {table}
        WHERE  {col} LIKE :like
        ORDER  BY {col} DESC
        LIMIT  1
    """), {"like": like})).mappings().first()
    next_n = 1
    if row and row["num"]:
        try:
            next_n = int(str(row["num"]).rsplit("-", 1)[-1]) + 1
        except (ValueError, IndexError):
            next_n = 1
    return f"{prefix}-{year}-{next_n:04d}"


# ═══════════════════════════════════════════════════════════════════════════════
# Purchase Orders
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/admin/purchase-orders")
async def list_purchase_orders(
    ctx: CurrentSpace,
    branch_id: str = "",
    status: str = "",
    supplier_contact_id: str = "",
    search: str = "",
    page: int = 1,
    per_page: int = 25,
) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {
        "limit":  max(1, min(per_page, 200)),
        "offset": max(0, (page - 1) * per_page),
    }
    if branch_id.strip():
        where.append("branch_id = :bid")
        params["bid"] = branch_id.strip()
    if status.strip():
        where.append("status = :st")
        params["st"] = status.strip().upper()
    if supplier_contact_id.strip():
        where.append("supplier_contact_id = :sid")
        params["sid"] = supplier_contact_id.strip()
    if search.strip():
        where.append("(LOWER(po_number) LIKE :q OR LOWER(supplier_name) LIKE :q "
                     "OR LOWER(reference) LIKE :q OR LOWER(notes) LIKE :q)")
        params["q"] = f"%{search.strip().lower()}%"
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT * FROM purchase_orders {where_sql}
            ORDER BY order_date DESC, created_at DESC
            LIMIT :limit OFFSET :offset
        """), params)).mappings().all()
        total = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM purchase_orders {where_sql}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).scalar() or 0
    return {
        "items":    [_row(r) for r in rows],
        "total":    int(total),
        "page":     page,
        "per_page": per_page,
    }


@router.post("/admin/purchase-orders", status_code=201)
async def create_purchase_order(body: POIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_priv(ctx)
    errs = _validate_lines(body.lines)
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    from shital.core.fabrics.database import SessionLocal

    order_date    = _parse_date(body.order_date, default=datetime.now(UTC).date())
    expected_date = _parse_date(body.expected_date, default=None)
    branch_id     = (body.branch_id or "main").strip() or "main"
    now           = datetime.now(UTC)

    # Roll-up totals
    subtotal = 0.0
    vat_total = 0.0
    computed: list[tuple[LineIn, float, float, float]] = []
    for ln in body.lines:
        net, vat, ttl = _compute_line_money(ln)
        subtotal += net
        vat_total += vat
        computed.append((ln, net, vat, ttl))
    total = round(subtotal + vat_total, 2)

    created_by = getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or ""

    # Retry on number collision (max 5 — should never hit even at burst)
    for attempt in range(5):
        async with SessionLocal() as db:
            po_number = await _next_number(db, "PO", branch_id)
            try:
                po = (await db.execute(text("""
                    INSERT INTO purchase_orders
                        (po_number, branch_id, supplier_contact_id, supplier_name,
                         status, order_date, expected_date, currency,
                         subtotal, vat_total, total,
                         notes, reference, delivery_address, created_by,
                         created_at, updated_at)
                    VALUES
                        (:num, :bid, :sid, :sname,
                         'DRAFT', :odate, :edate, :curr,
                         :sub, :vat, :tot,
                         :notes, :ref, :addr, :cby,
                         :now, :now)
                    RETURNING *
                """), {
                    "num":   po_number, "bid": branch_id,
                    "sid":   body.supplier_contact_id or None,
                    "sname": body.supplier_name.strip(),
                    "odate": order_date, "edate": expected_date,
                    "curr":  (body.currency or "GBP").upper()[:3],
                    "sub":   round(subtotal, 2), "vat": round(vat_total, 2), "tot": total,
                    "notes": body.notes, "ref": body.reference,
                    "addr":  body.delivery_address, "cby": created_by, "now": now,
                })).mappings().first()
                if po is None:
                    raise HTTPException(500, detail="Insert returned no row")
                po_id = po["id"]

                for i, (ln, net, vat, ttl) in enumerate(computed, start=1):
                    await db.execute(text("""
                        INSERT INTO purchase_order_lines
                            (po_id, line_no, description, nominal_code_id, nominal_code,
                             quantity, unit_price, vat_rate, vat_code,
                             line_net, line_vat, line_total, received_qty)
                        VALUES
                            (:pid, :ln, :desc, :ncid, :nc,
                             :qty, :up, :vr, :vc,
                             :net, :vat, :tot, 0)
                    """), {
                        "pid": po_id, "ln": i,
                        "desc": ln.description.strip(),
                        "ncid": ln.nominal_code_id or None,
                        "nc":   ln.nominal_code.strip().upper(),
                        "qty":  float(ln.quantity), "up": float(ln.unit_price),
                        "vr":   float(ln.vat_rate), "vc": ln.vat_code,
                        "net":  net, "vat": vat, "tot": ttl,
                    })
                await db.commit()
                return await _get_po_with_lines(str(po_id))
            except IntegrityError as exc:
                await db.rollback()
                if "po_number" in str(exc).lower() and attempt < 4:
                    continue  # retry with next number
                raise HTTPException(409, detail=f"PO creation failed: {exc.orig}") from exc

    raise HTTPException(500, detail="Failed to generate unique PO number after 5 attempts")


async def _get_po_with_lines(po_id: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        po = (await db.execute(
            text("SELECT * FROM purchase_orders WHERE id = :id"), {"id": po_id},
        )).mappings().first()
        if not po:
            raise HTTPException(404, detail="Purchase order not found")
        lines = (await db.execute(text("""
            SELECT * FROM purchase_order_lines WHERE po_id = :id ORDER BY line_no
        """), {"id": po_id})).mappings().all()
    out = _row(po)
    out["lines"] = [_row(line) for line in lines]
    return out


@router.get("/admin/purchase-orders/{po_id}")
async def get_purchase_order(po_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    return await _get_po_with_lines(po_id)


@router.post("/admin/purchase-orders/{po_id}/send")
async def send_purchase_order(po_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    return await _transition_po(po_id, ctx, from_status="DRAFT", to_status="SENT",
                                stamp_col="sent_at")


@router.post("/admin/purchase-orders/{po_id}/receive")
async def receive_purchase_order(po_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Mark all lines as fully received and flip header to RECEIVED.
    Part-receive (per-line received_qty updates) ships in a follow-up."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        po = (await db.execute(
            text("SELECT id, status FROM purchase_orders WHERE id = :id"), {"id": po_id},
        )).mappings().first()
        if not po:
            raise HTTPException(404, detail="Purchase order not found")
        if po["status"] not in ("SENT", "DRAFT", "PART_RECEIVED"):
            raise HTTPException(409, detail=f"Cannot receive from status {po['status']}")
        await db.execute(text("""
            UPDATE purchase_order_lines SET received_qty = quantity WHERE po_id = :id
        """), {"id": po_id})
        await db.execute(text("""
            UPDATE purchase_orders
            SET status = 'RECEIVED', received_at = :now, updated_at = :now
            WHERE id = :id
        """), {"id": po_id, "now": datetime.now(UTC)})
        await db.commit()
    return await _get_po_with_lines(po_id)


@router.post("/admin/purchase-orders/{po_id}/cancel")
async def cancel_purchase_order(po_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    return await _transition_po(po_id, ctx, from_status=None, to_status="CANCELLED",
                                stamp_col="cancelled_at",
                                forbid_from=("RECEIVED", "CANCELLED"))


@router.delete("/admin/purchase-orders/{po_id}", status_code=204)
async def delete_purchase_order(po_id: str, ctx: CurrentSpace) -> None:
    """Hard-delete only when still DRAFT — anything past DRAFT must be
    cancelled instead so the audit trail is preserved."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM purchase_orders WHERE id = :id"), {"id": po_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Purchase order not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be deleted (status={row['status']})")
        await db.execute(text("DELETE FROM purchase_orders WHERE id = :id"), {"id": po_id})
        await db.commit()


async def _transition_po(
    po_id: str, ctx: CurrentSpace, *,
    from_status: str | None, to_status: str, stamp_col: str,
    forbid_from: tuple[str, ...] = (),
) -> dict[str, Any]:
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM purchase_orders WHERE id = :id"), {"id": po_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Purchase order not found")
        if from_status and row["status"] != from_status:
            raise HTTPException(409, detail=f"Expected status {from_status}, got {row['status']}")
        if row["status"] in forbid_from:
            raise HTTPException(409, detail=f"Cannot transition from {row['status']}")
        await db.execute(text(f"""
            UPDATE purchase_orders
            SET status = :st, {stamp_col} = :now, updated_at = :now
            WHERE id = :id
        """), {"st": to_status, "now": datetime.now(UTC), "id": po_id})
        await db.commit()
    return await _get_po_with_lines(po_id)


# ═══════════════════════════════════════════════════════════════════════════════
# Sales Invoices
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/admin/sales-invoices")
async def list_sales_invoices(
    ctx: CurrentSpace,
    branch_id: str = "",
    status: str = "",
    customer_contact_id: str = "",
    search: str = "",
    page: int = 1,
    per_page: int = 25,
) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = []
    params: dict[str, Any] = {
        "limit":  max(1, min(per_page, 200)),
        "offset": max(0, (page - 1) * per_page),
    }
    if branch_id.strip():
        where.append("branch_id = :bid")
        params["bid"] = branch_id.strip()
    if status.strip():
        where.append("status = :st")
        params["st"] = status.strip().upper()
    if customer_contact_id.strip():
        where.append("customer_contact_id = :cid")
        params["cid"] = customer_contact_id.strip()
    if search.strip():
        where.append("(LOWER(invoice_number) LIKE :q OR LOWER(customer_name) LIKE :q "
                     "OR LOWER(reference) LIKE :q OR LOWER(notes) LIKE :q)")
        params["q"] = f"%{search.strip().lower()}%"
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT * FROM sales_invoices {where_sql}
            ORDER BY invoice_date DESC, created_at DESC
            LIMIT :limit OFFSET :offset
        """), params)).mappings().all()
        total = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM sales_invoices {where_sql}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).scalar() or 0
    return {
        "items":    [_row(r) for r in rows],
        "total":    int(total),
        "page":     page,
        "per_page": per_page,
    }


@router.post("/admin/sales-invoices", status_code=201)
async def create_sales_invoice(body: InvoiceIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_priv(ctx)
    errs = _validate_lines(body.lines)
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    from shital.core.fabrics.database import SessionLocal

    invoice_date = _parse_date(body.invoice_date, default=datetime.now(UTC).date())
    due_date     = _parse_date(body.due_date, default=None)
    branch_id    = (body.branch_id or "main").strip() or "main"
    now          = datetime.now(UTC)

    subtotal = 0.0
    vat_total = 0.0
    computed: list[tuple[LineIn, float, float, float]] = []
    for ln in body.lines:
        net, vat, ttl = _compute_line_money(ln)
        subtotal += net
        vat_total += vat
        computed.append((ln, net, vat, ttl))
    total = round(subtotal + vat_total, 2)

    created_by = getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or ""

    for attempt in range(5):
        async with SessionLocal() as db:
            invoice_number = await _next_number(db, "INV", branch_id)
            try:
                inv = (await db.execute(text("""
                    INSERT INTO sales_invoices
                        (invoice_number, branch_id, customer_contact_id, customer_name,
                         status, invoice_date, due_date, currency,
                         subtotal, vat_total, total, paid_total,
                         notes, reference, billing_address, created_by,
                         created_at, updated_at)
                    VALUES
                        (:num, :bid, :cid, :cname,
                         'DRAFT', :idate, :ddate, :curr,
                         :sub, :vat, :tot, 0,
                         :notes, :ref, :addr, :cby,
                         :now, :now)
                    RETURNING *
                """), {
                    "num":   invoice_number, "bid": branch_id,
                    "cid":   body.customer_contact_id or None,
                    "cname": body.customer_name.strip(),
                    "idate": invoice_date, "ddate": due_date,
                    "curr":  (body.currency or "GBP").upper()[:3],
                    "sub":   round(subtotal, 2), "vat": round(vat_total, 2), "tot": total,
                    "notes": body.notes, "ref": body.reference,
                    "addr":  body.billing_address, "cby": created_by, "now": now,
                })).mappings().first()
                if inv is None:
                    raise HTTPException(500, detail="Insert returned no row")
                inv_id = inv["id"]

                for i, (ln, net, vat, ttl) in enumerate(computed, start=1):
                    await db.execute(text("""
                        INSERT INTO sales_invoice_lines
                            (invoice_id, line_no, description, nominal_code_id, nominal_code,
                             quantity, unit_price, vat_rate, vat_code,
                             line_net, line_vat, line_total)
                        VALUES
                            (:iid, :ln, :desc, :ncid, :nc,
                             :qty, :up, :vr, :vc,
                             :net, :vat, :tot)
                    """), {
                        "iid": inv_id, "ln": i,
                        "desc": ln.description.strip(),
                        "ncid": ln.nominal_code_id or None,
                        "nc":   ln.nominal_code.strip().upper(),
                        "qty":  float(ln.quantity), "up": float(ln.unit_price),
                        "vr":   float(ln.vat_rate), "vc": ln.vat_code,
                        "net":  net, "vat": vat, "tot": ttl,
                    })
                await db.commit()
                return await _get_invoice_with_lines(str(inv_id))
            except IntegrityError as exc:
                await db.rollback()
                if "invoice_number" in str(exc).lower() and attempt < 4:
                    continue
                raise HTTPException(409, detail=f"Invoice creation failed: {exc.orig}") from exc

    raise HTTPException(500, detail="Failed to generate unique invoice number after 5 attempts")


async def _get_invoice_with_lines(inv_id: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        inv = (await db.execute(
            text("SELECT * FROM sales_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not inv:
            raise HTTPException(404, detail="Invoice not found")
        lines = (await db.execute(text("""
            SELECT * FROM sales_invoice_lines WHERE invoice_id = :id ORDER BY line_no
        """), {"id": inv_id})).mappings().all()
    out = _row(inv)
    out["lines"] = [_row(line) for line in lines]
    return out


@router.get("/admin/sales-invoices/{inv_id}")
async def get_sales_invoice(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    return await _get_invoice_with_lines(inv_id)


@router.post("/admin/sales-invoices/{inv_id}/send")
async def send_sales_invoice(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    return await _transition_invoice(inv_id, ctx, from_status="DRAFT", to_status="SENT",
                                     stamp_col="sent_at")


@router.post("/admin/sales-invoices/{inv_id}/pay")
async def pay_sales_invoice(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Mark whole invoice as paid in one shot. Per-payment matching against
    bank statements ships in a follow-up."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT id, status, total FROM sales_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Invoice not found")
        if row["status"] not in ("SENT", "DRAFT", "PART_PAID"):
            raise HTTPException(409, detail=f"Cannot mark paid from status {row['status']}")
        await db.execute(text("""
            UPDATE sales_invoices
            SET status = 'PAID', paid_total = total, paid_at = :now, updated_at = :now
            WHERE id = :id
        """), {"id": inv_id, "now": datetime.now(UTC)})
        await db.commit()
    return await _get_invoice_with_lines(inv_id)


@router.post("/admin/sales-invoices/{inv_id}/void")
async def void_sales_invoice(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    return await _transition_invoice(inv_id, ctx, from_status=None, to_status="VOID",
                                     stamp_col="voided_at",
                                     forbid_from=("PAID", "VOID"))


@router.delete("/admin/sales-invoices/{inv_id}", status_code=204)
async def delete_sales_invoice(inv_id: str, ctx: CurrentSpace) -> None:
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM sales_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Invoice not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be deleted (status={row['status']})")
        await db.execute(text("DELETE FROM sales_invoices WHERE id = :id"), {"id": inv_id})
        await db.commit()


async def _transition_invoice(
    inv_id: str, ctx: CurrentSpace, *,
    from_status: str | None, to_status: str, stamp_col: str,
    forbid_from: tuple[str, ...] = (),
) -> dict[str, Any]:
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM sales_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Invoice not found")
        if from_status and row["status"] != from_status:
            raise HTTPException(409, detail=f"Expected status {from_status}, got {row['status']}")
        if row["status"] in forbid_from:
            raise HTTPException(409, detail=f"Cannot transition from {row['status']}")
        await db.execute(text(f"""
            UPDATE sales_invoices
            SET status = :st, {stamp_col} = :now, updated_at = :now
            WHERE id = :id
        """), {"st": to_status, "now": datetime.now(UTC), "id": inv_id})
        await db.commit()
    return await _get_invoice_with_lines(inv_id)
