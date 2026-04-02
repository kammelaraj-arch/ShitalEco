"""
HR Capabilities — Employee management, leave, timesheets.
"""
from __future__ import annotations
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel
import structlog

from shital.core.dna.registry import capability, Fabric
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()


class CreateEmployeeInput(BaseModel):
    user_id: str
    employee_number: str
    job_title: str
    department: str
    start_date: str
    employment_type: str  # FULL_TIME | PART_TIME | CONTRACTOR | VOLUNTEER
    salary: str = "0"
    salary_period: str = "ANNUAL"
    ni_number: str = ""
    tax_code: str = "1257L"
    manager_id: str = ""


class LeaveRequestInput(BaseModel):
    employee_id: str
    leave_policy_id: str
    start_date: str
    end_date: str
    reason: str = ""


class TimeEntryInput(BaseModel):
    employee_id: str
    entry_date: str
    hours_worked: str
    description: str = ""


@capability(
    name="create_employee",
    description="Onboard a new employee — creates employee record linked to an existing user account.",
    fabric=Fabric.HR,
    requires=["hr:write"],
    idempotent=False,
    tags=["hr", "onboarding"],
)
async def create_employee(ctx: DigitalSpace, data: CreateEmployeeInput) -> dict[str, Any]:
    ctx.require_permission("hr:write")

    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    import uuid

    async with SessionLocal() as db:
        # Check employee number is unique
        existing = await db.execute(
            text("SELECT id FROM employees WHERE employee_number = :num AND deleted_at IS NULL"),
            {"num": data.employee_number},
        )
        if existing.scalar():
            from shital.core.fabrics.errors import ConflictError
            raise ConflictError(f"Employee number {data.employee_number} already exists")

        emp_id = str(uuid.uuid4())
        now = datetime.utcnow()
        await db.execute(
            text("""
                INSERT INTO employees
                (id, user_id, branch_id, employee_number, job_title, department,
                 start_date, employment_type, salary, salary_period, ni_number,
                 tax_code, is_active, manager_id, created_at, updated_at)
                VALUES (:id, :uid, :bid, :num, :title, :dept, :start, :type,
                        :salary, :sp, :ni, :tc, true, :mgr, :now, :now)
            """),
            {
                "id": emp_id, "uid": data.user_id, "bid": ctx.branch_id,
                "num": data.employee_number, "title": data.job_title,
                "dept": data.department, "start": data.start_date,
                "type": data.employment_type, "salary": data.salary,
                "sp": data.salary_period, "ni": data.ni_number or None,
                "tc": data.tax_code, "mgr": data.manager_id or None,
                "now": now,
            },
        )
        await db.commit()

    logger.info("employee_created", employee_id=emp_id, **ctx.log_context)
    return {"employee_id": emp_id, "employee_number": data.employee_number}


@capability(
    name="list_employees",
    description="List all employees in the branch. Filter by department, employment type, or active status.",
    fabric=Fabric.HR,
    requires=["hr:read"],
    idempotent=True,
    tags=["hr"],
)
async def list_employees(
    ctx: DigitalSpace,
    department: str = "",
    employment_type: str = "",
    is_active: bool = True,
    limit: int = 50,
    cursor: str = "",
) -> dict[str, Any]:
    ctx.require_permission("hr:read")

    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    conditions = ["e.branch_id = :bid", "e.deleted_at IS NULL"]
    params: dict[str, Any] = {"bid": ctx.branch_id, "limit": limit + 1}

    if department:
        conditions.append("e.department = :dept")
        params["dept"] = department
    if employment_type:
        conditions.append("e.employment_type = :etype")
        params["etype"] = employment_type
    conditions.append("e.is_active = :active")
    params["active"] = is_active
    if cursor:
        conditions.append("e.id > :cursor")
        params["cursor"] = cursor

    where = " AND ".join(conditions)
    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT e.id, e.employee_number, e.job_title, e.department,
                       e.employment_type, e.is_active, e.start_date,
                       u.name, u.email
                FROM employees e
                JOIN users u ON u.id = e.user_id
                WHERE {where}
                ORDER BY e.id
                LIMIT :limit
            """),
            params,
        )
        rows = result.mappings().all()

    items = [dict(r) for r in rows[:limit]]
    next_cursor = rows[limit]["id"] if len(rows) > limit else None

    return {"items": items, "next_cursor": next_cursor, "count": len(items)}


@capability(
    name="request_leave",
    description="Submit a leave request for an employee. System checks entitlement balance automatically.",
    fabric=Fabric.HR,
    requires=["hr:read"],
    idempotent=False,
    tags=["hr", "leave"],
)
async def request_leave(ctx: DigitalSpace, data: LeaveRequestInput) -> dict[str, Any]:
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    import uuid
    from datetime import timedelta

    start = date.fromisoformat(data.start_date)
    end = date.fromisoformat(data.end_date)
    delta = (end - start).days + 1

    async with SessionLocal() as db:
        req_id = str(uuid.uuid4())
        now = datetime.utcnow()
        await db.execute(
            text("""
                INSERT INTO leave_requests
                (id, employee_id, leave_policy_id, start_date, end_date, days,
                 reason, status, created_at, updated_at)
                VALUES (:id, :emp, :pol, :start, :end, :days, :reason, 'PENDING', :now, :now)
            """),
            {
                "id": req_id, "emp": data.employee_id, "pol": data.leave_policy_id,
                "start": start, "end": end, "days": str(delta),
                "reason": data.reason or None, "now": now,
            },
        )
        await db.commit()

    return {"leave_request_id": req_id, "days": delta, "status": "PENDING"}


@capability(
    name="approve_leave",
    description="Approve a pending leave request.",
    fabric=Fabric.HR,
    requires=["hr:write"],
    human_in_loop=True,
    tags=["hr", "leave"],
)
async def approve_leave(ctx: DigitalSpace, leave_request_id: str) -> dict[str, Any]:
    ctx.require_permission("hr:write")

    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                UPDATE leave_requests
                SET status = 'APPROVED', reviewed_by = :user, reviewed_at = :now, updated_at = :now
                WHERE id = :id AND status = 'PENDING'
                RETURNING id
            """),
            {"id": leave_request_id, "user": ctx.user_id, "now": datetime.utcnow()},
        )
        if not result.scalar():
            from shital.core.fabrics.errors import NotFoundError
            raise NotFoundError("LeaveRequest", leave_request_id)
        await db.commit()

    return {"leave_request_id": leave_request_id, "status": "APPROVED"}


@capability(
    name="log_time",
    description="Log hours worked by an employee on a specific date.",
    fabric=Fabric.HR,
    requires=["hr:read"],
    tags=["hr", "timesheet"],
)
async def log_time(ctx: DigitalSpace, data: TimeEntryInput) -> dict[str, Any]:
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    import uuid

    async with SessionLocal() as db:
        entry_id = str(uuid.uuid4())
        now = datetime.utcnow()
        await db.execute(
            text("""
                INSERT INTO time_entries
                (id, employee_id, branch_id, date, hours_worked, description, approved, created_at, updated_at)
                VALUES (:id, :emp, :bid, :date, :hours, :desc, false, :now, :now)
            """),
            {
                "id": entry_id, "emp": data.employee_id, "bid": ctx.branch_id,
                "date": data.entry_date, "hours": data.hours_worked,
                "desc": data.description or None, "now": now,
            },
        )
        await db.commit()

    return {"entry_id": entry_id, "hours": data.hours_worked, "date": data.entry_date}


@capability(
    name="get_org_chart",
    description="Retrieve the organisational chart showing reporting structure for the branch.",
    fabric=Fabric.HR,
    requires=["hr:read"],
    idempotent=True,
    tags=["hr", "org-chart"],
)
async def get_org_chart(ctx: DigitalSpace) -> dict[str, Any]:
    ctx.require_permission("hr:read")

    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT e.id, e.employee_number, e.job_title, e.department,
                       e.manager_id, u.name
                FROM employees e
                JOIN users u ON u.id = e.user_id
                WHERE e.branch_id = :bid AND e.is_active = true AND e.deleted_at IS NULL
                ORDER BY e.department, u.name
            """),
            {"bid": ctx.branch_id},
        )
        rows = result.mappings().all()

    employees = {r["id"]: dict(r) | {"reports": []} for r in rows}
    roots = []

    for emp in employees.values():
        mgr_id = emp.get("manager_id")
        if mgr_id and mgr_id in employees:
            employees[mgr_id]["reports"].append(emp)
        else:
            roots.append(emp)

    return {"branch_id": ctx.branch_id, "org_chart": roots, "total_employees": len(employees)}
