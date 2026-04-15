"""006 payment providers

Revision ID: 006_payment_providers
Revises: 005_azure_ad
Create Date: 2026-04-15 00:00:00.000000

Adds Clover Flex and SumUp columns to terminal_devices.
Updates provider comment to include clover | sumup.
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "006_payment_providers"
down_revision = "005_azure_ad"
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
