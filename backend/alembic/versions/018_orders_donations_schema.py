"""018 — add missing orders columns and create donations table

The orders table (created in 006) was missing columns required by the
create_pending_order and record_quick_donation endpoints.
The donations table was referenced by the backend but never created.
All inserts were silently failing, causing zero transactions to be recorded.
"""
from alembic import op

revision = '018'
down_revision = '017'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── orders: add missing columns (idempotent) ──────────────────────────────
    for ddl in [
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id       VARCHAR(64)  DEFAULT NULL",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS device_id     VARCHAR(128) DEFAULT NULL",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS device_label  VARCHAR(256) DEFAULT NULL",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS source        VARCHAR(64)  DEFAULT 'kiosk'",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_id    VARCHAR(64)  DEFAULT NULL",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_aid_eligible BOOLEAN  DEFAULT FALSE",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS ga_full_name  VARCHAR(256) DEFAULT ''",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS ga_postcode   VARCHAR(16)  DEFAULT ''",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS ga_address    VARCHAR(512) DEFAULT ''",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS ga_email      VARCHAR(256) DEFAULT ''",
    ]:
        op.execute(ddl)

    # ── donations table ───────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS donations (
            id                  VARCHAR(64)     PRIMARY KEY,
            user_id             VARCHAR(64)     DEFAULT NULL,
            contact_id          VARCHAR(64)     DEFAULT NULL,
            branch_id           VARCHAR(64)     DEFAULT 'main',
            amount              NUMERIC(10,2)   NOT NULL,
            currency            VARCHAR(3)      NOT NULL DEFAULT 'GBP',
            gift_aid_eligible   BOOLEAN         NOT NULL DEFAULT FALSE,
            purpose             VARCHAR(256)    NOT NULL DEFAULT 'General Fund',
            reference           VARCHAR(64)     NOT NULL,
            payment_provider    VARCHAR(64)     DEFAULT NULL,
            payment_ref         VARCHAR(256)    DEFAULT NULL,
            status              VARCHAR(32)     NOT NULL DEFAULT 'PENDING',
            source              VARCHAR(64)     DEFAULT 'kiosk',
            idempotency_key     VARCHAR(128)    UNIQUE,
            created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMP       NOT NULL DEFAULT NOW()
        )
    """)

    op.execute("CREATE INDEX IF NOT EXISTS ix_donations_reference   ON donations (reference)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_donations_user_id     ON donations (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_donations_branch_id   ON donations (branch_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_donations_status      ON donations (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_donations_created_at  ON donations (created_at)")


def downgrade() -> None:
    pass
