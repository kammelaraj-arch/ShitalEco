"""002 catalog items

Revision ID: 002_catalog_items
Revises:
Create Date: 2026-04-02 00:00:00.000000

Adds catalog_items table for the item/catalog management system.
Also adds gift_aid_eligible column to temple_services and basket_items if they exist.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "002_catalog_items"
down_revision = None
branch_labels = None
depends_on = None


def _column_exists(conn, table: str, column: str) -> bool:
    """Check if a column already exists in a table."""
    result = conn.execute(
        text("""
            SELECT COUNT(*) AS cnt
            FROM information_schema.columns
            WHERE table_name = :tbl
              AND column_name = :col
              AND table_schema = current_schema()
        """),
        {"tbl": table, "col": column},
    )
    row = result.mappings().first()
    return bool(row and row["cnt"] > 0)


def _table_exists(conn, table: str) -> bool:
    """Check if a table exists in the current schema."""
    result = conn.execute(
        text("""
            SELECT COUNT(*) AS cnt
            FROM information_schema.tables
            WHERE table_name = :tbl
              AND table_schema = current_schema()
        """),
        {"tbl": table},
    )
    row = result.mappings().first()
    return bool(row and row["cnt"] > 0)


def upgrade() -> None:
    conn = op.get_bind()

    # ── catalog_items ──────────────────────────────────────────────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS catalog_items (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name         VARCHAR(200) NOT NULL,
            name_gu      VARCHAR(200) DEFAULT '',
            name_hi      VARCHAR(200) DEFAULT '',
            description  TEXT DEFAULT '',
            category     VARCHAR(50) NOT NULL,
            price        NUMERIC(10, 2) NOT NULL,
            currency     VARCHAR(3) DEFAULT 'GBP',
            unit         VARCHAR(50) DEFAULT '',
            emoji        VARCHAR(10) DEFAULT '',
            image_url    TEXT DEFAULT '',
            gift_aid_eligible BOOLEAN DEFAULT FALSE,
            is_active    BOOLEAN DEFAULT TRUE,
            scope        VARCHAR(20) DEFAULT 'GLOBAL',
            branch_id    VARCHAR(100) DEFAULT '',
            stock_qty    INTEGER,
            sort_order   INTEGER DEFAULT 0,
            metadata_json JSONB DEFAULT '{}',
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at   TIMESTAMPTZ
        )
    """))

    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_catalog_items_category ON catalog_items(category)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_catalog_items_branch ON catalog_items(branch_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_catalog_items_scope ON catalog_items(scope)"
    ))

    # ── temple_services — add gift_aid_eligible if table exists ───────────
    if _table_exists(conn, "temple_services"):
        if not _column_exists(conn, "temple_services", "gift_aid_eligible"):
            conn.execute(text(
                "ALTER TABLE temple_services ADD COLUMN gift_aid_eligible BOOLEAN DEFAULT FALSE"
            ))

    # ── basket_items — add gift_aid_eligible if table exists ──────────────
    if _table_exists(conn, "basket_items"):
        if not _column_exists(conn, "basket_items", "gift_aid_eligible"):
            conn.execute(text(
                "ALTER TABLE basket_items ADD COLUMN gift_aid_eligible BOOLEAN DEFAULT FALSE"
            ))


def downgrade() -> None:
    conn = op.get_bind()

    # Remove gift_aid_eligible columns added in upgrade
    if _table_exists(conn, "basket_items"):
        if _column_exists(conn, "basket_items", "gift_aid_eligible"):
            conn.execute(text(
                "ALTER TABLE basket_items DROP COLUMN IF EXISTS gift_aid_eligible"
            ))

    if _table_exists(conn, "temple_services"):
        if _column_exists(conn, "temple_services", "gift_aid_eligible"):
            conn.execute(text(
                "ALTER TABLE temple_services DROP COLUMN IF EXISTS gift_aid_eligible"
            ))

    conn.execute(text("DROP TABLE IF EXISTS catalog_items"))
