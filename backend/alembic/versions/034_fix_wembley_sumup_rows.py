"""034 one-shot fix — flip orphan stripe_terminal rows to sumup

Any terminal_devices row claiming provider='stripe_terminal' but with
NO stripe_reader_id cannot be a working Stripe terminal — Stripe needs
the `tmr_...` reader id to route payments. The Wembley Solos were
onboarded through an older code path that defaulted provider to
'stripe_terminal' and never wrote a stripe_reader_id, so the Admin →
Devices Card Reader dropdown has been labelling them "(stripe terminal)"
and the kiosk's provider-match query refused to pair them.

Fix: UPDATE those orphan rows to provider='sumup' in-place. The
SumUp pairing on the kiosk side keys off the device, not the backend
row, so no SDK re-pairing is needed. The row's label stays as-is.

Idempotent — re-running finds zero orphans on a healthy DB.
"""
from alembic import op

revision = '034'
down_revision = '033'
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
          AND provider = 'stripe_terminal'
          AND (stripe_reader_id IS NULL OR stripe_reader_id = '')
    """)


def downgrade() -> None:
    # No-op: this is a data heal, there is no sensible rollback. A row
    # that was flipped sumup → was never really stripe_terminal in the
    # first place, so putting the broken state back serves no one.
    pass
