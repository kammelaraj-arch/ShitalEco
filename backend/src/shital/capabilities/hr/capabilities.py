"""
HR Capabilities — Employee management, leave, timesheets.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

import structlog
from pydantic import BaseModel

from shital.core.dna.registry import Fabric, capability
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()


class CreateEmployeeInput(BaseModel):
    # Fields sent by admin UI
    full_name: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""
    role: str = ""                # alias for job_title
    gross_salary: float = 0       # alias for salary
    national_insurance: str = ""  # alias for ni_number

    # Optional legacy / direct fields
    user_id: str = ""
    employee_number: str = ""
    job_title: str = ""
    department: str = "General"
    start_date: str = ""
    employment_type: str = "FULL_TIME"
    salary: str = "0"
    salary_period: str = "ANNUAL"
    ni_number: str = ""
    tax_code: str = "1257L"
    manager_id: str = ""
    reporting_manager_id: str = ""  # alias for manager_id from form

    # Photo & immigration
    photo_url: str = ""
    nationality: str = ""
    right_to_work_type: str = ""   # e.g. British, ILR, Visa, Student
    visa_number: str = ""
    visa_expiry: str = ""          # ISO date


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


async def _ensure_hr_tables() -> None:
    """Create HR tables if they don't exist yet (self-healing — no migration required)."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS employees (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                branch_id           VARCHAR(100) NOT NULL DEFAULT 'main',
                user_id             TEXT DEFAULT NULL,
                employee_number     VARCHAR(50)  NOT NULL,
                job_title           VARCHAR(200) NOT NULL DEFAULT 'Staff',
                department          VARCHAR(100) NOT NULL DEFAULT 'General',
                start_date          DATE         NOT NULL DEFAULT CURRENT_DATE,
                employment_type     VARCHAR(30)  NOT NULL DEFAULT 'FULL_TIME',
                gross_salary        NUMERIC(12,2) NOT NULL DEFAULT 0,
                national_insurance  VARCHAR(20)  NOT NULL DEFAULT '',
                tax_code            VARCHAR(20)  NOT NULL DEFAULT '1257L',
                manager_id          UUID,
                is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
                full_name           VARCHAR(200),
                email               VARCHAR(200),
                phone               VARCHAR(50),
                address             TEXT,
                photo_url           TEXT         NOT NULL DEFAULT '',
                nationality         VARCHAR(100) NOT NULL DEFAULT '',
                right_to_work_type  VARCHAR(50)  NOT NULL DEFAULT '',
                visa_number         VARCHAR(100) NOT NULL DEFAULT '',
                visa_expiry         DATE,
                notes               TEXT         NOT NULL DEFAULT '',
                created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                deleted_at          TIMESTAMPTZ
            )
        """))
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id)"))
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(branch_id, is_active)"))
        await db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uidx_employees_number ON employees(branch_id, employee_number)"))
        # Self-healing column additions for existing databases
        await db.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_id UUID"))
        await db.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT ''"))
        await db.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality VARCHAR(100) NOT NULL DEFAULT ''"))
        await db.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS right_to_work_type VARCHAR(50) NOT NULL DEFAULT ''"))
        await db.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_number VARCHAR(100) NOT NULL DEFAULT ''"))
        await db.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_expiry DATE"))
        await db.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS full_name VARCHAR(200)"))

        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS leave_policies (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                branch_id   VARCHAR(100) NOT NULL DEFAULT 'main',
                name        VARCHAR(100) NOT NULL,
                leave_type  VARCHAR(50)  NOT NULL DEFAULT 'ANNUAL',
                days_per_year INTEGER    NOT NULL DEFAULT 28,
                carry_over  INTEGER      NOT NULL DEFAULT 0,
                is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
                created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        """))

        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS leave_requests (
                id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
                leave_policy_id  UUID REFERENCES leave_policies(id) ON DELETE SET NULL,
                start_date       DATE NOT NULL,
                end_date         DATE NOT NULL,
                days             NUMERIC(5,1) NOT NULL DEFAULT 1,
                reason           TEXT,
                status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                reviewed_by      UUID DEFAULT NULL,
                reviewed_at      TIMESTAMPTZ,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS time_entries (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
                branch_id    VARCHAR(100) NOT NULL DEFAULT 'main',
                date         DATE         NOT NULL,
                hours_worked NUMERIC(5,2) NOT NULL DEFAULT 0,
                description  TEXT,
                approved     BOOLEAN      NOT NULL DEFAULT FALSE,
                created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        """))
        await db.commit()


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
    await _ensure_hr_tables()

    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    # Resolve aliases: form sends role/gross_salary/national_insurance
    job_title     = data.job_title or data.role or "Staff"
    salary        = str(data.gross_salary) if data.gross_salary else data.salary
    ni_number     = data.ni_number or data.national_insurance
    start_date    = date.fromisoformat(data.start_date) if data.start_date else date.today()

    # Auto-generate employee number if not provided
    emp_number = data.employee_number
    if not emp_number:
        prefix = (data.full_name or "EMP").replace(" ", "").upper()[:3]
        emp_number = f"{prefix}-{uuid.uuid4().hex[:6].upper()}"

    async with SessionLocal() as db:
        emp_id = str(uuid.uuid4())
        now = datetime.utcnow()
        await db.execute(
            text("""
                INSERT INTO employees
                (id, branch_id, employee_number, job_title, department,
                 start_date, employment_type, gross_salary, national_insurance,
                 is_active, manager_id,
                 full_name, email, phone, address,
                 photo_url, nationality, right_to_work_type, visa_number, visa_expiry,
                 created_at, updated_at)
                VALUES (:id, :bid, :num, :title, :dept, :start, :type,
                        :gross_salary, :ni, true, :mgr_id,
                        :full_name, :email, :phone, :address,
                        :photo_url, :nationality, :rtw_type, :visa_num, :visa_exp,
                        :now, :now)
            """),
            {
                "id": emp_id, "bid": ctx.branch_id,
                "num": emp_number, "title": job_title,
                "dept": data.department, "start": start_date,
                "type": data.employment_type,
                "gross_salary": float(salary) if salary else 0.0,
                "ni": ni_number or '',
                "mgr_id": data.reporting_manager_id or data.manager_id or None,
                "full_name": data.full_name or None,
                "email": data.email or None,
                "phone": data.phone or None,
                "address": data.address or None,
                "photo_url": data.photo_url or '',
                "nationality": data.nationality or '',
                "rtw_type": data.right_to_work_type or '',
                "visa_num": data.visa_number or '',
                "visa_exp": date.fromisoformat(data.visa_expiry) if data.visa_expiry else None,
                "now": now,
            },
        )
        await db.commit()

    logger.info("employee_created", employee_id=emp_id, **ctx.log_context)
    return {"employee_id": emp_id, "employee_number": emp_number}


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
    await _ensure_hr_tables()

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

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
                SELECT e.id, e.employee_number, e.job_title AS role, e.department,
                       e.employment_type, e.is_active, e.start_date,
                       COALESCE(e.full_name, '')  AS full_name,
                       COALESCE(e.email, '')      AS email,
                       COALESCE(e.phone, '')      AS phone,
                       COALESCE(e.address, '')    AS address,
                       e.gross_salary,
                       COALESCE(e.photo_url, '')         AS photo_url,
                       COALESCE(e.nationality, '')       AS nationality,
                       COALESCE(e.right_to_work_type,'') AS right_to_work_type,
                       e.visa_expiry,
                       CAST(e.manager_id AS VARCHAR) AS reporting_manager_id,
                       COALESCE(rm.full_name, '') AS reporting_manager_name
                FROM employees e
                LEFT JOIN employees rm ON rm.id = e.manager_id
                WHERE {where}
                ORDER BY e.full_name, e.id
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
    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

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
                "id": req_id, "emp": data.employee_id, "pol": data.leave_policy_id or None,
                "start": start, "end": end, "days": delta,
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

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

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
    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

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
                "date": date.fromisoformat(data.entry_date), "hours": float(data.hours_worked),
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

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT e.id, e.employee_number, e.job_title, e.department,
                       e.manager_id,
                       COALESCE(e.full_name, u.name, e.employee_number) AS name
                FROM employees e
                LEFT JOIN users u ON u.id = e.user_id
                WHERE e.branch_id = :bid AND e.is_active = true AND e.deleted_at IS NULL
                ORDER BY e.department, name
            """),
            {"bid": ctx.branch_id},
        )
        rows = result.mappings().all()

    employees: dict = {r["id"]: dict(r) | {"reports": []} for r in rows}
    roots = []

    for emp in employees.values():
        mgr_id = emp.get("manager_id")
        if mgr_id and mgr_id in employees:
            employees[mgr_id]["reports"].append(emp)
        else:
            roots.append(emp)

    return {"branch_id": ctx.branch_id, "org_chart": roots, "total_employees": len(employees)}
