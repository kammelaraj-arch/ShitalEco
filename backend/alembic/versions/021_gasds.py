"""021 GASDS collections — Gift Aid Small Donations Scheme

For cash bucket donations under £30 each, charities can claim 25% from HMRC
without a declaration. Annual cap is £8,000 per community building (places of
worship qualify). This table tracks collected cash so we can:

  - keep an audit trail of cash donation dates + amounts + location
  - sum up unclaimed totals to know how much we can claim from HMRC
  - mark collections as claimed in a particular HMRC submission

We deliberately keep this lightweight — record collections at whatever
granularity makes sense (per-day, per-week, per-event), not per-donation.
HMRC accepts daily/weekly totals from cash counts.
"""
from alembic import op

revision = '021'
down_revision = '020'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS gasds_collections (
            id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            collection_date DATE         NOT NULL,
            amount          DECIMAL(10,2) NOT NULL,
            location        VARCHAR(120)            DEFAULT '',
            description     VARCHAR(300)            DEFAULT '',
            tax_year        INT                     DEFAULT NULL,
            claimed_at      TIMESTAMPTZ,
            claimed_in_submission_id UUID,
            created_by      VARCHAR(120)            DEFAULT '',
            created_at      TIMESTAMPTZ             DEFAULT NOW(),
            updated_at      TIMESTAMPTZ             DEFAULT NOW(),
            deleted_at      TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_gasds_date     ON gasds_collections (collection_date)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_gasds_taxyear  ON gasds_collections (tax_year)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_gasds_claimed  ON gasds_collections (claimed_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS gasds_collections")
