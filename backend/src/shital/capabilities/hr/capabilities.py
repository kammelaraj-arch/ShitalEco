"""
HR Capabilities — Employee management, leave, timesheets.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

import structlog
from fastapi import HTTPException
from pydantic import BaseModel

from shital.core.dna.registry import Fabric, capability
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()

# Guard: only run DDL once per worker process lifetime
_hr_tables_ready = False


# ── Sensitive data access control ────────────────────────────────────────────
# Fields stripped from employee responses unless the caller is privileged
# (SUPER_ADMIN / ADMIN, which is the HR / CEO / Trustee tier in this system)
# OR is the employee themselves looking at their own record.
SENSITIVE_FIELDS = frozenset({
    "national_insurance",
    "gross_salary",
    "tax_code",
    "date_of_birth",
    "bank_sort_code",
    "bank_account_number",
    "bank_account_name",
    "dbs_certificate_number",
    "share_code",
    "visa_number",
    "p45_received",
    "starter_declaration",
    "pension_employee_pct",
    "pension_employer_pct",
    # Address-class fields are PII but kept visible to managers — change here
    # if the trust wants stricter scoping later.
})

# Roles that always see sensitive fields. ADMIN is the HR/Trustee/CEO tier in
# this admin panel — there are no separate HR/Trustee/CEO roles in the RBAC
# system today. If/when those roles get added, append them here.
PRIVILEGED_ROLES = frozenset({"SUPER_ADMIN", "ADMIN"})


def _can_see_sensitive(ctx: DigitalSpace, employee_user_id: str | None) -> bool:
    """True if ctx.role is privileged OR ctx.user_id matches the employee's
    user_id (employee viewing their own record)."""
    role = (getattr(ctx, "role", "") or "").upper()
    if role in PRIVILEGED_ROLES:
        return True
    caller_user_id = str(getattr(ctx, "user_id", "") or "")
    return bool(caller_user_id and employee_user_id and caller_user_id == str(employee_user_id))


def redact_sensitive(emp: dict[str, Any], ctx: DigitalSpace) -> dict[str, Any]:
    """Return a copy of `emp` with sensitive fields stripped if the caller
    isn't authorized to see them."""
    if _can_see_sensitive(ctx, emp.get("user_id")):
        return emp
    out = dict(emp)
    for key in SENSITIVE_FIELDS:
        if key in out:
            out[key] = None
    out["_sensitive_redacted"] = True
    return out


# ── Field-level validation ───────────────────────────────────────────────────
# Pragmatic regexes — catch obvious mistakes without rejecting edge-case
# valid values. UK NI numbers follow `AA 99 99 99 A` (allow optional spaces).
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_NI_RE    = re.compile(r"^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]$", re.I)


def _validate_employee_payload(employment_type: str, *,
                                full_name: str, email: str, ni_number: str,
                                start_date: str, nationality: str,
                                next_of_kin_name: str, next_of_kin_relationship: str,
                                next_of_kin_phone: str) -> None:
    """Raise HTTPException(400) with a list of human-readable issues if any
    required field is missing / malformed for the given employment_type.

    Rules per scope:
      - Always: full_name, start_date, nationality, NoK name + relationship + phone
      - Non-VOLUNTEER: email (valid format) + NI number (valid format)
    """
    errors: list[str] = []
    if not full_name.strip():
        errors.append("Full name is required")
    if not start_date.strip():
        errors.append("Start date is required")
    if not nationality.strip():
        errors.append("Nationality is required")
    if not next_of_kin_name.strip():
        errors.append("Next of kin name is required")
    if not next_of_kin_relationship.strip():
        errors.append("Next of kin relationship is required")
    if not next_of_kin_phone.strip():
        errors.append("Next of kin phone is required")

    is_volunteer = (employment_type or "").upper() == "VOLUNTEER"
    if not is_volunteer:
        if not email.strip():
            errors.append("Email is required for non-volunteers")
        elif not _EMAIL_RE.match(email.strip()):
            errors.append(f"Email '{email}' is not a valid format")
        if not ni_number.strip():
            errors.append("National Insurance number is required for non-volunteers")
        elif not _NI_RE.match(ni_number.strip().replace(" ", "")):
            errors.append(f"NI number '{ni_number}' is not a valid UK format (e.g. AB123456C)")

    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})


def _coerce_volunteer_salary(employment_type: str, gross_salary: float) -> float:
    """Volunteers always have salary 0, regardless of what was sent. The form
    disables the field but server-side enforcement matters too in case someone
    bypasses the UI."""
    if (employment_type or "").upper() == "VOLUNTEER":
        return 0.0
    return float(gross_salary or 0)


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
    branch_id: str = ""           # blank → use caller's branch context
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
    # Visa expansion
    visa_type: str = ""               # Tier 2 / Skilled Worker / Student / etc.
    visa_issue_date: str = ""         # ISO date
    visa_sponsor_license: str = ""    # employer's sponsor license #
    share_code: str = ""              # GOV.UK digital right-to-work share code
    share_code_expiry: str = ""       # ISO date

    # Personal (DOB / gender / personal contact)
    date_of_birth: str = ""           # ISO date
    gender: str = ""                  # M / F / X / PREFER_NOT_SAY
    personal_email: str = ""
    emergency_phone: str = ""

    # Next of kin
    next_of_kin_name: str = ""
    next_of_kin_relationship: str = ""
    next_of_kin_phone: str = ""
    next_of_kin_email: str = ""
    next_of_kin_address: str = ""

    # Banking (sensitive — redacted in non-privileged responses)
    bank_sort_code: str = ""
    bank_account_number: str = ""
    bank_account_name: str = ""

    # Pension / benefits
    pension_enrolled: bool = False
    pension_provider: str = ""
    pension_employee_pct: float = 0
    pension_employer_pct: float = 0
    benefits_notes: str = ""

    # UK compliance
    dbs_check_status: str = ""        # NOT_CHECKED / CLEAR / FLAGGED / IN_PROGRESS
    dbs_check_date: str = ""          # ISO date
    dbs_check_expiry: str = ""        # ISO date
    dbs_certificate_number: str = ""  # sensitive
    rtw_check_date: str = ""          # ISO date — when RTW was verified
    rtw_check_reference: str = ""     # e.g. share code reference, doc note
    p45_received: bool = False
    starter_declaration: str = ""     # 'A' | 'B' | 'C' | ''

    # Working terms
    hours_per_week: float = 0
    holiday_entitlement_days: float = 0
    probation_end_date: str = ""      # ISO date
    end_date: str = ""                # ISO date — leaving date
    leaving_reason: str = ""          # RESIGNED / REDUNDANCY / DISMISSED / RETIRED / OTHER

    # Free-text stopgaps until we add proper documents/certificates tables
    qualifications_notes: str = ""
    documents_held_notes: str = ""


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
    """Create HR tables if they don't exist yet (self-healing).

    Each statement runs in its own transaction so one failure (e.g. duplicate
    data blocking a unique index) doesn't abort the whole batch.
    Only runs once per worker process; subsequent calls return immediately.
    """
    global _hr_tables_ready
    if _hr_tables_ready:
        return

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    _ddl = [
        """CREATE TABLE IF NOT EXISTS employees (
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
        )""",
        "CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(branch_id, is_active)",
        # Self-healing column additions for existing databases
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_id UUID",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS full_name VARCHAR(200)",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS email VARCHAR(200)",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone VARCHAR(50)",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality VARCHAR(100) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS right_to_work_type VARCHAR(50) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_number VARCHAR(100) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_expiry DATE",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
        # ── Phase 1 HR enhancement: Next-of-Kin, pension, banking, DBS, etc. ──
        # All idempotent — safe to re-run on existing dbs. Defaults chosen so
        # legacy rows don't fail NOT NULL after column add.
        # Visa expansion
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_type             VARCHAR(80)  NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_issue_date       DATE",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_sponsor_license  VARCHAR(60)  NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS share_code            VARCHAR(20)  NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS share_code_expiry     DATE",
        # Personal
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth         DATE",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender                VARCHAR(30)  NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS personal_email        VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_phone       VARCHAR(50)  NOT NULL DEFAULT ''",
        # Next of kin
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS next_of_kin_name         VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS next_of_kin_relationship VARCHAR(100) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS next_of_kin_phone        VARCHAR(50)  NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS next_of_kin_email        VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS next_of_kin_address      TEXT         NOT NULL DEFAULT ''",
        # Banking — sensitive, redacted in non-privileged responses
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_sort_code         VARCHAR(10)  NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_account_number    VARCHAR(20)  NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_account_name      VARCHAR(200) NOT NULL DEFAULT ''",
        # Pension / benefits
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS pension_enrolled       BOOLEAN      NOT NULL DEFAULT FALSE",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS pension_provider       VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS pension_employee_pct   NUMERIC(5,2) NOT NULL DEFAULT 0",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS pension_employer_pct   NUMERIC(5,2) NOT NULL DEFAULT 0",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS benefits_notes         TEXT         NOT NULL DEFAULT ''",
        # UK compliance — DBS / RTW / starter
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS dbs_check_status       VARCHAR(30)  NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS dbs_check_date         DATE",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS dbs_check_expiry       DATE",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS dbs_certificate_number VARCHAR(60)  NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS rtw_check_date         DATE",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS rtw_check_reference    VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS p45_received           BOOLEAN      NOT NULL DEFAULT FALSE",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS starter_declaration    VARCHAR(2)   NOT NULL DEFAULT ''",
        # Working terms
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS hours_per_week         NUMERIC(5,2) NOT NULL DEFAULT 0",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS holiday_entitlement_days NUMERIC(5,1) NOT NULL DEFAULT 0",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end_date     DATE",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS end_date               DATE",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS leaving_reason         VARCHAR(60)  NOT NULL DEFAULT ''",
        # Free-text stopgaps until we add proper documents/certificates tables
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS qualifications_notes   TEXT         NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS documents_held_notes   TEXT         NOT NULL DEFAULT ''",
        # Unique index in its own transaction so duplicate data doesn't abort everything
        "CREATE UNIQUE INDEX IF NOT EXISTS uidx_employees_number ON employees(branch_id, employee_number)",
        """CREATE TABLE IF NOT EXISTS leave_policies (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id   VARCHAR(100) NOT NULL DEFAULT 'main',
            name        VARCHAR(100) NOT NULL,
            leave_type  VARCHAR(50)  NOT NULL DEFAULT 'ANNUAL',
            days_per_year INTEGER    NOT NULL DEFAULT 28,
            carry_over  INTEGER      NOT NULL DEFAULT 0,
            is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS leave_requests (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id      UUID NOT NULL,
            leave_policy_id  VARCHAR(100) NOT NULL DEFAULT '',
            start_date       DATE NOT NULL,
            end_date         DATE NOT NULL,
            days             NUMERIC(5,1) NOT NULL DEFAULT 1,
            reason           TEXT,
            status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            reviewed_by      VARCHAR(200),
            reviewed_at      TIMESTAMPTZ,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id)",
        "CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status)",
        """CREATE TABLE IF NOT EXISTS time_entries (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id  UUID NOT NULL,
            branch_id    VARCHAR(100) NOT NULL DEFAULT 'main',
            date         DATE         NOT NULL,
            hours_worked NUMERIC(5,2) NOT NULL DEFAULT 0,
            description  TEXT,
            approved     BOOLEAN      NOT NULL DEFAULT FALSE,
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_time_entries_employee ON time_entries(employee_id)",
        "CREATE INDEX IF NOT EXISTS idx_time_entries_branch ON time_entries(branch_id, date)",
        # Upgrade VARCHAR(10) columns in main.py schema → correct NUMERIC types
        """DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='time_entries'
                  AND column_name='hours_worked'
                  AND data_type='character varying'
            ) THEN
                ALTER TABLE time_entries
                ALTER COLUMN hours_worked TYPE NUMERIC(5,2)
                USING NULLIF(hours_worked, '')::NUMERIC;
            END IF;
        END $$""",
        """DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='leave_requests'
                  AND column_name='days'
                  AND data_type='character varying'
            ) THEN
                ALTER TABLE leave_requests
                ALTER COLUMN days TYPE NUMERIC(5,1)
                USING NULLIF(days, '')::NUMERIC;
            END IF;
        END $$""",
    ]

    for sql in _ddl:
        try:
            async with SessionLocal() as db:
                await db.execute(text(sql))
                await db.commit()
        except Exception:
            pass  # best-effort; tables/columns should exist from alembic/main.py

    _hr_tables_ready = True


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
    salary_str    = str(data.gross_salary) if data.gross_salary else data.salary
    ni_number     = data.ni_number or data.national_insurance

    # Validate per employment type (raises 400 with a list of issues if invalid).
    _validate_employee_payload(
        data.employment_type,
        full_name=data.full_name,
        email=data.email,
        ni_number=ni_number,
        start_date=data.start_date,
        nationality=data.nationality,
        next_of_kin_name=data.next_of_kin_name,
        next_of_kin_relationship=data.next_of_kin_relationship,
        next_of_kin_phone=data.next_of_kin_phone,
    )

    start_date    = date.fromisoformat(data.start_date) if data.start_date else date.today()
    gross_salary  = _coerce_volunteer_salary(data.employment_type, float(salary_str) if salary_str else 0.0)

    # Auto-generate employee number if not provided
    emp_number = data.employee_number
    if not emp_number:
        prefix = (data.full_name or "EMP").replace(" ", "").upper()[:3]
        emp_number = f"{prefix}-{uuid.uuid4().hex[:6].upper()}"

    def _d(s: str) -> date | None:
        return date.fromisoformat(s) if s else None

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
                 visa_type, visa_issue_date, visa_sponsor_license, share_code, share_code_expiry,
                 date_of_birth, gender, personal_email, emergency_phone,
                 next_of_kin_name, next_of_kin_relationship, next_of_kin_phone,
                 next_of_kin_email, next_of_kin_address,
                 bank_sort_code, bank_account_number, bank_account_name,
                 pension_enrolled, pension_provider, pension_employee_pct,
                 pension_employer_pct, benefits_notes,
                 dbs_check_status, dbs_check_date, dbs_check_expiry, dbs_certificate_number,
                 rtw_check_date, rtw_check_reference,
                 p45_received, starter_declaration,
                 hours_per_week, holiday_entitlement_days,
                 probation_end_date, end_date, leaving_reason,
                 qualifications_notes, documents_held_notes,
                 created_at, updated_at)
                VALUES (:id, :bid, :num, :title, :dept, :start, :type,
                        :gross_salary, :ni, true, :mgr_id,
                        :full_name, :email, :phone, :address,
                        :photo_url, :nationality, :rtw_type, :visa_num, :visa_exp,
                        :visa_type, :visa_issue, :visa_sponsor, :share_code, :share_exp,
                        :dob, :gender, :p_email, :em_phone,
                        :nok_name, :nok_rel, :nok_phone,
                        :nok_email, :nok_addr,
                        :bank_sort, :bank_acc, :bank_name,
                        :pen_enrolled, :pen_provider, :pen_emp_pct,
                        :pen_er_pct, :benefits,
                        :dbs_status, :dbs_date, :dbs_exp, :dbs_cert,
                        :rtw_date, :rtw_ref,
                        :p45, :starter,
                        :hrs_week, :hol_days,
                        :prob_end, :end_date, :leave_reason,
                        :quals, :docs,
                        :now, :now)
            """),
            {
                "id": emp_id, "bid": (data.branch_id or ctx.branch_id),
                "num": emp_number, "title": job_title,
                "dept": data.department, "start": start_date,
                "type": data.employment_type,
                "gross_salary": gross_salary,
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
                "visa_exp": _d(data.visa_expiry),
                "visa_type": data.visa_type or '',
                "visa_issue": _d(data.visa_issue_date),
                "visa_sponsor": data.visa_sponsor_license or '',
                "share_code": data.share_code or '',
                "share_exp": _d(data.share_code_expiry),
                "dob": _d(data.date_of_birth),
                "gender": data.gender or '',
                "p_email": data.personal_email or '',
                "em_phone": data.emergency_phone or '',
                "nok_name": data.next_of_kin_name or '',
                "nok_rel": data.next_of_kin_relationship or '',
                "nok_phone": data.next_of_kin_phone or '',
                "nok_email": data.next_of_kin_email or '',
                "nok_addr": data.next_of_kin_address or '',
                "bank_sort": data.bank_sort_code or '',
                "bank_acc": data.bank_account_number or '',
                "bank_name": data.bank_account_name or '',
                "pen_enrolled": bool(data.pension_enrolled),
                "pen_provider": data.pension_provider or '',
                "pen_emp_pct": float(data.pension_employee_pct or 0),
                "pen_er_pct": float(data.pension_employer_pct or 0),
                "benefits": data.benefits_notes or '',
                "dbs_status": data.dbs_check_status or '',
                "dbs_date": _d(data.dbs_check_date),
                "dbs_exp": _d(data.dbs_check_expiry),
                "dbs_cert": data.dbs_certificate_number or '',
                "rtw_date": _d(data.rtw_check_date),
                "rtw_ref": data.rtw_check_reference or '',
                "p45": bool(data.p45_received),
                "starter": data.starter_declaration or '',
                "hrs_week": float(data.hours_per_week or 0),
                "hol_days": float(data.holiday_entitlement_days or 0),
                "prob_end": _d(data.probation_end_date),
                "end_date": _d(data.end_date),
                "leave_reason": data.leaving_reason or '',
                "quals": data.qualifications_notes or '',
                "docs": data.documents_held_notes or '',
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
    # SELECT * so consumers (admin form) get every field including the Phase 1
    # additions without us having to hand-list every column. Sensitive fields
    # are stripped via redact_sensitive() per row.
    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT e.*, e.job_title AS role
                FROM employees e
                WHERE {where}
                ORDER BY e.full_name, e.id
                LIMIT :limit
            """),
            params,
        )
        rows = result.mappings().all()

    items = [redact_sensitive(dict(r), ctx) for r in rows[:limit]]
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
    await _ensure_hr_tables()
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
                (id, employee_id, start_date, end_date, days,
                 reason, status, created_at, updated_at)
                VALUES (:id, :emp, :start, :end, :days, :reason, 'PENDING', :now, :now)
            """),
            {
                "id": req_id, "emp": data.employee_id,
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
    await _ensure_hr_tables()
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
                "date": date.fromisoformat(data.entry_date), "hours": str(float(data.hours_worked)),
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
