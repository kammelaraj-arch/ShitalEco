"""031 attendance + activities (staff / volunteer check-in + assigned tasks)

Three tables, one feature:

- ``attendance_log`` — one row per check-in/check-out pair. ``person_type``
  distinguishes employees from volunteers (both have UUID ids in their own
  tables; we store the id + type instead of two FK columns so one table
  covers both). Open sessions have ``check_out_at IS NULL`` — the "who's
  on site right now" view just filters on that.

- ``activities`` — named task templates per branch ("Kitchen prep",
  "Setup for puja", "Welcome desk"). Templates don't belong to anyone;
  they're reusable.

- ``activity_assignments`` — pins a template to a person on a date. One
  volunteer can have multiple assignments per day; one activity can be
  assigned to many people. Status: assigned → in_progress → done | skipped.

Defensive statement timeouts match the house pattern (migrations 028-030).
Everything idempotent so a re-run after a partial failure is safe.
"""
from alembic import op

revision = '031'
down_revision = '030'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Defensive caps so a locked-table or runaway query can't stall the
    # whole deploy — matches the pattern established in 028-030.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("SET LOCAL statement_timeout = '20s'")

    # ── 1. attendance_log ─────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS attendance_log (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            person_type     TEXT NOT NULL CHECK (person_type IN ('employee','volunteer')),
            person_id       UUID NOT NULL,
            branch_id       TEXT NOT NULL,
            check_in_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            check_out_at    TIMESTAMPTZ,
            notes           TEXT,
            checked_in_by   TEXT,
            checked_out_by  TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    # Hot path: "who's on site right now at branch X" — filter open rows per
    # branch. Partial index keeps it tiny (open sessions are a small subset
    # of lifetime rows).
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_attendance_open
        ON attendance_log (branch_id, check_in_at DESC)
        WHERE check_out_at IS NULL
    """)
    # History lookup for a single person (hours this week, last check-in).
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_attendance_person_day
        ON attendance_log (person_type, person_id, check_in_at DESC)
    """)
    # Guard against two "open" rows for the same person at once — if the UI
    # fires check-in twice (double-tap, slow network), the second one
    # should 409, not duplicate.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_one_open_per_person
        ON attendance_log (person_type, person_id)
        WHERE check_out_at IS NULL
    """)

    # ── 2. activities (reusable task templates) ───────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS activities (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id   TEXT NOT NULL,
            name        TEXT NOT NULL,
            description TEXT,
            colour      TEXT,                  -- optional tag colour for the UI
            archived    BOOLEAN NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_activities_branch
        ON activities (branch_id, archived, name)
    """)
    # No two activities with the same name per branch (avoids near-duplicates
    # like "Kitchen prep" vs "kitchen prep ").
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_unique_name
        ON activities (branch_id, LOWER(TRIM(name)))
        WHERE archived = FALSE
    """)

    # ── 3. activity_assignments ───────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS activity_assignments (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            activity_id     UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
            person_type     TEXT NOT NULL CHECK (person_type IN ('employee','volunteer')),
            person_id       UUID NOT NULL,
            branch_id       TEXT NOT NULL,
            assigned_date   DATE NOT NULL,
            start_time      TIME,              -- optional window hint
            end_time        TIME,
            status          TEXT NOT NULL DEFAULT 'assigned'
                              CHECK (status IN ('assigned','in_progress','done','skipped')),
            notes           TEXT,
            assigned_by     TEXT,              -- email of trustee who assigned
            completed_at    TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    # The two queries the UI actually makes: "what's assigned to me today"
    # and "what's assigned on this activity across people".
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_assignments_person_date
        ON activity_assignments (person_type, person_id, assigned_date DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_assignments_activity_date
        ON activity_assignments (activity_id, assigned_date DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_assignments_branch_date
        ON activity_assignments (branch_id, assigned_date DESC, status)
    """)


def downgrade() -> None:
    # Order matters — assignments reference activities.
    op.execute("DROP TABLE IF EXISTS activity_assignments")
    op.execute("DROP TABLE IF EXISTS activities")
    op.execute("DROP TABLE IF EXISTS attendance_log")
