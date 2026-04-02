"""HR router."""
from fastapi import APIRouter
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
