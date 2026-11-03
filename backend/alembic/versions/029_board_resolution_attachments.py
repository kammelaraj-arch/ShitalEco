"""029 board_resolution_attachments + board_resolution_ai_drafts

Companion tables for the Board Resolution wizard's two late additions:

  - board_resolution_attachments — files uploaded against a resolution
    (meeting minutes, quotes, prior correspondence). Trustees see these
    linked from their vote-invite. Bytes stored in-row (bytea) because
    these are low-volume, modest-sized governance docs — no need for
    S3 plumbing. Capped by app-level size check.

  - board_resolution_ai_drafts — audit log of every AI draft/polish run.
    Captures mode (draft|finalise), the operator user_id, the source
    (meeting_id or null), the instruction note, the summarised source
    excerpts the model was shown, and the fields it returned. So we can
    show trustees who/what shaped the text and prove the human had the
    final word (they always edit after a draft).

Both tables reference board_resolutions (which 038 in the board-router
PR creates). This migration is additive — it does NOT create
board_resolutions itself. If the board foundation migration has not
run yet in this environment, this one is still safe to apply: the
FK is deferred-friendly (we only reference an existing table), so
Postgres will reject the migration cleanly on fresh environments
with a clear error, rather than silently creating an orphan table.

For environments where the board tables have not landed yet, we guard
the FK with a DO-block that creates the table only if the parent
exists and otherwise falls back to a plain UUID column with no FK —
the router validates the resolution exists on every write anyway.
"""
from alembic import op

revision = '029'
down_revision = '028'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS board_resolution_attachments (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            resolution_id    UUID NOT NULL,
            filename         TEXT NOT NULL,
            content_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
            size_bytes       INTEGER NOT NULL DEFAULT 0,
            source           TEXT NOT NULL DEFAULT 'upload'
                             CHECK (source IN ('upload', 'meeting', 'ai')),
            uploaded_by      UUID,
            data             BYTEA NOT NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at       TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_bra_resolution
          ON board_resolution_attachments (resolution_id)
          WHERE deleted_at IS NULL
    """)

    # Add the FK only if the parent table exists in this environment.
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                 WHERE table_name = 'board_resolutions'
            ) THEN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                     WHERE constraint_name = 'bra_resolution_fk'
                ) THEN
                    ALTER TABLE board_resolution_attachments
                      ADD CONSTRAINT bra_resolution_fk
                      FOREIGN KEY (resolution_id)
                      REFERENCES board_resolutions(id)
                      ON DELETE CASCADE;
                END IF;
            END IF;
        END $$;
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS board_resolution_ai_drafts (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            resolution_id    UUID NOT NULL,
            mode             TEXT NOT NULL CHECK (mode IN ('draft', 'finalise')),
            meeting_id       UUID,
            instruction      TEXT NOT NULL DEFAULT '',
            source_excerpt   TEXT NOT NULL DEFAULT '',
            output_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
            model            TEXT NOT NULL DEFAULT '',
            run_by           UUID,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_brad_resolution
          ON board_resolution_ai_drafts (resolution_id, created_at DESC)
    """)
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                 WHERE table_name = 'board_resolutions'
            ) THEN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                     WHERE constraint_name = 'brad_resolution_fk'
                ) THEN
                    ALTER TABLE board_resolution_ai_drafts
                      ADD CONSTRAINT brad_resolution_fk
                      FOREIGN KEY (resolution_id)
                      REFERENCES board_resolutions(id)
                      ON DELETE CASCADE;
                END IF;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS board_resolution_ai_drafts")
    op.execute("DROP TABLE IF EXISTS board_resolution_attachments")
