"""
Payroll Capabilities — UK PAYE, National Insurance, auto-enrolment pension.
All calculations use 2024/25 tax year thresholds.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import structlog
from pydantic import BaseModel

from shital.core.dna.registry import Fabric, capability
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()

# ─── 2024/25 Tax Year Constants ───────────────────────────────────────────────
PERSONAL_ALLOWANCE = Decimal("12570")
BASIC_RATE_LIMIT = Decimal("50270")
HIGHER_RATE_LIMIT = Decimal("125140")
BASIC_RATE = Decimal("0.20")
HIGHER_RATE = Decimal("0.40")
ADDITIONAL_RATE = Decimal("0.45")

NI_LOWER_MONTHLY = Decimal("1048")     # £12,570 / 12
NI_UPPER_MONTHLY = Decimal("4189")     # £50,270 / 12
NI_EMPLOYEE_MAIN = Decimal("0.08")
NI_EMPLOYEE_UPPER = Decimal("0.02")
NI_EMPLOYER_SECONDARY_MONTHLY = Decimal("758")   # £9,100 / 12
NI_EMPLOYER_RATE = Decimal("0.138")

PENSION_LOWER_MONTHLY = Decimal("520")   # £6,240 / 12
PENSION_UPPER_MONTHLY = Decimal("4189")  # £50,270 / 12
PENSION_EMPLOYEE_MIN = Decimal("0.05")
PENSION_EMPLOYER_MIN = Decimal("0.03")

MONTHS_PER_YEAR = Decimal("12")
TWO_DP = Decimal("0.01")


def _round(v: Decimal) -> Decimal:
    return v.quantize(TWO_DP, ROUND_HALF_UP)


def calculate_paye(monthly_gross: Decimal, tax_code: str) -> Decimal:
    """Calculate monthly PAYE income tax for standard L-suffix tax codes."""
    annual_gross = monthly_gross * MONTHS_PER_YEAR

    # Derive personal allowance from tax code (e.g. 1257L → £12,570)
    try:
        allowance = Decimal(str(int("".join(filter(str.isdigit, tax_code))) * 10))
    except (ValueError, TypeError):
        allowance = PERSONAL_ALLOWANCE

    # PA tapered above £100k
    if annual_gross > Decimal("100000"):
        taper = ((annual_gross - Decimal("100000")) / 2).quantize(TWO_DP)
        allowance = max(Decimal("0"), allowance - taper)

    taxable = max(Decimal("0"), annual_gross - allowance)

    tax = Decimal("0")
    if taxable <= (BASIC_RATE_LIMIT - allowance):
        tax = taxable * BASIC_RATE
    elif taxable <= (HIGHER_RATE_LIMIT - allowance):
        basic_band = BASIC_RATE_LIMIT - allowance
        tax = (basic_band * BASIC_RATE) + ((taxable - basic_band) * HIGHER_RATE)
    else:
        basic_band = BASIC_RATE_LIMIT - allowance
        higher_band = HIGHER_RATE_LIMIT - BASIC_RATE_LIMIT
        tax = (
            (basic_band * BASIC_RATE)
            + (higher_band * HIGHER_RATE)
            + ((taxable - basic_band - higher_band) * ADDITIONAL_RATE)
        )

    return _round(max(Decimal("0"), tax / MONTHS_PER_YEAR))


def calculate_employee_ni(monthly_gross: Decimal, ni_category: str) -> Decimal:
    """Calculate employee NI contribution for a monthly pay period."""
    if ni_category.upper() == "C":  # Over state pension age
        return Decimal("0")

    ni = Decimal("0")
    if monthly_gross > NI_LOWER_MONTHLY:
        main_earnings = min(monthly_gross, NI_UPPER_MONTHLY) - NI_LOWER_MONTHLY
        ni += main_earnings * NI_EMPLOYEE_MAIN
    if monthly_gross > NI_UPPER_MONTHLY:
        ni += (monthly_gross - NI_UPPER_MONTHLY) * NI_EMPLOYEE_UPPER

    return _round(ni)


def calculate_employer_ni(monthly_gross: Decimal) -> Decimal:
    """Calculate employer NI (secondary) contribution."""
    if monthly_gross <= NI_EMPLOYER_SECONDARY_MONTHLY:
        return Decimal("0")
    return _round((monthly_gross - NI_EMPLOYER_SECONDARY_MONTHLY) * NI_EMPLOYER_RATE)


def calculate_pension(monthly_gross: Decimal, scheme: str) -> tuple[Decimal, Decimal]:
    """Return (employee_pension, employer_pension) for auto-enrolment."""
    if scheme == "NONE":
        return Decimal("0"), Decimal("0")
    qualifying = max(Decimal("0"), min(monthly_gross, PENSION_UPPER_MONTHLY) - PENSION_LOWER_MONTHLY)
    employee = _round(qualifying * PENSION_EMPLOYEE_MIN)
    employer = _round(qualifying * PENSION_EMPLOYER_MIN)
    return employee, employer


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class PayslipCalculationInput(BaseModel):
    employee_id: str
    monthly_gross: str
    tax_code: str = "1257L"
    ni_category: str = "A"
    pension_scheme: str = "AUTO_ENROLMENT"
    ytd_gross: str = "0.00"
    ytd_tax: str = "0.00"
    ytd_ni: str = "0.00"


class RunPayrollInput(BaseModel):
    period: str  # "2024-01"
    idempotency_key: str
    dry_run: bool = False


# ─── Capabilities ─────────────────────────────────────────────────────────────

@capability(
    name="calculate_payslip",
    description="Calculate UK PAYE tax, National Insurance, and auto-enrolment pension for one employee for a monthly pay period. Returns gross, tax, NI, pension, and net pay.",
    fabric=Fabric.PAYROLL,
    requires=["payroll:read"],
    idempotent=True,
    tags=["payroll", "paye", "ni", "pension"],
)
async def calculate_payslip(ctx: DigitalSpace, data: PayslipCalculationInput) -> dict[str, Any]:
    ctx.require_permission("payroll:read")

    gross = Decimal(data.monthly_gross)
    tax = calculate_paye(gross, data.tax_code)
    emp_ni = calculate_employee_ni(gross, data.ni_category)
    er_ni = calculate_employer_ni(gross)
    emp_pension, er_pension = calculate_pension(gross, data.pension_scheme)

    # Deductions from employee's pay
    total_deductions = tax + emp_ni + emp_pension
    net = gross - total_deductions

    ytd_gross = Decimal(data.ytd_gross) + gross
    ytd_tax = Decimal(data.ytd_tax) + tax
    ytd_ni = Decimal(data.ytd_ni) + emp_ni

    return {
        "employee_id": data.employee_id,
        "gross_pay": str(gross),
        "income_tax": str(tax),
        "employee_ni": str(emp_ni),
        "employer_ni": str(er_ni),
        "pension_employee": str(emp_pension),
        "pension_employer": str(er_pension),
        "total_deductions": str(total_deductions),
        "net_pay": str(_round(net)),
        "ytd_gross": str(ytd_gross),
        "ytd_tax": str(ytd_tax),
        "ytd_ni": str(ytd_ni),
        "tax_code": data.tax_code,
        "ni_category": data.ni_category,
    }


@capability(
    name="run_payroll",
    description="Run payroll for all active employees in the branch for a given period (e.g. '2024-01'). Calculates PAYE, NI, pension for each employee. Use dry_run=true to preview without saving.",
    fabric=Fabric.PAYROLL,
    requires=["payroll:run"],
    human_in_loop=True,
    idempotent=True,
    tags=["payroll", "batch"],
    raci={"responsible": ["HR_MANAGER"], "accountable": ["TRUSTEE"], "informed": ["ACCOUNTANT"]},
)
async def run_payroll(ctx: DigitalSpace, data: RunPayrollInput) -> dict[str, Any]:
    ctx.require_permission("payroll:run")

    import uuid
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    log = logger.bind(**ctx.log_context)

    async with SessionLocal() as db:
        # Idempotency check
        existing = await db.execute(
            text("SELECT id FROM payroll_runs WHERE idempotency_key = :key"),
            {"key": data.idempotency_key},
        )
        if existing.scalar():
            raise IdempotencyError(f"Payroll run with key {data.idempotency_key} already exists")

        # Get active employees
        emp_result = await db.execute(
            text("""
                SELECT e.id, e.salary, e.tax_code, e.ni_number,
                       e.employment_type,
                       COALESCE(e.salary, 0) AS monthly_gross
                FROM employees e
                WHERE e.branch_id = :bid AND e.is_active = true
                  AND e.employment_type IN ('FULL_TIME', 'PART_TIME')
                  AND e.deleted_at IS NULL
            """),
            {"bid": ctx.branch_id},
        )
        employees = emp_result.mappings().all()

    payslips = []
    total_gross = Decimal("0")
    total_net = Decimal("0")
    total_tax = Decimal("0")
    total_ni = Decimal("0")
    total_pension = Decimal("0")

    for emp in employees:
        salary = Decimal(str(emp["monthly_gross"] or 0))
        if emp["employment_type"] == "FULL_TIME":
            monthly = (salary / 12).quantize(TWO_DP) if salary > 100 else salary
        else:
            monthly = salary  # assume already monthly for part-time

        tax = calculate_paye(monthly, emp.get("tax_code") or "1257L")
        emp_ni = calculate_employee_ni(monthly, "A")
        er_ni = calculate_employer_ni(monthly)
        emp_p, er_p = calculate_pension(monthly, "AUTO_ENROLMENT")
        net = monthly - tax - emp_ni - emp_p

        total_gross += monthly
        total_net += net
        total_tax += tax
        total_ni += emp_ni
        total_pension += emp_p

        payslips.append({
            "employee_id": emp["id"],
            "gross": str(_round(monthly)),
            "tax": str(tax),
            "ni": str(emp_ni),
            "employer_ni": str(er_ni),
            "pension_emp": str(emp_p),
            "pension_er": str(er_p),
            "net": str(_round(net)),
        })

    run_id = str(uuid.uuid4())
    if not data.dry_run:
        now = datetime.utcnow()
        async with SessionLocal() as db:
            await db.execute(
                text("""
                    INSERT INTO payroll_runs
                    (id, branch_id, period, run_date, status, processed_by,
                     completed_at, total_gross, total_net, total_tax,
                     total_ni, total_pension, idempotency_key, created_at, updated_at)
                    VALUES (:id, :bid, :period, :run_date, 'COMPLETED', :user,
                            :now, :tg, :tn, :tt, :tni, :tp, :ikey, :now, :now)
                """),
                {
                    "id": run_id, "bid": ctx.branch_id, "period": data.period,
                    "run_date": now.date(), "user": ctx.user_id, "now": now,
                    "tg": str(total_gross), "tn": str(_round(total_net)),
                    "tt": str(total_tax), "tni": str(total_ni), "tp": str(total_pension),
                    "ikey": data.idempotency_key,
                },
            )
            await db.commit()

        log.info("payroll_run_completed", run_id=run_id, employees=len(payslips), period=data.period)

    return {
        "payroll_run_id": run_id,
        "period": data.period,
        "dry_run": data.dry_run,
        "employee_count": len(payslips),
        "total_gross": str(_round(total_gross)),
        "total_net": str(_round(total_net)),
        "total_tax": str(total_tax),
        "total_ni": str(total_ni),
        "total_pension": str(total_pension),
        "payslips": payslips,
    }


from shital.core.fabrics.errors import IdempotencyError  # noqa: E402 — avoid circular
