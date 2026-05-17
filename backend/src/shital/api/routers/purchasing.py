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
    if prefix == "PO":
        table, col = "purchase_orders", "po_number"
    elif prefix == "BILL":
        table, col = "purchase_invoices", "invoice_number"
    else:
        table, col = "sales_invoices", "invoice_number"
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


@router.put("/admin/purchase-orders/{po_id}")
async def update_purchase_order(po_id: str, body: POIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Edit a DRAFT PO — header + complete line replacement. Past DRAFT
    the data is locked (cancel + create a fresh PO instead)."""
    _require_priv(ctx)
    errs = _validate_lines(body.lines)
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    order_date    = _parse_date(body.order_date, default=datetime.now(UTC).date())
    expected_date = _parse_date(body.expected_date, default=None)

    subtotal = 0.0
    vat_total = 0.0
    computed: list[tuple[LineIn, float, float, float]] = []
    for ln in body.lines:
        net, vat, ttl = _compute_line_money(ln)
        subtotal += net
        vat_total += vat
        computed.append((ln, net, vat, ttl))
    total = round(subtotal + vat_total, 2)

    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM purchase_orders WHERE id = :id"), {"id": po_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Purchase order not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be edited (status={row['status']})")

        await db.execute(text("""
            UPDATE purchase_orders SET
                branch_id           = :bid,
                supplier_contact_id = :sid,
                supplier_name       = :sname,
                order_date          = :odate,
                expected_date       = :edate,
                currency            = :curr,
                subtotal            = :sub,
                vat_total           = :vat,
                total               = :tot,
                notes               = :notes,
                reference           = :ref,
                delivery_address    = :addr,
                updated_at          = NOW()
            WHERE id = :id
        """), {
            "id":   po_id, "bid": (body.branch_id or "main").strip(),
            "sid":  body.supplier_contact_id or None,
            "sname": body.supplier_name.strip(),
            "odate": order_date, "edate": expected_date,
            "curr": (body.currency or "GBP").upper()[:3],
            "sub":  round(subtotal, 2), "vat": round(vat_total, 2), "tot": total,
            "notes": body.notes, "ref": body.reference, "addr": body.delivery_address,
        })
        await db.execute(text("DELETE FROM purchase_order_lines WHERE po_id = :id"), {"id": po_id})
        for i, (ln, net, vat, ttl) in enumerate(computed, start=1):
            await db.execute(text("""
                INSERT INTO purchase_order_lines
                    (po_id, line_no, description, nominal_code_id, nominal_code,
                     quantity, unit_price, vat_rate, vat_code,
                     line_net, line_vat, line_total, received_qty)
                VALUES (:pid, :ln, :desc, :ncid, :nc,
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
    return await _get_po_with_lines(po_id)


@router.post("/admin/purchase-orders/{po_id}/send")
async def send_purchase_order(po_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    return await _transition_po(po_id, ctx, from_status="DRAFT", to_status="SENT",
                                stamp_col="sent_at")


@router.post("/admin/purchase-orders/{po_id}/receive")
async def receive_purchase_order(po_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Mark all lines fully received, flip header to RECEIVED, and post the
    GL entry (DR Expense + Input VAT, CR AP)."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import gl
    async with SessionLocal() as db:
        po = (await db.execute(
            text("SELECT * FROM purchase_orders WHERE id = :id"), {"id": po_id},
        )).mappings().first()
        if not po:
            raise HTTPException(404, detail="Purchase order not found")
        if po["status"] not in ("SENT", "DRAFT", "PART_RECEIVED"):
            raise HTTPException(409, detail=f"Cannot receive from status {po['status']}")

        lines = (await db.execute(text("""
            SELECT nominal_code, nominal_code_id, line_net, line_vat, line_total, quantity
            FROM   purchase_order_lines WHERE po_id = :id ORDER BY line_no
        """), {"id": po_id})).mappings().all()

        await db.execute(text("""
            UPDATE purchase_order_lines SET received_qty = quantity WHERE po_id = :id
        """), {"id": po_id})
        now = datetime.now(UTC)
        await db.execute(text("""
            UPDATE purchase_orders
            SET status = 'RECEIVED', received_at = :now, updated_at = :now
            WHERE id = :id
        """), {"id": po_id, "now": now})

        try:
            posting: list[dict[str, Any]] = []
            for line in lines:
                net = float(line["line_net"] or 0)
                vat = float(line["line_vat"] or 0)
                if net:
                    posting.append({
                        "nominal_code": line["nominal_code"] or gl.DEFAULT_EXPENSE,
                        "nominal_code_id": str(line["nominal_code_id"]) if line["nominal_code_id"] else None,
                        "debit": net, "credit": 0,
                        "description": f"PO {po['po_number']} — {po['supplier_name'] or 'supplier'}",
                    })
                if vat > 0:
                    posting.append({
                        "nominal_code": gl.DEFAULT_VAT_INPUT,
                        "debit": vat, "credit": 0,
                        "description": f"Input VAT — PO {po['po_number']}",
                    })
            posting.append({
                "nominal_code": gl.DEFAULT_CREDITOR,
                "debit": 0, "credit": float(po["total"] or 0),
                "description": f"AP — {po['supplier_name'] or 'supplier'}",
            })
            await gl.post(
                db,
                branch_id=po["branch_id"], entry_date=now.date(),
                description=f"PO receipt — {po['po_number']} ({po['supplier_name'] or 'supplier'})",
                reference=po["po_number"],
                source_type=gl.SOURCE_PO_RECEIVE, source_id=po_id,
                posted_by=getattr(ctx, "user_email", "") or "",
                idempotency_key=f"gl-po-receive-{po_id}",
                lines=posting,
            )
        except Exception:
            import structlog
            structlog.get_logger().exception("po_receive_gl_post_failed", po_id=po_id)

        await db.commit()
    return await _get_po_with_lines(po_id)


class ReceiveLineIn(BaseModel):
    line_id: str
    received_qty: float


class PartReceiveIn(BaseModel):
    lines: list[ReceiveLineIn]


@router.post("/admin/purchase-orders/{po_id}/part-receive")
async def part_receive_po(po_id: str, body: PartReceiveIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Per-line partial receipt. Updates received_qty for the specified
    lines (clamped between 0 and the line quantity), then transitions the
    header: every line fully received -> RECEIVED + GL post; anything
    partial -> PART_RECEIVED (no GL until fully received, to keep one
    posting per PO; for per-receipt GL granularity post the matching
    delta manually for now)."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        po = (await db.execute(
            text("SELECT * FROM purchase_orders WHERE id = :id"), {"id": po_id},
        )).mappings().first()
        if not po:
            raise HTTPException(404, detail="Purchase order not found")
        if po["status"] not in ("SENT", "DRAFT", "PART_RECEIVED"):
            raise HTTPException(409, detail=f"Cannot part-receive from status {po['status']}")

        for ln in body.lines:
            await db.execute(text("""
                UPDATE purchase_order_lines
                SET    received_qty = LEAST(GREATEST(:rq, 0), quantity)
                WHERE  id = :id AND po_id = :po
            """), {"rq": float(ln.received_qty), "id": ln.line_id, "po": po_id})

        agg = (await db.execute(text("""
            SELECT SUM(quantity)     AS total_q,
                   SUM(received_qty) AS recv_q,
                   COUNT(*) FILTER (WHERE received_qty = 0) AS zero_lines,
                   COUNT(*) FILTER (WHERE received_qty >= quantity) AS full_lines,
                   COUNT(*) AS line_count
            FROM purchase_order_lines WHERE po_id = :id
        """), {"id": po_id})).mappings().first()

        now = datetime.now(UTC)
        all_received = agg and agg["full_lines"] == agg["line_count"]
        any_received = agg and (agg["recv_q"] or 0) > 0
        if all_received:
            new_status = "RECEIVED"
            await db.execute(text("""
                UPDATE purchase_orders SET status='RECEIVED', received_at=:now, updated_at=:now WHERE id=:id
            """), {"id": po_id, "now": now})
            # Auto-post GL on full receipt (same as /receive)
            from shital.services import gl
            try:
                lines = (await db.execute(text("""
                    SELECT nominal_code, nominal_code_id, line_net, line_vat
                    FROM   purchase_order_lines WHERE po_id = :id ORDER BY line_no
                """), {"id": po_id})).mappings().all()
                posting: list[dict[str, Any]] = []
                for line in lines:
                    net = float(line["line_net"] or 0)
                    vat = float(line["line_vat"] or 0)
                    if net:
                        posting.append({
                            "nominal_code": line["nominal_code"] or gl.DEFAULT_EXPENSE,
                            "nominal_code_id": str(line["nominal_code_id"]) if line["nominal_code_id"] else None,
                            "debit": net, "credit": 0,
                            "description": f"PO {po['po_number']}",
                        })
                    if vat > 0:
                        posting.append({
                            "nominal_code": gl.DEFAULT_VAT_INPUT,
                            "debit": vat, "credit": 0,
                            "description": f"Input VAT — PO {po['po_number']}",
                        })
                posting.append({
                    "nominal_code": gl.DEFAULT_CREDITOR,
                    "debit": 0, "credit": float(po["total"] or 0),
                    "description": f"AP — {po['supplier_name'] or 'supplier'}",
                })
                await gl.post(
                    db, branch_id=po["branch_id"], entry_date=now.date(),
                    description=f"PO receipt — {po['po_number']}",
                    reference=po["po_number"],
                    source_type=gl.SOURCE_PO_RECEIVE, source_id=po_id,
                    posted_by=getattr(ctx, "user_email", "") or "",
                    idempotency_key=f"gl-po-receive-{po_id}",
                    lines=posting,
                )
            except Exception:
                import structlog
                structlog.get_logger().exception("po_part_receive_gl_post_failed", po_id=po_id)
        elif any_received:
            new_status = "PART_RECEIVED"
            await db.execute(text("""
                UPDATE purchase_orders SET status='PART_RECEIVED', updated_at=:now WHERE id=:id
            """), {"id": po_id, "now": now})
        else:
            new_status = po["status"]
        await db.commit()
    return {**await _get_po_with_lines(po_id), "new_status": new_status}


@router.post("/admin/purchase-orders/{po_id}/cancel")
async def cancel_purchase_order(po_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Cancel a PO. If the receipt was already posted to the GL, also
    reverse that journal entry so the ledger stays clean."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import gl

    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT id, status FROM purchase_orders WHERE id = :id"), {"id": po_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Purchase order not found")
        if row["status"] in ("RECEIVED", "CANCELLED"):
            raise HTTPException(409, detail=f"Cannot cancel from {row['status']}")

        gl_row = (await db.execute(text("""
            SELECT id FROM transactions
            WHERE  source_type = :st AND source_id = :sid AND reversal_of IS NULL
            ORDER  BY posted_at DESC LIMIT 1
        """), {"st": gl.SOURCE_PO_RECEIVE, "sid": po_id})).mappings().first()
        if gl_row:
            try:
                await gl.reverse(db, original_txn_id=str(gl_row["id"]),
                                 posted_by=getattr(ctx, "user_email", "") or "",
                                 description="PO cancelled — reversing receipt")
            except Exception:
                import structlog
                structlog.get_logger().exception("po_cancel_reverse_failed", po_id=po_id)

        await db.execute(text("""
            UPDATE purchase_orders SET status='CANCELLED', cancelled_at=:now, updated_at=:now WHERE id=:id
        """), {"id": po_id, "now": datetime.now(UTC)})
        await db.commit()
    return await _get_po_with_lines(po_id)


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


@router.put("/admin/sales-invoices/{inv_id}")
async def update_sales_invoice(inv_id: str, body: InvoiceIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Edit a DRAFT invoice — header + complete line replacement.
    Past DRAFT the data is locked (void + create a fresh invoice instead)."""
    _require_priv(ctx)
    errs = _validate_lines(body.lines)
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    invoice_date = _parse_date(body.invoice_date, default=datetime.now(UTC).date())
    due_date     = _parse_date(body.due_date, default=None)

    subtotal = 0.0
    vat_total = 0.0
    computed: list[tuple[LineIn, float, float, float]] = []
    for ln in body.lines:
        net, vat, ttl = _compute_line_money(ln)
        subtotal += net
        vat_total += vat
        computed.append((ln, net, vat, ttl))
    total = round(subtotal + vat_total, 2)

    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM sales_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Invoice not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be edited (status={row['status']})")

        await db.execute(text("""
            UPDATE sales_invoices SET
                branch_id           = :bid,
                customer_contact_id = :cid,
                customer_name       = :cname,
                invoice_date        = :idate,
                due_date            = :ddate,
                currency            = :curr,
                subtotal            = :sub,
                vat_total           = :vat,
                total               = :tot,
                notes               = :notes,
                reference           = :ref,
                billing_address     = :addr,
                updated_at          = NOW()
            WHERE id = :id
        """), {
            "id":   inv_id, "bid": (body.branch_id or "main").strip(),
            "cid":  body.customer_contact_id or None,
            "cname": body.customer_name.strip(),
            "idate": invoice_date, "ddate": due_date,
            "curr": (body.currency or "GBP").upper()[:3],
            "sub":  round(subtotal, 2), "vat": round(vat_total, 2), "tot": total,
            "notes": body.notes, "ref": body.reference, "addr": body.billing_address,
        })
        await db.execute(text("DELETE FROM sales_invoice_lines WHERE invoice_id = :id"), {"id": inv_id})
        for i, (ln, net, vat, ttl) in enumerate(computed, start=1):
            await db.execute(text("""
                INSERT INTO sales_invoice_lines
                    (invoice_id, line_no, description, nominal_code_id, nominal_code,
                     quantity, unit_price, vat_rate, vat_code,
                     line_net, line_vat, line_total)
                VALUES (:iid, :ln, :desc, :ncid, :nc,
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
    return await _get_invoice_with_lines(inv_id)


@router.post("/admin/sales-invoices/{inv_id}/send")
async def send_sales_invoice(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Mark invoice SENT and post the receivable to the GL
    (DR AR, CR Income + Output VAT)."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import gl
    async with SessionLocal() as db:
        inv = (await db.execute(
            text("SELECT * FROM sales_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not inv:
            raise HTTPException(404, detail="Invoice not found")
        if inv["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Expected status DRAFT, got {inv['status']}")

        lines = (await db.execute(text("""
            SELECT nominal_code, nominal_code_id, line_net, line_vat
            FROM   sales_invoice_lines WHERE invoice_id = :id ORDER BY line_no
        """), {"id": inv_id})).mappings().all()

        now = datetime.now(UTC)
        await db.execute(text("""
            UPDATE sales_invoices SET status='SENT', sent_at=:now, updated_at=:now WHERE id=:id
        """), {"id": inv_id, "now": now})

        try:
            posting: list[dict[str, Any]] = [{
                "nominal_code": gl.DEFAULT_DEBTOR,
                "debit": float(inv["total"] or 0), "credit": 0,
                "description": f"AR — {inv['customer_name'] or 'customer'}",
            }]
            for line in lines:
                net = float(line["line_net"] or 0)
                vat = float(line["line_vat"] or 0)
                if net:
                    posting.append({
                        "nominal_code": line["nominal_code"] or gl.DEFAULT_INVOICE_INCOME,
                        "nominal_code_id": str(line["nominal_code_id"]) if line["nominal_code_id"] else None,
                        "debit": 0, "credit": net,
                        "description": f"Invoice {inv['invoice_number']}",
                    })
                if vat > 0:
                    posting.append({
                        "nominal_code": gl.DEFAULT_VAT_OUTPUT,
                        "debit": 0, "credit": vat,
                        "description": f"Output VAT — Invoice {inv['invoice_number']}",
                    })
            await gl.post(
                db, branch_id=inv["branch_id"], entry_date=now.date(),
                description=f"Invoice raised — {inv['invoice_number']} ({inv['customer_name'] or 'customer'})",
                reference=inv["invoice_number"],
                source_type=gl.SOURCE_INVOICE_SEND, source_id=inv_id,
                posted_by=getattr(ctx, "user_email", "") or "",
                idempotency_key=f"gl-inv-send-{inv_id}",
                lines=posting,
            )
        except Exception:
            import structlog
            structlog.get_logger().exception("invoice_send_gl_post_failed", inv_id=inv_id)

        await db.commit()
    return await _get_invoice_with_lines(inv_id)


@router.post("/admin/sales-invoices/{inv_id}/pay")
async def pay_sales_invoice(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Mark whole invoice as PAID and post DR Bank CR AR for the
    outstanding amount (total - paid_total)."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import gl
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT * FROM sales_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Invoice not found")
        if row["status"] not in ("SENT", "DRAFT", "PART_PAID"):
            raise HTTPException(409, detail=f"Cannot mark paid from status {row['status']}")

        outstanding = float(row["total"] or 0) - float(row["paid_total"] or 0)
        now = datetime.now(UTC)
        await db.execute(text("""
            UPDATE sales_invoices
            SET status='PAID', paid_total=total, paid_at=:now, updated_at=:now
            WHERE id=:id
        """), {"id": inv_id, "now": now})

        if outstanding > 0:
            try:
                await gl.post(
                    db, branch_id=row["branch_id"], entry_date=now.date(),
                    description=f"Invoice payment — {row['invoice_number']}",
                    reference=row["invoice_number"],
                    source_type=gl.SOURCE_INVOICE_PAY, source_id=inv_id,
                    posted_by=getattr(ctx, "user_email", "") or "",
                    idempotency_key=f"gl-inv-pay-{inv_id}-{outstanding:.2f}",
                    lines=gl.lines_for_invoice_pay(outstanding, row["customer_name"] or "customer"),
                )
            except Exception:
                import structlog
                structlog.get_logger().exception("invoice_pay_gl_post_failed", inv_id=inv_id)

        await db.commit()
    return await _get_invoice_with_lines(inv_id)


class InvoicePaymentIn(BaseModel):
    amount: float
    payment_date: str = ""
    bank_nominal_code: str = ""
    payment_ref: str = ""


@router.post("/admin/sales-invoices/{inv_id}/payments")
async def record_invoice_payment(inv_id: str, body: InvoicePaymentIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Record a partial (or full) payment against an invoice. Posts a
    DR Bank / CR AR for the amount and bumps paid_total. Flips status
    PART_PAID -> PAID when paid_total >= total."""
    _require_priv(ctx)
    if body.amount <= 0:
        raise HTTPException(400, detail="amount must be > 0")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import gl
    async with SessionLocal() as db:
        inv = (await db.execute(
            text("SELECT * FROM sales_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not inv:
            raise HTTPException(404, detail="Invoice not found")
        if inv["status"] in ("VOID",):
            raise HTTPException(409, detail="Cannot record payment on a VOID invoice")

        paid_so_far = float(inv["paid_total"] or 0) + float(body.amount)
        total = float(inv["total"] or 0)
        if paid_so_far > total + 0.005:
            raise HTTPException(400, detail=f"Payment {body.amount} would over-pay (paid {paid_so_far:.2f} vs total {total:.2f})")

        now = datetime.now(UTC)
        new_status = "PAID" if abs(paid_so_far - total) < 0.01 else "PART_PAID"
        stamp_pay_at = ", paid_at = :now" if new_status == "PAID" else ""
        await db.execute(text(f"""
            UPDATE sales_invoices
            SET    paid_total = :pt, status = :st, updated_at = :now{stamp_pay_at}
            WHERE  id = :id
        """), {"pt": round(paid_so_far, 2), "st": new_status, "now": now, "id": inv_id})

        try:
            bank = (body.bank_nominal_code or "").strip().upper() or gl.DEFAULT_BANK
            entry_date = body.payment_date.strip() or now.date().isoformat()
            await gl.post(
                db, branch_id=inv["branch_id"], entry_date=entry_date,
                description=f"Payment — Invoice {inv['invoice_number']} ({body.amount:.2f})",
                reference=body.payment_ref or inv["invoice_number"],
                source_type=gl.SOURCE_INVOICE_PAY, source_id=inv_id,
                posted_by=getattr(ctx, "user_email", "") or "",
                idempotency_key=f"gl-inv-pay-{inv_id}-{entry_date}-{body.amount:.2f}",
                lines=[
                    {"nominal_code": bank, "debit": body.amount, "credit": 0,
                     "description": f"Receipt — {inv['customer_name'] or 'customer'}"},
                    {"nominal_code": gl.DEFAULT_DEBTOR, "debit": 0, "credit": body.amount,
                     "description": f"AR clear — {inv['customer_name'] or 'customer'}"},
                ],
            )
        except Exception:
            import structlog
            structlog.get_logger().exception("invoice_payment_gl_post_failed", inv_id=inv_id)

        await db.commit()
    return await _get_invoice_with_lines(inv_id)


@router.post("/admin/sales-invoices/{inv_id}/void")
async def void_sales_invoice(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Void an invoice. Reverses the send + any payment GL entries
    posted against it to keep the ledger clean."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import gl

    async with SessionLocal() as db:
        inv = (await db.execute(
            text("SELECT id, status FROM sales_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not inv:
            raise HTTPException(404, detail="Invoice not found")
        if inv["status"] in ("PAID", "VOID"):
            raise HTTPException(409, detail=f"Cannot void from {inv['status']}")

        gl_entries = (await db.execute(text("""
            SELECT id FROM transactions
            WHERE  source_id = :sid
              AND  source_type IN (:s1, :s2)
              AND  reversal_of IS NULL
              AND  NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversal_of = transactions.id)
            ORDER  BY posted_at
        """), {"sid": inv_id, "s1": gl.SOURCE_INVOICE_SEND, "s2": gl.SOURCE_INVOICE_PAY})).mappings().all()
        for gl_row in gl_entries:
            try:
                await gl.reverse(db, original_txn_id=str(gl_row["id"]),
                                 posted_by=getattr(ctx, "user_email", "") or "",
                                 description="Invoice voided — reversing posting")
            except Exception:
                import structlog
                structlog.get_logger().exception("invoice_void_reverse_failed", inv_id=inv_id, gl_id=str(gl_row["id"]))

        await db.execute(text("""
            UPDATE sales_invoices SET status='VOID', voided_at=:now, updated_at=:now WHERE id=:id
        """), {"id": inv_id, "now": datetime.now(UTC)})
        await db.commit()
    return await _get_invoice_with_lines(inv_id)


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


# ═══════════════════════════════════════════════════════════════════════════════
# Purchase Invoices (Supplier Bills)
# ═══════════════════════════════════════════════════════════════════════════════

PURCHASE_INVOICE_STATUSES = {"DRAFT", "RECEIVED", "PART_PAID", "PAID", "VOID"}


class PurchaseInvoiceIn(BaseModel):
    branch_id: str = "main"
    supplier_contact_id: str | None = None
    supplier_name: str = ""
    supplier_invoice_number: str = ""
    po_id: str | None = None
    invoice_date: str = ""
    due_date: str = ""
    currency: str = "GBP"
    notes: str = ""
    reference: str = ""
    lines: list[LineIn] = Field(default_factory=list)


class SupplierPaymentIn(BaseModel):
    amount: float
    payment_date: str = ""
    bank_nominal_code: str = ""
    payment_ref: str = ""


async def _get_pinv_with_lines(inv_id: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        inv = (await db.execute(
            text("SELECT * FROM purchase_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not inv:
            raise HTTPException(404, detail="Purchase invoice not found")
        lines = (await db.execute(text("""
            SELECT * FROM purchase_invoice_lines WHERE invoice_id = :id ORDER BY line_no
        """), {"id": inv_id})).mappings().all()
    out = _row(inv)
    out["lines"] = [_row(line) for line in lines]
    return out


@router.get("/admin/purchase-invoices")
async def list_purchase_invoices(
    ctx: CurrentSpace,
    branch_id: str = "",
    status: str = "",
    supplier_contact_id: str = "",
    po_id: str = "",
    overdue: bool = False,
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
    if po_id.strip():
        where.append("po_id = :pid")
        params["pid"] = po_id.strip()
    if overdue:
        where.append("due_date IS NOT NULL AND due_date < CURRENT_DATE AND status IN ('RECEIVED', 'PART_PAID')")
    if search.strip():
        where.append("(LOWER(invoice_number) LIKE :q OR LOWER(supplier_invoice_number) LIKE :q "
                     "OR LOWER(supplier_name) LIKE :q OR LOWER(reference) LIKE :q OR LOWER(notes) LIKE :q)")
        params["q"] = f"%{search.strip().lower()}%"
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT *, (total - paid_total) AS outstanding
            FROM   purchase_invoices {where_sql}
            ORDER  BY invoice_date DESC, created_at DESC
            LIMIT  :limit OFFSET :offset
        """), params)).mappings().all()
        total_row = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM purchase_invoices {where_sql}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).scalar() or 0
    return {
        "items":    [_row(r) for r in rows],
        "total":    int(total_row),
        "page":     page,
        "per_page": per_page,
    }


@router.get("/admin/purchase-invoices/{inv_id}")
async def get_purchase_invoice(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    return await _get_pinv_with_lines(inv_id)


@router.post("/admin/purchase-invoices", status_code=201)
async def create_purchase_invoice(body: PurchaseInvoiceIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Log a bill from a supplier. Created as DRAFT — call /receive to
    post the expense + AP to the GL."""
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
            invoice_number = await _next_number(db, "BILL", branch_id)
            try:
                inv = (await db.execute(text("""
                    INSERT INTO purchase_invoices
                        (invoice_number, supplier_invoice_number, branch_id,
                         supplier_contact_id, supplier_name, po_id,
                         status, invoice_date, due_date, currency,
                         subtotal, vat_total, total, paid_total,
                         notes, reference, created_by, created_at, updated_at)
                    VALUES
                        (:num, :sref, :bid, :sid, :sname, :poid,
                         'DRAFT', :idate, :ddate, :curr,
                         :sub, :vat, :tot, 0,
                         :notes, :ref, :cby, :now, :now)
                    RETURNING *
                """), {
                    "num":  invoice_number, "sref": body.supplier_invoice_number.strip(),
                    "bid":  branch_id, "sid": body.supplier_contact_id or None,
                    "sname": body.supplier_name.strip(),
                    "poid": body.po_id or None,
                    "idate": invoice_date, "ddate": due_date,
                    "curr": (body.currency or "GBP").upper()[:3],
                    "sub":  round(subtotal, 2), "vat": round(vat_total, 2), "tot": total,
                    "notes": body.notes, "ref": body.reference,
                    "cby": created_by, "now": now,
                })).mappings().first()
                if inv is None:
                    raise HTTPException(500, detail="Insert returned no row")
                inv_id = inv["id"]
                for i, (ln, net, vat, ttl) in enumerate(computed, start=1):
                    await db.execute(text("""
                        INSERT INTO purchase_invoice_lines
                            (invoice_id, line_no, description, nominal_code_id, nominal_code,
                             quantity, unit_price, vat_rate, vat_code,
                             line_net, line_vat, line_total)
                        VALUES (:iid, :ln, :desc, :ncid, :nc,
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
                return await _get_pinv_with_lines(str(inv_id))
            except IntegrityError as exc:
                await db.rollback()
                err_str = str(exc).lower()
                if "invoice_number" in err_str and "purchase_invoices" in err_str and attempt < 4:
                    continue
                if "uq_purchase_invoices_supp_ref" in err_str:
                    raise HTTPException(409, detail=(
                        f"Bill with supplier reference '{body.supplier_invoice_number}' "
                        f"already exists for this supplier"
                    )) from exc
                raise HTTPException(409, detail=f"Purchase invoice creation failed: {exc.orig}") from exc

    raise HTTPException(500, detail="Failed to generate unique BILL number after 5 attempts")


@router.post("/admin/purchase-invoices/from-po/{po_id}", status_code=201)
async def create_purchase_invoice_from_po(po_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Auto-build a DRAFT supplier bill from an existing PO — copies header
    + lines. Caller can edit (PUT) before /receive to amend amounts to
    match what the supplier actually billed."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        po = (await db.execute(
            text("SELECT * FROM purchase_orders WHERE id = :id"), {"id": po_id},
        )).mappings().first()
        if not po:
            raise HTTPException(404, detail="Purchase order not found")
        po_lines = (await db.execute(text("""
            SELECT * FROM purchase_order_lines WHERE po_id = :id ORDER BY line_no
        """), {"id": po_id})).mappings().all()

    body = PurchaseInvoiceIn(
        branch_id=po["branch_id"],
        supplier_contact_id=str(po["supplier_contact_id"]) if po["supplier_contact_id"] else None,
        supplier_name=po["supplier_name"] or "",
        po_id=str(po["id"]),
        invoice_date=datetime.now(UTC).date().isoformat(),
        currency=po["currency"] or "GBP",
        reference=po["po_number"],
        notes=f"From PO {po['po_number']}",
        lines=[LineIn(
            description=line["description"],
            nominal_code_id=str(line["nominal_code_id"]) if line["nominal_code_id"] else None,
            nominal_code=line["nominal_code"] or "",
            quantity=float(line["quantity"] or 0),
            unit_price=float(line["unit_price"] or 0),
            vat_rate=float(line["vat_rate"] or 0),
            vat_code=line["vat_code"] or "OUT_OF_SCOPE",
        ) for line in po_lines],
    )
    return await create_purchase_invoice(body, ctx)


@router.put("/admin/purchase-invoices/{inv_id}")
async def update_purchase_invoice(inv_id: str, body: PurchaseInvoiceIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Edit a DRAFT supplier bill (header + lines)."""
    _require_priv(ctx)
    errs = _validate_lines(body.lines)
    if errs:
        raise HTTPException(400, detail={"errors": errs})

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    invoice_date = _parse_date(body.invoice_date, default=datetime.now(UTC).date())
    due_date     = _parse_date(body.due_date, default=None)
    subtotal = 0.0
    vat_total = 0.0
    computed: list[tuple[LineIn, float, float, float]] = []
    for ln in body.lines:
        net, vat, ttl = _compute_line_money(ln)
        subtotal += net
        vat_total += vat
        computed.append((ln, net, vat, ttl))
    total = round(subtotal + vat_total, 2)

    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM purchase_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Purchase invoice not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be edited (status={row['status']})")
        await db.execute(text("""
            UPDATE purchase_invoices SET
                branch_id               = :bid,
                supplier_contact_id     = :sid,
                supplier_name           = :sname,
                supplier_invoice_number = :sref,
                po_id                   = :poid,
                invoice_date            = :idate,
                due_date                = :ddate,
                currency                = :curr,
                subtotal                = :sub,
                vat_total               = :vat,
                total                   = :tot,
                notes                   = :notes,
                reference               = :ref,
                updated_at              = NOW()
            WHERE id = :id
        """), {
            "id":   inv_id, "bid": (body.branch_id or "main").strip(),
            "sid":  body.supplier_contact_id or None,
            "sname": body.supplier_name.strip(),
            "sref": body.supplier_invoice_number.strip(),
            "poid": body.po_id or None,
            "idate": invoice_date, "ddate": due_date,
            "curr": (body.currency or "GBP").upper()[:3],
            "sub":  round(subtotal, 2), "vat": round(vat_total, 2), "tot": total,
            "notes": body.notes, "ref": body.reference,
        })
        await db.execute(text("DELETE FROM purchase_invoice_lines WHERE invoice_id = :id"), {"id": inv_id})
        for i, (ln, net, vat, ttl) in enumerate(computed, start=1):
            await db.execute(text("""
                INSERT INTO purchase_invoice_lines
                    (invoice_id, line_no, description, nominal_code_id, nominal_code,
                     quantity, unit_price, vat_rate, vat_code,
                     line_net, line_vat, line_total)
                VALUES (:iid, :ln, :desc, :ncid, :nc,
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
    return await _get_pinv_with_lines(inv_id)


@router.post("/admin/purchase-invoices/{inv_id}/receive")
async def receive_purchase_invoice(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Mark the bill as RECEIVED and post DR Expense + DR VAT-input CR AP."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import gl
    async with SessionLocal() as db:
        inv = (await db.execute(
            text("SELECT * FROM purchase_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not inv:
            raise HTTPException(404, detail="Purchase invoice not found")
        if inv["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Expected status DRAFT, got {inv['status']}")

        lines = (await db.execute(text("""
            SELECT nominal_code, nominal_code_id, line_net, line_vat
            FROM   purchase_invoice_lines WHERE invoice_id = :id ORDER BY line_no
        """), {"id": inv_id})).mappings().all()

        now = datetime.now(UTC)
        await db.execute(text("""
            UPDATE purchase_invoices SET status='RECEIVED', received_at=:now, updated_at=:now WHERE id=:id
        """), {"id": inv_id, "now": now})

        try:
            posting: list[dict[str, Any]] = []
            for line in lines:
                net = float(line["line_net"] or 0)
                vat = float(line["line_vat"] or 0)
                if net:
                    posting.append({
                        "nominal_code": line["nominal_code"] or gl.DEFAULT_EXPENSE,
                        "nominal_code_id": str(line["nominal_code_id"]) if line["nominal_code_id"] else None,
                        "debit": net, "credit": 0,
                        "description": f"Bill {inv['invoice_number']} — {inv['supplier_name'] or 'supplier'}",
                    })
                if vat > 0:
                    posting.append({
                        "nominal_code": gl.DEFAULT_VAT_INPUT,
                        "debit": vat, "credit": 0,
                        "description": f"Input VAT — Bill {inv['invoice_number']}",
                    })
            posting.append({
                "nominal_code": gl.DEFAULT_CREDITOR,
                "debit": 0, "credit": float(inv["total"] or 0),
                "description": f"AP — {inv['supplier_name'] or 'supplier'}",
            })
            await gl.post(
                db, branch_id=inv["branch_id"], entry_date=now.date(),
                description=f"Bill received — {inv['invoice_number']} ({inv['supplier_name'] or 'supplier'})",
                reference=inv["invoice_number"],
                source_type=gl.SOURCE_PO_RECEIVE, source_id=inv_id,
                posted_by=getattr(ctx, "user_email", "") or "",
                idempotency_key=f"gl-pinv-receive-{inv_id}",
                lines=posting,
            )
        except Exception:
            import structlog
            structlog.get_logger().exception("purchase_invoice_receive_gl_post_failed", inv_id=inv_id)

        await db.commit()
    return await _get_pinv_with_lines(inv_id)


@router.post("/admin/purchase-invoices/{inv_id}/pay")
async def pay_purchase_invoice_full(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Mark the bill PAID in one shot and post DR AP CR Bank for the
    outstanding balance."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import gl
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT * FROM purchase_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Purchase invoice not found")
        if row["status"] not in ("RECEIVED", "PART_PAID"):
            raise HTTPException(409, detail=f"Cannot mark paid from status {row['status']}")

        outstanding = float(row["total"] or 0) - float(row["paid_total"] or 0)
        now = datetime.now(UTC)
        await db.execute(text("""
            UPDATE purchase_invoices
            SET status='PAID', paid_total=total, paid_at=:now, updated_at=:now
            WHERE id=:id
        """), {"id": inv_id, "now": now})

        if outstanding > 0:
            try:
                await gl.post(
                    db, branch_id=row["branch_id"], entry_date=now.date(),
                    description=f"Bill payment — {row['invoice_number']}",
                    reference=row["invoice_number"],
                    source_type=gl.SOURCE_PO_PAY, source_id=inv_id,
                    posted_by=getattr(ctx, "user_email", "") or "",
                    idempotency_key=f"gl-pinv-pay-{inv_id}-{outstanding:.2f}",
                    lines=gl.lines_for_po_pay(outstanding, row["supplier_name"] or "supplier"),
                )
            except Exception:
                import structlog
                structlog.get_logger().exception("purchase_invoice_pay_gl_post_failed", inv_id=inv_id)
        await db.commit()
    return await _get_pinv_with_lines(inv_id)


@router.post("/admin/purchase-invoices/{inv_id}/payments")
async def record_supplier_payment(inv_id: str, body: SupplierPaymentIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Record a partial (or full) payment to the supplier. Posts DR AP
    CR Bank for the amount, bumps paid_total. Flips RECEIVED -> PART_PAID
    -> PAID as appropriate."""
    _require_priv(ctx)
    if body.amount <= 0:
        raise HTTPException(400, detail="amount must be > 0")
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import gl
    async with SessionLocal() as db:
        inv = (await db.execute(
            text("SELECT * FROM purchase_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not inv:
            raise HTTPException(404, detail="Purchase invoice not found")
        if inv["status"] in ("VOID", "DRAFT"):
            raise HTTPException(409, detail=f"Cannot record payment on a {inv['status']} bill")

        paid_so_far = float(inv["paid_total"] or 0) + float(body.amount)
        total = float(inv["total"] or 0)
        if paid_so_far > total + 0.005:
            raise HTTPException(400, detail=f"Payment {body.amount} would over-pay (paid {paid_so_far:.2f} vs total {total:.2f})")

        now = datetime.now(UTC)
        new_status = "PAID" if abs(paid_so_far - total) < 0.01 else "PART_PAID"
        stamp_paid = ", paid_at = :now" if new_status == "PAID" else ""
        await db.execute(text(f"""
            UPDATE purchase_invoices
            SET    paid_total = :pt, status = :st, updated_at = :now{stamp_paid}
            WHERE  id = :id
        """), {"pt": round(paid_so_far, 2), "st": new_status, "now": now, "id": inv_id})

        try:
            bank = (body.bank_nominal_code or "").strip().upper() or gl.DEFAULT_BANK
            entry_date = body.payment_date.strip() or now.date().isoformat()
            await gl.post(
                db, branch_id=inv["branch_id"], entry_date=entry_date,
                description=f"Payment — Bill {inv['invoice_number']} ({body.amount:.2f})",
                reference=body.payment_ref or inv["invoice_number"],
                source_type=gl.SOURCE_PO_PAY, source_id=inv_id,
                posted_by=getattr(ctx, "user_email", "") or "",
                idempotency_key=f"gl-pinv-pay-{inv_id}-{entry_date}-{body.amount:.2f}",
                lines=[
                    {"nominal_code": gl.DEFAULT_CREDITOR, "debit": body.amount, "credit": 0,
                     "description": f"AP clear — {inv['supplier_name'] or 'supplier'}"},
                    {"nominal_code": bank, "debit": 0, "credit": body.amount,
                     "description": f"Payment — {inv['supplier_name'] or 'supplier'}"},
                ],
            )
        except Exception:
            import structlog
            structlog.get_logger().exception("supplier_payment_gl_post_failed", inv_id=inv_id)
        await db.commit()
    return await _get_pinv_with_lines(inv_id)


@router.post("/admin/purchase-invoices/{inv_id}/void")
async def void_purchase_invoice(inv_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Void a bill and reverse every non-reversed GL entry against it
    (receive + any payments)."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import gl
    async with SessionLocal() as db:
        inv = (await db.execute(
            text("SELECT id, status FROM purchase_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not inv:
            raise HTTPException(404, detail="Purchase invoice not found")
        if inv["status"] in ("PAID", "VOID"):
            raise HTTPException(409, detail=f"Cannot void from {inv['status']}")

        gl_entries = (await db.execute(text("""
            SELECT id FROM transactions
            WHERE  source_id = :sid
              AND  source_type IN (:s1, :s2)
              AND  reversal_of IS NULL
              AND  NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversal_of = transactions.id)
            ORDER  BY posted_at
        """), {"sid": inv_id, "s1": gl.SOURCE_PO_RECEIVE, "s2": gl.SOURCE_PO_PAY})).mappings().all()
        for gl_row in gl_entries:
            try:
                await gl.reverse(db, original_txn_id=str(gl_row["id"]),
                                 posted_by=getattr(ctx, "user_email", "") or "",
                                 description="Bill voided — reversing posting")
            except Exception:
                import structlog
                structlog.get_logger().exception("purchase_invoice_void_reverse_failed",
                                                 inv_id=inv_id, gl_id=str(gl_row["id"]))

        await db.execute(text("""
            UPDATE purchase_invoices SET status='VOID', voided_at=:now, updated_at=:now WHERE id=:id
        """), {"id": inv_id, "now": datetime.now(UTC)})
        await db.commit()
    return await _get_pinv_with_lines(inv_id)


@router.delete("/admin/purchase-invoices/{inv_id}", status_code=204)
async def delete_purchase_invoice(inv_id: str, ctx: CurrentSpace) -> None:
    """Hard-delete a DRAFT bill (anything past DRAFT must be voided)."""
    _require_priv(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM purchase_invoices WHERE id = :id"), {"id": inv_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Purchase invoice not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be deleted (status={row['status']})")
        await db.execute(text("DELETE FROM purchase_invoices WHERE id = :id"), {"id": inv_id})
        await db.commit()
