"""023 explicit donor fields on gift_aid_declarations

The original gift_aid_declarations table only had full_name and a free-form
address. The kiosk form has long collected first_name, surname, and
house_number separately — store them as proper columns so:
  - admin UI can show them in dedicated columns
  - HMRC XML builder can use them directly without splitting full_name on
    space (which is fragile for compound surnames or middle names)

All idempotent (IF NOT EXISTS) so safe to run repeatedly.
"""
from alembic import op

revision = '023'
down_revision = '022'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE gift_aid_declarations ADD COLUMN IF NOT EXISTS first_name  VARCHAR(100) DEFAULT ''")
    op.execute("ALTER TABLE gift_aid_declarations ADD COLUMN IF NOT EXISTS surname     VARCHAR(100) DEFAULT ''")
    op.execute("ALTER TABLE gift_aid_declarations ADD COLUMN IF NOT EXISTS house_number VARCHAR(50) DEFAULT ''")
    op.execute("ALTER TABLE gift_aid_declarations ADD COLUMN IF NOT EXISTS uprn         VARCHAR(50) DEFAULT ''")
    # Backfill split for any rows that have full_name but no first/surname
    op.execute("""
        UPDATE gift_aid_declarations
        SET first_name = SPLIT_PART(full_name, ' ', 1)
        WHERE COALESCE(first_name, '') = '' AND COALESCE(full_name, '') != ''
    """)
    op.execute("""
        UPDATE gift_aid_declarations
        SET surname = TRIM(SUBSTRING(full_name FROM POSITION(' ' IN full_name) + 1))
        WHERE COALESCE(surname, '') = '' AND POSITION(' ' IN full_name) > 0
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE gift_aid_declarations DROP COLUMN IF EXISTS uprn")
    op.execute("ALTER TABLE gift_aid_declarations DROP COLUMN IF EXISTS house_number")
    op.execute("ALTER TABLE gift_aid_declarations DROP COLUMN IF EXISTS surname")
    op.execute("ALTER TABLE gift_aid_declarations DROP COLUMN IF EXISTS first_name")
