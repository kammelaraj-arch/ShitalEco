"""013 hr tables

Revision ID: 013_hr_tables
Revises: 012_assets_bookings_documents
Create Date: 2026-04-12 00:00:00.000000

Creates HR tables: employees, leave_policies, leave_requests, time_entries.
"""
from __future__ import annotations

from sqlalchemy import text

from alembic import op

revision = "013_hr_tables"
down_revision = "012_assets_bookings_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS employees (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id           VARCHAR(100) NOT NULL DEFAULT 'main',
            user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
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
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_employees_branch     ON employees(branch_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_employees_active     ON employees(branch_id, is_active)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department)"))
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uidx_employees_number ON employees(branch_id, employee_number)"))

    conn.execute(text("""
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
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_leave_policies_branch ON leave_policies(branch_id)"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS leave_requests (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            leave_policy_id  UUID REFERENCES leave_policies(id) ON DELETE SET NULL,
            start_date       DATE NOT NULL,
            end_date         DATE NOT NULL,
            days             NUMERIC(5,1) NOT NULL DEFAULT 1,
            reason           TEXT,
            status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at      TIMESTAMPTZ,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_leave_requests_status   ON leave_requests(status)"))

    conn.execute(text("""
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
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_time_entries_employee ON time_entries(employee_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_time_entries_branch   ON time_entries(branch_id, date)"))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP TABLE IF EXISTS time_entries"))
    conn.execute(text("DROP TABLE IF EXISTS leave_requests"))
    conn.execute(text("DROP TABLE IF EXISTS leave_policies"))
    conn.execute(text("DROP TABLE IF EXISTS employees"))
