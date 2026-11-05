"""044 seed SBR2022-01 — Shital roadmap and operating model resolution

User direction: "based on this pls create all resolutions required as
target all outstanding, i though you create wizard?" The uploaded zip
(SBR202201) carries one past board resolution:

  Title     : Shital roadmap and operating model
  Ref       : SBR2022-01
  Held      : 05/08/2022 19:00-22:00 (Teams) + 12/02/2023 face-to-face
  Trustees  : Reena Kakkad, Vinit Chandulal Lakhani, Raj Kammela (Chair)
  Outcome   : Approved unanimously

The wizard is for drafting NEW resolutions. Historical records like
this one are entered as retrospective (is_retrospective=true) so the
voting mechanics don't fire on a decision already made. This migration
inserts it directly, idempotent, so finance / audit have the paper
trail without needing a human to re-type a 2022 decision.

What this seeds
  1. The three trustees (if not already present — matched by email).
  2. A board_meetings row for 05/08/2022.
  3. The resolution itself as CLOSED + CARRIED + retrospective, with
     tally 3-0-0 and effective_quorum_at_close=3.
  4. Three FOR votes, one per trustee.

Everything keys off natural identifiers (title + decision_date, email
for trustees) and uses ON CONFLICT DO NOTHING / NOT EXISTS guards so
rerunning the migration is a no-op.
"""
from alembic import op

revision = '044'
down_revision = '043'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only seed if the schema this feature depends on actually exists on
    # this environment. _patch_schema() creates it on every startup, but if
    # the migration runs BEFORE main.py's startup hook we'd otherwise fail
    # with "relation 'resolutions' does not exist". All inserts are wrapped
    # in a DO block that bails cleanly when the tables aren't there.
    op.execute("""
        DO $$
        DECLARE
            t_reena_id   UUID;
            t_vinit_id   UUID;
            t_raj_id     UUID;
            m_id         UUID;
            r_id         UUID;
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.tables
                 WHERE table_name = 'resolutions'
            ) THEN
                RAISE NOTICE 'resolutions table not yet created — skipping SBR2022-01 seed';
                RETURN;
            END IF;

            -- 1. Trustees (idempotent — matched by email).
            INSERT INTO trustees (full_name, email, role, is_active)
            VALUES ('Reena Kakkad', 'reena.kakkad@shital.org.uk', 'TRUSTEE', true)
            ON CONFLICT DO NOTHING;
            INSERT INTO trustees (full_name, email, role, is_active)
            VALUES ('Vinit Chandulal Lakhani', 'vinit.lakhani@shital.org.uk', 'TRUSTEE', true)
            ON CONFLICT DO NOTHING;
            INSERT INTO trustees (full_name, email, role, is_active)
            VALUES ('Raj Kammela', 'raj.kammela@shital.org.uk', 'CHAIR', true)
            ON CONFLICT DO NOTHING;

            SELECT id INTO t_reena_id FROM trustees WHERE LOWER(email) = LOWER('reena.kakkad@shital.org.uk') LIMIT 1;
            SELECT id INTO t_vinit_id FROM trustees WHERE LOWER(email) = LOWER('vinit.lakhani@shital.org.uk') LIMIT 1;
            SELECT id INTO t_raj_id   FROM trustees WHERE LOWER(email) = LOWER('raj.kammela@shital.org.uk')   LIMIT 1;

            -- 2. Board meeting on 05/08/2022 (date-based de-dup).
            SELECT id INTO m_id FROM board_meetings
             WHERE DATE(scheduled_at) = DATE '2022-08-05'
               AND title ILIKE '%roadmap%operating model%' LIMIT 1;
            IF m_id IS NULL THEN
                INSERT INTO board_meetings
                    (meeting_type, mode, title, scheduled_at, location, agenda, status,
                     opened_at, closed_at, minutes_status, minutes_text, notes)
                VALUES
                    ('TRUSTEE_MEETING', 'HYBRID',
                     'Shital roadmap and operating model — SBR2022-01',
                     TIMESTAMP '2022-08-05 19:00:00+00',
                     'Microsoft Teams + face-to-face refresh (12/02/2023 at Wembley)',
                     'Shital roadmap, governance, risk register, roles of trustees',
                     'CLOSED',
                     TIMESTAMP '2022-08-05 19:00:00+00',
                     TIMESTAMP '2022-08-05 22:00:00+00',
                     'APPROVED', '', 'SBR2022-01 refresh meeting held on 12/02/2023 at 13:30')
                RETURNING id INTO m_id;
            END IF;

            -- 3. Resolution row (title-based de-dup).
            SELECT id INTO r_id FROM resolutions
             WHERE title = 'SBR2022-01 — Shital roadmap and operating model' LIMIT 1;
            IF r_id IS NULL THEN
                INSERT INTO resolutions
                    (meeting_id, title, background, recommendation,
                     risk_impact, budget_impact,
                     category, decision_type, status,
                     decision_date, is_retrospective, retrospective_reason,
                     outcome, outcome_summary,
                     published_at, closed_at,
                     quorum_at_close, effective_quorum_at_close,
                     tally_for, tally_against, tally_abstain)
                VALUES (
                    m_id,
                    'SBR2022-01 — Shital roadmap and operating model',
                    'The board met to approve the forward roadmap and operating model for SHITAL. ' ||
                    'Supporting annexures: SHITAL Road map 2022 (PL), Role description for trustees (NCVO Knowhow), ' ||
                    'Trustee roles (NCVO), Role of a charity chair, Risk register (NCVO Knowhow), ' ||
                    'Governing document (NCVO Knowhow).',
                    E'The board resolved that:\n' ||
                    E'1. RK is authorised to convene an initial meeting with employees at Wembley temple along with ' ||
                    E'the other two trustees to inform the plans and governance structure as in the annexures.\n' ||
                    E'2. Following the above meeting, RK is authorised to execute the plan and implement the ' ||
                    E'governance taking it through the gates and process as in the annexures.\n' ||
                    E'3. An action plan should be developed for the board review by RK.',
                    'Governance risk mitigated by adopting NCVO best-practice framework (risk register, roles, ' ||
                    'governing document). Operational risk to be tracked by RK via the action plan.',
                    'No direct spend. Roadmap sets the scope for future budget resolutions (future SBRs).',
                    'POLICY', 'BOARD_MEETING', 'CLOSED',
                    DATE '2022-08-05', true,
                    'Historical record entered 2026 from the signed SBR2022-01 document ' ||
                    '(Teams meeting 05/08/2022 19:00-22:00 + face-to-face refresh 12/02/2023).',
                    'CARRIED',
                    'Approved unanimously by all three trustees. Signed and sealed per the attached SBR2022-01 V1.0.',
                    TIMESTAMP '2022-08-05 19:00:00+00',
                    TIMESTAMP '2022-08-05 22:00:00+00',
                    3, 3, 3, 0, 0
                )
                RETURNING id INTO r_id;
            END IF;

            -- 4. One FOR vote per trustee (ON CONFLICT handled by UNIQUE
            --    constraint on (resolution_id, trustee_id)).
            IF t_reena_id IS NOT NULL THEN
                INSERT INTO resolution_votes (resolution_id, trustee_id, choice, comment, voted_at)
                VALUES (r_id, t_reena_id, 'FOR',
                        'SBR2022-01 historical record — approved per original signed document.',
                        TIMESTAMP '2022-08-05 22:00:00+00')
                ON CONFLICT (resolution_id, trustee_id) DO NOTHING;
            END IF;
            IF t_vinit_id IS NOT NULL THEN
                INSERT INTO resolution_votes (resolution_id, trustee_id, choice, comment, voted_at)
                VALUES (r_id, t_vinit_id, 'FOR',
                        'SBR2022-01 historical record — approved per original signed document.',
                        TIMESTAMP '2022-08-05 22:00:00+00')
                ON CONFLICT (resolution_id, trustee_id) DO NOTHING;
            END IF;
            IF t_raj_id IS NOT NULL THEN
                INSERT INTO resolution_votes (resolution_id, trustee_id, choice, comment, voted_at)
                VALUES (r_id, t_raj_id, 'FOR',
                        'SBR2022-01 historical record — approved per original signed document.',
                        TIMESTAMP '2022-08-05 22:00:00+00')
                ON CONFLICT (resolution_id, trustee_id) DO NOTHING;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    # Reversible by title — safe even if other migrations/data touched the
    # row after seeding (we only delete OUR named row + its linked meeting).
    op.execute("""
        DO $$
        DECLARE
            r_id UUID;
            m_id UUID;
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.tables WHERE table_name = 'resolutions'
            ) THEN
                RETURN;
            END IF;
            SELECT id, meeting_id INTO r_id, m_id FROM resolutions
             WHERE title = 'SBR2022-01 — Shital roadmap and operating model' LIMIT 1;
            IF r_id IS NOT NULL THEN
                DELETE FROM resolution_votes WHERE resolution_id = r_id;
                DELETE FROM resolutions      WHERE id            = r_id;
            END IF;
            IF m_id IS NOT NULL THEN
                DELETE FROM board_meetings
                 WHERE id = m_id
                   AND title ILIKE '%SBR2022-01%';
            END IF;
        END $$;
    """)
