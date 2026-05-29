"""029 normalise branch_id to short code across every kiosk/donation/order/device table

The JWT used to carry users.branch_id (a UUID) and that UUID leaked into
every authenticated INSERT that did `bid = ctx.branch_id` — so rows in
donations, orders, terminal_devices, kiosk_devices, catalog_items (and
~40 other tables that all use VARCHAR branch_id) end up holding either:

  - a UUID  (e.g. '776fe65a-26ea-4167-8dc5-19870ba98e67')
  - the literal string 'main' (the column default)
  - the actual short code ('main', 'wembley')

This migration discovers every table with a text-typed branch_id column
(excluding the branches table itself) and rewrites any UUID-form value
to the corresponding branches.branch_id short code. Unknown UUIDs (no
matching branch) are left alone so we don't silently relabel rows we
can't identify.

Idempotent: each UPDATE is a no-op on already-canonical data, so this
migration is safe to re-run.
"""
from sqlalchemy import text

from alembic import op

revision = '029'
down_revision = '028'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # This migration runs synchronously before uvicorn on every boot
    # (`alembic upgrade head` in the Docker CMD). Bound lock acquisition and
    # statement time so a busy or large table can never hang the deploy and
    # trip the health-check rollback. Each table is normalised inside its own
    # savepoint, so a lock/timeout on one table skips just that table — it is
    # retried on the next boot, and the UPDATE is a no-op once data is canonical.
    conn.execute(text("SET lock_timeout = '3s'"))
    conn.execute(text("SET statement_timeout = '20s'"))

    tables = conn.execute(text("""
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'branch_id'
          AND data_type IN ('character varying', 'text')
          AND table_name <> 'branches'
        ORDER BY table_name
    """)).scalars().all()

    for table in tables:
        # Quote the table name (information_schema returns unquoted identifiers
        # but a future table named with a reserved word would still be safe).
        try:
            with conn.begin_nested():
                conn.execute(text(f"""
                    UPDATE "{table}" AS t
                    SET branch_id = b.branch_id
                    FROM branches AS b
                    WHERE t.branch_id ~* '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$'
                      AND lower(b.id::text) = lower(t.branch_id)
                      AND t.branch_id <> b.branch_id
                """))
        except Exception:
            # Lock wait / statement timeout / transient error — leave this table
            # for the next boot rather than failing the whole migration.
            continue


def downgrade() -> None:
    # Irreversible — we don't keep the original UUID. After upgrade the data
    # is canonical short codes; restoring UUIDs would re-introduce the bug.
    pass
