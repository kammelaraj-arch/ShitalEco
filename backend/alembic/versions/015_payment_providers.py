"""015 payment providers

Revision ID: 015_payment_providers
Revises: 014_catalog_items_project_id
Create Date: 2026-04-15 00:00:00.000000

Adds Clover Flex and SumUp columns to terminal_devices.
Updates provider comment to include clover | sumup.
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "015_payment_providers"
down_revision = "014_catalog_items_project_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(text(
        "ALTER TABLE terminal_devices ADD COLUMN IF NOT EXISTS "
        "clover_device_id VARCHAR(255) NOT NULL DEFAULT ''"
    ))
    conn.execute(text(
        "ALTER TABLE terminal_devices ADD COLUMN IF NOT EXISTS "
        "sumup_reader_serial VARCHAR(255) NOT NULL DEFAULT ''"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("ALTER TABLE terminal_devices DROP COLUMN IF EXISTS clover_device_id"))
    conn.execute(text("ALTER TABLE terminal_devices DROP COLUMN IF EXISTS sumup_reader_serial"))
