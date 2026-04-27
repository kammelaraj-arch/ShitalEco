"""022 GASDS community building — link collections to a branch.

HMRC's GASDS scheme caps the annual claim at £8,000 PER community building
(places of worship qualify; each temple = its own building). To track the
per-building cap accurately, link each collection to a branch.
"""
from alembic import op

revision = '022'
down_revision = '021'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # branch_id matches branches.branch_id (the short code, e.g. "wembley")
    op.execute(
        "ALTER TABLE gasds_collections "
        "ADD COLUMN IF NOT EXISTS branch_id VARCHAR(100) DEFAULT NULL"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_gasds_branch ON gasds_collections (branch_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_gasds_branch")
    op.execute("ALTER TABLE gasds_collections DROP COLUMN IF EXISTS branch_id")
