"""039 one-shot — remote-reload KK1 so the restored reader lands without re-login

User direction: "Can't you force relogin remotely?"

The Quick Donation kiosk already polls POST /quick-donation/check-command
every 30 s and acts on any pending command. We queue `reload-config` on
KK1 so the kiosk re-pulls its device config (including the
`stripe_reader_id = tmr_Gcuz1QQB6nzqMs` restored by migration 038) at
its next poll — no manual logout + login.

Scoped to KK1 only. The command's queue mechanism itself clears the row
on ack, so leaving `pending_command` set here is self-cleaning.
"""
from alembic import op

revision = '039'
down_revision = '038'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("SET LOCAL statement_timeout = '10s'")
    op.execute("""
        UPDATE kiosk_devices
           SET pending_command    = 'reload-config',
               pending_command_at = NOW(),
               updated_at         = NOW()
         WHERE LOWER(device_username) = 'kk1'
           AND deleted_at IS NULL
           AND UPPER(status)  = 'ACTIVE'
    """)


def downgrade() -> None:
    # Clear the queued command without acknowledging it as executed.
    op.execute("""
        UPDATE kiosk_devices
           SET pending_command    = NULL,
               pending_command_at = NULL,
               updated_at         = NOW()
         WHERE LOWER(device_username) = 'kk1'
           AND pending_command = 'reload-config'
    """)
