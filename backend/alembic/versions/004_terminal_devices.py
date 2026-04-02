"""004 terminal devices

Revision ID: 004_terminal_devices
Revises: 003_gift_aid_declarations
Create Date: 2026-04-02 00:00:00.000000

Creates terminal_devices table — one row per physical card reader.
Each device is tied to a branch and optionally assigned to a staff user.
Supports both Stripe Terminal (WisePOS E) and Square Terminal devices.
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "004_terminal_devices"
down_revision = "003_gift_aid_declarations"
branch_labels = None
depends_on = None


def _table_exists(conn, table: str) -> bool:
    result = conn.execute(
        text("""
            SELECT COUNT(*) AS cnt FROM information_schema.tables
            WHERE table_name = :tbl AND table_schema = current_schema()
        """),
        {"tbl": table},
    )
    row = result.mappings().first()
    return bool(row and row["cnt"] > 0)


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS terminal_devices (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            -- Ownership
            branch_id           VARCHAR(100) NOT NULL,
            branch_name         VARCHAR(200) DEFAULT '',
            user_id             VARCHAR(100) DEFAULT NULL,
            user_name           VARCHAR(200) DEFAULT '',
            user_email          VARCHAR(200) DEFAULT '',

            -- Identity
            label               VARCHAR(255) NOT NULL,
            provider            VARCHAR(50)  NOT NULL DEFAULT 'stripe_terminal',
                                -- stripe_terminal | square | cash

            -- Stripe Terminal
            stripe_reader_id    VARCHAR(255) DEFAULT '',
            stripe_location_id  VARCHAR(255) DEFAULT '',

            -- Square Terminal
            square_device_id    VARCHAR(255) DEFAULT '',

            -- Hardware info (synced from Stripe/Square)
            device_type         VARCHAR(100) DEFAULT '',
            serial_number       VARCHAR(100) DEFAULT '',

            -- Runtime state
            status              VARCHAR(50) DEFAULT 'offline',
                                -- online | offline | busy
            is_active           BOOLEAN NOT NULL DEFAULT TRUE,
            last_seen_at        TIMESTAMPTZ DEFAULT NULL,

            -- Admin notes
            notes               TEXT DEFAULT '',
            metadata_json       JSONB NOT NULL DEFAULT '{}',

            -- Timestamps + soft-delete
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at          TIMESTAMPTZ DEFAULT NULL
        )
    """))

    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_terminal_devices_branch "
        "ON terminal_devices(branch_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_terminal_devices_user "
        "ON terminal_devices(user_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_terminal_devices_stripe_reader "
        "ON terminal_devices(stripe_reader_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_terminal_devices_active "
        "ON terminal_devices(is_active) WHERE deleted_at IS NULL"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP TABLE IF EXISTS terminal_devices"))
