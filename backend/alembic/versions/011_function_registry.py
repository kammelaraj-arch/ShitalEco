"""011 function_registry — AI-callable function registry + full invocation audit log

Revision ID: 011_function_registry
Revises: 010_kiosk_profiles
Create Date: 2026-04-05

Two tables:
  function_registry    — catalogue of every callable function/capability the AI agent
                         can discover and invoke. Input/output schemas stored as JSONB
                         so the AI can understand what each function expects and returns.
  function_invocations — immutable append-only audit trail of every call made, whether
                         by a human admin, the AI agent, a webhook, or a schedule.
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "011_function_registry"
down_revision = "010_kiosk_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── function_registry ────────────────────────────────────────────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS function_registry (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            -- Identity
            function_name    VARCHAR(300) UNIQUE NOT NULL,
            display_name     VARCHAR(300) NOT NULL DEFAULT '',
            description      TEXT         NOT NULL DEFAULT '',
            fabric           VARCHAR(100) NOT NULL DEFAULT 'general',
            tags             JSONB        NOT NULL DEFAULT '[]',
            version          VARCHAR(50)  NOT NULL DEFAULT '1.0.0',

            -- How to call it
            module_path      VARCHAR(500)          DEFAULT NULL,
            http_endpoint    VARCHAR(500)          DEFAULT NULL,
            http_method      VARCHAR(10)  NOT NULL DEFAULT 'POST',

            -- Schemas (JSON Schema format — readable by Claude/AI agents)
            input_schema     JSONB        NOT NULL DEFAULT '{}',
            output_schema    JSONB        NOT NULL DEFAULT '{}',
            example_input    JSONB                 DEFAULT '{}',
            example_output   JSONB                 DEFAULT '{}',

            -- Governance
            status           VARCHAR(50)  NOT NULL DEFAULT 'active',
                             -- active | deprecated | experimental | disabled
            human_in_loop    BOOLEAN      NOT NULL DEFAULT false,
            requires_auth    BOOLEAN      NOT NULL DEFAULT true,
            required_roles   JSONB        NOT NULL DEFAULT '[]',
            idempotent       BOOLEAN      NOT NULL DEFAULT false,

            -- Usage counters (updated on each invocation)
            total_calls      INTEGER      NOT NULL DEFAULT 0,
            success_count    INTEGER      NOT NULL DEFAULT 0,
            failure_count    INTEGER      NOT NULL DEFAULT 0,
            last_used_at     TIMESTAMPTZ           DEFAULT NULL,

            -- Lifecycle
            is_active        BOOLEAN      NOT NULL DEFAULT true,
            created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at       TIMESTAMPTZ           DEFAULT NULL
        )
    """))

    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_reg_fabric "
        "ON function_registry(fabric) WHERE deleted_at IS NULL"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_reg_status "
        "ON function_registry(status) WHERE deleted_at IS NULL"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_reg_tags "
        "ON function_registry USING GIN(tags)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_reg_name_trgm "
        "ON function_registry(function_name)"
    ))

    # ── function_invocations ─────────────────────────────────────────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS function_invocations (
            id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

            -- What was called
            function_id      UUID        REFERENCES function_registry(id) ON DELETE SET NULL,
            function_name    VARCHAR(300) NOT NULL,

            -- Who called it
            branch_id        VARCHAR(100) NOT NULL DEFAULT 'main',
            user_id          VARCHAR(200)          DEFAULT NULL,
            user_email       VARCHAR(200)          DEFAULT NULL,
            user_role        VARCHAR(100)          DEFAULT NULL,

            -- Why it was called (AI context)
            triggered_by     VARCHAR(50)  NOT NULL DEFAULT 'manual',
                             -- manual | ai_agent | webhook | schedule | api
            agent_session_id VARCHAR(200)          DEFAULT NULL,
            agent_reasoning  TEXT                  DEFAULT NULL,
            agent_query      TEXT                  DEFAULT NULL,

            -- Payload (full input/output for debugging)
            input_data       JSONB        NOT NULL DEFAULT '{}',
            output_data      JSONB                 DEFAULT NULL,

            -- Result
            status           VARCHAR(50)  NOT NULL DEFAULT 'pending',
                             -- pending | success | failed | timeout | cancelled
            error_message    TEXT                  DEFAULT NULL,
            error_code       VARCHAR(100)          DEFAULT NULL,
            duration_ms      INTEGER               DEFAULT NULL,

            -- Request context
            ip_address       VARCHAR(100)          DEFAULT NULL,
            user_agent       TEXT                  DEFAULT NULL,
            request_id       VARCHAR(200)          DEFAULT NULL,

            -- Timestamps (append-only — never updated)
            created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            completed_at     TIMESTAMPTZ           DEFAULT NULL
        )
    """))

    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_inv_function_id "
        "ON function_invocations(function_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_inv_function_name "
        "ON function_invocations(function_name)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_inv_user "
        "ON function_invocations(user_email)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_inv_triggered_by "
        "ON function_invocations(triggered_by)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_inv_status "
        "ON function_invocations(status)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_inv_created "
        "ON function_invocations(created_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_fn_inv_session "
        "ON function_invocations(agent_session_id) "
        "WHERE agent_session_id IS NOT NULL"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP TABLE IF EXISTS function_invocations"))
    conn.execute(text("DROP TABLE IF EXISTS function_registry"))
