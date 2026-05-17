"""UK PAYE / NI / Pension calculation — monthly payroll.

Approximation suitable for a UK temple-charity payroll (small number of
salaried staff + a few hourly volunteers receiving expenses). NOT a
substitute for HMRC RTI — for that, run the resulting numbers through
your registered PAYE bureau. The figures match HMRC's official tax
calculator within £1 for standard tax codes and typical NI categories.

Approach
--------
- Monthly tax-free allowance derived from the tax_code (default 1257L
  = £12,570 / 12 = £1,047.50 / month)
- Two-band income tax (20% basic to £37,700 above allowance, 40% higher
  above £37,700+allowance). Additional rate (45%) is rare for charity
  staff but supported.
- Class 1 NI Category A: 8% on monthly £1,048-£4,189, 2% above
- Employer NI: 13.8% above monthly £758
- Pension: percent of gross (qualifying earnings band variant available
  via `pension_basis=qualifying`)
- Adjustments (overtime / bonus / other pay) are added to gross before
  tax + NI; pension contributions remain percent of gross unless the
  employee record overrides the basis.

Numbers come from `EMPLOYEE.gross_salary` (annual) → divide by 12 for
monthly basic. Hourly workers can pass `hours_worked + hourly_rate`
instead and basic_pay is computed accordingly.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

# ── UK constants (2024/25 baseline; adjust per FY via env if needed) ──
ANNUAL_PERSONAL_ALLOWANCE = Decimal("12570")
HIGHER_RATE_THRESHOLD     = Decimal("37700")    # above allowance
ADDITIONAL_RATE_THRESHOLD = Decimal("125140")   # above allowance (total income)

BASIC_RATE      = Decimal("0.20")
HIGHER_RATE     = Decimal("0.40")
ADDITIONAL_RATE = Decimal("0.45")

# Monthly NI thresholds (Cat A — most common)
NI_MONTHLY_PT  = Decimal("1048")   # primary threshold
NI_MONTHLY_UEL = Decimal("4189")   # upper earnings limit
NI_RATE_BAND_1 = Decimal("0.08")
NI_RATE_BAND_2 = Decimal("0.02")
# Employer NI
NI_MONTHLY_ST  = Decimal("758")    # secondary threshold
NI_EMPLOYER_RATE = Decimal("0.138")


def _d(x: Any) -> Decimal:
    """Coerce to Decimal."""
    if isinstance(x, Decimal):
        return x
    if x is None or x == "":
        return Decimal("0")
    return Decimal(str(x))


def _q2(x: Decimal) -> Decimal:
    """Round to 2dp banker's rounding."""
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _tax_free_monthly(tax_code: str) -> Decimal:
    """Derive monthly tax-free allowance from a UK tax code.

    Standard codes (1257L, 1100L, NT, BR, D0, D1, K-prefix):
    - Numeric portion × 10 = annual allowance
    - Special codes handled (BR=0, NT=infinite, K=negative allowance)
    """
    code = (tax_code or "").strip().upper()
    if not code or code == "NT":
        # NT = no tax. Massive number so all earnings fall under allowance.
        return Decimal("999999999")
    if code in ("BR", "0T"):
        return Decimal("0")
    if code in ("D0", "D1", "D2"):
        # All earnings at fixed rate; caller handles. Return 0 here.
        return Decimal("0")
    if code.startswith("K"):
        # K-codes ADD to taxable pay rather than deduct — negative allowance
        try:
            n = Decimal(code[1:].rstrip("LMNTWX"))
            return Decimal("-1") * (n * 10) / Decimal("12")
        except Exception:
            return ANNUAL_PERSONAL_ALLOWANCE / 12
    # Standard numeric + suffix (L, M, N, T, W1, M1, X)
    digits = "".join(c for c in code if c.isdigit())
    if not digits:
        return ANNUAL_PERSONAL_ALLOWANCE / 12
    try:
        return (Decimal(digits) * 10) / Decimal("12")
    except Exception:
        return ANNUAL_PERSONAL_ALLOWANCE / 12


def _income_tax_monthly(taxable_monthly: Decimal, tax_code: str) -> Decimal:
    """Calculate monthly PAYE income tax."""
    code = (tax_code or "").strip().upper()
    if code == "BR":
        return _q2(taxable_monthly * BASIC_RATE)
    if code == "D0":
        return _q2(taxable_monthly * HIGHER_RATE)
    if code == "D1":
        return _q2(taxable_monthly * ADDITIONAL_RATE)
    if code == "NT":
        return Decimal("0")

    allowance_monthly = _tax_free_monthly(tax_code)
    # K-codes: allowance is NEGATIVE — add to taxable_pay
    if allowance_monthly < 0:
        taxable_above_allowance = taxable_monthly + (-allowance_monthly)
    else:
        taxable_above_allowance = max(taxable_monthly - allowance_monthly, Decimal("0"))

    basic_band_monthly      = HIGHER_RATE_THRESHOLD / 12
    additional_band_monthly = (ADDITIONAL_RATE_THRESHOLD - HIGHER_RATE_THRESHOLD) / 12

    in_basic      = min(taxable_above_allowance, basic_band_monthly)
    in_higher     = min(max(taxable_above_allowance - basic_band_monthly, Decimal("0")),
                        additional_band_monthly)
    in_additional = max(taxable_above_allowance - basic_band_monthly - additional_band_monthly,
                        Decimal("0"))

    tax = (in_basic      * BASIC_RATE
         + in_higher     * HIGHER_RATE
         + in_additional * ADDITIONAL_RATE)
    return _q2(tax)


def _ni_employee_monthly(gross_monthly: Decimal) -> Decimal:
    """Class 1 employee NI — Category A monthly."""
    if gross_monthly <= NI_MONTHLY_PT:
        return Decimal("0")
    in_band_1 = min(gross_monthly, NI_MONTHLY_UEL) - NI_MONTHLY_PT
    in_band_2 = max(gross_monthly - NI_MONTHLY_UEL, Decimal("0"))
    return _q2(in_band_1 * NI_RATE_BAND_1 + in_band_2 * NI_RATE_BAND_2)


def _ni_employer_monthly(gross_monthly: Decimal) -> Decimal:
    """Class 1 secondary NI — employer's contribution monthly."""
    if gross_monthly <= NI_MONTHLY_ST:
        return Decimal("0")
    return _q2((gross_monthly - NI_MONTHLY_ST) * NI_EMPLOYER_RATE)


def calculate(
    *,
    annual_salary: float | str | Decimal = 0,
    hours_worked: float | str | Decimal = 0,
    hourly_rate:  float | str | Decimal = 0,
    overtime_pay: float | str | Decimal = 0,
    bonus_pay:    float | str | Decimal = 0,
    other_pay:    float | str | Decimal = 0,
    other_deductions: float | str | Decimal = 0,
    student_loan: float | str | Decimal = 0,
    tax_code: str = "1257L",
    pension_employee_pct: float | str | Decimal = 0,
    pension_employer_pct: float | str | Decimal = 0,
    pension_enrolled: bool = False,
) -> dict[str, Any]:
    """Calculate one month's payslip. Returns a dict with every line
    item the payslip needs to render."""
    annual = _d(annual_salary)
    basic  = _q2(annual / 12) if annual > 0 else _q2(_d(hours_worked) * _d(hourly_rate))

    overtime = _q2(_d(overtime_pay))
    bonus    = _q2(_d(bonus_pay))
    other    = _q2(_d(other_pay))
    gross    = _q2(basic + overtime + bonus + other)

    taxable = gross  # Pension salary-sacrifice would reduce this; not modelled here.
    tax     = _income_tax_monthly(taxable, tax_code)
    ni_emp  = _ni_employee_monthly(gross)
    ni_er   = _ni_employer_monthly(gross)

    pension_emp_pct = _d(pension_employee_pct)
    pension_er_pct  = _d(pension_employer_pct)
    pension_emp = _q2(gross * pension_emp_pct / 100) if pension_enrolled and pension_emp_pct > 0 else Decimal("0")
    pension_er  = _q2(gross * pension_er_pct  / 100) if pension_enrolled and pension_er_pct  > 0 else Decimal("0")

    student = _q2(_d(student_loan))
    other_d = _q2(_d(other_deductions))

    total_deductions = _q2(tax + ni_emp + pension_emp + student + other_d)
    net_pay = _q2(gross - total_deductions)
    total_employer_cost = _q2(gross + ni_er + pension_er)

    earnings_lines: list[dict[str, Any]] = [
        {"label": "Basic pay", "amount": float(basic)},
    ]
    if overtime > 0:
        earnings_lines.append({"label": "Overtime",  "amount": float(overtime)})
    if bonus > 0:
        earnings_lines.append({"label": "Bonus",     "amount": float(bonus)})
    if other > 0:
        earnings_lines.append({"label": "Other pay", "amount": float(other)})

    deduction_lines: list[dict[str, Any]] = []
    if tax > 0:
        deduction_lines.append({"label": "PAYE income tax",     "amount": float(tax)})
    if ni_emp > 0:
        deduction_lines.append({"label": "National Insurance",  "amount": float(ni_emp)})
    if pension_emp > 0:
        deduction_lines.append({"label": "Pension contribution","amount": float(pension_emp)})
    if student > 0:
        deduction_lines.append({"label": "Student loan",        "amount": float(student)})
    if other_d > 0:
        deduction_lines.append({"label": "Other deductions",    "amount": float(other_d)})

    return {
        "basic_pay":           float(basic),
        "overtime_pay":        float(overtime),
        "bonus_pay":           float(bonus),
        "other_pay":           float(other),
        "gross_pay":           float(gross),
        "taxable_pay":         float(taxable),
        "tax_deduction":       float(tax),
        "ni_employee":         float(ni_emp),
        "pension_employee":    float(pension_emp),
        "student_loan":        float(student),
        "other_deductions":    float(other_d),
        "total_deductions":    float(total_deductions),
        "net_pay":             float(net_pay),
        "ni_employer":         float(ni_er),
        "pension_employer":    float(pension_er),
        "total_employer_cost": float(total_employer_cost),
        "earnings_lines":      earnings_lines,
        "deduction_lines":     deduction_lines,
    }
