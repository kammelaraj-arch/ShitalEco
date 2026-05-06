"""026 CRM Accounts (companies / organisations)

Adds Dynamics-style CRM Accounts on top of the existing Contacts/Addresses
schema. Tables are prefixed `crm_` to avoid collision with the existing
Finance chart-of-accounts table also called `accounts`.

  - crm_accounts            companies / organisations
  - crm_account_contacts    M:N link with role (e.g. "CEO", "Trustee")
  - crm_account_services    multiple services / capabilities per account
  - addresses.crm_account_id nullable FK so an existing address can also
                              belong to an account (we reuse addresses —
                              no separate org-address table)

Idempotent + self-healing: drops stale state from a prior failed run
on this same migration revision before recreating.
"""
from alembic import op

revision = '026'
down_revision = '024'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Self-heal: a previous attempt may have added addresses.account_id
    #    and/or stub tables before failing. Drop them so we start clean.
    op.execute("ALTER TABLE addresses DROP CONSTRAINT IF EXISTS addresses_account_id_fkey")
    op.execute("DROP INDEX  IF EXISTS idx_addresses_account")
    op.execute("ALTER TABLE addresses DROP COLUMN IF EXISTS account_id")
    op.execute("DROP TABLE IF EXISTS account_services")
    op.execute("DROP TABLE IF EXISTS account_contacts")

    # ── crm_accounts ────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS crm_accounts (
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
            parent_account_id    UUID REFERENCES crm_accounts(id) ON DELETE SET NULL,
            owner_user_id        UUID,
            branch_id            VARCHAR(64) NOT NULL DEFAULT '',
            notes                TEXT NOT NULL DEFAULT '',
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at           TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_accounts_name    ON crm_accounts(name)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_accounts_type    ON crm_accounts(account_type)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_accounts_status  ON crm_accounts(status) WHERE deleted_at IS NULL")
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_accounts_primary ON crm_accounts(primary_contact_id)")

    # ── M:N: crm_accounts ↔ contacts (with role) ────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS crm_account_contacts (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id  UUID NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
            contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            role        VARCHAR(150) NOT NULL DEFAULT '',
            is_primary  BOOLEAN NOT NULL DEFAULT false,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (account_id, contact_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_account_contacts_acct ON crm_account_contacts(account_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_account_contacts_cont ON crm_account_contacts(contact_id)")

    # ── Services (multiple per account) ─────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS crm_account_services (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id   UUID NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
            service_name VARCHAR(200) NOT NULL,
            service_type VARCHAR(50)  NOT NULL DEFAULT '',
            description  TEXT NOT NULL DEFAULT '',
            is_active    BOOLEAN NOT NULL DEFAULT true,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_account_services_acct ON crm_account_services(account_id)")

    # ── Reuse existing addresses table — add nullable crm_account_id ────
    op.execute(
        "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS crm_account_id UUID "
        "REFERENCES crm_accounts(id) ON DELETE SET NULL"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_addresses_crm_account ON addresses(crm_account_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_addresses_crm_account")
    op.execute("ALTER TABLE addresses DROP COLUMN IF EXISTS crm_account_id")
    op.execute("DROP TABLE IF EXISTS crm_account_services")
    op.execute("DROP TABLE IF EXISTS crm_account_contacts")
    op.execute("DROP TABLE IF EXISTS crm_accounts")
