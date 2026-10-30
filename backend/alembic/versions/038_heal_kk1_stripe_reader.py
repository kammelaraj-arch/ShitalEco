"""038 one-shot heal — restore KK1's Stripe Terminal assignment

Context: the Quick Donation kiosk device "On Main Hundi"
(device_username = 'kk1', branch_id = 'wembley_main') was paired to a
BBPOS WisePOS E (Stripe Terminal reader `tmr_Gcuz1QQB6nzqMs`, label
"honeydew-everyone-then"). The reader is still online in Stripe
(verified via GET /api/v1/kiosk/terminal/readers), but its
terminal_devices row b567471e-560c-4e54-b687-8a1bc67e2a87 was
soft-deleted and its `stripe_reader_id` was cleared — so Quick
Donation login kept failing with "Reader honeydew-everyone-then is
assigned but missing credentials".

User direction: "This kiosk must use Stripe Terminal. It should be in
the database."

Fix:
  1. If a non-deleted terminal_devices row for Wembley with
     stripe_reader_id = 'tmr_Gcuz1QQB6nzqMs' already exists, use it.
  2. Otherwise un-delete and populate the existing b567471e... row
     (preserves history) with the correct Stripe fields.
  3. Point kiosk_devices 'kk1' at that row's id.

Idempotent and specific to KK1 — doesn't touch any other device.
"""
from alembic import op

revision = '038'
down_revision = '037'
branch_labels = None
depends_on = None

STRIPE_READER_ID    = 'tmr_Gcuz1QQB6nzqMs'
READER_LABEL        = 'honeydew-everyone-then'
BRANCH_ID           = 'wembley_main'
DEVICE_USERNAME     = 'kk1'
GHOST_ROW_ID        = 'b567471e-560c-4e54-b687-8a1bc67e2a87'


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("SET LOCAL statement_timeout = '15s'")

    # 1) Prefer an existing LIVE row carrying this stripe_reader_id.
    #    If one exists we don't touch its data — we just point KK1 at it.
    #    Otherwise we revive the ghost row b567471e... in place.
    op.execute(f"""
        WITH live AS (
            SELECT id FROM terminal_devices
             WHERE stripe_reader_id = '{STRIPE_READER_ID}'
               AND deleted_at IS NULL
               AND COALESCE(is_active, true) = true
             LIMIT 1
        ),
        revived AS (
            UPDATE terminal_devices
               SET stripe_reader_id = '{STRIPE_READER_ID}',
                   provider         = 'stripe_terminal',
                   label            = CASE WHEN label IS NULL OR label = ''
                                           THEN '{READER_LABEL}' ELSE label END,
                   branch_id        = '{BRANCH_ID}',
                   is_active        = true,
                   deleted_at       = NULL,
                   sumup_reader_serial = '',
                   clover_device_id    = '',
                   updated_at       = NOW()
             WHERE id = '{GHOST_ROW_ID}'
               AND NOT EXISTS (SELECT 1 FROM live)
             RETURNING id
        ),
        chosen AS (
            SELECT id FROM live
            UNION ALL
            SELECT id FROM revived
            LIMIT 1
        )
        UPDATE kiosk_devices
           SET card_reader_id = (SELECT id FROM chosen),
               updated_at     = NOW()
         WHERE LOWER(device_username) = '{DEVICE_USERNAME}'
           AND deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM chosen)
    """)


def downgrade() -> None:
    # Point KK1 back at the pre-heal (ghost) row if it still exists.
    # We don't re-delete the row — leaving it live is harmless and avoids
    # losing the Stripe reader linkage on a reversion.
    op.execute(f"""
        UPDATE kiosk_devices
           SET card_reader_id = '{GHOST_ROW_ID}',
               updated_at     = NOW()
         WHERE LOWER(device_username) = '{DEVICE_USERNAME}'
           AND deleted_at IS NULL
    """)
