"""009 add name_te to catalog_items and temple_services

Revision ID: 009_name_te
Revises: 008_email_templates
Create Date: 2026-04-04
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = '009_name_te'
down_revision = '008_email_templates'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS name_te VARCHAR(200) NOT NULL DEFAULT ''"))
    conn.execute(sa.text("SAVEPOINT sp_ts_009"))
    try:
        conn.execute(sa.text("ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS name_te VARCHAR(200) NOT NULL DEFAULT ''"))
        conn.execute(sa.text("RELEASE SAVEPOINT sp_ts_009"))
    except Exception:
        conn.execute(sa.text("ROLLBACK TO SAVEPOINT sp_ts_009"))


def downgrade() -> None:
    try:
        op.drop_column('catalog_items', 'name_te')
    except Exception:
        pass
    try:
        op.drop_column('temple_services', 'name_te')
    except Exception:
        pass
