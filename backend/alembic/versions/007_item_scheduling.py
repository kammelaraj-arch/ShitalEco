"""007 item scheduling — available_from/until, display_channel, branch_stock

Revision ID: 007_item_scheduling
Revises: 006_kiosk_baskets
Create Date: 2026-04-04
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '007_item_scheduling'
down_revision = '006_kiosk_baskets'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use raw SQL with IF NOT EXISTS to avoid transaction abort on duplicate columns
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS available_from  TIMESTAMPTZ"))
    conn.execute(sa.text("ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ"))
    conn.execute(sa.text("ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS display_channel VARCHAR(20) NOT NULL DEFAULT 'both'"))
    conn.execute(sa.text("ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS branch_stock    JSONB NOT NULL DEFAULT '{}'"))
    conn.execute(sa.text("ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS is_live         BOOLEAN NOT NULL DEFAULT true"))

    # Same scheduling fields on temple_services (guarded — table may not exist)
    conn.execute(sa.text("SAVEPOINT sp_ts_007"))
    try:
        conn.execute(sa.text("ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS available_from  TIMESTAMPTZ"))
        conn.execute(sa.text("ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ"))
        conn.execute(sa.text("ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS display_channel VARCHAR(20) NOT NULL DEFAULT 'both'"))
        conn.execute(sa.text("ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS is_live         BOOLEAN NOT NULL DEFAULT true"))
        conn.execute(sa.text("RELEASE SAVEPOINT sp_ts_007"))
    except Exception:
        conn.execute(sa.text("ROLLBACK TO SAVEPOINT sp_ts_007"))


def downgrade() -> None:
    for col in ['available_from', 'available_until', 'display_channel', 'branch_stock', 'is_live']:
        try:
            op.drop_column('catalog_items', col)
        except Exception:
            pass
    for col in ['available_from', 'available_until', 'display_channel']:
        try:
            op.drop_column('temple_services', col)
        except Exception:
            pass
