"""HR router."""
from __future__ import annotations
from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from shital.api.deps import CurrentSpace
from shital.capabilities.hr.capabilities import (
    create_employee, list_employees, request_leave, approve_leave, log_time, get_org_chart,
    CreateEmployeeInput, LeaveRequestInput, TimeEntryInput,
)

router = APIRouter(prefix="/hr", tags=["hr"])


@router.get("/employees")
async def employees(ctx: CurrentSpace, department: str = "", employment_type: str = "",
                    is_active: bool = True, limit: int = 50, cursor: str = ""):
    return await list_employees(ctx, department, employment_type, is_active, limit, cursor)


@router.post("/employees")
async def create_emp(body: CreateEmployeeInput, ctx: CurrentSpace):
    return await create_employee(ctx, body)


class EmployeeUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    role: str | None = None
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


@router.put("/employees/{employee_id}")
async def update_emp(employee_id: str, body: EmployeeUpdate, ctx: CurrentSpace) -> dict[str, Any]:
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    from datetime import datetime
    sets = []
    params: dict[str, Any] = {"eid": employee_id, "now": datetime.utcnow()}
    field_map = {
        "full_name": body.full_name, "email": body.email, "phone": body.phone,
        "address": body.address, "department": body.department,
        "employment_type": body.employment_type, "is_active": body.is_active,
        "photo_url": body.photo_url, "nationality": body.nationality,
        "right_to_work_type": body.right_to_work_type,
        "visa_number": body.visa_number, "visa_expiry": body.visa_expiry,
    }
    for col, val in field_map.items():
        if val is not None:
            sets.append(f"{col} = :{col}"); params[col] = val
    if body.role is not None:
        sets.append("job_title = :job_title"); params["job_title"] = body.role
    if body.gross_salary is not None:
        sets.append("salary = :salary"); params["salary"] = str(body.gross_salary)
    if body.national_insurance is not None:
        sets.append("ni_number = :ni_number"); params["ni_number"] = body.national_insurance
    if body.start_date is not None:
        sets.append("start_date = :start_date"); params["start_date"] = body.start_date
    if not sets:
        return {"ok": True}
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        result = await db.execute(text(
            f"UPDATE employees SET {', '.join(sets)} WHERE id = :eid"
        ), params)
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Employee not found")
    return {"ok": True}


@router.delete("/employees/{employee_id}", status_code=204)
async def deactivate_emp(employee_id: str, ctx: CurrentSpace) -> None:
    """Soft-delete (deactivate) an employee."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    from datetime import datetime
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
