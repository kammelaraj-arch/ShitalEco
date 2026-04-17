"""014 catalog items project_id column

Revision ID: 014_catalog_items_project_id
Revises: 013_hr_tables
Create Date: 2026-04-12 00:00:00.000000

Adds project_id column to catalog_items (was in code but never migrated).
"""
from __future__ import annotations

from sqlalchemy import text

from alembic import op

revision = "014_catalog_items_project_id"
down_revision = "013_hr_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(text(
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS project_id VARCHAR(100) NOT NULL DEFAULT ''"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_catalog_items_project ON catalog_items(project_id)"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP INDEX IF EXISTS idx_catalog_items_project"))
    conn.execute(text("ALTER TABLE catalog_items DROP COLUMN IF EXISTS project_id"))
