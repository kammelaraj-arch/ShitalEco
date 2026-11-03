"""030 payment_transactions + payment_sync_log for daily Stripe/SumUp sync

User request: "sync/get all Sumup, Strip transaction every day for
financial clarity."

Two tables, both idempotent:

  - payment_transactions — a unified transaction ledger across providers.
    One row per Stripe BalanceTransaction or SumUp transaction. Stripe
    rows cover charges, refunds, payouts, fees — the full money
    movement, so totals reconcile cleanly against a bank statement.
    SumUp rows cover card-reader transactions and their refunds.

    UNIQUE (provider, external_id) means a daily re-run never
    duplicates a row. Incremental sync uses MAX(provider_created_at)
    as the cursor.

  - payment_sync_log — one row per sync run. Records provider, cursor
    range, counts (inserted/updated/skipped), errors, duration. So
    finance can see at a glance what the last sync did and whether it
    was clean.

No FKs — this ledger stands on its own, deliberately: if a Stripe
transaction has no matching donation row in our system (e.g. test-mode
noise, refund issued directly in dashboard), we still see it here and
can reconcile manually.
"""
from alembic import op

revision = '030'
down_revision = '029'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS payment_transactions (
            id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider              TEXT NOT NULL CHECK (provider IN ('stripe', 'sumup')),
            external_id           TEXT NOT NULL,
            kind                  TEXT NOT NULL,
            status                TEXT NOT NULL DEFAULT '',
            amount_pence          BIGINT NOT NULL DEFAULT 0,
            currency              TEXT NOT NULL DEFAULT 'GBP',
            fee_pence             BIGINT NOT NULL DEFAULT 0,
            net_pence             BIGINT NOT NULL DEFAULT 0,
            description           TEXT NOT NULL DEFAULT '',
            customer_hint         TEXT NOT NULL DEFAULT '',
            payment_method_hint   TEXT NOT NULL DEFAULT '',
            source_ref            TEXT NOT NULL DEFAULT '',
            payout_ref            TEXT NOT NULL DEFAULT '',
            provider_created_at   TIMESTAMPTZ NOT NULL,
            raw                   JSONB NOT NULL DEFAULT '{}'::jsonb,
            synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (provider, external_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_pt_provider_created
          ON payment_transactions (provider, provider_created_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_pt_source_ref
          ON payment_transactions (source_ref)
          WHERE source_ref <> ''
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_pt_kind_status
          ON payment_transactions (provider, kind, status)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS payment_sync_log (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider        TEXT NOT NULL,
            started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at    TIMESTAMPTZ,
            cursor_from     TIMESTAMPTZ,
            cursor_to       TIMESTAMPTZ,
            rows_fetched    INTEGER NOT NULL DEFAULT 0,
            rows_inserted   INTEGER NOT NULL DEFAULT 0,
            rows_updated    INTEGER NOT NULL DEFAULT 0,
            status          TEXT NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'ok', 'error', 'skipped')),
            error_message   TEXT NOT NULL DEFAULT '',
            triggered_by    TEXT NOT NULL DEFAULT ''
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_psl_provider_started
          ON payment_sync_log (provider, started_at DESC)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS payment_sync_log")
    op.execute("DROP TABLE IF EXISTS payment_transactions")
