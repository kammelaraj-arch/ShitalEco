"""HR Alerts — compliance-critical reminders for staff management.

Single endpoint that returns every employee record that needs attention:
- Visa expiring within X days (immigration compliance)
- DBS check expiring or overdue (safeguarding compliance)
- Right-to-work check overdue (Home Office prevention-of-illegal-working duty)
- Probation period ending this month (HR review trigger)
- Contract end date approaching (fixed-term renewal decisions)
- Missing required fields (NI / tax_code / next-of-kin) on active employees

Each alert carries `severity` (red/amber/green), `due_in_days`, and a
human-readable `message`. The admin page renders them as a single
dashboard prioritised by severity, so trustees see the urgent items first.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from shital.api.deps import CurrentSpace

router = APIRouter(prefix="/hr", tags=["hr"])

PRIVILEGED = {"SUPER_ADMIN", "ADMIN", "HR_MANAGER"}


def _require(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Privileged role required")


def _days_until(d: date | None) -> int | None:
    if not d:
        return None
    return (d - date.today()).days


def _severity(due_days: int | None, *, red_within: int = 30,
              amber_within: int = 90) -> str:
    if due_days is None:
        return "green"
    if due_days < 0:
        return "red"
    if due_days <= red_within:
        return "red"
    if due_days <= amber_within:
        return "amber"
    return "green"


@router.get("/alerts")
async def hr_alerts(ctx: CurrentSpace, branch_id: str = "",
                    include_green: bool = False) -> dict[str, Any]:
    """Return every HR-compliance alert for active employees. Sorted by
    severity (red first) then by due date ascending. Stats counters
    let the dashboard show a count-by-severity tile."""
    _require(ctx)
    # Same root cause as the leave-page bug from PR #100: `dbs_check_status`,
    # `visa_type`, `share_code_expiry` etc are ALTERed in via
    # `_ensure_hr_tables()` (lazy on first POST), not in main.py's
    # `_patch_schema()` (startup). On a backend that hasn't received any
    # leave/timesheet POST yet, those columns are missing and the SELECT
    # below returns "column does not exist". Calling _ensure_hr_tables()
    # here makes the GET self-healing; idempotent + cheap on subsequent calls.
    from shital.capabilities.hr.capabilities import _ensure_hr_tables
    await _ensure_hr_tables()

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    where: list[str] = ["is_active = true", "deleted_at IS NULL"]
    params: dict[str, Any] = {}
    if branch_id.strip():
        where.append("branch_id = :bid")
        params["bid"] = branch_id.strip()
    sql_where = " AND ".join(where)

    async with SessionLocal() as db:
        emps = (await db.execute(text(f"""
            SELECT id, COALESCE(full_name, '') AS full_name, employee_number,
                   branch_id, job_title, department,
                   employment_type, start_date, end_date, probation_end_date,
                   visa_expiry, visa_type, share_code_expiry,
                   dbs_check_date, dbs_check_expiry, dbs_check_status,
                   rtw_check_date,
                   national_insurance, tax_code,
                   next_of_kin_name, next_of_kin_phone
            FROM   employees
            WHERE  {sql_where}
            ORDER  BY full_name
        """), params)).mappings().all()

    alerts: list[dict[str, Any]] = []
    severity_count = {"red": 0, "amber": 0, "green": 0}

    for emp in emps:
        emp_id = str(emp["id"])
        name = emp["full_name"] or emp["employee_number"] or "Unnamed"

        def _add(kind: str, due_days: int | None, message: str, *,
                 ref_date: date | None = None, red_within: int = 30,
                 amber_within: int = 90) -> None:
            sev = _severity(due_days, red_within=red_within, amber_within=amber_within)
            if sev == "green" and not include_green:
                return
            severity_count[sev] += 1
            alerts.append({
                "employee_id":  emp_id,
                "employee_name": name,
                "employee_number": emp["employee_number"] or "",
                "branch_id":   emp["branch_id"],
                "job_title":   emp["job_title"] or "",
                "kind":        kind,
                "severity":    sev,
                "due_in_days": due_days,
                "ref_date":    ref_date.isoformat() if ref_date else None,
                "message":     message,
            })

        # Visa expiry — immigration compliance, highest priority
        if emp["visa_expiry"]:
            d = _days_until(emp["visa_expiry"])
            label = emp["visa_type"] or "Visa"
            _add(
                "visa_expiry", d,
                f"{label} expires {emp['visa_expiry'].isoformat()}"
                + (f" ({d} day{'s' if abs(d) != 1 else ''}"
                   f"{' ago' if d is not None and d < 0 else ' to go'})" if d is not None else ""),
                ref_date=emp["visa_expiry"],
                red_within=30, amber_within=90,
            )

        # Share code expiry (right-to-work check)
        if emp["share_code_expiry"]:
            d = _days_until(emp["share_code_expiry"])
            _add(
                "share_code_expiry", d,
                f"Right-to-work share code expires {emp['share_code_expiry'].isoformat()}",
                ref_date=emp["share_code_expiry"],
                red_within=14, amber_within=60,
            )

        # DBS check expiry — safeguarding
        if emp["dbs_check_expiry"]:
            d = _days_until(emp["dbs_check_expiry"])
            _add(
                "dbs_expiry", d,
                f"DBS check expires {emp['dbs_check_expiry'].isoformat()}",
                ref_date=emp["dbs_check_expiry"],
                red_within=30, amber_within=90,
            )
        elif emp["dbs_check_status"] in ("MISSING", "REQUIRED", ""):
            # No DBS at all for an active employee — depends on role, but
            # surface as amber.
            severity_count["amber"] += 1
            alerts.append({
                "employee_id":  emp_id,
                "employee_name": name,
                "employee_number": emp["employee_number"] or "",
                "branch_id":   emp["branch_id"],
                "job_title":   emp["job_title"] or "",
                "kind":        "dbs_missing",
                "severity":    "amber",
                "due_in_days": None,
                "ref_date":    None,
                "message":     "No DBS check recorded — confirm whether role requires one",
            })

        # RTW check — must be on file before start_date + every 12 months
        # for time-limited workers. Surface if missing for any active emp.
        if not emp["rtw_check_date"]:
            severity_count["amber"] += 1
            alerts.append({
                "employee_id":  emp_id,
                "employee_name": name,
                "employee_number": emp["employee_number"] or "",
                "branch_id":   emp["branch_id"],
                "job_title":   emp["job_title"] or "",
                "kind":        "rtw_missing",
                "severity":    "amber",
                "due_in_days": None,
                "ref_date":    None,
                "message":     "No right-to-work check recorded (Home Office §8)",
            })

        # Probation ending
        if emp["probation_end_date"]:
            d = _days_until(emp["probation_end_date"])
            if d is not None and d <= 60:
                _add(
                    "probation_ending", d,
                    f"Probation ends {emp['probation_end_date'].isoformat()} — schedule review",
                    ref_date=emp["probation_end_date"],
                    red_within=14, amber_within=60,
                )

        # Fixed-term contract ending
        if emp["end_date"]:
            d = _days_until(emp["end_date"])
            if d is not None and d <= 120:
                _add(
                    "contract_ending", d,
                    f"Contract ends {emp['end_date'].isoformat()} — renew or release",
                    ref_date=emp["end_date"],
                    red_within=30, amber_within=120,
                )

        # Required-field gaps on FULL_TIME / PART_TIME employees
        if (emp["employment_type"] or "").upper() in ("FULL_TIME", "PART_TIME"):
            if not (emp["national_insurance"] or "").strip():
                severity_count["red"] += 1
                alerts.append({
                    "employee_id":  emp_id,
                    "employee_name": name,
                    "employee_number": emp["employee_number"] or "",
                    "branch_id":   emp["branch_id"],
                    "job_title":   emp["job_title"] or "",
                    "kind":        "missing_ni",
                    "severity":    "red",
                    "due_in_days": None,
                    "ref_date":    None,
                    "message":     "National Insurance number missing — required for payroll",
                })
            if not (emp["tax_code"] or "").strip():
                severity_count["red"] += 1
                alerts.append({
                    "employee_id":  emp_id,
                    "employee_name": name,
                    "employee_number": emp["employee_number"] or "",
                    "branch_id":   emp["branch_id"],
                    "job_title":   emp["job_title"] or "",
                    "kind":        "missing_tax_code",
                    "severity":    "red",
                    "due_in_days": None,
                    "ref_date":    None,
                    "message":     "Tax code missing — required for payroll",
                })
            if not (emp["next_of_kin_name"] or "").strip() or not (emp["next_of_kin_phone"] or "").strip():
                severity_count["amber"] += 1
                alerts.append({
                    "employee_id":  emp_id,
                    "employee_name": name,
                    "employee_number": emp["employee_number"] or "",
                    "branch_id":   emp["branch_id"],
                    "job_title":   emp["job_title"] or "",
                    "kind":        "missing_next_of_kin",
                    "severity":    "amber",
                    "due_in_days": None,
                    "ref_date":    None,
                    "message":     "Next-of-kin name / phone missing — required for emergency",
                })

    # Sort: red → amber → green, then by due_in_days asc (overdue first)
    sev_order = {"red": 0, "amber": 1, "green": 2}
    alerts.sort(key=lambda a: (
        sev_order.get(a["severity"], 9),
        a["due_in_days"] if a["due_in_days"] is not None else 99999,
    ))

    return {
        "alerts":  alerts,
        "count":   len(alerts),
        "by_severity": severity_count,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
