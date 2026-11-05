"""043 payment_transactions.provider can be 'paypal'

The ledger already stores Stripe BalanceTransactions and SumUp
transactions. User wants PayPal money movements in the same view, so
widen the CHECK and clear the old one if present. Idempotent.
"""
from alembic import op

revision = '043'
down_revision = '042'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old constraint if still around under its auto-generated name.
    op.execute("""
        DO $$
        DECLARE
            cname TEXT;
        BEGIN
            SELECT conname INTO cname
              FROM pg_constraint
             WHERE conrelid = 'payment_transactions'::regclass
               AND contype = 'c'
               AND pg_get_constraintdef(oid) ILIKE '%provider%IN%';
            IF cname IS NOT NULL THEN
                EXECUTE 'ALTER TABLE payment_transactions DROP CONSTRAINT ' || quote_ident(cname);
            END IF;
        END $$;
    """)
    op.execute("""
        ALTER TABLE payment_transactions
          ADD CONSTRAINT payment_transactions_provider_check
          CHECK (provider IN ('stripe', 'sumup', 'paypal'))
    """)
    # Same for payment_sync_log.status (status 'skipped' already allowed; no
    # provider check here, so nothing to do — the earlier migration already
    # left it free-text).


def downgrade() -> None:
    op.execute("""
        ALTER TABLE payment_transactions
          DROP CONSTRAINT IF EXISTS payment_transactions_provider_check
    """)
    op.execute("""
        ALTER TABLE payment_transactions
          ADD CONSTRAINT payment_transactions_provider_check
          CHECK (provider IN ('stripe', 'sumup'))
    """)
