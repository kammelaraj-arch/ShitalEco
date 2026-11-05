"""042 finance_accounts + payment_transactions.account_id

User direction: "we should have Bank/other account and its transaction
under finance like multiple bank account, strip, sumup, Temple Safe
Accounts to track, hundi counting different locations. shoe latest
first and trans must be linked to its account. and we need flexibility
to add more types etc."

Finance now has one table of real-world money containers — bank
accounts, payment-provider accounts, physical cash locations (Temple
Safe, Hundi boxes per branch), PayPal, cash tills, anything else the
charity needs to track. The type field is a free-text slug (no CHECK
constraint) so finance can add new types without a code change; the
UI offers a dropdown of known types and a free-text fallback.

Every payment_transactions row gets a nullable FK to the account it
hit. Existing rows stay unlinked until the sync backfills them on the
next run — the sync reads the provider name and looks up the primary
account of that provider (sort_order ASC, is_active=true, ON CONFLICT
DO NOTHING on reruns). Rows added before this migration landed will
link on the next sync.

Seed rows: a handful of sensible defaults for Wembley, idempotent. Ops
can rename / delete / add more from Admin → Finance → Accounts.
"""
from alembic import op

revision = '042'
down_revision = '041'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS finance_accounts (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name              TEXT NOT NULL,
            account_type      TEXT NOT NULL DEFAULT 'OTHER',
            branch_id         TEXT NOT NULL DEFAULT '',
            currency          TEXT NOT NULL DEFAULT 'GBP',
            external_ref      TEXT NOT NULL DEFAULT '',
            opening_balance   NUMERIC(14,2) NOT NULL DEFAULT 0,
            notes             TEXT NOT NULL DEFAULT '',
            is_active         BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order        INTEGER NOT NULL DEFAULT 100,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at        TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_fa_type_active
          ON finance_accounts (account_type, sort_order)
          WHERE deleted_at IS NULL AND is_active = true
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_name_branch
          ON finance_accounts (LOWER(name), LOWER(branch_id))
          WHERE deleted_at IS NULL
    """)

    op.execute("""
        ALTER TABLE payment_transactions
          ADD COLUMN IF NOT EXISTS account_id UUID
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'pt_account_fk'
            ) THEN
                ALTER TABLE payment_transactions
                  ADD CONSTRAINT pt_account_fk
                  FOREIGN KEY (account_id)
                  REFERENCES finance_accounts(id)
                  ON DELETE SET NULL;
            END IF;
        END $$;
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_pt_account
          ON payment_transactions (account_id)
          WHERE account_id IS NOT NULL
    """)

    # Idempotent seed — operator can rename / delete / add more from the UI.
    op.execute("""
        INSERT INTO finance_accounts (name, account_type, branch_id, sort_order, notes)
        VALUES
          ('Stripe — UK',                 'STRIPE', '',        10, 'Online card + Terminal — Stripe'),
          ('SumUp — UK',                  'SUMUP',  '',        20, 'Card reader — SumUp'),
          ('PayPal — UK',                 'PAYPAL', '',        30, 'Online donations — PayPal'),
          ('NatWest Current',             'BANK',   '',        40, 'Primary bank current account'),
          ('Temple Safe — Wembley',       'SAFE',   'wembley', 50, 'Physical safe at Wembley'),
          ('Hundi — Wembley',             'HUNDI',  'wembley', 60, 'Offering box — Wembley temple'),
          ('Cash Till — Wembley',         'CASH',   'wembley', 70, 'Front desk cash till')
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS pt_account_fk")
    op.execute("ALTER TABLE payment_transactions DROP COLUMN IF EXISTS account_id")
    op.execute("DROP TABLE IF EXISTS finance_accounts")
