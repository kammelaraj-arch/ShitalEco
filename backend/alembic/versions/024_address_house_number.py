"""024 add house_number to addresses (CRM)

The addresses table currently stores only `formatted` (full address line),
`postcode`, and `uprn`. HMRC R68 + the kiosk Gift Aid form both need
house_number as a separate field, and the live admin view should be able
to display the donor's house number without parsing `formatted`.

Compliance snapshot still lives on gift_aid_declarations.house_number
(migration 023) — that row is never updated after insert. This adds
the same field to the canonical CRM table so the live join can show
the donor's current address without touching the snapshot.

Idempotent.
"""
from alembic import op

revision = '024'
down_revision = '023'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE addresses ADD COLUMN IF NOT EXISTS house_number VARCHAR(50) NOT NULL DEFAULT ''")


def downgrade() -> None:
    op.execute("ALTER TABLE addresses DROP COLUMN IF EXISTS house_number")
