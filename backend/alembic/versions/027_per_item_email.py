"""027 per-item post-payment email + per-device menu options

Two device/catalogue settings the user requested:

  catalog_items
    - send_email_on_payment BOOLEAN     — toggle in admin UI
    - email_template_key    VARCHAR(100) — which email_templates row to send
                                            (e.g. "brick_donation_thanks")

  kiosk_devices
    - menu_options JSONB                — per-device staff-menu visibility,
                                            e.g. {"test_print": true,
                                                  "theme_cycle": false,
                                                  "refresh": true,
                                                  "admin": true}

When a kiosk order completes, the backend looks at every line item's
catalog_items row; for any item with send_email_on_payment=true and a
non-empty email_template_key, it renders that template with the customer
+ transaction context and sends one email per item per order (one email
per quantity is NOT what the user asked for — 5 bricks → 1 email).

Idempotent.
"""
from alembic import op

revision = '027'
down_revision = '026'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE catalog_items "
        "ADD COLUMN IF NOT EXISTS send_email_on_payment BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        "ALTER TABLE catalog_items "
        "ADD COLUMN IF NOT EXISTS email_template_key VARCHAR(100) NOT NULL DEFAULT ''"
    )
    op.execute(
        "ALTER TABLE kiosk_devices "
        "ADD COLUMN IF NOT EXISTS menu_options JSONB NOT NULL DEFAULT "
        "'{\"test_print\": true, \"theme_cycle\": true, \"refresh\": true, \"admin\": true}'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE kiosk_devices DROP COLUMN IF EXISTS menu_options")
    op.execute("ALTER TABLE catalog_items DROP COLUMN IF EXISTS email_template_key")
    op.execute("ALTER TABLE catalog_items DROP COLUMN IF EXISTS send_email_on_payment")
