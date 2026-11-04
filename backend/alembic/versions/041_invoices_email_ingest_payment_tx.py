"""041 invoices + invoice_attachments + email_ingest_messages + payment_transactions + payment_sync_log

Backs the new /finance/invoices and /finance/transactions admin pages.

Tables (all idempotent):

  - email_ingest_messages
      One row per email seen (key: Message-ID). Stores AI classification
      + confidence + extracted JSON + body excerpt + headers. Lets
      finance audit what the inbox pulled and what the model saw.

  - invoices
      Finance's single record for supplier/finance documents —
      invoices, purchase orders, receipts, statements. Discriminated by
      doc_type. Status lifecycle: DRAFT → APPROVED → PAID → VOID.
      Natural de-dup on (doc_type, supplier_email, doc_number).

  - invoice_attachments
      PDFs, images, etc. that arrived with the email. Bytes in-row.

  - payment_transactions
      Unified ledger across Stripe + SumUp — one row per money
      movement. UNIQUE (provider, external_id) so the nightly sync is
      idempotent. Covers charges, refunds, fees, payouts.

  - payment_sync_log
      One row per sync run (cursor, counts, status, error, trigger).
      Powers the Admin → Finance → Stripe + SumUp "sync history" view.

This is a single consolidated migration (vs the four separate ones on
the feature branch) because we're landing the invoices + transactions
admin pages as one focused change set.
"""
from alembic import op

revision = '041'
down_revision = '040'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── email_ingest_messages ───────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS email_ingest_messages (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            message_id        TEXT NOT NULL,
            uid               TEXT NOT NULL DEFAULT '',
            folder            TEXT NOT NULL DEFAULT 'INBOX',
            from_address      TEXT NOT NULL DEFAULT '',
            to_address        TEXT NOT NULL DEFAULT '',
            subject           TEXT NOT NULL DEFAULT '',
            received_at       TIMESTAMPTZ,
            body_excerpt      TEXT NOT NULL DEFAULT '',
            classification    TEXT NOT NULL DEFAULT 'UNCLASSIFIED'
                              CHECK (classification IN (
                                'INVOICE', 'PURCHASE_ORDER', 'RECEIPT',
                                'STATEMENT', 'OTHER', 'UNCLASSIFIED'
                              )),
            confidence        NUMERIC(3,2) NOT NULL DEFAULT 0.00,
            extracted_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
            status            TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'processed', 'error', 'skipped')),
            error_message     TEXT NOT NULL DEFAULT '',
            raw_headers       JSONB NOT NULL DEFAULT '{}'::jsonb,
            model             TEXT NOT NULL DEFAULT '',
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            processed_at      TIMESTAMPTZ,
            UNIQUE (message_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_eim_received
          ON email_ingest_messages (received_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_eim_status
          ON email_ingest_messages (status, classification)
    """)

    # ── invoices (supplier documents, discriminated by doc_type) ────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoices (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            doc_type          TEXT NOT NULL CHECK (doc_type IN (
                                'INVOICE', 'PURCHASE_ORDER', 'RECEIPT', 'STATEMENT'
                              )),
            doc_number        TEXT NOT NULL DEFAULT '',
            supplier_name     TEXT NOT NULL DEFAULT '',
            supplier_email    TEXT NOT NULL DEFAULT '',
            supplier_vat_id   TEXT NOT NULL DEFAULT '',
            issued_date       DATE,
            due_date          DATE,
            total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
            net_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
            vat_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
            currency          TEXT NOT NULL DEFAULT 'GBP',
            branch_id         TEXT NOT NULL DEFAULT 'main',
            source            TEXT NOT NULL DEFAULT 'email'
                              CHECK (source IN ('email', 'manual', 'upload')),
            source_email_id   UUID REFERENCES email_ingest_messages(id) ON DELETE SET NULL,
            status            TEXT NOT NULL DEFAULT 'DRAFT'
                              CHECK (status IN ('DRAFT', 'APPROVED', 'PAID', 'VOID')),
            notes             TEXT NOT NULL DEFAULT '',
            raw_fields        JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at        TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_inv_type_status
          ON invoices (doc_type, status) WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_inv_supplier
          ON invoices (supplier_name) WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_inv_source_email
          ON invoices (source_email_id) WHERE source_email_id IS NOT NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_supplier_docnum
          ON invoices (doc_type, supplier_email, doc_number)
          WHERE deleted_at IS NULL
            AND doc_number <> ''
            AND supplier_email <> ''
    """)

    # ── invoice_attachments ─────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoice_attachments (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            filename      TEXT NOT NULL,
            content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
            size_bytes    INTEGER NOT NULL DEFAULT 0,
            data          BYTEA NOT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ia_document ON invoice_attachments (document_id)
    """)

    # ── payment_transactions (unified Stripe + SumUp ledger) ────────────────
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
          ON payment_transactions (source_ref) WHERE source_ref <> ''
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_pt_kind_status
          ON payment_transactions (provider, kind, status)
    """)

    # ── payment_sync_log ────────────────────────────────────────────────────
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
    op.execute("DROP TABLE IF EXISTS invoice_attachments")
    op.execute("DROP TABLE IF EXISTS invoices")
    op.execute("DROP TABLE IF EXISTS email_ingest_messages")
