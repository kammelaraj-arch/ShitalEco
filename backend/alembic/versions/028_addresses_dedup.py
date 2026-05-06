"""028 dedup addresses + unique constraint per (contact, postcode, house_number)

Bug: every kiosk gift-aid declaration ran a plain INSERT INTO addresses
with no ON CONFLICT, so the same donor accumulated identical address
rows on every donation. Admin → Addresses showed e.g. 3 copies of the
same RAJ K address.

Fix: delete duplicates (keeping the oldest per contact_id+postcode+
house_number), then a partial UNIQUE index so future inserts collide
and the upsert in code (next commit) takes the existing row.

Idempotent. Partial — only enforces uniqueness when contact_id IS NOT
NULL (anonymous addresses without a contact stay independent).
"""
from alembic import op

revision = '028'
down_revision = '027'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Dedup existing rows (keep oldest per group) ──────────────────────
    op.execute("""
        DELETE FROM addresses a
        USING addresses b
        WHERE a.id <> b.id
          AND a.contact_id IS NOT NULL
          AND a.contact_id = b.contact_id
          AND a.postcode   = b.postcode
          AND COALESCE(a.house_number, '') = COALESCE(b.house_number, '')
          AND a.created_at > b.created_at
    """)
    # Tie-breaker if two rows share the exact same created_at (rare but
    # possible) — keep the smaller UUID, delete the other.
    op.execute("""
        DELETE FROM addresses a
        USING addresses b
        WHERE a.id > b.id
          AND a.contact_id IS NOT NULL
          AND a.contact_id = b.contact_id
          AND a.postcode   = b.postcode
          AND COALESCE(a.house_number, '') = COALESCE(b.house_number, '')
          AND a.created_at = b.created_at
    """)

    # ── 2. Partial unique index (only when contact_id is set) ───────────────
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS addresses_unique_contact_pc_house
        ON addresses (contact_id, postcode, house_number)
        WHERE contact_id IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS addresses_unique_contact_pc_house")
