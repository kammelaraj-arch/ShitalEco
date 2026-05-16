"""Budgets (Phase 3).

Period+branch budgets with per-nominal-code line allocations. Variance
report joins `budget_lines` to `transaction_lines` (Phase 2 GL) so
actuals come from the live ledger — no parallel actuals store.

Endpoints
    GET    /admin/budgets                       — list with filters
    POST   /admin/budgets                       — create header
    GET    /admin/budgets/{id}                  — header + lines
    PUT    /admin/budgets/{id}                  — update header (DRAFT only)
    DELETE /admin/budgets/{id}                  — delete (DRAFT only)
    POST   /admin/budgets/{id}/approve          — DRAFT -> APPROVED
    POST   /admin/budgets/{id}/close            — APPROVED -> CLOSED
    PUT    /admin/budgets/{id}/lines            — replace lines wholesale
    GET    /admin/budgets/{id}/vs-actual        — variance for one budget
    GET    /admin/budgets/dashboard             — multi-budget rollup
                                                  for the org-wide tile
"""
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["budgets"])

VALID_PERIOD_TYPES = {"YEAR", "QUARTER", "MONTH"}
VALID_FUND_TYPES   = {"UNRESTRICTED", "RESTRICTED", "ENDOWMENT"}
PRIVILEGED         = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "AUDITOR"}
WRITERS            = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT"}


def _require_read(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Privileged role required")


def _require_write(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in WRITERS:
        raise HTTPException(403, detail="Write role required")


def _row(r: Any) -> dict[str, Any]:
    if r is None:
        return {}
    out: dict[str, Any] = {}
    for k, v in dict(r).items():
        if isinstance(v, UUID):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif hasattr(v, "normalize"):
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                out[k] = str(v)
        else:
            out[k] = v
    return out


def _period_window(fiscal_year: int, period_type: str, period_label: str) -> tuple[date, date]:
    """Compute period_start/period_end from the type + label combo. Lets
    the UI just pick YEAR/QUARTER/MONTH + label and the backend figures
    out the date window for variance reporting."""
    period_type = period_type.upper()
    label = (period_label or "").strip()
    if period_type == "YEAR":
        return date(fiscal_year, 1, 1), date(fiscal_year, 12, 31)
    if period_type == "QUARTER":
        q = 1
        up = label.upper()
        if up.endswith("Q2"):
            q = 2
        elif up.endswith("Q3"):
            q = 3
        elif up.endswith("Q4"):
            q = 4
        starts = {1: (1, 1), 2: (4, 1), 3: (7, 1), 4: (10, 1)}
        ends   = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}
        sm, sd = starts[q]
        em, ed = ends[q]
        return date(fiscal_year, sm, sd), date(fiscal_year, em, ed)
    if period_type == "MONTH":
        try:
            m = int(label.split("-")[-1])
        except (ValueError, IndexError):
            m = 1
        m = max(1, min(12, m))
        from calendar import monthrange
        return date(fiscal_year, m, 1), date(fiscal_year, m, monthrange(fiscal_year, m)[1])
    return date(fiscal_year, 1, 1), date(fiscal_year, 12, 31)


# ─── Pydantic ───────────────────────────────────────────────────────────────

class LineIn(BaseModel):
    nominal_code_id: str = ""
    nominal_code: str = ""
    fund_type: str = "UNRESTRICTED"
    project_id: str | None = None
    amount: float = 0
    notes: str = ""


class BudgetIn(BaseModel):
    branch_id: str = "main"
    fiscal_year: int
    period_type: str = "YEAR"
    period_label: str = ""
    name: str = ""
    fund_type: str = "UNRESTRICTED"
    project_id: str | None = None
    notes: str = ""
    lines: list[LineIn] = Field(default_factory=list)


# ─── List + Create ──────────────────────────────────────────────────────────

@router.get("/admin/budgets")
async def list_budgets(
    ctx: CurrentSpace,
    branch_id: str = "",
    fiscal_year: int | None = None,
    status: str = "",
    project_id: str = "",
    fund_type: str = "",
    page: int = 1,
    per_page: int = 50,
) -> dict[str, Any]:
    _require_read(ctx)
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
    if fiscal_year:
        where.append("fiscal_year = :fy")
        params["fy"] = fiscal_year
    if status.strip():
        where.append("status = :st")
        params["st"] = status.strip().upper()
    if project_id.strip():
        where.append("project_id = :pid")
        params["pid"] = project_id.strip()
    if fund_type.strip():
        where.append("fund_type = :ft")
        params["ft"] = fund_type.strip().upper()
    sql_where = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT * FROM budgets {sql_where}
            ORDER BY fiscal_year DESC, period_label DESC, branch_id
            LIMIT :limit OFFSET :offset
        """), params)).mappings().all()
        total = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM budgets {sql_where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).scalar() or 0
    return {
        "items":    [_row(r) for r in rows],
        "total":    int(total),
        "page":     page,
        "per_page": per_page,
    }


async def _get_with_lines(db: Any, budget_id: str) -> dict[str, Any]:
    from sqlalchemy import text
    header = (await db.execute(
        text("SELECT * FROM budgets WHERE id = :id"), {"id": budget_id},
    )).mappings().first()
    if not header:
        raise HTTPException(404, detail="Budget not found")
    lines = (await db.execute(text("""
        SELECT bl.*, nc.code AS code, nc.name AS code_name, nc.type AS code_type
        FROM   budget_lines bl
        LEFT JOIN nominal_codes nc ON nc.id = bl.nominal_code_id
        WHERE  bl.budget_id = :id
        ORDER  BY nc.code NULLS LAST
    """), {"id": budget_id})).mappings().all()
    out = _row(header)
    out["lines"] = [_row(line) for line in lines]
    return out


@router.get("/admin/budgets/{budget_id}")
async def get_budget(budget_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_read(ctx)
    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        return await _get_with_lines(db, budget_id)


@router.post("/admin/budgets", status_code=201)
async def create_budget(body: BudgetIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_write(ctx)
    if body.period_type not in VALID_PERIOD_TYPES:
        raise HTTPException(400, detail=f"period_type must be one of {sorted(VALID_PERIOD_TYPES)}")
    if body.fund_type not in VALID_FUND_TYPES:
        raise HTTPException(400, detail=f"fund_type must be one of {sorted(VALID_FUND_TYPES)}")

    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    from shital.core.fabrics.database import SessionLocal

    branch_id = (body.branch_id or "main").strip() or "main"
    label = (body.period_label or "").strip() or str(body.fiscal_year)
    period_start, period_end = _period_window(body.fiscal_year, body.period_type, label)
    now = datetime.now(UTC)
    created_by = getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or ""

    total_income = sum(float(ln.amount) for ln in body.lines if ln.amount > 0)
    total_expense = sum(abs(float(ln.amount)) for ln in body.lines if ln.amount < 0)
    net = total_income - total_expense

    async with SessionLocal() as db:
        try:
            header = (await db.execute(text("""
                INSERT INTO budgets
                    (branch_id, fiscal_year, period_type, period_label,
                     period_start, period_end, name, status, fund_type, project_id,
                     total_income, total_expense, net_budget, notes, created_by,
                     created_at, updated_at)
                VALUES
                    (:bid, :fy, :pt, :pl, :ps, :pe, :name, 'DRAFT', :fund, :pid,
                     :ti, :te, :net, :notes, :cby, :now, :now)
                RETURNING *
            """), {
                "bid": branch_id, "fy": body.fiscal_year,
                "pt":  body.period_type.upper(), "pl": label,
                "ps":  period_start, "pe": period_end,
                "name": body.name.strip() or f"{branch_id} {label}",
                "fund": body.fund_type, "pid": body.project_id or None,
                "ti":   round(total_income, 2),
                "te":   round(total_expense, 2),
                "net":  round(net, 2),
                "notes": body.notes, "cby": created_by, "now": now,
            })).mappings().first()
        except IntegrityError as exc:
            raise HTTPException(409, detail=f"Budget already exists for this period: {exc.orig}") from exc

        if header is None:
            raise HTTPException(500, detail="Insert returned no row")
        budget_id = str(header["id"])

        for ln in body.lines:
            if not ln.nominal_code_id and not ln.nominal_code:
                continue
            nominal_id = ln.nominal_code_id
            if not nominal_id and ln.nominal_code:
                r = (await db.execute(
                    text("SELECT id FROM nominal_codes WHERE code = :c LIMIT 1"),
                    {"c": ln.nominal_code.strip().upper()},
                )).mappings().first()
                if r:
                    nominal_id = str(r["id"])
            if not nominal_id:
                continue
            await db.execute(text("""
                INSERT INTO budget_lines
                    (budget_id, nominal_code_id, nominal_code, fund_type,
                     project_id, amount, notes, created_at, updated_at)
                VALUES (:bid, :ncid, :nc, :fund, :pid, :amt, :notes, :now, :now)
            """), {
                "bid": budget_id, "ncid": nominal_id,
                "nc":  ln.nominal_code.strip().upper(),
                "fund": ln.fund_type or body.fund_type,
                "pid": ln.project_id or body.project_id or None,
                "amt": round(float(ln.amount), 2),
                "notes": ln.notes, "now": now,
            })
        await db.commit()
        return await _get_with_lines(db, budget_id)


@router.put("/admin/budgets/{budget_id}")
async def update_budget(budget_id: str, body: BudgetIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM budgets WHERE id = :id"), {"id": budget_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Budget not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT budgets can be edited (status={row['status']})")
        period_start, period_end = _period_window(body.fiscal_year, body.period_type, body.period_label or str(body.fiscal_year))
        await db.execute(text("""
            UPDATE budgets SET
                fiscal_year   = :fy,
                period_type   = :pt,
                period_label  = :pl,
                period_start  = :ps,
                period_end    = :pe,
                name          = :name,
                fund_type     = :fund,
                project_id    = :pid,
                notes         = :notes,
                updated_at    = NOW()
            WHERE id = :id
        """), {
            "id":   budget_id, "fy": body.fiscal_year,
            "pt":   body.period_type.upper(),
            "pl":   body.period_label or str(body.fiscal_year),
            "ps":   period_start, "pe": period_end,
            "name": body.name.strip(), "fund": body.fund_type,
            "pid":  body.project_id or None, "notes": body.notes,
        })
        await db.commit()
        return await _get_with_lines(db, budget_id)


@router.put("/admin/budgets/{budget_id}/lines")
async def replace_lines(budget_id: str, body: BudgetIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Wholesale replace all lines (DRAFT only). Recomputes totals."""
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status, fund_type, project_id FROM budgets WHERE id = :id"),
            {"id": budget_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Budget not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT budgets can be edited (status={row['status']})")

        await db.execute(text("DELETE FROM budget_lines WHERE budget_id = :id"), {"id": budget_id})

        now = datetime.now(UTC)
        total_income = 0.0
        total_expense = 0.0
        for ln in body.lines:
            nominal_id = ln.nominal_code_id
            if not nominal_id and ln.nominal_code:
                r = (await db.execute(
                    text("SELECT id FROM nominal_codes WHERE code = :c LIMIT 1"),
                    {"c": ln.nominal_code.strip().upper()},
                )).mappings().first()
                if r:
                    nominal_id = str(r["id"])
            if not nominal_id:
                continue
            amount = round(float(ln.amount), 2)
            if amount > 0:
                total_income += amount
            elif amount < 0:
                total_expense += abs(amount)
            await db.execute(text("""
                INSERT INTO budget_lines
                    (budget_id, nominal_code_id, nominal_code, fund_type,
                     project_id, amount, notes, created_at, updated_at)
                VALUES (:bid, :ncid, :nc, :fund, :pid, :amt, :notes, :now, :now)
            """), {
                "bid": budget_id, "ncid": nominal_id,
                "nc":  ln.nominal_code.strip().upper(),
                "fund": ln.fund_type or row["fund_type"] or "UNRESTRICTED",
                "pid": ln.project_id or (str(row["project_id"]) if row["project_id"] else None),
                "amt": amount, "notes": ln.notes, "now": now,
            })
        await db.execute(text("""
            UPDATE budgets
            SET total_income = :ti, total_expense = :te, net_budget = :net, updated_at = :now
            WHERE id = :id
        """), {
            "ti": round(total_income, 2), "te": round(total_expense, 2),
            "net": round(total_income - total_expense, 2),
            "now": now, "id": budget_id,
        })
        await db.commit()
        return await _get_with_lines(db, budget_id)


@router.post("/admin/budgets/{budget_id}/approve")
async def approve_budget(budget_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    return await _transition(budget_id, ctx, from_status="DRAFT", to_status="APPROVED",
                             stamp_col="approved_at", stamp_user_col="approved_by")


@router.post("/admin/budgets/{budget_id}/close")
async def close_budget(budget_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    return await _transition(budget_id, ctx, from_status="APPROVED", to_status="CLOSED",
                             stamp_col="closed_at")


@router.delete("/admin/budgets/{budget_id}", status_code=204)
async def delete_budget(budget_id: str, ctx: CurrentSpace) -> None:
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM budgets WHERE id = :id"), {"id": budget_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Budget not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be deleted (status={row['status']})")
        await db.execute(text("DELETE FROM budgets WHERE id = :id"), {"id": budget_id})
        await db.commit()


async def _transition(
    budget_id: str, ctx: CurrentSpace, *,
    from_status: str, to_status: str, stamp_col: str, stamp_user_col: str = "",
) -> dict[str, Any]:
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    user_email = getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or ""
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM budgets WHERE id = :id"), {"id": budget_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Budget not found")
        if row["status"] != from_status:
            raise HTTPException(409, detail=f"Expected status {from_status}, got {row['status']}")
        set_user = f", {stamp_user_col} = :user" if stamp_user_col else ""
        await db.execute(text(f"""
            UPDATE budgets
            SET status = :st, {stamp_col} = :now{set_user}, updated_at = :now
            WHERE id = :id
        """), {"st": to_status, "now": datetime.now(UTC), "user": user_email, "id": budget_id})
        await db.commit()
        return await _get_with_lines(db, budget_id)


# ─── Budget vs Actual ───────────────────────────────────────────────────────

@router.get("/admin/budgets/{budget_id}/vs-actual")
async def vs_actual(budget_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Per-code budget vs actual + variance.

    Actuals come from `transaction_lines` filtered to the budget's
    branch + period + fund (+ project if set). INCOME codes: actual =
    credits - debits (income is a credit). EXPENSE codes: actual =
    debits - credits. Variance = budget - actual (negative = overspent
    on expenses, positive = under-budget; opposite for income).
    """
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        header = (await db.execute(
            text("SELECT * FROM budgets WHERE id = :id"), {"id": budget_id},
        )).mappings().first()
        if not header:
            raise HTTPException(404, detail="Budget not found")

        rows = (await db.execute(text("""
            WITH actuals AS (
                SELECT tl.nominal_code_id,
                       COALESCE(SUM(tl.debit_amount), 0)  AS dr,
                       COALESCE(SUM(tl.credit_amount), 0) AS cr
                FROM   transaction_lines tl
                JOIN   transactions t ON t.id = tl.transaction_id
                WHERE  t.status = 'POSTED'
                  AND  t.deleted_at IS NULL
                  AND  tl.branch_id = :bid
                  AND  (tl.fund_type = :fund OR :fund = '')
                  AND  t.date BETWEEN :ps AND :pe
                  AND  (:pid IS NULL OR tl.project_id = :pid)
                GROUP BY tl.nominal_code_id
            )
            SELECT bl.id              AS line_id,
                   bl.amount          AS budget_amount,
                   bl.notes           AS line_notes,
                   nc.id              AS code_id,
                   nc.code            AS code,
                   nc.name            AS code_name,
                   nc.type            AS code_type,
                   COALESCE(a.dr, 0)  AS actual_dr,
                   COALESCE(a.cr, 0)  AS actual_cr
            FROM   budget_lines bl
            JOIN   nominal_codes nc ON nc.id = bl.nominal_code_id
            LEFT JOIN actuals a ON a.nominal_code_id = bl.nominal_code_id
            WHERE  bl.budget_id = :id
            ORDER  BY nc.code
        """), {
            "id":   budget_id,
            "bid":  header["branch_id"],
            "fund": header["fund_type"] or "",
            "ps":   header["period_start"],
            "pe":   header["period_end"],
            "pid":  str(header["project_id"]) if header["project_id"] else None,
        })).mappings().all()

    items: list[dict[str, Any]] = []
    total_budget_income = 0.0
    total_actual_income = 0.0
    total_budget_expense = 0.0
    total_actual_expense = 0.0
    for r in rows:
        budget_amt = float(r["budget_amount"] or 0)
        dr = float(r["actual_dr"] or 0)
        cr = float(r["actual_cr"] or 0)
        code_type = r["code_type"] or "EXPENSE"
        if code_type == "INCOME":
            actual = round(cr - dr, 2)
            variance = round(budget_amt - actual, 2)
            total_budget_income += budget_amt
            total_actual_income += actual
        else:
            actual = round(dr - cr, 2)
            variance = round(budget_amt - actual, 2)
            total_budget_expense += abs(budget_amt)
            total_actual_expense += actual
        pct = round((actual / budget_amt * 100), 1) if budget_amt else 0.0
        items.append({
            "line_id":      str(r["line_id"]),
            "code_id":      str(r["code_id"]),
            "code":         r["code"],
            "code_name":    r["code_name"],
            "code_type":    code_type,
            "budget_amount": budget_amt,
            "actual_amount": actual,
            "variance":     variance,
            "pct_used":     pct,
            "notes":        r["line_notes"],
        })

    return {
        "budget": _row(header),
        "items":  items,
        "totals": {
            "budget_income":  round(total_budget_income, 2),
            "actual_income":  round(total_actual_income, 2),
            "budget_expense": round(total_budget_expense, 2),
            "actual_expense": round(total_actual_expense, 2),
            "budget_net":     round(total_budget_income - total_budget_expense, 2),
            "actual_net":     round(total_actual_income - total_actual_expense, 2),
        },
    }


@router.get("/admin/budgets/dashboard")
async def budgets_dashboard(
    ctx: CurrentSpace,
    fiscal_year: int | None = None,
    branch_id: str = "",
) -> dict[str, Any]:
    """Rollup tiles for the budgets landing page — totals across every
    APPROVED budget in the period."""
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where = ["b.status IN ('APPROVED', 'CLOSED')"]
    params: dict[str, Any] = {}
    if fiscal_year:
        where.append("b.fiscal_year = :fy")
        params["fy"] = fiscal_year
    if branch_id.strip():
        where.append("b.branch_id = :bid")
        params["bid"] = branch_id.strip()
    sql_where = " AND ".join(where)

    async with SessionLocal() as db:
        totals = (await db.execute(text(f"""
            SELECT COALESCE(SUM(total_income),  0) AS budget_income,
                   COALESCE(SUM(total_expense), 0) AS budget_expense,
                   COUNT(*) AS budget_count
            FROM   budgets b
            WHERE  {sql_where}
        """), params)).mappings().first()

        actuals = (await db.execute(text(f"""
            SELECT
                COALESCE(SUM(CASE WHEN nc.type = 'INCOME'  THEN tl.credit_amount - tl.debit_amount ELSE 0 END), 0) AS actual_income,
                COALESCE(SUM(CASE WHEN nc.type = 'EXPENSE' THEN tl.debit_amount  - tl.credit_amount ELSE 0 END), 0) AS actual_expense
            FROM transaction_lines tl
            JOIN nominal_codes nc ON nc.id = tl.nominal_code_id
            JOIN transactions t   ON t.id = tl.transaction_id
            WHERE t.status = 'POSTED' AND t.deleted_at IS NULL
              AND EXISTS (
                  SELECT 1 FROM budgets b
                  WHERE {sql_where}
                    AND tl.branch_id = b.branch_id
                    AND t.date BETWEEN b.period_start AND b.period_end
              )
        """), params)).mappings().first()
    return {
        "fiscal_year":     fiscal_year,
        "branch_id":       branch_id,
        "budget_income":   float(totals["budget_income"] or 0)  if totals else 0,
        "budget_expense":  float(totals["budget_expense"] or 0) if totals else 0,
        "actual_income":   float(actuals["actual_income"] or 0) if actuals else 0,
        "actual_expense":  float(actuals["actual_expense"] or 0) if actuals else 0,
        "budget_count":    int(totals["budget_count"] or 0)     if totals else 0,
    }
