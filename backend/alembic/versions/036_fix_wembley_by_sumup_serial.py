"""036 one-shot heal — flip by sumup_reader_serial, the authoritative column

After 034/035 still left the Wembley rows showing provider=stripe_terminal,
the actual column data makes the answer obvious: `sumup_reader_serial`
holds a real Solo serial on those rows. If a row has a SumUp serial, it
IS a SumUp. The label text turned out to be a red herring — all 3 rows
share "honeydew-everyone-then" because the operator typed the same
friendly name three times.

Rule:
  sumup_reader_serial IS NOT NULL AND sumup_reader_serial != ''
    ⇒ provider = 'sumup', wipe any Stripe placeholder, keep the serial.

This supersedes the "look at label" heuristic. Idempotent.
"""
from alembic import op

revision = '036'
down_revision = '035'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("SET LOCAL statement_timeout = '10s'")

    op.execute("""
        UPDATE terminal_devices
        SET provider = 'sumup',
            stripe_reader_id = NULL,
            updated_at = NOW()
        WHERE deleted_at IS NULL
          AND provider <> 'sumup'
          AND sumup_reader_serial IS NOT NULL
          AND sumup_reader_serial <> ''
    """)


def downgrade() -> None:
    pass
