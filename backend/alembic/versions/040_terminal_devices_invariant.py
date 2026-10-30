"""040 terminal_devices — single-provider invariant guard + one-shot cleanup

User direction: "We must prevent this happening again to any of the devices."

The bug that bit KK1 was a terminal_devices row with
    provider = 'stripe_terminal'
    stripe_reader_id = ''                          ← emptied by auto-heal
    sumup_reader_serial = 'rdr_72KS212AT49ZJ8FXDEYK3C394F'  ← wrong column

Three identity columns (stripe_reader_id, sumup_reader_serial,
clover_device_id) are mutually exclusive by design — one per provider,
the other two empty. Nothing on prod enforced this, so a classifier
sweep in background_recovery.py was free to write both and silently
corrupt rows.

This migration adds a Postgres CHECK constraint so any future write
that violates the invariant fails loudly (23514 constraint violation
bubbling as an HTTP 500) instead of silently rotting data. Deleted
rows are exempted because the historical zombies on prod (e.g.
b567471e..., which 038 kept archived) still carry stale cross-provider
data from before this guard existed.

Before adding the constraint we blank the cross-provider ID columns on
all LIVE rows so the ALTER TABLE succeeds. This is a one-shot heal, not
an ongoing auto-heal — the invariant from here on is enforced by the
constraint itself, not by a sweep.
"""
from alembic import op

revision = '040'
down_revision = '039'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '30s'")

    # 1) One-shot pre-constraint cleanup. For every LIVE row, blank the
    #    identity columns that don't belong to its declared provider. The
    #    authoritative column for the provider is left untouched.
    op.execute("""
        UPDATE terminal_devices
           SET sumup_reader_serial = '',
               clover_device_id    = '',
               updated_at          = NOW()
         WHERE deleted_at IS NULL
           AND provider = 'stripe_terminal'
           AND (
                 (sumup_reader_serial IS NOT NULL AND sumup_reader_serial <> '')
              OR (clover_device_id    IS NOT NULL AND clover_device_id    <> '')
           )
    """)
    op.execute("""
        UPDATE terminal_devices
           SET stripe_reader_id = '',
               clover_device_id = '',
               updated_at       = NOW()
         WHERE deleted_at IS NULL
           AND provider = 'sumup'
           AND (
                 (stripe_reader_id IS NOT NULL AND stripe_reader_id <> '')
              OR (clover_device_id IS NOT NULL AND clover_device_id <> '')
           )
    """)
    op.execute("""
        UPDATE terminal_devices
           SET stripe_reader_id    = '',
               sumup_reader_serial = '',
               updated_at          = NOW()
         WHERE deleted_at IS NULL
           AND provider = 'clover'
           AND (
                 (stripe_reader_id    IS NOT NULL AND stripe_reader_id    <> '')
              OR (sumup_reader_serial IS NOT NULL AND sumup_reader_serial <> '')
           )
    """)

    # 2) Add the invariant. Deleted rows exempt. Live rows must have the
    #    authoritative column populated OR all three empty (unassigned),
    #    and the two non-authoritative columns must be blank.
    op.execute("""
        ALTER TABLE terminal_devices
          DROP CONSTRAINT IF EXISTS terminal_devices_single_provider_id
    """)
    op.execute("""
        ALTER TABLE terminal_devices
          ADD CONSTRAINT terminal_devices_single_provider_id CHECK (
            deleted_at IS NOT NULL
            OR provider NOT IN ('stripe_terminal', 'sumup', 'clover')
            OR (
                 provider = 'stripe_terminal'
                 AND COALESCE(sumup_reader_serial, '') = ''
                 AND COALESCE(clover_device_id,    '') = ''
            )
            OR (
                 provider = 'sumup'
                 AND COALESCE(stripe_reader_id, '') = ''
                 AND COALESCE(clover_device_id, '') = ''
            )
            OR (
                 provider = 'clover'
                 AND COALESCE(stripe_reader_id,    '') = ''
                 AND COALESCE(sumup_reader_serial, '') = ''
            )
          )
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE terminal_devices
          DROP CONSTRAINT IF EXISTS terminal_devices_single_provider_id
    """)
