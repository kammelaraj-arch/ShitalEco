"""Payroll runs + payslips.

Full payroll flow:
    1. Create run for a period → DRAFT
    2. Auto-generate draft payslips for every active employee
    3. Review / override individual payslips
    4. Finalize → status FINALIZED, payslips frozen
    5. Mark paid → posts wages journal to GL (one entry covering the whole run)
"""
from __future__ import annotations

from calendar import monthrange
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from shital.api.deps import CurrentSpace
from shital.capabilities.payroll.capabilities import (
    PayslipCalculationInput,
    RunPayrollInput,
    calculate_payslip,
    run_payroll,
)

router = APIRouter(prefix="/payroll", tags=["payroll"])

PRIVILEGED = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "HR_MANAGER"}


def _require_read(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Privileged role required")


def _require_write(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Privileged role required")


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


def _json(obj: Any) -> str:
    import json
    return json.dumps(obj)


class RunIn(BaseModel):
    branch_id: str = "main"
    year: int
    month: int
    pay_date: str = ""
    employee_ids: list[str] = Field(default_factory=list)
    notes: str = ""


class PayslipOverride(BaseModel):
    basic_pay: float | None = None
    overtime_pay: float | None = None
    bonus_pay: float | None = None
    other_pay: float | None = None
    other_deductions: float | None = None
    student_loan: float | None = None
    notes: str | None = None


class MarkPaidIn(BaseModel):
    payment_method: str = "bank_transfer"
    payment_ref: str = ""
    bank_nominal_code: str = ""


# Legacy endpoints (kept for backwards compatibility)

@router.post("/calculate")
async def calc_payslip(body: PayslipCalculationInput, ctx: CurrentSpace):
    return await calculate_payslip(ctx, body)


@router.post("/run")
async def run(body: RunPayrollInput, ctx: CurrentSpace):
    return await run_payroll(ctx, body)


# Runs

@router.get("/runs")
async def list_runs(
    ctx: CurrentSpace,
    branch_id: str = "",
    year: int | None = None,
    status: str = "",
    page: int = 1,
    per_page: int = 50,
) -> dict[str, Any]:
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = ["deleted_at IS NULL"]
    params: dict[str, Any] = {
        "limit":  max(1, min(per_page, 200)),
        "offset": max(0, (page - 1) * per_page),
    }
    if branch_id.strip():
        where.append("branch_id = :bid")
        params["bid"] = branch_id.strip()
    if year:
        where.append("period_year = :y")
        params["y"] = year
    if status.strip():
        where.append("status = :st")
        params["st"] = status.strip().upper()

    sql_where = " AND ".join(where)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT *,
                   (SELECT COUNT(*) FROM payslips WHERE payroll_run_id = pr.id) AS payslip_count
            FROM   payroll_runs pr
            WHERE  {sql_where}
            ORDER  BY period_year DESC NULLS LAST, period_month DESC NULLS LAST, run_date DESC
            LIMIT  :limit OFFSET :offset
        """), params)).mappings().all()
        total = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM payroll_runs pr WHERE {sql_where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).scalar() or 0
    return {
        "runs":     [_row(r) for r in rows],
        "items":    [_row(r) for r in rows],
        "total":    int(total),
        "page":     page,
        "per_page": per_page,
    }


async def _get_run_with_payslips(db: Any, run_id: str) -> dict[str, Any]:
    from sqlalchemy import text
    header = (await db.execute(
        text("SELECT * FROM payroll_runs WHERE id = :id AND deleted_at IS NULL"),
        {"id": run_id},
    )).mappings().first()
    if not header:
        raise HTTPException(404, detail="Payroll run not found")
    payslips = (await db.execute(text("""
        SELECT * FROM payslips WHERE payroll_run_id = :id
        ORDER BY employee_name
    """), {"id": run_id})).mappings().all()
    out = _row(header)
    out["payslips"] = [_row(p) for p in payslips]
    return out


@router.get("/runs/{run_id}")
async def get_run(run_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_read(ctx)
    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        return await _get_run_with_payslips(db, run_id)


async def _refresh_run_totals(db: Any, run_id: str) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        UPDATE payroll_runs SET
            total_gross            = COALESCE((SELECT SUM(gross_pay)            FROM payslips WHERE payroll_run_id = :id), 0),
            total_net              = COALESCE((SELECT SUM(net_pay)              FROM payslips WHERE payroll_run_id = :id), 0),
            total_tax              = COALESCE((SELECT SUM(tax_deduction)        FROM payslips WHERE payroll_run_id = :id), 0),
            total_ni               = COALESCE((SELECT SUM(ni_employee)          FROM payslips WHERE payroll_run_id = :id), 0),
            total_pension          = COALESCE((SELECT SUM(pension_employee)     FROM payslips WHERE payroll_run_id = :id), 0),
            total_employer_ni      = COALESCE((SELECT SUM(ni_employer)          FROM payslips WHERE payroll_run_id = :id), 0),
            total_employer_pension = COALESCE((SELECT SUM(pension_employer)     FROM payslips WHERE payroll_run_id = :id), 0),
            total_employer_cost    = COALESCE((SELECT SUM(total_employer_cost)  FROM payslips WHERE payroll_run_id = :id), 0),
            updated_at = NOW()
        WHERE id = :id
    """), {"id": run_id})


async def _generate_payslips(db: Any, run_row: Any, employee_ids: list[str]) -> int:
    """Create one DRAFT payslip per employee."""
    from sqlalchemy import text

    from shital.services import payroll_calc

    where_emp = "branch_id = :bid AND is_active = true AND deleted_at IS NULL"
    params: dict[str, Any] = {"bid": run_row["branch_id"]}
    if employee_ids:
        where_emp += " AND id::text = ANY(:ids)"
        params["ids"] = employee_ids

    emps = (await db.execute(text(f"""
        SELECT id, COALESCE(full_name, '') AS full_name,
               employee_number, tax_code, national_insurance,
               gross_salary, hours_per_week,
               pension_enrolled, pension_employee_pct, pension_employer_pct,
               employment_type
        FROM   employees
        WHERE  {where_emp}
        ORDER  BY full_name
    """), params)).mappings().all()

    now = datetime.now(UTC)
    pay_date = run_row["pay_date"] or run_row["period_end"]
    count = 0
    for emp in emps:
        annual = float(emp["gross_salary"] or 0)
        calc = payroll_calc.calculate(
            annual_salary=annual,
            tax_code=emp["tax_code"] or "1257L",
            pension_employee_pct=float(emp["pension_employee_pct"] or 0),
            pension_employer_pct=float(emp["pension_employer_pct"] or 0),
            pension_enrolled=bool(emp["pension_enrolled"]),
        )

        ytd = (await db.execute(text("""
            SELECT COALESCE(SUM(gross_pay),        0) AS g,
                   COALESCE(SUM(tax_deduction),    0) AS t,
                   COALESCE(SUM(ni_employee),      0) AS n,
                   COALESCE(SUM(pension_employee), 0) AS p,
                   COALESCE(SUM(net_pay),          0) AS np
            FROM   payslips
            WHERE  employee_id = :eid
              AND  EXTRACT(YEAR FROM period_end) = :yr
              AND  status IN ('FINALIZED', 'PAID')
        """), {"eid": emp["id"], "yr": run_row["period_year"]})).mappings().first()
        ytd_g  = float((ytd["g"]  if ytd else 0) or 0) + calc["gross_pay"]
        ytd_t  = float((ytd["t"]  if ytd else 0) or 0) + calc["tax_deduction"]
        ytd_n  = float((ytd["n"]  if ytd else 0) or 0) + calc["ni_employee"]
        ytd_p  = float((ytd["p"]  if ytd else 0) or 0) + calc["pension_employee"]
        ytd_np = float((ytd["np"] if ytd else 0) or 0) + calc["net_pay"]

        await db.execute(text("""
            INSERT INTO payslips
                (payroll_run_id, employee_id, branch_id,
                 period_label, period_start, period_end, pay_date,
                 employee_name, employee_number, tax_code, ni_number,
                 basic_pay, overtime_pay, bonus_pay, other_pay,
                 gross_pay, taxable_pay,
                 tax_deduction, ni_employee, pension_employee,
                 student_loan, other_deductions, total_deductions,
                 net_pay,
                 ni_employer, pension_employer, total_employer_cost,
                 ytd_gross, ytd_tax, ytd_ni, ytd_pension, ytd_net,
                 status, earnings_json, deductions_json,
                 calculated_at, created_at, updated_at)
            VALUES
                (:rid, :eid, :bid,
                 :pl, :ps, :pe, :pd,
                 :name, :num, :tc, :nin,
                 :bp, 0, 0, 0,
                 :gp, :tx,
                 :tax, :ni_e, :pen_e,
                 0, 0, :td,
                 :np,
                 :ni_er, :pen_er, :tec,
                 :ytg, :ytt, :ytn, :ytp, :ytnp,
                 'DRAFT', CAST(:earn AS jsonb), CAST(:deduct AS jsonb),
                 :now, :now, :now)
            ON CONFLICT (payroll_run_id, employee_id) DO UPDATE SET
                basic_pay = EXCLUDED.basic_pay,
                gross_pay = EXCLUDED.gross_pay,
                taxable_pay = EXCLUDED.taxable_pay,
                tax_deduction = EXCLUDED.tax_deduction,
                ni_employee = EXCLUDED.ni_employee,
                pension_employee = EXCLUDED.pension_employee,
                total_deductions = EXCLUDED.total_deductions,
                net_pay = EXCLUDED.net_pay,
                ni_employer = EXCLUDED.ni_employer,
                pension_employer = EXCLUDED.pension_employer,
                total_employer_cost = EXCLUDED.total_employer_cost,
                ytd_gross = EXCLUDED.ytd_gross,
                ytd_tax = EXCLUDED.ytd_tax,
                ytd_ni = EXCLUDED.ytd_ni,
                ytd_pension = EXCLUDED.ytd_pension,
                ytd_net = EXCLUDED.ytd_net,
                earnings_json = EXCLUDED.earnings_json,
                deductions_json = EXCLUDED.deductions_json,
                calculated_at = EXCLUDED.calculated_at,
                updated_at = EXCLUDED.updated_at
        """), {
            "rid": run_row["id"], "eid": emp["id"], "bid": run_row["branch_id"],
            "pl":  run_row["period_label"],
            "ps":  run_row["period_start"], "pe": run_row["period_end"],
            "pd":  pay_date,
            "name": emp["full_name"] or "",
            "num":  emp["employee_number"] or "",
            "tc":   emp["tax_code"] or "1257L",
            "nin":  emp["national_insurance"] or "",
            "bp":   calc["basic_pay"],
            "gp":   calc["gross_pay"], "tx": calc["taxable_pay"],
            "tax":  calc["tax_deduction"], "ni_e": calc["ni_employee"],
            "pen_e": calc["pension_employee"],
            "td":   calc["total_deductions"],
            "np":   calc["net_pay"],
            "ni_er": calc["ni_employer"], "pen_er": calc["pension_employer"],
            "tec":  calc["total_employer_cost"],
            "ytg":  ytd_g, "ytt": ytd_t, "ytn": ytd_n, "ytp": ytd_p, "ytnp": ytd_np,
            "earn": _json(calc["earnings_lines"]),
            "deduct": _json(calc["deduction_lines"]),
            "now":  now,
        })
        count += 1
    await _refresh_run_totals(db, run_row["id"])
    return count


@router.post("/runs", status_code=201)
async def create_run(body: RunIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Create a payroll run + auto-generate a DRAFT payslip per active
    employee in the branch."""
    _require_write(ctx)
    if body.year < 2020 or body.year > 2099:
        raise HTTPException(400, detail="year must be 2020-2099")
    if body.month < 1 or body.month > 12:
        raise HTTPException(400, detail="month must be 1-12")

    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    from shital.core.fabrics.database import SessionLocal

    branch_id = (body.branch_id or "main").strip() or "main"
    period_start = date(body.year, body.month, 1)
    period_end   = date(body.year, body.month, monthrange(body.year, body.month)[1])
    pay_date     = date.fromisoformat(body.pay_date) if body.pay_date.strip() else period_end
    period_label = f"{body.year:04d}-{body.month:02d}"
    now = datetime.now(UTC)
    user = getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or ""

    async with SessionLocal() as db:
        try:
            run_row = (await db.execute(text("""
                INSERT INTO payroll_runs
                    (branch_id, period, run_date, status,
                     period_year, period_month, period_label,
                     period_start, period_end, pay_date,
                     processed_by, notes, idempotency_key,
                     created_at, updated_at)
                VALUES
                    (:bid, :pl, :rd, 'DRAFT',
                     :yr, :mn, :pl,
                     :ps, :pe, :pdy,
                     :user, :notes, :idem,
                     :now, :now)
                RETURNING *
            """), {
                "bid": branch_id, "pl": period_label, "rd": now.date(),
                "yr": body.year, "mn": body.month,
                "ps": period_start, "pe": period_end, "pdy": pay_date,
                "user": user, "notes": body.notes,
                "idem": f"payroll-{branch_id}-{period_label}",
                "now": now,
            })).mappings().first()
        except IntegrityError as exc:
            await db.rollback()
            raise HTTPException(409, detail=(
                f"Payroll run already exists for {branch_id} {period_label}"
            )) from exc
        if run_row is None:
            raise HTTPException(500, detail="Insert returned no row")

        await _generate_payslips(db, run_row, body.employee_ids)
        await db.commit()
        return await _get_run_with_payslips(db, str(run_row["id"]))


@router.put("/runs/{run_id}")
async def update_run(run_id: str, body: RunIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    pay_date = date.fromisoformat(body.pay_date) if body.pay_date.strip() else None
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM payroll_runs WHERE id = :id"), {"id": run_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Payroll run not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be edited (status={row['status']})")
        await db.execute(text("""
            UPDATE payroll_runs
            SET pay_date = COALESCE(:pdy, pay_date),
                notes    = :notes,
                updated_at = NOW()
            WHERE id = :id
        """), {"pdy": pay_date, "notes": body.notes, "id": run_id})
        await db.commit()
        return await _get_run_with_payslips(db, run_id)


@router.post("/runs/{run_id}/regenerate")
async def regenerate_run(run_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    """Re-calculate all DRAFT payslips in this run from the current
    employee records."""
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        run_row = (await db.execute(
            text("SELECT * FROM payroll_runs WHERE id = :id"), {"id": run_id},
        )).mappings().first()
        if not run_row:
            raise HTTPException(404, detail="Payroll run not found")
        if run_row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be regenerated (status={run_row['status']})")
        emps = (await db.execute(
            text("SELECT employee_id::text AS eid FROM payslips WHERE payroll_run_id = :id"),
            {"id": run_id},
        )).mappings().all()
        emp_ids = [r["eid"] for r in emps]
        await _generate_payslips(db, run_row, emp_ids)
        await db.commit()
        return await _get_run_with_payslips(db, run_id)


@router.post("/runs/{run_id}/finalize")
async def finalize_run(run_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    user = getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or ""
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM payroll_runs WHERE id = :id"), {"id": run_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Payroll run not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Expected DRAFT, got {row['status']}")
        await _refresh_run_totals(db, run_id)
        await db.execute(text("""
            UPDATE payroll_runs
            SET status='FINALIZED', finalised_at=:now, finalised_by=:user, updated_at=:now
            WHERE id=:id
        """), {"id": run_id, "now": datetime.now(UTC), "user": user})
        await db.execute(text("""
            UPDATE payslips SET status='FINALIZED', updated_at=NOW()
            WHERE payroll_run_id=:id AND status='DRAFT'
        """), {"id": run_id})
        await db.commit()
        return await _get_run_with_payslips(db, run_id)


@router.post("/runs/{run_id}/mark-paid")
async def mark_run_paid(run_id: str, body: MarkPaidIn, ctx: CurrentSpace) -> dict[str, Any]:
    """Mark FINALIZED run as PAID and post the wages journal:

        DR Wages & Salaries (5200)   total_gross
        DR Employer NI       (5210)   total_employer_ni
        DR Employer Pension  (5220)   total_employer_pension
            CR Bank          (1000)   total_net
            CR PAYE/NI Owed  (2200)   total_tax + total_ni + total_employer_ni
            CR Pension Owed  (2210)   total_pension + total_employer_pension
    """
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    try:
        from shital.services import gl  # ships with the financial-stack PR
    except ImportError:
        gl = None  # GL posting is skipped; payroll still pays out cleanly
    user = getattr(ctx, "user_email", "") or getattr(ctx, "user_id", "") or ""
    async with SessionLocal() as db:
        run_row = (await db.execute(
            text("SELECT * FROM payroll_runs WHERE id = :id"), {"id": run_id},
        )).mappings().first()
        if not run_row:
            raise HTTPException(404, detail="Payroll run not found")
        if run_row["status"] != "FINALIZED":
            raise HTTPException(409, detail=f"Expected FINALIZED, got {run_row['status']}")

        now = datetime.now(UTC)
        await db.execute(text("""
            UPDATE payroll_runs
            SET status='PAID', paid_at=:now, completed_at=:now, updated_at=:now
            WHERE id=:id
        """), {"id": run_id, "now": now})
        await db.execute(text("""
            UPDATE payslips
            SET status='PAID', paid_at=:now,
                payment_method=:m, payment_ref=:r,
                updated_at=:now
            WHERE payroll_run_id=:id AND status='FINALIZED'
        """), {"id": run_id, "now": now, "m": body.payment_method, "r": body.payment_ref})

        if gl is None:
            await db.commit()
            return await _get_run_with_payslips(db, run_id)
        try:
            gross  = float(run_row["total_gross"] or 0)
            er_ni  = float(run_row["total_employer_ni"] or 0)
            er_pen = float(run_row["total_employer_pension"] or 0)
            net    = float(run_row["total_net"] or 0)
            ee_tax = float(run_row["total_tax"] or 0)
            ee_ni  = float(run_row["total_ni"] or 0)
            ee_pen = float(run_row["total_pension"] or 0)
            bank   = (body.bank_nominal_code or "").strip().upper() or gl.DEFAULT_BANK
            lines: list[dict[str, Any]] = []
            if gross > 0:
                lines.append({"nominal_code": "5200", "debit": gross, "credit": 0,
                              "description": f"Wages — {run_row['period_label']}"})
            if er_ni > 0:
                lines.append({"nominal_code": "5210", "debit": er_ni, "credit": 0,
                              "description": f"Employer NI — {run_row['period_label']}"})
            if er_pen > 0:
                lines.append({"nominal_code": "5220", "debit": er_pen, "credit": 0,
                              "description": f"Employer pension — {run_row['period_label']}"})
            if net > 0:
                lines.append({"nominal_code": bank, "debit": 0, "credit": net,
                              "description": f"Net pay — {run_row['period_label']}"})
            paye_ni_owed = ee_tax + ee_ni + er_ni
            if paye_ni_owed > 0:
                lines.append({"nominal_code": "2200", "debit": 0, "credit": paye_ni_owed,
                              "description": f"PAYE/NI owed — {run_row['period_label']}"})
            pen_owed = ee_pen + er_pen
            if pen_owed > 0:
                lines.append({"nominal_code": "2210", "debit": 0, "credit": pen_owed,
                              "description": f"Pension owed — {run_row['period_label']}"})
            if lines:
                await gl.post(
                    db,
                    branch_id=run_row["branch_id"],
                    entry_date=now.date(),
                    description=f"Payroll — {run_row['period_label']}",
                    reference=f"PAYROLL-{run_row['period_label']}",
                    source_type=gl.SOURCE_PAYROLL, source_id=run_id,
                    posted_by=user,
                    idempotency_key=f"gl-payroll-{run_id}",
                    lines=lines,
                )
        except Exception:
            import structlog
            structlog.get_logger().exception("payroll_mark_paid_gl_post_failed", run_id=run_id)

        await db.commit()
        return await _get_run_with_payslips(db, run_id)


@router.delete("/runs/{run_id}", status_code=204)
async def delete_run(run_id: str, ctx: CurrentSpace) -> None:
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT status FROM payroll_runs WHERE id = :id"), {"id": run_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Payroll run not found")
        if row["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be deleted (status={row['status']})")
        await db.execute(text("""
            UPDATE payroll_runs SET deleted_at=NOW(), updated_at=NOW() WHERE id=:id
        """), {"id": run_id})
        await db.commit()


# Payslips

@router.get("/payslips")
async def list_payslips(
    ctx: CurrentSpace,
    employee_id: str = "",
    branch_id: str = "",
    period_label: str = "",
    status: str = "",
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
    if employee_id.strip():
        where.append("employee_id = :eid")
        params["eid"] = employee_id.strip()
    if branch_id.strip():
        where.append("branch_id = :bid")
        params["bid"] = branch_id.strip()
    if period_label.strip():
        where.append("period_label = :pl")
        params["pl"] = period_label.strip()
    if status.strip():
        where.append("status = :st")
        params["st"] = status.strip().upper()
    sql_where = ("WHERE " + " AND ".join(where)) if where else ""

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT * FROM payslips {sql_where}
            ORDER BY pay_date DESC, period_label DESC, employee_name
            LIMIT :limit OFFSET :offset
        """), params)).mappings().all()
        total = (await db.execute(
            text(f"SELECT COUNT(*) AS c FROM payslips {sql_where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )).scalar() or 0
    return {
        "items":    [_row(r) for r in rows],
        "total":    int(total),
        "page":     page,
        "per_page": per_page,
    }


@router.get("/payslips/{payslip_id}")
async def get_payslip(payslip_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(
            text("SELECT * FROM payslips WHERE id = :id"), {"id": payslip_id},
        )).mappings().first()
        if not row:
            raise HTTPException(404, detail="Payslip not found")
    return _row(row)


@router.put("/payslips/{payslip_id}")
async def update_payslip(payslip_id: str, body: PayslipOverride, ctx: CurrentSpace) -> dict[str, Any]:
    """Override DRAFT payslip fields and recompute deductions."""
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    from shital.services import payroll_calc

    async with SessionLocal() as db:
        ps = (await db.execute(
            text("SELECT * FROM payslips WHERE id = :id"), {"id": payslip_id},
        )).mappings().first()
        if not ps:
            raise HTTPException(404, detail="Payslip not found")
        if ps["status"] != "DRAFT":
            raise HTTPException(409, detail=f"Only DRAFT can be edited (status={ps['status']})")

        emp = (await db.execute(text("""
            SELECT pension_enrolled, pension_employee_pct, pension_employer_pct
            FROM   employees WHERE id = :id
        """), {"id": ps["employee_id"]})).mappings().first()

        overtime = float(body.overtime_pay)     if body.overtime_pay     is not None else float(ps["overtime_pay"] or 0)
        bonus    = float(body.bonus_pay)        if body.bonus_pay        is not None else float(ps["bonus_pay"]    or 0)
        other    = float(body.other_pay)        if body.other_pay        is not None else float(ps["other_pay"]    or 0)
        student  = float(body.student_loan)     if body.student_loan     is not None else float(ps["student_loan"] or 0)
        other_d  = float(body.other_deductions) if body.other_deductions is not None else float(ps["other_deductions"] or 0)
        basic    = float(body.basic_pay)        if body.basic_pay        is not None else float(ps["basic_pay"]    or 0)

        calc = payroll_calc.calculate(
            annual_salary=basic * 12,
            overtime_pay=overtime, bonus_pay=bonus, other_pay=other,
            other_deductions=other_d, student_loan=student,
            tax_code=ps["tax_code"] or "1257L",
            pension_employee_pct=float((emp or {}).get("pension_employee_pct") or 0),
            pension_employer_pct=float((emp or {}).get("pension_employer_pct") or 0),
            pension_enrolled=bool((emp or {}).get("pension_enrolled")),
        )

        await db.execute(text("""
            UPDATE payslips SET
                basic_pay        = :bp,
                overtime_pay     = :op,
                bonus_pay        = :bonus,
                other_pay        = :other,
                gross_pay        = :gp,
                taxable_pay      = :tx,
                tax_deduction    = :tax,
                ni_employee      = :ni,
                pension_employee = :pen,
                student_loan     = :sl,
                other_deductions = :od,
                total_deductions = :td,
                net_pay          = :np,
                ni_employer      = :nier,
                pension_employer = :pener,
                total_employer_cost = :tec,
                earnings_json    = CAST(:earn AS jsonb),
                deductions_json  = CAST(:deduct AS jsonb),
                notes            = COALESCE(:notes, notes),
                calculated_at    = NOW(),
                updated_at       = NOW()
            WHERE id = :id
        """), {
            "id": payslip_id,
            "bp": basic, "op": overtime, "bonus": bonus, "other": other,
            "gp": calc["gross_pay"], "tx": calc["taxable_pay"],
            "tax": calc["tax_deduction"], "ni": calc["ni_employee"],
            "pen": calc["pension_employee"],
            "sl": student, "od": other_d,
            "td": calc["total_deductions"], "np": calc["net_pay"],
            "nier": calc["ni_employer"], "pener": calc["pension_employer"],
            "tec":  calc["total_employer_cost"],
            "earn": _json(calc["earnings_lines"]),
            "deduct": _json(calc["deduction_lines"]),
            "notes": body.notes,
        })
        await _refresh_run_totals(db, str(ps["payroll_run_id"]))
        await db.commit()
        return await get_payslip(payslip_id, ctx)


@router.post("/payslips/{payslip_id}/mark-sent")
async def mark_payslip_sent(payslip_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_write(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE payslips SET sent_at=NOW(), updated_at=NOW() WHERE id=:id
        """), {"id": payslip_id})
        await db.commit()
    return await get_payslip(payslip_id, ctx)


@router.get("/employees/{employee_id}/payslips")
async def employee_payslips(employee_id: str, ctx: CurrentSpace, limit: int = 36) -> dict[str, Any]:
    _require_read(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT * FROM payslips WHERE employee_id = :eid
            ORDER BY period_end DESC LIMIT :limit
        """), {"eid": employee_id, "limit": max(1, min(limit, 120))})).mappings().all()
    return {"items": [_row(r) for r in rows]}
