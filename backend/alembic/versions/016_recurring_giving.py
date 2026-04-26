"""Recurring giving tiers and donor subscriptions"""
from alembic import op

revision = '016'
down_revision = '015_payment_providers'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS recurring_giving_tiers (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            amount          DECIMAL(10,2) NOT NULL,
            label           VARCHAR(200)  NOT NULL DEFAULT '',
            description     VARCHAR(500)            DEFAULT '',
            frequency       VARCHAR(20)             DEFAULT 'MONTH',
            is_active       BOOLEAN                 DEFAULT true,
            is_default      BOOLEAN                 DEFAULT false,
            display_order   INT                     DEFAULT 0,
            paypal_plan_id  VARCHAR(255)            DEFAULT '',
            created_at      TIMESTAMPTZ             DEFAULT NOW(),
            updated_at      TIMESTAMPTZ             DEFAULT NOW()
        )
    """)

    op.execute("""
        INSERT INTO recurring_giving_tiers
            (amount, label, description, is_active, is_default, display_order)
        VALUES
            (5.00,  'Lamp Supporter',  'Supports daily lamp lighting at the temple',        true, false, 1),
            (11.00, 'Prasad Patron',   'Provides weekly prasad offering to devotees',        true, true,  2),
            (21.00, 'Puja Sponsor',    'Sponsors a monthly puja ceremony',                   true, false, 3),
            (51.00, 'Festival Friend', 'Helps cover special festival and event costs',        true, false, 4)
        ON CONFLICT DO NOTHING
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS recurring_giving_subscriptions (
            id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            paypal_subscription_id  VARCHAR(255) UNIQUE,
            paypal_plan_id          VARCHAR(255)            DEFAULT '',
            tier_id                 UUID        REFERENCES recurring_giving_tiers(id) ON DELETE SET NULL,
            amount                  DECIMAL(10,2) NOT NULL,
            frequency               VARCHAR(20)             DEFAULT 'MONTH',
            status                  VARCHAR(50)             DEFAULT 'PENDING_APPROVAL',
            branch_id               VARCHAR(100)            DEFAULT 'main',
            donor_name              VARCHAR(255)            DEFAULT '',
            donor_email             VARCHAR(255)            DEFAULT '',
            approved_at             TIMESTAMPTZ,
            cancelled_at            TIMESTAMPTZ,
            created_at              TIMESTAMPTZ             DEFAULT NOW(),
            updated_at              TIMESTAMPTZ             DEFAULT NOW()
        )
    """)

    op.execute("CREATE INDEX IF NOT EXISTS idx_rgs_status ON recurring_giving_subscriptions(status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_rgs_email  ON recurring_giving_subscriptions(donor_email)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS recurring_giving_subscriptions")
    op.execute("DROP TABLE IF EXISTS recurring_giving_tiers")
