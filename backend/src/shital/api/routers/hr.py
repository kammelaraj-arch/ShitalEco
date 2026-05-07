"""HR router."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace
from shital.capabilities.hr.capabilities import (
    CreateEmployeeInput,
    LeaveRequestInput,
    TimeEntryInput,
    approve_leave,
    create_employee,
    get_org_chart,
    list_employees,
    log_time,
    request_leave,
)

router = APIRouter(prefix="/hr", tags=["hr"])


@router.get("/employees")
async def employees(ctx: CurrentSpace, department: str = "", employment_type: str = "",
                    is_active: bool = True, limit: int = 50, cursor: str = ""):
    return await list_employees(ctx, department, employment_type, is_active, limit, cursor)


@router.post("/employees")
async def create_emp(body: CreateEmployeeInput, ctx: CurrentSpace):
    return await create_employee(ctx, body)


@router.get("/employees/search")
async def search_employees(ctx: CurrentSpace, q: str = "", id: str = "", limit: int = 20):
    """Typeahead search for employees by name, or look up a single employee by id."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        if id:
            result = await db.execute(text("""
                SELECT id, COALESCE(full_name, '') AS full_name,
                       job_title AS role,
                       COALESCE(photo_url, '') AS photo_url
                FROM employees
                WHERE id = :id AND branch_id = :bid AND deleted_at IS NULL
                LIMIT 1
            """), {"id": id, "bid": ctx.branch_id})
        else:
            result = await db.execute(text("""
                SELECT id, COALESCE(full_name, '') AS full_name,
                       job_title AS role,
                       COALESCE(photo_url, '') AS photo_url
                FROM employees
                WHERE branch_id = :bid AND is_active = true AND deleted_at IS NULL
                  AND (full_name ILIKE :q OR job_title ILIKE :q)
                ORDER BY full_name
                LIMIT :limit
            """), {"bid": ctx.branch_id, "q": f"%{q}%", "limit": limit})
        rows = result.mappings().all()
    return {"items": [dict(r) for r in rows]}


class EmployeeUpdate(BaseModel):
    # Existing
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    role: str | None = None
    branch_id: str | None = None
    department: str | None = None
    employment_type: str | None = None
    start_date: str | None = None
    gross_salary: float | None = None
    national_insurance: str | None = None
    is_active: bool | None = None
    photo_url: str | None = None
    nationality: str | None = None
    right_to_work_type: str | None = None
    visa_number: str | None = None
    visa_expiry: str | None = None
    reporting_manager_id: str | None = None
    # Phase 1 additions — all optional so partial updates work as before
    visa_type: str | None = None
    visa_issue_date: str | None = None
    visa_sponsor_license: str | None = None
    share_code: str | None = None
    share_code_expiry: str | None = None
    date_of_birth: str | None = None
    gender: str | None = None
    personal_email: str | None = None
    emergency_phone: str | None = None
    next_of_kin_name: str | None = None
    next_of_kin_relationship: str | None = None
    next_of_kin_phone: str | None = None
    next_of_kin_email: str | None = None
    next_of_kin_address: str | None = None
    bank_sort_code: str | None = None
    bank_account_number: str | None = None
    bank_account_name: str | None = None
    pension_enrolled: bool | None = None
    pension_provider: str | None = None
    pension_employee_pct: float | None = None
    pension_employer_pct: float | None = None
    benefits_notes: str | None = None
    dbs_check_status: str | None = None
    dbs_check_date: str | None = None
    dbs_check_expiry: str | None = None
    dbs_certificate_number: str | None = None
    rtw_check_date: str | None = None
    rtw_check_reference: str | None = None
    p45_received: bool | None = None
    starter_declaration: str | None = None
    hours_per_week: float | None = None
    holiday_entitlement_days: float | None = None
    probation_end_date: str | None = None
    end_date: str | None = None
    leaving_reason: str | None = None
    qualifications_notes: str | None = None
    documents_held_notes: str | None = None


@router.put("/employees/{employee_id}")
async def update_emp(employee_id: str, body: EmployeeUpdate, ctx: CurrentSpace) -> dict[str, Any]:
    from datetime import date, datetime

    from sqlalchemy import text

    from shital.capabilities.hr.capabilities import (
        _coerce_volunteer_salary,
        _validate_employee_payload,
    )
    from shital.core.fabrics.database import SessionLocal

    # If we're changing employment_type or any required field, fetch the
    # current row and merge so validation runs against the resulting state.
    # This keeps partial updates working while preventing a half-edit from
    # leaving the row in an invalid state (e.g. switching to FULL_TIME but
    # NI still empty).
    needs_validation = any(v is not None for v in [
        body.employment_type, body.full_name, body.email, body.national_insurance,
        body.start_date, body.nationality, body.next_of_kin_name,
        body.next_of_kin_relationship, body.next_of_kin_phone,
    ])

    async with SessionLocal() as db:
        existing = (await db.execute(
            text("SELECT * FROM employees WHERE id = :eid"),
            {"eid": employee_id},
        )).mappings().first()
        if not existing:
            raise HTTPException(status_code=404, detail="Employee not found")

        if needs_validation:
            merged = {
                "employment_type": body.employment_type if body.employment_type is not None else existing["employment_type"],
                "full_name": body.full_name if body.full_name is not None else (existing.get("full_name") or ""),
                "email": body.email if body.email is not None else (existing.get("email") or ""),
                "ni_number": body.national_insurance if body.national_insurance is not None else (existing.get("national_insurance") or ""),
                "start_date": body.start_date if body.start_date is not None else (existing.get("start_date").isoformat() if existing.get("start_date") else ""),
                "nationality": body.nationality if body.nationality is not None else (existing.get("nationality") or ""),
                "next_of_kin_name": body.next_of_kin_name if body.next_of_kin_name is not None else (existing.get("next_of_kin_name") or ""),
                "next_of_kin_relationship": body.next_of_kin_relationship if body.next_of_kin_relationship is not None else (existing.get("next_of_kin_relationship") or ""),
                "next_of_kin_phone": body.next_of_kin_phone if body.next_of_kin_phone is not None else (existing.get("next_of_kin_phone") or ""),
            }
            _validate_employee_payload(**merged)

    # Build the SET clause. String + bool fields can be set directly; DATE
    # and float fields need coercion; aliases (role → job_title, reporting
    # _manager_id → manager_id) are mapped explicitly.
    sets: list[str] = []
    params: dict[str, Any] = {"eid": employee_id, "now": datetime.utcnow()}

    direct_str_or_bool = [
        "full_name", "email", "phone", "address", "branch_id", "department",
        "employment_type", "is_active", "photo_url", "nationality",
        "right_to_work_type", "visa_number", "national_insurance",
        "visa_type", "visa_sponsor_license", "share_code",
        "gender", "personal_email", "emergency_phone",
        "next_of_kin_name", "next_of_kin_relationship", "next_of_kin_phone",
        "next_of_kin_email", "next_of_kin_address",
        "bank_sort_code", "bank_account_number", "bank_account_name",
        "pension_enrolled", "pension_provider", "benefits_notes",
        "dbs_check_status", "dbs_certificate_number", "rtw_check_reference",
        "p45_received", "starter_declaration", "leaving_reason",
        "qualifications_notes", "documents_held_notes",
    ]
    for col in direct_str_or_bool:
        val = getattr(body, col)
        if val is not None:
            sets.append(f"{col} = :{col}")
            params[col] = val

    def _coerce_date(s: str | None) -> date | None:
        if s is None:
            return None
        return date.fromisoformat(s) if s else None

    date_fields = [
        ("visa_expiry", body.visa_expiry),
        ("visa_issue_date", body.visa_issue_date),
        ("share_code_expiry", body.share_code_expiry),
        ("date_of_birth", body.date_of_birth),
        ("dbs_check_date", body.dbs_check_date),
        ("dbs_check_expiry", body.dbs_check_expiry),
        ("rtw_check_date", body.rtw_check_date),
        ("probation_end_date", body.probation_end_date),
        ("end_date", body.end_date),
    ]
    for col, val in date_fields:
        if val is not None:
            sets.append(f"{col} = :{col}")
            params[col] = _coerce_date(val)

    float_fields = [
        ("pension_employee_pct", body.pension_employee_pct),
        ("pension_employer_pct", body.pension_employer_pct),
        ("hours_per_week", body.hours_per_week),
        ("holiday_entitlement_days", body.holiday_entitlement_days),
    ]
    for col, val in float_fields:
        if val is not None:
            sets.append(f"{col} = :{col}")
            params[col] = float(val)

    if body.role is not None:
        sets.append("job_title = :job_title")
        params["job_title"] = body.role
    if body.gross_salary is not None:
        # Coerce volunteers to 0 — uses the merged employment_type if changing,
        # otherwise the existing value.
        emp_type = body.employment_type if body.employment_type is not None else existing["employment_type"]
        sets.append("gross_salary = :gross_salary")
        params["gross_salary"] = _coerce_volunteer_salary(emp_type or "", float(body.gross_salary))
    if body.start_date is not None:
        sets.append("start_date = :start_date")
        params["start_date"] = date.fromisoformat(body.start_date)
    if body.reporting_manager_id is not None:
        sets.append("manager_id = :manager_id")
        params["manager_id"] = body.reporting_manager_id if body.reporting_manager_id else None
    if not sets:
        return {"ok": True}
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        await db.execute(text(
            f"UPDATE employees SET {', '.join(sets)} WHERE id = :eid"
        ), params)
        await db.commit()
    return {"ok": True}


@router.delete("/employees/{employee_id}", status_code=204)
async def deactivate_emp(employee_id: str, ctx: CurrentSpace) -> None:
    """Soft-delete (deactivate) an employee."""
    from datetime import datetime

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text(
            "UPDATE employees SET is_active = false, updated_at = :now WHERE id = :eid"
        ), {"eid": employee_id, "now": datetime.utcnow()})
        await db.commit()


@router.get("/org-chart")
async def org_chart(ctx: CurrentSpace):
    return await get_org_chart(ctx)


@router.post("/leave")
async def create_leave(body: LeaveRequestInput, ctx: CurrentSpace):
    return await request_leave(ctx, body)


@router.post("/leave/{leave_id}/approve")
async def approve(leave_id: str, ctx: CurrentSpace):
    return await approve_leave(ctx, leave_id)


@router.post("/timesheet")
async def log_timesheet(body: TimeEntryInput, ctx: CurrentSpace):
    return await log_time(ctx, body)
