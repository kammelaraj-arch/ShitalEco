"""037 software_downloads — admin-editable tiles on the Downloads page

Lets trustees add/remove links on admin.shital.org.uk/admin/downloads/
without a web build+deploy. The admin UI falls back to the hardcoded
default list if the table is empty, so this migration is zero-impact
on first apply: nothing shows up on the page until an admin adds the
first row.

Idempotent — CREATE TABLE IF NOT EXISTS.
"""
from alembic import op

revision = '037'
down_revision = '036'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("SET LOCAL statement_timeout = '10s'")
    op.execute("""
        CREATE TABLE IF NOT EXISTS software_downloads (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title       TEXT NOT NULL,
            subtitle    TEXT NOT NULL DEFAULT '',
            icon        TEXT NOT NULL DEFAULT '📦',
            href        TEXT NOT NULL,
            badge       TEXT NOT NULL DEFAULT 'Link',
            category    TEXT NOT NULL DEFAULT 'installer',
            accent      TEXT NOT NULL DEFAULT 'border-l-saffron-500/50',
            sort_order  INTEGER NOT NULL DEFAULT 100,
            is_active   BOOLEAN NOT NULL DEFAULT TRUE,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by  TEXT NOT NULL DEFAULT 'system'
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_software_downloads_active_sort
            ON software_downloads(is_active, sort_order)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS software_downloads")
