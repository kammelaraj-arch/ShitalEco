"""032 custom checklists on activities + per-assignment tick state

Builds on migration 031 (attendance + activities). An activity template now
carries an ordered list of ``activity_checklist_items`` — each with a type
(checkbox / text / number / photo / signature), required flag, optional
help text. When a template is assigned to someone, the per-instance tick
state lives in ``activity_assignment_checklist_state`` (one row per
(assignment, item), carrying the ticked bool + whichever value field
matches the item's type).

Scope cut (deliberate): no schedule / recurrence yet — that's phase 2.
Phase 1 is: trustees define a custom checklist on a template, then anyone
assigned the activity ticks off items with values + evidence.

Defensive statement timeouts match the house pattern (migrations 028-031).
Everything idempotent so a re-run after a partial failure is safe.
"""
from alembic import op

revision = '032'
down_revision = '031'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("SET LOCAL statement_timeout = '20s'")

    # ── 1. activity_checklist_items ───────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS activity_checklist_items (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            activity_id   UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
            label         TEXT NOT NULL,
            item_type     TEXT NOT NULL
                            CHECK (item_type IN
                                   ('checkbox','text','number','photo','signature')),
            required      BOOLEAN NOT NULL DEFAULT TRUE,
            help_text     TEXT,
            order_index   INTEGER NOT NULL DEFAULT 0,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    # Hot path: render a template's checklist in order.
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_checklist_items_activity_order
        ON activity_checklist_items (activity_id, order_index, id)
    """)

    # ── 2. activity_assignment_checklist_state ────────────────────────────
    #     One row per (assignment, item). Carries whichever value column
    #     matches the item's type. Also stores who checked and when, so an
    #     audit view can show "ticked by X at 09:14".
    op.execute("""
        CREATE TABLE IF NOT EXISTS activity_assignment_checklist_state (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            assignment_id  UUID NOT NULL REFERENCES activity_assignments(id)
                              ON DELETE CASCADE,
            item_id        UUID NOT NULL REFERENCES activity_checklist_items(id)
                              ON DELETE CASCADE,
            is_checked     BOOLEAN NOT NULL DEFAULT FALSE,
            value_text     TEXT,
            value_number   NUMERIC,
            photo_url      TEXT,
            signature_data TEXT,         -- data: URI or object-storage ref
            checked_by     TEXT,
            checked_at     TIMESTAMPTZ,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    # Each (assignment, item) pair must be unique — one state row per combo.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_state_unique
        ON activity_assignment_checklist_state (assignment_id, item_id)
    """)
    # Lookup state for an assignment (the "fetch my checklist" query).
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_checklist_state_assignment
        ON activity_assignment_checklist_state (assignment_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS activity_assignment_checklist_state")
    op.execute("DROP TABLE IF EXISTS activity_checklist_items")
