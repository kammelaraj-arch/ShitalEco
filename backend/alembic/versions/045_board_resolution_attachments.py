"""045 board resolution attachments + AI draft log

Backs the Context step of the 5-step Board Resolution wizard —
file attachments for a draft + a per-run log of every AI draft call.

  - board_resolution_attachments
      Files uploaded against a resolution (minutes, quotes, prior
      correspondence). Trustees see these linked from the vote-invite.
      Bytes stored in-row (bytea) — low-volume governance docs; no
      need to stand up S3. Capped by the app-level size check.

  - board_resolution_ai_drafts
      One row per AI draft/polish run. Captures operator, source
      (meeting_id or null), instruction note, the source excerpt
      the model was shown, and the fields it returned. So trustees
      can see who/what shaped the text and prove the human had the
      final say (they always edit after a draft).

Both reference `resolutions.id` (the table name _patch_schema creates;
NOT `board_resolutions`). FK is added only if the parent exists in
this environment so the migration is safe to run ahead of the schema
patcher that creates `resolutions`.
"""
from alembic import op

revision = '045'
down_revision = '044'
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
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables WHERE table_name = 'resolutions'
            ) THEN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                     WHERE constraint_name = 'bra_resolution_fk'
                ) THEN
                    ALTER TABLE board_resolution_attachments
                      ADD CONSTRAINT bra_resolution_fk
                      FOREIGN KEY (resolution_id)
                      REFERENCES resolutions(id)
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
                SELECT 1 FROM information_schema.tables WHERE table_name = 'resolutions'
            ) THEN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                     WHERE constraint_name = 'brad_resolution_fk'
                ) THEN
                    ALTER TABLE board_resolution_ai_drafts
                      ADD CONSTRAINT brad_resolution_fk
                      FOREIGN KEY (resolution_id)
                      REFERENCES resolutions(id)
                      ON DELETE CASCADE;
                END IF;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS board_resolution_ai_drafts")
    op.execute("DROP TABLE IF EXISTS board_resolution_attachments")
