"""026 CRM Accounts (companies / organisations)

Adds Dynamics-style Accounts on top of the existing Contacts/Addresses
schema:

  - accounts            — companies / organisations
  - account_contacts    — M:N link with role (e.g. "CEO", "Trustee")
  - account_services    — multiple services / capabilities per account
  - addresses.account_id — optional FK so an existing address can also
                           belong to an account (we reuse the existing
                           addresses table — no separate org-address table)

Idempotent (IF NOT EXISTS / safe-add). Soft-delete via deleted_at.
"""
from alembic import op

revision = '026'
down_revision = '024'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── accounts ────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS accounts (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name                 VARCHAR(300) NOT NULL,
            legal_name           VARCHAR(300) NOT NULL DEFAULT '',
            account_type         VARCHAR(50)  NOT NULL DEFAULT 'customer',
            status               VARCHAR(20)  NOT NULL DEFAULT 'active',
            website              VARCHAR(300) NOT NULL DEFAULT '',
            email                VARCHAR(254) NOT NULL DEFAULT '',
            phone                VARCHAR(50)  NOT NULL DEFAULT '',
            industry             VARCHAR(100) NOT NULL DEFAULT '',
            registration_number  VARCHAR(100) NOT NULL DEFAULT '',
            vat_number           VARCHAR(50)  NOT NULL DEFAULT '',
            charity_number       VARCHAR(50)  NOT NULL DEFAULT '',
            primary_contact_id   UUID REFERENCES contacts(id) ON DELETE SET NULL,
            parent_account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,
            owner_user_id        UUID,
            branch_id            VARCHAR(64) NOT NULL DEFAULT '',
            notes                TEXT NOT NULL DEFAULT '',
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at           TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_accounts_name    ON accounts(name)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_accounts_type    ON accounts(account_type)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_accounts_status  ON accounts(status) WHERE deleted_at IS NULL")
    op.execute("CREATE INDEX IF NOT EXISTS idx_accounts_primary ON accounts(primary_contact_id)")

    # ── M:N: accounts ↔ contacts (with role) ────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS account_contacts (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            role        VARCHAR(150) NOT NULL DEFAULT '',
            is_primary  BOOLEAN NOT NULL DEFAULT false,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (account_id, contact_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_account_contacts_acct ON account_contacts(account_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_account_contacts_cont ON account_contacts(contact_id)")

    # ── Services (multiple per account) ─────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS account_services (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            service_name VARCHAR(200) NOT NULL,
            service_type VARCHAR(50)  NOT NULL DEFAULT '',
            description  TEXT NOT NULL DEFAULT '',
            is_active    BOOLEAN NOT NULL DEFAULT true,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_account_services_acct ON account_services(account_id)")

    # ── reuse existing addresses table — add nullable account_id ────────
    op.execute(
        "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS account_id UUID "
        "REFERENCES accounts(id) ON DELETE SET NULL"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_addresses_account ON addresses(account_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_addresses_account")
    op.execute("ALTER TABLE addresses DROP COLUMN IF EXISTS account_id")
    op.execute("DROP TABLE IF EXISTS account_services")
    op.execute("DROP TABLE IF EXISTS account_contacts")
    op.execute("DROP TABLE IF EXISTS accounts")
