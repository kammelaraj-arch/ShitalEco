"""031 email ingest + supplier_documents

User direction: "next read emails and identify payments, invoice,
purchase order and create records."

Three tables, all idempotent:

  - email_ingest_messages
      One row per email we have seen, keyed by its RFC 5322 Message-ID
      header so re-polling the inbox never reprocesses the same
      message. Stores the classification AI produced, the extracted
      field set, and a short body excerpt for the admin page.

  - supplier_documents
      Finance's single record for anything a supplier sent us —
      invoices, purchase orders, receipts, statements. Discriminated by
      doc_type. One row per extracted document; attachments live in
      supplier_document_attachments (bytes in-row, same pattern as
      board_resolution_attachments).

  - supplier_document_attachments
      PDFs, images etc. that came with the email.

FKs chosen:
  - supplier_documents.source_email_id → email_ingest_messages(id)
    ON DELETE SET NULL   (keep the record if we prune the mail log)
  - supplier_document_attachments.document_id → supplier_documents(id)
    ON DELETE CASCADE    (orphans are useless)
"""
from alembic import op

revision = '031'
down_revision = '030'
branch_labels = None
depends_on = None


def upgrade() -> None:
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

    op.execute("""
        CREATE TABLE IF NOT EXISTS supplier_documents (
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
        CREATE INDEX IF NOT EXISTS ix_sd_type_status
          ON supplier_documents (doc_type, status)
          WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_sd_supplier
          ON supplier_documents (supplier_name)
          WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_sd_source_email
          ON supplier_documents (source_email_id)
          WHERE source_email_id IS NOT NULL
    """)
    # Natural de-dup: same supplier + same invoice number = same doc.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_sd_supplier_docnum
          ON supplier_documents (doc_type, supplier_email, doc_number)
          WHERE deleted_at IS NULL
            AND doc_number <> ''
            AND supplier_email <> ''
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS supplier_document_attachments (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id   UUID NOT NULL REFERENCES supplier_documents(id) ON DELETE CASCADE,
            filename      TEXT NOT NULL,
            content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
            size_bytes    INTEGER NOT NULL DEFAULT 0,
            data          BYTEA NOT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_sda_document
          ON supplier_document_attachments (document_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS supplier_document_attachments")
    op.execute("DROP TABLE IF EXISTS supplier_documents")
    op.execute("DROP TABLE IF EXISTS email_ingest_messages")
