"""012 assets bookings documents

Revision ID: 012_assets_bookings_documents
Revises: 011_function_registry
Create Date: 2026-04-05 00:00:00.000000

Creates assets, bookings, and documents tables.
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "012_assets_bookings_documents"
down_revision = "011_function_registry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS assets (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id       VARCHAR(100) NOT NULL DEFAULT 'main',
            name            VARCHAR(200) NOT NULL,
            description     TEXT DEFAULT '',
            category        VARCHAR(50) NOT NULL DEFAULT 'OTHER',
            serial_number   VARCHAR(100) DEFAULT '',
            purchase_date   DATE,
            purchase_price  NUMERIC(12,2) DEFAULT 0,
            current_value   NUMERIC(12,2) DEFAULT 0,
            supplier        VARCHAR(200) DEFAULT '',
            warranty_expiry DATE,
            location        VARCHAR(200) DEFAULT '',
            status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            assigned_to     VARCHAR(200) DEFAULT '',
            notes           TEXT DEFAULT '',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at      TIMESTAMPTZ
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_assets_branch   ON assets(branch_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_assets_status   ON assets(status)"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS bookings (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id        VARCHAR(100) NOT NULL DEFAULT 'main',
            title            VARCHAR(200) NOT NULL,
            description      TEXT DEFAULT '',
            room             VARCHAR(100) NOT NULL DEFAULT 'Main Hall',
            booking_date     DATE NOT NULL,
            start_time       VARCHAR(10) NOT NULL DEFAULT '09:00',
            end_time         VARCHAR(10) NOT NULL DEFAULT '10:00',
            organiser_name   VARCHAR(200) DEFAULT '',
            organiser_email  VARCHAR(200) DEFAULT '',
            organiser_phone  VARCHAR(50)  DEFAULT '',
            attendees        INTEGER DEFAULT 0,
            status           VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
            notes            TEXT DEFAULT '',
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at       TIMESTAMPTZ
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_bookings_branch ON bookings(branch_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_bookings_date   ON bookings(booking_date)"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS documents (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id    VARCHAR(100) NOT NULL DEFAULT 'main',
            title        VARCHAR(200) NOT NULL,
            description  TEXT DEFAULT '',
            category     VARCHAR(50) NOT NULL DEFAULT 'GENERAL',
            file_url     TEXT DEFAULT '',
            file_name    VARCHAR(200) DEFAULT '',
            file_size    INTEGER DEFAULT 0,
            mime_type    VARCHAR(100) DEFAULT '',
            uploaded_by  VARCHAR(200) DEFAULT '',
            version      VARCHAR(20) DEFAULT '1.0',
            review_due   DATE,
            tags         TEXT DEFAULT '',
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at   TIMESTAMPTZ
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_documents_branch   ON documents(branch_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category)"))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP TABLE IF EXISTS documents"))
    conn.execute(text("DROP TABLE IF EXISTS bookings"))
    conn.execute(text("DROP TABLE IF EXISTS assets"))
