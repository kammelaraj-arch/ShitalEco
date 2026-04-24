"""019 — add fee_amount and net_amount columns to donations table

Stores the payment provider fee and the net settlement amount for each donation.
These are NULL at payment time and populated when settlement data arrives
(via provider webhook or manual reconciliation).
"""
from alembic import op

revision = '019'
down_revision = '018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    for ddl in [
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS fee_amount  NUMERIC(10,2) DEFAULT NULL",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS net_amount  NUMERIC(10,2) DEFAULT NULL",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS fee_pct     NUMERIC(6,4)  DEFAULT NULL",
    ]:
        op.execute(ddl)


def downgrade() -> None:
    pass
