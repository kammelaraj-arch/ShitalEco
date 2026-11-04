"""032 rename supplier_documents → invoices (and attachments)

User direction: "we have invoices entity where we should store the
records entries."

The 031 tables were named supplier_documents / supplier_document_attachments.
Finance's mental model is a single "invoices" ledger that happens to
carry a doc_type discriminator (INVOICE / PURCHASE_ORDER / RECEIPT /
STATEMENT), so we rename to match.

Idempotent: renames only if the old name exists AND the new name
does not. Safe to run on fresh environments (where only 031 fresh
tables will already have the new name) and on partial deployments.

Indexes and constraints keep their names — PostgreSQL does not
automatically rename them with the table, but their names only show
in error messages / \\d output and don't affect correctness.
"""
from alembic import op

revision = '032'
down_revision = '031'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_documents')
               AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoices') THEN
                ALTER TABLE supplier_documents RENAME TO invoices;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_document_attachments')
               AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoice_attachments') THEN
                ALTER TABLE supplier_document_attachments RENAME TO invoice_attachments;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoice_attachments')
               AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_document_attachments') THEN
                ALTER TABLE invoice_attachments RENAME TO supplier_document_attachments;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoices')
               AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_documents') THEN
                ALTER TABLE invoices RENAME TO supplier_documents;
            END IF;
        END $$;
    """)
