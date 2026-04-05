"""010 kiosk_profiles — mapping table for Branch + Kiosk User + Device + Profile

Revision ID: 010_kiosk_profiles
Revises: 009_name_te
Create Date: 2026-04-04

Links branches, kiosk user accounts, terminal devices, and configuration
into a single mapping table. Each row represents one QuickDonation kiosk
deployment at a specific branch.
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "010_kiosk_profiles"
down_revision = "009_name_te"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS kiosk_profiles (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            -- Branch link
            branch_id           VARCHAR(100) NOT NULL,
            branch_name         VARCHAR(200) NOT NULL DEFAULT '',

            -- Kiosk user account (login credentials)
            user_id             UUID DEFAULT NULL,
            user_email          VARCHAR(200) NOT NULL,
            user_name           VARCHAR(200) NOT NULL DEFAULT '',

            -- Terminal device assignment
            device_id           UUID DEFAULT NULL,
            device_label        VARCHAR(255) DEFAULT '',
            stripe_reader_id    VARCHAR(255) DEFAULT '',
            device_provider     VARCHAR(50) DEFAULT 'stripe_terminal',

            -- Profile / configuration
            profile_name        VARCHAR(200) NOT NULL,
            kiosk_type          VARCHAR(50) NOT NULL DEFAULT 'quick_donation',
                                -- quick_donation | full_kiosk | shop
            display_name        VARCHAR(200) DEFAULT '',
            preset_amounts      JSONB NOT NULL DEFAULT '[1, 2.5, 5, 10, 15, 20, 50]',
            default_purpose     VARCHAR(200) DEFAULT 'General Fund',
            gift_aid_prompt     BOOLEAN NOT NULL DEFAULT true,
            idle_timeout_secs   INT NOT NULL DEFAULT 90,
            theme               VARCHAR(50) DEFAULT 'saffron',

            -- Status
            is_active           BOOLEAN NOT NULL DEFAULT TRUE,
            last_active_at      TIMESTAMPTZ DEFAULT NULL,

            -- Audit
            notes               TEXT DEFAULT '',
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at          TIMESTAMPTZ DEFAULT NULL,

            -- Unique: one profile per user per branch
            UNIQUE(branch_id, user_email)
        )
    """))

    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_branch "
        "ON kiosk_profiles(branch_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_user "
        "ON kiosk_profiles(user_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_device "
        "ON kiosk_profiles(device_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_active "
        "ON kiosk_profiles(is_active) WHERE deleted_at IS NULL"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP TABLE IF EXISTS kiosk_profiles"))
