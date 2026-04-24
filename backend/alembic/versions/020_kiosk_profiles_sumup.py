"""020 — add SumUp reader fields to kiosk_profiles

kiosk_profiles was missing sumup_reader_serial and sumup_reader_api_id,
so Path-2 (legacy user) logins could not persist SumUp reader config in
the database. All SumUp state lived only in browser localStorage.
"""
from alembic import op

revision = '020'
down_revision = '019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    for ddl in [
        "ALTER TABLE kiosk_profiles ADD COLUMN IF NOT EXISTS sumup_reader_serial VARCHAR(255) DEFAULT ''",
        "ALTER TABLE kiosk_profiles ADD COLUMN IF NOT EXISTS sumup_reader_api_id  VARCHAR(255) DEFAULT ''",
    ]:
        op.execute(ddl)


def downgrade() -> None:
    pass
