"""046 payment_transactions — rich detail columns

User direction: "get all the transaction detail as much as possible,
cover all important fields."

Adds the columns finance needs to answer common questions without
re-opening the Stripe / SumUp / PayPal dashboard:

  - Donor identity         customer_name, customer_email, customer_phone
  - Billing location       billing_country, billing_postcode
  - Payment method         payment_method_type, card_brand, card_last4,
                           card_country, card_funding
  - Processor trail        receipt_url, statement_descriptor,
                           available_at (funds availability)
  - Dispute / refund state refunded, refund_amount_pence, disputed

All nullable with sensible defaults so existing rows stay valid and
reruns of sync upsert the columns via COALESCE in the router code.
"""
from alembic import op

revision = '046'
down_revision = '045'
branch_labels = None
depends_on = None


_COLS = [
    "customer_name TEXT NOT NULL DEFAULT ''",
    "customer_email TEXT NOT NULL DEFAULT ''",
    "customer_phone TEXT NOT NULL DEFAULT ''",
    "billing_country TEXT NOT NULL DEFAULT ''",
    "billing_postcode TEXT NOT NULL DEFAULT ''",
    "payment_method_type TEXT NOT NULL DEFAULT ''",
    "card_brand TEXT NOT NULL DEFAULT ''",
    "card_last4 TEXT NOT NULL DEFAULT ''",
    "card_country TEXT NOT NULL DEFAULT ''",
    "card_funding TEXT NOT NULL DEFAULT ''",
    "receipt_url TEXT NOT NULL DEFAULT ''",
    "statement_descriptor TEXT NOT NULL DEFAULT ''",
    "available_at TIMESTAMPTZ",
    "refunded BOOLEAN NOT NULL DEFAULT false",
    "refund_amount_pence BIGINT NOT NULL DEFAULT 0",
    "disputed BOOLEAN NOT NULL DEFAULT false",
]


def upgrade() -> None:
    for col in _COLS:
        name = col.split(" ", 1)[0]
        op.execute(f"ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS {col}")  # noqa: S608
        _ = name
    # Common lookup — finance frequently filters by donor email.
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_pt_customer_email
          ON payment_transactions (LOWER(customer_email))
          WHERE customer_email <> ''
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_pt_disputed
          ON payment_transactions (disputed)
          WHERE disputed = true
    """)


def downgrade() -> None:
    for col in _COLS:
        name = col.split(" ", 1)[0]
        op.execute(f"ALTER TABLE payment_transactions DROP COLUMN IF EXISTS {name}")  # noqa: S608
