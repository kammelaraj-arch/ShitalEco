"""035 one-shot heal — flip rows whose label CLEARLY identifies them as SumUp

Follow-up to 034. 034 only touched rows where stripe_reader_id was NULL
or empty, but the Wembley rows had a placeholder tmr_Gcuz1QQB6nzqMs
pasted into stripe_reader_id while their LABEL plainly says "Solo" or
carries a `2001xxxxxxx` SumUp Solo serial. The 034 WHERE clause skipped
them.

Fix: when label evidence is overwhelming, flip regardless of
stripe_reader_id and wipe the placeholder so the provider-match query
can't cross-wire the row with any real Stripe terminal in the future.

Label-evidence rule (unanimous or we don't touch):
  * label matches r'(?i)\\bsolo\\b'   — "Solo-Webley-02", "SOLO", etc.
  * OR label contains r'\\b(2001|2002)\\d{7,8}\\b' — SumUp Solo serial

Idempotent — re-running finds zero orphans on a healthy DB.
"""
from alembic import op

revision = '035'
down_revision = '034'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("SET LOCAL statement_timeout = '10s'")

    op.execute(r"""
        UPDATE terminal_devices
        SET provider = 'sumup',
            stripe_reader_id = NULL,
            updated_at = NOW()
        WHERE deleted_at IS NULL
          AND provider = 'stripe_terminal'
          AND (
                label ~* '\ysolo\y'
             OR label ~  '\y(2001|2002)[0-9]{7,8}\y'
          )
    """)


def downgrade() -> None:
    # No-op: this is a data heal, there is no sensible rollback.
    pass
