"""033 generic audit log — track all admin-mutable writes

Universal (entity_type, entity_id) design so one table captures writes
across every mutable domain — card readers, kiosk devices, employees,
volunteers, activities, recurring subscriptions, you name it. Routers
drop a single `await record_audit(…)` call after a successful write
and the "who changed what, when" trail is immediate.

Row shape:
  actor_email       — email of the trustee / admin who did it
                       (anonymous@kiosk for unauthenticated flows)
  actor_role        — role at the time of the change (SUPER_ADMIN,
                       BRANCH_MANAGER, STAFF, …)
  action            — create | update | delete | assign | unassign | …
                       (free text; routers pick their own vocabulary)
  entity_type       — snake_case table name ('terminal_devices',
                       'employees', 'activities', …)
  entity_id         — the row's primary key, as text (UUID or whatever)
  branch_id         — denormalised so a branch-scoped audit view is a
                       single WHERE
  source_endpoint   — the HTTP path that fired the write, so when a
                       mystery mutation shows up you can trace which
                       client called it
  before_json       — the pre-change row (JSONB; NULL on create)
  after_json        — the post-change row (JSONB; NULL on delete)
  changed_fields    — the diff of keys that actually changed (so the
                       UI can show "provider: sumup → stripe_terminal"
                       without scanning the two blobs)
  diff_summary      — optional human line ("provider changed sumup →
                       stripe_terminal"), filled by the caller when
                       there's useful context the raw diff misses
  created_at        — write time
  request_id        — optional request-correlation id so multiple
                       audit rows that came from the same HTTP call
                       can be grouped in the UI

Branch_id can be NULL (super-admin-only entities), hence the explicit
nullability. Indexes cover the three queries the UI runs:
  1. "last N audits across this branch"            → (branch_id, created_at)
  2. "every change ever to this specific row"     → (entity_type, entity_id, created_at)
  3. "everything this actor did today"            → (actor_email, created_at)

board_audit_log (migration ~2690 in main.py) is a legacy pre-existing
audit table scoped to board meetings only. We DO NOT touch it. New
code uses THIS table.

Defensive statement timeouts match the house pattern.
"""
from alembic import op

revision = '033'
down_revision = '032'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("SET LOCAL statement_timeout = '20s'")

    op.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            actor_email     TEXT NOT NULL DEFAULT '',
            actor_role      TEXT,
            action          TEXT NOT NULL,
            entity_type     TEXT NOT NULL,
            entity_id       TEXT NOT NULL,
            branch_id       TEXT,
            source_endpoint TEXT,
            before_json     JSONB,
            after_json      JSONB,
            changed_fields  TEXT[],
            diff_summary    TEXT,
            request_id      TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # Hot path 1: branch-scoped audit feed, newest first.
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_log_branch_time
        ON audit_log (branch_id, created_at DESC)
    """)
    # Hot path 2: full history of a single row.
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_log_entity_time
        ON audit_log (entity_type, entity_id, created_at DESC)
    """)
    # Hot path 3: everything this user did (compliance / incident response).
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_log_actor_time
        ON audit_log (actor_email, created_at DESC)
    """)
    # Correlation grouping for the UI.
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_log_request
        ON audit_log (request_id)
        WHERE request_id IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit_log")
