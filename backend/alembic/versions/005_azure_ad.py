"""005 azure ad

Revision ID: 005_azure_ad
Revises: 004_terminal_devices
Create Date: 2026-04-02 00:00:00.000000

Adds Azure AD / Microsoft 365 SSO fields to the users table:
  azure_oid  — Azure AD Object ID (oid claim from ID token, globally unique)
  azure_upn  — User Principal Name (preferred_username / email from Azure)
  auth_provider — tracks how the user authenticates (local | azure_ad | google)
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "005_azure_ad"
down_revision = "004_terminal_devices"
branch_labels = None
depends_on = None


def _column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(
        text("""
            SELECT COUNT(*) AS cnt FROM information_schema.columns
            WHERE table_name = :tbl AND column_name = :col
              AND table_schema = current_schema()
        """),
        {"tbl": table, "col": column},
    )
    row = result.mappings().first()
    return bool(row and row["cnt"] > 0)


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

    if _table_exists(conn, "users"):
        if not _column_exists(conn, "users", "azure_oid"):
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN azure_oid VARCHAR(100) DEFAULT NULL"
            ))
        if not _column_exists(conn, "users", "azure_upn"):
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN azure_upn VARCHAR(255) DEFAULT NULL"
            ))
        if not _column_exists(conn, "users", "auth_provider"):
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN auth_provider VARCHAR(30) DEFAULT 'local'"
            ))

    # Unique index on azure_oid (partial — NULLs are not equal)
    conn.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_azure_oid
        ON users(azure_oid)
        WHERE azure_oid IS NOT NULL
    """))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP INDEX IF EXISTS idx_users_azure_oid"))

    if _table_exists(conn, "users"):
        for col in ("auth_provider", "azure_upn", "azure_oid"):
            if _column_exists(conn, "users", col):
                conn.execute(text(f"ALTER TABLE users DROP COLUMN IF EXISTS {col}"))
