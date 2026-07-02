"""
Shital Temple ERP — FastAPI application entry point.
Assembles Digital DNA capabilities, Digital Space governance, Digital Brain AI,
and all Foundation Fabrics into a unified agentic API.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, ORJSONResponse

from shital.core.fabrics.config import settings
from shital.core.fabrics.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
)
from shital.core.fabrics.errors import (
    ValidationError as ShitalValidationError,
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    # Register all Digital DNA micro-capabilities
    import shital.capabilities.assets.capabilities  # noqa: F401
    import shital.capabilities.auth.capabilities  # noqa: F401
    import shital.capabilities.compliance.capabilities  # noqa: F401
    import shital.capabilities.finance.capabilities  # noqa: F401
    import shital.capabilities.hr.capabilities  # noqa: F401
    import shital.capabilities.notifications.capabilities  # noqa: F401
    import shital.capabilities.payments.capabilities  # noqa: F401
    import shital.capabilities.payroll.capabilities  # noqa: F401
    from shital.core.dna.registry import DigitalDNA
    total_caps = len(DigitalDNA.all_capabilities())
    logger.info("digital_dna_loaded", total_capabilities=total_caps)

    # ── Schema patch + DNA sync — NON-BLOCKING (deploy-gate fix) ─────────
    # PERMANENT FIX for the prod promote doom-loop: _patch_schema() runs 60+
    # idempotent ALTERs and sync_from_digital_dna() rewrites the function
    # registry. On the large prod DB the FIRST boot after a schema change
    # took >1200s — LONGER than deploy.sh's health-gate ceiling. Because these
    # ran synchronously BEFORE `yield`, uvicorn didn't serve /health until they
    # finished, so the gate timed out → auto-rollback → migrations never
    # committed → next promote started over. Prod could NEVER update.
    #
    # Moving them to a background task lets `yield` happen immediately, so
    # uvicorn serves /health within seconds → the deploy gate passes → the
    # migrations finish in the background and commit. _patch_schema is additive
    # + idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS), and
    # the app already ran on the prior-compatible schema, so serving a few
    # requests during the brief patch window is safe — far safer than a prod
    # that can't deploy at all. A readiness flag is exposed via /health for
    # observability (status: "starting" until the patch completes).
    import asyncio as _asyncio
    app.state.schema_ready = False
    app.state.schema_error = None

    async def _startup_migrations() -> None:
        try:
            await _patch_schema()
        except Exception as exc:
            app.state.schema_error = str(exc)
            logger.error("startup_patch_failed", error=str(exc))
        try:
            from shital.api.routers.functions import sync_from_digital_dna
            result = await sync_from_digital_dna()
            logger.info("function_registry_synced",
                        synced=result["synced"], errors=len(result["errors"]))
        except Exception as exc:
            logger.error("function_registry_sync_failed", error=str(exc))
        app.state.schema_ready = True
        logger.info("startup_migrations_complete")

    _migrations_task = _asyncio.create_task(_startup_migrations())

    # ── Mail Agent background poller ─────────────────────────────────────
    # Disabled when MAIL_AGENT_POLL_SECONDS=0 or MAIL_AGENT_MAILBOXES is empty
    # (so dev stacks don't burn Anthropic credit unless explicitly enabled).
    _mail_task: _asyncio.Task[None] | None = None
    if (settings.MAIL_AGENT_POLL_SECONDS > 0
            and settings.MAIL_AGENT_MAILBOXES.strip()
            and settings.ANTHROPIC_API_KEY.strip()):
        async def _mail_loop() -> None:
            from shital.services.mail_agent import sweep_once
            # Initial delay so the schema patch + Digital DNA load finish
            # before the first Graph call (avoids "table not found" races).
            await _asyncio.sleep(30)
            while True:
                try:
                    res = await sweep_once()
                    logger.info("mail_agent_sweep", result=res)
                except Exception as exc:
                    logger.error("mail_agent_sweep_failed", error=str(exc))
                await _asyncio.sleep(settings.MAIL_AGENT_POLL_SECONDS)
        _mail_task = _asyncio.create_task(_mail_loop())
        logger.info("mail_agent_started",
                    interval=settings.MAIL_AGENT_POLL_SECONDS,
                    mailboxes=settings.MAIL_AGENT_MAILBOXES)

    # ── Background recovery loop ─────────────────────────────────────────
    # Runs forever inside the backend process. DISABLED via env var on prod
    # while we diagnose a crash that happens ~5 min after the loop starts
    # (suspected OOM during SumUp transactions-API pagination, or
    # uncaught exception in _sumup_reconcile_once tearing down the asyncio
    # event loop). Set RECOVERY_LOOP_ENABLED=1 to re-enable.
    _recovery_task: _asyncio.Task[None] | None = None
    if os.environ.get("RECOVERY_LOOP_ENABLED", "0") == "1":
        from shital.services.background_recovery import recovery_loop
        _recovery_task = _asyncio.create_task(recovery_loop())
        logger.info("recovery_loop_started")
    else:
        logger.info("recovery_loop_disabled_via_env")

    # ── Scheduled-deploy poller ──────────────────────────────────────────
    # Polls scheduled_deploys every 60 s; any pending row whose
    # scheduled_for is in the past gets fired via the deployer. We mark
    # the row 'fired' BEFORE the deployer call so the promote-induced
    # backend restart can't double-fire it on the next boot (the row is
    # already past the WHERE filter). On failure we record the error;
    # the row stays in 'failed' status so the operator can see why in
    # System Ops and re-schedule manually.
    async def _scheduled_deploy_poller() -> None:
        from shital.services.scheduled_deploys import poll_and_fire
        # First sweep after 15 s — covers the case where a backend was
        # restarted past a row's scheduled_for time (within a small grace).
        await _asyncio.sleep(15)
        while True:
            try:
                fired = await poll_and_fire()
                if fired:
                    logger.info("scheduled_deploys_fired", count=fired)
            except Exception as exc:
                logger.error("scheduled_deploys_poll_failed", error=str(exc))
            await _asyncio.sleep(60)
    _sched_task = _asyncio.create_task(_scheduled_deploy_poller())
    logger.info("scheduled_deploy_poller_started")

    yield
    if _mail_task:
        _mail_task.cancel()
    if _recovery_task is not None:
        _recovery_task.cancel()
    _sched_task.cancel()
    logger.info("shital_shutdown")


async def _patch_schema() -> None:
    """Idempotent schema patcher — adds any columns migrations may have missed."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    patches = [
        # ── Core tables (migration 001 — recreate if missing) ─────────────────
        """CREATE TABLE IF NOT EXISTS users (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email         VARCHAR(255) UNIQUE NOT NULL,
            name          VARCHAR(200) NOT NULL DEFAULT '',
            phone         VARCHAR(50),
            role          VARCHAR(50)  NOT NULL DEFAULT 'DEVOTEE',
            branch_id     VARCHAR(100),
            password_hash TEXT,
            is_active     BOOLEAN NOT NULL DEFAULT TRUE,
            mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
            auth_provider VARCHAR(30) NOT NULL DEFAULT 'local',
            azure_oid     VARCHAR(100),
            azure_upn     VARCHAR(255),
            last_login_at TIMESTAMPTZ,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at    TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_azure_oid ON users(azure_oid) WHERE azure_oid IS NOT NULL",
        """CREATE TABLE IF NOT EXISTS employees (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id        VARCHAR(100) NOT NULL DEFAULT 'main',
            employee_number  VARCHAR(50)  NOT NULL DEFAULT '',
            department       VARCHAR(100) NOT NULL DEFAULT '',
            job_title        VARCHAR(200) NOT NULL DEFAULT '',
            employment_type  VARCHAR(30)  NOT NULL DEFAULT 'FULL_TIME',
            start_date       DATE,
            end_date         DATE,
            gross_salary     NUMERIC(12,2) NOT NULL DEFAULT 0,
            national_insurance VARCHAR(20) NOT NULL DEFAULT '',
            is_active        BOOLEAN NOT NULL DEFAULT TRUE,
            full_name        VARCHAR(200),
            email            VARCHAR(255),
            phone            VARCHAR(50),
            address          TEXT,
            photo_url        TEXT NOT NULL DEFAULT '',
            nationality      VARCHAR(100) NOT NULL DEFAULT '',
            right_to_work_type VARCHAR(50) NOT NULL DEFAULT '',
            visa_number      VARCHAR(100) NOT NULL DEFAULT '',
            visa_expiry      DATE,
            manager_id       UUID,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at       TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active)",
        # Add missing columns to users table on existing deployments
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS azure_oid     VARCHAR(100)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS azure_upn     VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(30) NOT NULL DEFAULT 'local'",
        # Migration 007 columns on catalog_items
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS available_from  TIMESTAMPTZ",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS display_channel VARCHAR(20) NOT NULL DEFAULT 'both'",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS branch_stock    JSONB NOT NULL DEFAULT '{}'",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS is_live         BOOLEAN NOT NULL DEFAULT true",
        # Migration 009 column on catalog_items
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS name_te         VARCHAR(200) NOT NULL DEFAULT ''",
        # Missing columns referenced by list_items / kiosk queries
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS metadata_json   JSONB        NOT NULL DEFAULT '{}'",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS stock_qty       INTEGER",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS sort_order      INTEGER      NOT NULL DEFAULT 0",
        # Migration 007 columns on temple_services (if table exists)
        "ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS available_from  TIMESTAMPTZ",
        "ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ",
        "ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS display_channel VARCHAR(20) NOT NULL DEFAULT 'both'",
        "ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS is_live         BOOLEAN NOT NULL DEFAULT true",
        "ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS name_te         VARCHAR(200) NOT NULL DEFAULT ''",
        # Migration 012 — assets, bookings, documents tables
        """CREATE TABLE IF NOT EXISTS assets (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id VARCHAR(100) NOT NULL DEFAULT 'main',
            name VARCHAR(200) NOT NULL,
            description TEXT DEFAULT '',
            category VARCHAR(50) NOT NULL DEFAULT 'OTHER',
            serial_number VARCHAR(100) DEFAULT '',
            purchase_date DATE,
            purchase_price NUMERIC(12,2) DEFAULT 0,
            current_value NUMERIC(12,2) DEFAULT 0,
            supplier VARCHAR(200) DEFAULT '',
            warranty_expiry DATE,
            location VARCHAR(200) DEFAULT '',
            status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            assigned_to VARCHAR(200) DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_assets_branch   ON assets(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category)",
        # ── Key Register — custody of physical keys and digital access ──────
        """CREATE TABLE IF NOT EXISTS key_register (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id VARCHAR(100) NOT NULL DEFAULT 'main',
            name VARCHAR(200) NOT NULL,
            key_type VARCHAR(30) NOT NULL DEFAULT 'PHYSICAL_KEY',
            description TEXT NOT NULL DEFAULT '',
            holder_employee_id UUID,
            owner_employee_id UUID,
            physical_location VARCHAR(200) NOT NULL DEFAULT '',
            serial_number VARCHAR(100) NOT NULL DEFAULT '',
            copies_count INTEGER NOT NULL DEFAULT 1,
            vault_reference VARCHAR(500) NOT NULL DEFAULT '',
            access_url VARCHAR(500) NOT NULL DEFAULT '',
            username_hint VARCHAR(200) NOT NULL DEFAULT '',
            provider VARCHAR(100) NOT NULL DEFAULT '',
            status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            issued_date DATE,
            returned_date DATE,
            expiry_date DATE,
            last_rotated_date DATE,
            notes TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_keyreg_branch  ON key_register(branch_id) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_keyreg_type    ON key_register(key_type) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_keyreg_status  ON key_register(status)   WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_keyreg_holder  ON key_register(holder_employee_id) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_keyreg_expiry  ON key_register(expiry_date) WHERE expiry_date IS NOT NULL AND deleted_at IS NULL",
        # ── Expansion fields added 2026: track total sets vs in-vault, plus
        # the per-holder undertaking that trustees increasingly require for
        # physical keys to property / shrines / donation boxes.
        "ALTER TABLE key_register ADD COLUMN IF NOT EXISTS total_sets               INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE key_register ADD COLUMN IF NOT EXISTS sets_in_vault            INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE key_register ADD COLUMN IF NOT EXISTS undertaking_required     BOOLEAN NOT NULL DEFAULT true",
        "ALTER TABLE key_register ADD COLUMN IF NOT EXISTS undertaking_signed_at    TIMESTAMPTZ DEFAULT NULL",
        "ALTER TABLE key_register ADD COLUMN IF NOT EXISTS undertaking_signed_name  VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE key_register ADD COLUMN IF NOT EXISTS undertaking_pdf_url      TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE key_register ADD COLUMN IF NOT EXISTS undertaking_sent_at      TIMESTAMPTZ DEFAULT NULL",
        """CREATE TABLE IF NOT EXISTS key_register_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key_id UUID NOT NULL,
            event_type VARCHAR(30) NOT NULL,
            actor_user_id UUID,
            actor_name VARCHAR(200) NOT NULL DEFAULT '',
            from_holder_id UUID,
            to_holder_id UUID,
            notes TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_keyreg_events_key ON key_register_events(key_id, created_at DESC)",
        # ── Per-set holdings (a single key definition may have N sets each
        # held by a different person, each with their own undertaking +
        # issue/return dates). This replaces the single holder_employee_id
        # for new code; the legacy column stays as a denormalised "current
        # primary holder" for back-compat with the existing list view.
        """CREATE TABLE IF NOT EXISTS key_holdings (
            id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key_id                   UUID NOT NULL REFERENCES key_register(id) ON DELETE CASCADE,
            set_number               INTEGER NOT NULL DEFAULT 1,
            holder_employee_id       UUID,
            issued_date              DATE,
            returned_date            DATE,
            expected_return_date     DATE,
            status                   VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            undertaking_required     BOOLEAN NOT NULL DEFAULT true,
            undertaking_sent_at      TIMESTAMPTZ,
            undertaking_signed_at    TIMESTAMPTZ,
            undertaking_signed_name  VARCHAR(200) NOT NULL DEFAULT '',
            undertaking_pdf_url      TEXT NOT NULL DEFAULT '',
            notes                    TEXT NOT NULL DEFAULT '',
            created_by_user_id       UUID,
            created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at               TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_key_holdings_key      ON key_holdings(key_id) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_key_holdings_holder   ON key_holdings(holder_employee_id) WHERE deleted_at IS NULL AND status = 'ACTIVE'",
        "CREATE INDEX IF NOT EXISTS idx_key_holdings_undersnd ON key_holdings(key_id) WHERE deleted_at IS NULL AND undertaking_required = true AND undertaking_signed_at IS NULL",
        # E-signature columns — when the operator emails the holder for
        # online signing, we mint a token, snapshot the recipient email,
        # and (on sign) capture the typed name + IP + user agent + a
        # base64 PNG of any drawn signature as evidence.
        "ALTER TABLE key_holdings ADD COLUMN IF NOT EXISTS undertaking_token            VARCHAR(64) DEFAULT NULL",
        "ALTER TABLE key_holdings ADD COLUMN IF NOT EXISTS undertaking_email_sent_to    VARCHAR(255) DEFAULT NULL",
        "ALTER TABLE key_holdings ADD COLUMN IF NOT EXISTS undertaking_signed_ip        VARCHAR(64)  NOT NULL DEFAULT ''",
        "ALTER TABLE key_holdings ADD COLUMN IF NOT EXISTS undertaking_signed_ua        TEXT         NOT NULL DEFAULT ''",
        "ALTER TABLE key_holdings ADD COLUMN IF NOT EXISTS undertaking_signature_png    TEXT         NOT NULL DEFAULT ''",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_key_holdings_token ON key_holdings(undertaking_token) WHERE undertaking_token IS NOT NULL",
        """CREATE TABLE IF NOT EXISTS bookings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id VARCHAR(100) NOT NULL DEFAULT 'main',
            title VARCHAR(200) NOT NULL,
            description TEXT DEFAULT '',
            room VARCHAR(100) NOT NULL DEFAULT 'Main Hall',
            booking_date DATE NOT NULL,
            start_time VARCHAR(10) NOT NULL DEFAULT '09:00',
            end_time VARCHAR(10) NOT NULL DEFAULT '10:00',
            organiser_name VARCHAR(200) DEFAULT '',
            organiser_email VARCHAR(200) DEFAULT '',
            organiser_phone VARCHAR(50) DEFAULT '',
            attendees INTEGER DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
            notes TEXT DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_bookings_branch ON bookings(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_bookings_date   ON bookings(booking_date)",
        """CREATE TABLE IF NOT EXISTS documents (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id VARCHAR(100) NOT NULL DEFAULT 'main',
            title VARCHAR(200) NOT NULL,
            description TEXT DEFAULT '',
            category VARCHAR(50) NOT NULL DEFAULT 'GENERAL',
            file_url TEXT DEFAULT '',
            file_name VARCHAR(200) DEFAULT '',
            file_size INTEGER DEFAULT 0,
            mime_type VARCHAR(100) DEFAULT '',
            uploaded_by VARCHAR(200) DEFAULT '',
            version VARCHAR(20) DEFAULT '1.0',
            review_due DATE,
            tags TEXT DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_documents_branch   ON documents(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category)",
        # DMS expansion — link a document to another record (a key_holding,
        # an employee, a project), mark confidential / system-generated,
        # and remember the disk path so the download endpoint can stream
        # the file without re-deriving it.
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS linked_entity_type VARCHAR(40) NOT NULL DEFAULT ''",
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS linked_entity_id   VARCHAR(64) NOT NULL DEFAULT ''",
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_confidential    BOOLEAN     NOT NULL DEFAULT false",
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_generated       BOOLEAN     NOT NULL DEFAULT false",
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS generated_by       VARCHAR(80) NOT NULL DEFAULT ''",
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_path          TEXT        NOT NULL DEFAULT ''",
        "CREATE INDEX IF NOT EXISTS idx_documents_linked ON documents(linked_entity_type, linked_entity_id) WHERE deleted_at IS NULL AND linked_entity_id <> ''",
        # System alerts — every monitor.sh transition is POSTed here so the
        # admin can see container restarts, backup failures, expired certs,
        # etc. in one place instead of trawling through trustee mailboxes.
        # Auto-heal attempts (restart count + outcome) are recorded on the
        # same row so the trustee can see "this restarted itself 3 times"
        # without SSH-ing into the host.
        """CREATE TABLE IF NOT EXISTS system_alerts (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            host            VARCHAR(120) NOT NULL DEFAULT '',
            check_name      VARCHAR(80)  NOT NULL,
            severity        VARCHAR(20)  NOT NULL DEFAULT 'critical',
            status          VARCHAR(20)  NOT NULL DEFAULT 'fail',
            message         TEXT         NOT NULL DEFAULT '',
            detail          TEXT         NOT NULL DEFAULT '',
            heal_attempts   INTEGER      NOT NULL DEFAULT 0,
            heal_outcome    VARCHAR(20)  NOT NULL DEFAULT '',
            acknowledged_at TIMESTAMPTZ DEFAULT NULL,
            acknowledged_by VARCHAR(255) NOT NULL DEFAULT '',
            resolved_at     TIMESTAMPTZ DEFAULT NULL,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_system_alerts_status     ON system_alerts(status, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_system_alerts_check_host ON system_alerts(check_name, host, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_system_alerts_open       ON system_alerts(created_at DESC) WHERE resolved_at IS NULL AND status <> 'ok'",
        # Category lookup — formal codes with display labels, icons, and a
        # folder name used when laying files out on disk. Seeded with the
        # canonical charity categories; admins can add more via the API.
        """CREATE TABLE IF NOT EXISTS document_categories (
            code                  VARCHAR(40)  PRIMARY KEY,
            label                 VARCHAR(120) NOT NULL,
            description           TEXT         NOT NULL DEFAULT '',
            icon                  VARCHAR(8)   NOT NULL DEFAULT '📄',
            folder_name           VARCHAR(60)  NOT NULL DEFAULT 'general',
            default_review_months INTEGER      NOT NULL DEFAULT 0,
            is_confidential_default BOOLEAN    NOT NULL DEFAULT false,
            sort_order            INTEGER      NOT NULL DEFAULT 100,
            is_active             BOOLEAN      NOT NULL DEFAULT true,
            created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        # Gift Aid submissions history table
        """CREATE TABLE IF NOT EXISTS gift_aid_submissions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            correlation_id VARCHAR(100) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'submitted',
            declarations_count INTEGER NOT NULL DEFAULT 0,
            total_donated NUMERIC(12,2) NOT NULL DEFAULT 0,
            amount_claimed NUMERIC(12,2) NOT NULL DEFAULT 0,
            hmrc_reference VARCHAR(200) DEFAULT '',
            environment VARCHAR(10) NOT NULL DEFAULT 'test',
            errors TEXT DEFAULT '',
            submitted_by VARCHAR(200) DEFAULT '',
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_gift_aid_submissions_date ON gift_aid_submissions(submitted_at)",
        # API keys encrypted store
        """CREATE TABLE IF NOT EXISTS api_keys_store (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key_name    VARCHAR(100) UNIQUE NOT NULL,
            encrypted_value TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            group_name  VARCHAR(50) NOT NULL DEFAULT 'OTHER',
            is_sensitive BOOLEAN NOT NULL DEFAULT true,
            has_value   BOOLEAN GENERATED ALWAYS AS (encrypted_value <> '') STORED,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by  VARCHAR(200) NOT NULL DEFAULT ''
        )""",
        "CREATE INDEX IF NOT EXISTS idx_api_keys_group ON api_keys_store(group_name)",
        # App settings (key/value config store — also created by migration 003)
        """CREATE TABLE IF NOT EXISTS app_settings (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key         VARCHAR(100) NOT NULL UNIQUE,
            value       TEXT NOT NULL DEFAULT '',
            description TEXT,
            is_secret   BOOLEAN NOT NULL DEFAULT false,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        # ── Smart Screen ─────────────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS screen_content_items (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id     VARCHAR(100) NOT NULL DEFAULT 'main',
            title         VARCHAR(200) NOT NULL,
            content_type  VARCHAR(30)  NOT NULL DEFAULT 'IMAGE',
            media_url     TEXT         NOT NULL DEFAULT '',
            audio_url     TEXT         NOT NULL DEFAULT '',
            thumbnail_url TEXT         NOT NULL DEFAULT '',
            duration_secs INTEGER      NOT NULL DEFAULT 10,
            is_live       BOOLEAN      NOT NULL DEFAULT false,
            youtube_id    VARCHAR(50)  NOT NULL DEFAULT '',
            website_url   TEXT         NOT NULL DEFAULT '',
            description   TEXT         NOT NULL DEFAULT '',
            tags          TEXT         NOT NULL DEFAULT '',
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at    TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_screen_content_branch ON screen_content_items(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_screen_content_type   ON screen_content_items(content_type)",
        """CREATE TABLE IF NOT EXISTS screen_playlists (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id     VARCHAR(100) NOT NULL DEFAULT 'main',
            name          VARCHAR(200) NOT NULL,
            description   TEXT         NOT NULL DEFAULT '',
            shuffle       BOOLEAN      NOT NULL DEFAULT false,
            loop_playlist BOOLEAN      NOT NULL DEFAULT true,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at    TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_screen_playlists_branch ON screen_playlists(branch_id)",
        """CREATE TABLE IF NOT EXISTS screen_playlist_items (
            id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
            playlist_id     UUID    NOT NULL,
            content_item_id UUID    NOT NULL,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            duration_secs   INTEGER DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_screen_playlist_items_pl ON screen_playlist_items(playlist_id)",
        """CREATE TABLE IF NOT EXISTS screen_profiles (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id           VARCHAR(100) NOT NULL DEFAULT 'main',
            name                VARCHAR(200) NOT NULL,
            location            VARCHAR(200) NOT NULL DEFAULT '',
            description         TEXT         NOT NULL DEFAULT '',
            display_mode        VARCHAR(20)  NOT NULL DEFAULT 'playlist',
            default_playlist_id UUID         DEFAULT NULL,
            live_url            TEXT         NOT NULL DEFAULT '',
            live_type           VARCHAR(20)  NOT NULL DEFAULT 'stream',
            schedule_json       JSONB        NOT NULL DEFAULT '[]',
            is_active           BOOLEAN      NOT NULL DEFAULT true,
            created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at          TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_screen_profiles_branch ON screen_profiles(branch_id)",
        # HR — standalone employee fields (no user account required)
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id               TEXT DEFAULT NULL",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS full_name             VARCHAR(200)",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS email                 VARCHAR(255)",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone                 VARCHAR(50)",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS address               TEXT",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url             TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality            VARCHAR(100) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS right_to_work_type    VARCHAR(50)  NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_number           VARCHAR(100) NOT NULL DEFAULT ''",
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_expiry           DATE",
        # Donations ledger
        """CREATE TABLE IF NOT EXISTS donations (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id                 VARCHAR(200) NOT NULL DEFAULT '',
            branch_id               VARCHAR(100) NOT NULL DEFAULT 'main',
            amount                  NUMERIC(12,2) NOT NULL DEFAULT 0,
            currency                VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            gift_aid_eligible       BOOLEAN      NOT NULL DEFAULT false,
            gift_aid_declaration_id UUID         DEFAULT NULL,
            gift_aid_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
            purpose                 VARCHAR(200) NOT NULL DEFAULT 'General',
            reference               VARCHAR(100) NOT NULL DEFAULT '',
            payment_provider        VARCHAR(50)  NOT NULL DEFAULT 'cash',
            payment_ref             VARCHAR(200) DEFAULT NULL,
            status                  VARCHAR(20)  NOT NULL DEFAULT 'COMPLETED',
            idempotency_key         VARCHAR(200) NOT NULL DEFAULT '',
            created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at              TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_donations_branch   ON donations(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_donations_status   ON donations(status)",
        "CREATE INDEX IF NOT EXISTS idx_donations_created  ON donations(created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_idempotency ON donations(idempotency_key)",
        # Branches — managed via admin UI
        """CREATE TABLE IF NOT EXISTS branches (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id     VARCHAR(50)  UNIQUE NOT NULL,
            name          VARCHAR(200) NOT NULL,
            city          VARCHAR(100) NOT NULL DEFAULT '',
            postcode      VARCHAR(20)  NOT NULL DEFAULT '',
            address       TEXT         NOT NULL DEFAULT '',
            phone         VARCHAR(50)  NOT NULL DEFAULT '',
            email         VARCHAR(200) NOT NULL DEFAULT '',
            established   VARCHAR(10)  NOT NULL DEFAULT '',
            is_active     BOOLEAN      NOT NULL DEFAULT true,
            manager_name  VARCHAR(200) NOT NULL DEFAULT '',
            manager_email VARCHAR(200) NOT NULL DEFAULT '',
            notes         TEXT         NOT NULL DEFAULT '',
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_branches_active ON branches(is_active)",
        # ── Internal reference vs public display name ────────────────────────
        # internal_ref: short, stable, human-assigned code (WEM, LEI, MK, RDG)
        # used as the canonical reference across all INTERNAL systems. The
        # public-facing `name` is the display name shown to donors (donation
        # portal, receipts, kiosk). branch_id (slug) remains the DB FK.
        "ALTER TABLE branches ADD COLUMN IF NOT EXISTS internal_ref VARCHAR(30) NOT NULL DEFAULT ''",
        # Backfill internal_ref from branch_id for existing rows (uppercased,
        # trimmed) so every branch has a non-empty internal reference.
        "UPDATE branches SET internal_ref = UPPER(branch_id) WHERE COALESCE(internal_ref,'') = ''",
        # Unique on non-empty internal_ref so two branches can't share a code.
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_internal_ref ON branches(internal_ref) WHERE internal_ref <> ''",
        # Fundraising projects — each project groups PROJECT_DONATION items
        """CREATE TABLE IF NOT EXISTS projects (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id    VARCHAR(60) UNIQUE NOT NULL,
            name          VARCHAR(200) NOT NULL,
            description   TEXT NOT NULL DEFAULT '',
            branch_id     VARCHAR(100) NOT NULL DEFAULT 'main',
            goal_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
            image_url     TEXT NOT NULL DEFAULT '',
            start_date    DATE,
            end_date      DATE,
            is_active     BOOLEAN NOT NULL DEFAULT true,
            sort_order    INTEGER NOT NULL DEFAULT 0,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_projects_branch ON projects(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(is_active)",
        # Link catalog_items to a project (optional)
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS project_id VARCHAR(60) NOT NULL DEFAULT ''",
        "CREATE INDEX IF NOT EXISTS idx_catalog_items_project ON catalog_items(project_id)",

        # ── Project Management extensions ────────────────────────────────────
        # Three named owner roles (each is a users.id reference, nullable so
        # an early-stage project doesn't have to fill every slot).
        # Plus budget_total (committed budget), status (lifecycle), and
        # risk_level (operator-set RAG).
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_manager_id UUID DEFAULT NULL",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS business_owner_id  UUID DEFAULT NULL",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS tech_owner_id      UUID DEFAULT NULL",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_total       NUMERIC(14,2) NOT NULL DEFAULT 0",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS status             VARCHAR(20)   NOT NULL DEFAULT 'DRAFT'",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS risk_level         VARCHAR(20)   NOT NULL DEFAULT 'GREEN'",
        # Parent project for hierarchy — programmes → projects → sub-projects.
        # Nullable: a top-level project has no parent. ON DELETE SET NULL so
        # deleting a parent doesn't cascade-destroy its children — they just
        # become top-level. The summary endpoint surfaces both the parent's
        # name and the immediate-child list so the UI can render a tree.
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_project_id  UUID DEFAULT NULL",
        "CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id) WHERE parent_project_id IS NOT NULL",

        # Team assignments — many-to-many between projects and users with a
        # role per assignment (DEVELOPER, ANALYST, FINANCE, STAKEHOLDER, etc.).
        """CREATE TABLE IF NOT EXISTS project_assignments (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id      UUID NOT NULL,
            role         VARCHAR(40)  NOT NULL DEFAULT 'TEAM_MEMBER',
            notes        TEXT         NOT NULL DEFAULT '',
            assigned_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            removed_at   TIMESTAMPTZ  DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_assignments_proj ON project_assignments(project_id) WHERE removed_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_project_assignments_user ON project_assignments(user_id)    WHERE removed_at IS NULL",

        # Activity log — every status change, comment, milestone update.
        # actor_id is the user who logged the activity (nullable for system
        # events). kind discriminates: NOTE / STATUS_CHANGE / MILESTONE /
        # EXPENSE / INVOICE / RISK.
        """CREATE TABLE IF NOT EXISTS project_activities (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            actor_id     UUID DEFAULT NULL,
            actor_email  VARCHAR(255) NOT NULL DEFAULT '',
            kind         VARCHAR(30)  NOT NULL DEFAULT 'NOTE',
            title        VARCHAR(255) NOT NULL DEFAULT '',
            body         TEXT         NOT NULL DEFAULT '',
            related_id   VARCHAR(100) NOT NULL DEFAULT '',
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_activities_proj ON project_activities(project_id, created_at DESC)",

        # Risk register — one row per identified risk. likelihood + impact
        # are 1-5 scales; risk_score = likelihood * impact, computed as
        # generated column so the UI can sort/filter without recomputing.
        """CREATE TABLE IF NOT EXISTS project_risks (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title        VARCHAR(255) NOT NULL,
            description  TEXT         NOT NULL DEFAULT '',
            likelihood   INTEGER      NOT NULL DEFAULT 3 CHECK (likelihood BETWEEN 1 AND 5),
            impact       INTEGER      NOT NULL DEFAULT 3 CHECK (impact     BETWEEN 1 AND 5),
            risk_score   INTEGER      GENERATED ALWAYS AS (likelihood * impact) STORED,
            mitigation   TEXT         NOT NULL DEFAULT '',
            owner_id     UUID DEFAULT NULL,
            status       VARCHAR(20)  NOT NULL DEFAULT 'OPEN',
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            closed_at    TIMESTAMPTZ  DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_risks_proj ON project_risks(project_id, status)",

        # Expense line items — actual spending against the project. category
        # is operator-set (LABOUR / MATERIALS / SERVICES / TRAVEL / OTHER).
        # invoice_ref links to project_invoices.invoice_no when sourced from
        # a vendor invoice.
        """CREATE TABLE IF NOT EXISTS project_expenses (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            spent_on     DATE         NOT NULL,
            category     VARCHAR(40)  NOT NULL DEFAULT 'OTHER',
            vendor       VARCHAR(255) NOT NULL DEFAULT '',
            description  TEXT         NOT NULL DEFAULT '',
            amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
            currency     VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            invoice_ref  VARCHAR(100) NOT NULL DEFAULT '',
            recorded_by  UUID DEFAULT NULL,
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at   TIMESTAMPTZ  DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_expenses_proj ON project_expenses(project_id, spent_on DESC) WHERE deleted_at IS NULL",

        # Vendor invoice tracker per project. status: RECEIVED / APPROVED /
        # PAID / DISPUTED / CANCELLED.
        """CREATE TABLE IF NOT EXISTS project_invoices (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            vendor        VARCHAR(255) NOT NULL,
            invoice_no    VARCHAR(100) NOT NULL DEFAULT '',
            invoice_date  DATE,
            due_date      DATE,
            paid_date     DATE,
            amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
            currency      VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            status        VARCHAR(20)  NOT NULL DEFAULT 'RECEIVED',
            file_url      TEXT         NOT NULL DEFAULT '',
            notes         TEXT         NOT NULL DEFAULT '',
            recorded_by   UUID DEFAULT NULL,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at    TIMESTAMPTZ  DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_invoices_proj   ON project_invoices(project_id) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_project_invoices_status ON project_invoices(status)    WHERE deleted_at IS NULL",

        # ── Phase 1b/1c — reuse-existing linking ─────────────────────────────
        # Link expenses + invoices to the existing crm_accounts CRM (where
        # vendor/supplier/partner already live as account_type values). Keep
        # the free-text vendor column for back-compat — populate either.
        "ALTER TABLE project_expenses ADD COLUMN IF NOT EXISTS vendor_account_id UUID DEFAULT NULL",
        "ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS vendor_account_id UUID DEFAULT NULL",
        "CREATE INDEX IF NOT EXISTS idx_project_expenses_vendor ON project_expenses(vendor_account_id) WHERE vendor_account_id IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_project_invoices_vendor ON project_invoices(vendor_account_id) WHERE vendor_account_id IS NOT NULL",

        # Reuse the donations table for incoming-funds attribution per project.
        # Today the dashboard guesses by `purpose` text-match against the
        # project name; making this an explicit FK lets restricted-fund
        # projects show their actual donor-restricted intake without text
        # heuristics. Nullable so general donations stay project-agnostic.
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT NULL",
        "CREATE INDEX IF NOT EXISTS idx_donations_project ON donations(project_id) WHERE project_id IS NOT NULL",

        # Milestones — the work breakdown the operator asked for. Each row is
        # a deliverable with an owner + due date. status moves through
        # PENDING / IN_PROGRESS / DONE / SKIPPED; pct_complete is 0-100 for
        # finer reporting on the dashboard.
        """CREATE TABLE IF NOT EXISTS project_milestones (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title        VARCHAR(255) NOT NULL,
            description  TEXT         NOT NULL DEFAULT '',
            owner_id     UUID DEFAULT NULL,
            due_date     DATE,
            status       VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
            pct_complete INTEGER      NOT NULL DEFAULT 0 CHECK (pct_complete BETWEEN 0 AND 100),
            completed_at TIMESTAMPTZ  DEFAULT NULL,
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at   TIMESTAMPTZ  DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_milestones_proj ON project_milestones(project_id, due_date) WHERE deleted_at IS NULL",

        # Documents — charter, contracts, grant agreements, signed approvals.
        # file_url is intentionally an external URL (SharePoint, Drive, S3)
        # rather than a binary in PG — uploaders elsewhere already populate
        # similar URL columns this way.
        """CREATE TABLE IF NOT EXISTS project_documents (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title        VARCHAR(255) NOT NULL,
            kind         VARCHAR(40)  NOT NULL DEFAULT 'OTHER',
            file_url     TEXT         NOT NULL DEFAULT '',
            version      VARCHAR(50)  NOT NULL DEFAULT '',
            uploaded_by  UUID DEFAULT NULL,
            uploaded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at   TIMESTAMPTZ  DEFAULT NULL,
            notes        TEXT         NOT NULL DEFAULT ''
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_documents_proj ON project_documents(project_id) WHERE deleted_at IS NULL",

        # ── Tasks ────────────────────────────────────────────────────────
        # The Activity log records what HAPPENED (immutable timeline). Tasks
        # record what NEEDS TO HAPPEN — assigned work with a due date and
        # status that the team progresses. Kept deliberately small: one
        # assignee, status enum, no sub-tasks. Adding a CHECKLIST kind to
        # project_activities was considered and rejected because tasks need
        # mutable state.
        """CREATE TABLE IF NOT EXISTS project_tasks (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title           VARCHAR(255) NOT NULL,
            description     TEXT         NOT NULL DEFAULT '',
            assignee_id     UUID DEFAULT NULL,
            due_date        DATE DEFAULT NULL,
            status          VARCHAR(20)  NOT NULL DEFAULT 'TODO',
            priority        VARCHAR(20)  NOT NULL DEFAULT 'MEDIUM',
            created_by      UUID DEFAULT NULL,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            completed_at    TIMESTAMPTZ DEFAULT NULL,
            deleted_at      TIMESTAMPTZ DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_tasks_proj      ON project_tasks(project_id) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee  ON project_tasks(assignee_id) WHERE deleted_at IS NULL AND status <> 'DONE'",

        # ── TV / Broadcast channel ───────────────────────────────────────
        # The temple's online TV channel runs through YouTube Live as the
        # streaming backend; the admin keeps the content library, schedule
        # and playout log so we own the "what's playing now" question
        # independently of YouTube's API. Donations and viewer metrics tie
        # back here. Public viewer lives at apps/tv/.
        """CREATE TABLE IF NOT EXISTS broadcast_assets (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title           VARCHAR(255) NOT NULL,
            description     TEXT         NOT NULL DEFAULT '',
            kind            VARCHAR(40)  NOT NULL DEFAULT 'OTHER',
            language        VARCHAR(20)  NOT NULL DEFAULT 'en',
            branch_id       VARCHAR(100) DEFAULT NULL,
            source_url      TEXT         NOT NULL DEFAULT '',
            youtube_video_id VARCHAR(40) DEFAULT NULL,
            duration_seconds INTEGER     NOT NULL DEFAULT 0,
            thumbnail_url   TEXT         NOT NULL DEFAULT '',
            rights_cleared  BOOLEAN      NOT NULL DEFAULT true,
            tags            JSONB        NOT NULL DEFAULT '[]'::jsonb,
            uploaded_by     UUID DEFAULT NULL,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at      TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_broadcast_assets_kind     ON broadcast_assets(kind)     WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_broadcast_assets_branch   ON broadcast_assets(branch_id) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_broadcast_assets_yt       ON broadcast_assets(youtube_video_id) WHERE youtube_video_id IS NOT NULL",
        # Schedule = recurring weekly grid. day_of_week 0=Mon … 6=Sun.
        """CREATE TABLE IF NOT EXISTS broadcast_schedule_blocks (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id       VARCHAR(100) DEFAULT NULL,
            day_of_week     SMALLINT     NOT NULL,
            start_time      TIME         NOT NULL,
            duration_min    INTEGER      NOT NULL DEFAULT 30,
            asset_id        UUID REFERENCES broadcast_assets(id) ON DELETE SET NULL,
            title_override  VARCHAR(255) NOT NULL DEFAULT '',
            is_live_slot    BOOLEAN      NOT NULL DEFAULT false,
            recurring       BOOLEAN      NOT NULL DEFAULT true,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at      TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_broadcast_schedule_dow    ON broadcast_schedule_blocks(day_of_week, start_time) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_broadcast_schedule_branch ON broadcast_schedule_blocks(branch_id) WHERE deleted_at IS NULL",
        # Live broadcasts — actual occurrences (vs the recurring schedule).
        # A row is created when something actually goes live, capturing the
        # YouTube stream id + viewer peak for reporting.
        """CREATE TABLE IF NOT EXISTS broadcast_live_events (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id       VARCHAR(100) DEFAULT NULL,
            project_id      UUID DEFAULT NULL,
            title           VARCHAR(255) NOT NULL,
            description     TEXT         NOT NULL DEFAULT '',
            scheduled_at    TIMESTAMPTZ  DEFAULT NULL,
            started_at      TIMESTAMPTZ  DEFAULT NULL,
            ended_at        TIMESTAMPTZ  DEFAULT NULL,
            platform        VARCHAR(20)  NOT NULL DEFAULT 'youtube',
            youtube_video_id VARCHAR(40) DEFAULT NULL,
            stream_url      TEXT         NOT NULL DEFAULT '',
            recording_url   TEXT         NOT NULL DEFAULT '',
            viewer_count_peak INTEGER    NOT NULL DEFAULT 0,
            status          VARCHAR(20)  NOT NULL DEFAULT 'SCHEDULED',
            created_by      UUID DEFAULT NULL,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_broadcast_live_status  ON broadcast_live_events(status, scheduled_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_broadcast_live_branch  ON broadcast_live_events(branch_id, scheduled_at DESC)",

        # Budget breakdown — one row per category (LABOUR / MATERIALS /
        # SERVICES / TRAVEL / OTHER, matching the project_expenses category
        # enum). Variance reporting joins this against the expense rollup
        # for per-category over/under spend.
        """CREATE TABLE IF NOT EXISTS project_budget_items (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            category     VARCHAR(40)  NOT NULL DEFAULT 'OTHER',
            description  TEXT         NOT NULL DEFAULT '',
            amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
            currency     VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_budget_items_proj ON project_budget_items(project_id, category)",

        # Project partners — join to crm_accounts (NOT a new vendors table).
        # The relationship value distinguishes between PARTNER (collaborating
        # charity), GRANTOR (funded us), BENEFICIARY (we serve them),
        # SPONSOR (gave us in-kind / cash without restriction), SUPPLIER.
        # account_type on crm_accounts already filters vendor/supplier/etc.;
        # this table records the per-project relationship.
        """CREATE TABLE IF NOT EXISTS project_partners (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            account_id   UUID NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
            relationship VARCHAR(40)  NOT NULL DEFAULT 'PARTNER',
            start_date   DATE,
            end_date     DATE,
            notes        TEXT         NOT NULL DEFAULT '',
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            removed_at   TIMESTAMPTZ  DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_partners_proj    ON project_partners(project_id)    WHERE removed_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_project_partners_account ON project_partners(account_id)    WHERE removed_at IS NULL",

        # Approval workflow — single-step trustee/admin approval pattern.
        # kind: START (DRAFT → ACTIVE), CHANGE_BUDGET, CHANGE_SCOPE, CLOSE.
        # status: PENDING → APPROVED | REJECTED | WITHDRAWN.
        # Project status transitions to ACTIVE are gated on an APPROVED
        # 'START' row when budget_total > APPROVAL_THRESHOLD_GBP OR
        # project_type='CAPITAL' OR fund_type IN (RESTRICTED, ENDOWMENT).
        """CREATE TABLE IF NOT EXISTS project_approvals (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            kind            VARCHAR(40)  NOT NULL DEFAULT 'START',
            requested_by    UUID DEFAULT NULL,
            requested_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            request_reason  TEXT         NOT NULL DEFAULT '',
            status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
            approver_id     UUID DEFAULT NULL,
            decided_at      TIMESTAMPTZ  DEFAULT NULL,
            decision_reason TEXT         NOT NULL DEFAULT ''
        )""",
        "CREATE INDEX IF NOT EXISTS idx_project_approvals_proj ON project_approvals(project_id, status)",

        # ── Phase 3B — In-app notifications ──────────────────────────────────
        # Per-user fan-out. kind discriminates: ASSIGNMENT / RISK / APPROVAL /
        # MILESTONE / INVOICE / FUNDING / SYSTEM. link_url is a relative
        # path the header bell links to when the user clicks the row.
        # read_at NULL → unread; mark-read flips it. Auto-collapse old rows
        # via a periodic job (skipped for now — table size is fine for years).
        """CREATE TABLE IF NOT EXISTS notifications (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     UUID NOT NULL,
            kind        VARCHAR(40)  NOT NULL DEFAULT 'SYSTEM',
            title       VARCHAR(255) NOT NULL,
            body        TEXT         NOT NULL DEFAULT '',
            link_url    VARCHAR(500) NOT NULL DEFAULT '',
            severity    VARCHAR(20)  NOT NULL DEFAULT 'INFO',
            read_at     TIMESTAMPTZ  DEFAULT NULL,
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_notifications_user_all    ON notifications(user_id, created_at DESC)",

        # ── Recurring Payments — financial obligations tracker ─────────────────
        """CREATE TABLE IF NOT EXISTS recurring_payments (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id       VARCHAR(100) NOT NULL DEFAULT 'main',
            name            VARCHAR(200) NOT NULL,
            category        VARCHAR(50)  NOT NULL DEFAULT 'OTHER',
            is_critical     BOOLEAN      NOT NULL DEFAULT false,
            amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
            currency        VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            frequency       VARCHAR(20)  NOT NULL DEFAULT 'MONTHLY',
            start_date      DATE         NOT NULL DEFAULT CURRENT_DATE,
            end_date        DATE,
            day_of_month    SMALLINT,
            renewal_date    DATE,
            notice_days     SMALLINT     NOT NULL DEFAULT 30,
            payee           VARCHAR(200) NOT NULL DEFAULT '',
            reference       VARCHAR(200) NOT NULL DEFAULT '',
            notes           TEXT         NOT NULL DEFAULT '',
            is_active       BOOLEAN      NOT NULL DEFAULT true,
            created_by      VARCHAR(200) NOT NULL DEFAULT '',
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at      TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_recurring_branch   ON recurring_payments(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_recurring_category ON recurring_payments(category)",
        "CREATE INDEX IF NOT EXISTS idx_recurring_active   ON recurring_payments(is_active)",
        """CREATE TABLE IF NOT EXISTS payment_schedule (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            recurring_payment_id UUID         NOT NULL,
            branch_id            VARCHAR(100) NOT NULL DEFAULT 'main',
            due_date             DATE         NOT NULL,
            amount               NUMERIC(12,2) NOT NULL DEFAULT 0,
            currency             VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            status               VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
            paid_date            DATE,
            paid_amount          NUMERIC(12,2),
            paid_reference       VARCHAR(200) NOT NULL DEFAULT '',
            paid_by              VARCHAR(200) NOT NULL DEFAULT '',
            notes                TEXT         NOT NULL DEFAULT '',
            created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_pschedule_recurring ON payment_schedule(recurring_payment_id)",
        "CREATE INDEX IF NOT EXISTS idx_pschedule_branch    ON payment_schedule(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_pschedule_due_date  ON payment_schedule(due_date)",
        "CREATE INDEX IF NOT EXISTS idx_pschedule_status    ON payment_schedule(status)",
        # ── Kiosk / Display Devices ────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS kiosk_devices (
            id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id             VARCHAR(100) NOT NULL DEFAULT 'main',
            name                  VARCHAR(200) NOT NULL,
            description           TEXT NOT NULL DEFAULT '',
            device_type           VARCHAR(30) NOT NULL DEFAULT 'KIOSK',
            location              VARCHAR(200) NOT NULL DEFAULT '',
            status                VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            screen_profile_id     UUID,
            peak_start            VARCHAR(5) NOT NULL DEFAULT '09:00',
            peak_end              VARCHAR(5) NOT NULL DEFAULT '21:00',
            off_peak_playlist_id  UUID,
            default_donate_amount NUMERIC(8,2) NOT NULL DEFAULT 5,
            serial_number         VARCHAR(100) NOT NULL DEFAULT '',
            ip_address            VARCHAR(50) NOT NULL DEFAULT '',
            device_token          VARCHAR(100) UNIQUE NOT NULL DEFAULT '',
            last_seen_at          TIMESTAMPTZ,
            notes                 TEXT NOT NULL DEFAULT '',
            created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at            TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_kiosk_devices_branch ON kiosk_devices(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_kiosk_devices_type   ON kiosk_devices(device_type)",
        "CREATE INDEX IF NOT EXISTS idx_kiosk_devices_token  ON kiosk_devices(device_token)",
        # ── Add card_reader_id to existing kiosk_devices rows ─────────────────
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS card_reader_id UUID",
        # ── Kiosk branding / appearance columns ───────────────────────────────
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS kiosk_theme          VARCHAR(20)  NOT NULL DEFAULT 'lotus'",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS org_name             VARCHAR(100) NOT NULL DEFAULT ''",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS org_logo_url         TEXT         NOT NULL DEFAULT ''",
        # ── Device-level credentials + quick donation feature flags ──────────────
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS device_username      VARCHAR(100) DEFAULT NULL",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS device_password_hash VARCHAR(255) DEFAULT NULL",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS show_monthly_giving  BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS enable_gift_aid      BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS tap_and_go           BOOLEAN NOT NULL DEFAULT true",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS donate_title         VARCHAR(100) NOT NULL DEFAULT 'Tap & Donate'",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS monthly_giving_text  VARCHAR(200) NOT NULL DEFAULT 'Make a big impact from just £5/month'",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS monthly_giving_amount  NUMERIC(8,2) NOT NULL DEFAULT 5.00",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS confirmation_text      TEXT         NOT NULL DEFAULT ''",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS bg_color              VARCHAR(20)  NOT NULL DEFAULT ''",
        # Per-device staff-menu visibility — JSON of { test_print, theme_cycle,
        # refresh, admin } booleans. Loaded by the kiosk on login; the gear
        # menu hides items where the value is false.
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS menu_options JSONB NOT NULL DEFAULT '{\"test_print\": true, \"theme_cycle\": true, \"refresh\": true, \"admin\": true}'::jsonb",
        # Physical location of the device (WGS-84). Nullable — not every kiosk
        # has GPS set yet. NUMERIC(9,6) gives ~10cm precision and covers any
        # coordinate on Earth without floating-point drift.
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS latitude  NUMERIC(9,6) DEFAULT NULL",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6) DEFAULT NULL",
        # Remote-command channel. Admin queues a command here; the kiosk polls
        # /quick-donation/check-command every ~30s, acts (e.g. reload), then
        # acks to clear the column. Single-slot (no queue) by design — repeated
        # admin clicks just overwrite; the kiosk only needs the latest intent.
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS pending_command    VARCHAR(50)  DEFAULT NULL",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS pending_command_at TIMESTAMPTZ  DEFAULT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_kiosk_devices_username ON kiosk_devices(device_username) WHERE device_username IS NOT NULL",
        # ── Menu / menu-profile system (per-app, parent/child) ────────────────
        """CREATE TABLE IF NOT EXISTS menus (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            app_id        VARCHAR(64)  NOT NULL,
            code          VARCHAR(64)  NOT NULL,
            label         VARCHAR(200) NOT NULL,
            parent_id     UUID         REFERENCES menus(id) ON DELETE CASCADE,
            icon          VARCHAR(64)  NOT NULL DEFAULT '',
            display_order INTEGER      NOT NULL DEFAULT 0,
            is_active     BOOLEAN      NOT NULL DEFAULT true,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            UNIQUE (app_id, code)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_menus_app    ON menus(app_id)",
        "CREATE INDEX IF NOT EXISTS idx_menus_parent ON menus(parent_id)",
        """CREATE TABLE IF NOT EXISTS menu_profiles (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            app_id      VARCHAR(64)  NOT NULL,
            name        VARCHAR(120) NOT NULL,
            description TEXT         NOT NULL DEFAULT '',
            is_default  BOOLEAN      NOT NULL DEFAULT false,
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            UNIQUE (app_id, name)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_menu_profiles_app ON menu_profiles(app_id)",
        """CREATE TABLE IF NOT EXISTS menu_profile_items (
            profile_id UUID NOT NULL REFERENCES menu_profiles(id) ON DELETE CASCADE,
            menu_id    UUID NOT NULL REFERENCES menus(id)         ON DELETE CASCADE,
            PRIMARY KEY (profile_id, menu_id)
        )""",
        "ALTER TABLE kiosk_devices ADD COLUMN IF NOT EXISTS menu_profile_id UUID REFERENCES menu_profiles(id) ON DELETE SET NULL",
        # Seed kiosk menus (idempotent — guarded by NOT EXISTS)
        """INSERT INTO menus (app_id, code, label, icon, display_order)
        SELECT * FROM (VALUES
            ('kiosk','donations',        'Donations',         '🪔', 10),
            ('kiosk','soft_donation',    'Soft Item Donation','🎁', 20),
            ('kiosk','sponsorship',      'Sponsorship',       '📖', 30),
            ('kiosk','project_donation', 'Project Donation',  '🏗️', 40),
            ('kiosk','services',         'Services',          '✨', 50),
            ('kiosk','shop',             'Shop',              '🛍️', 60),
            ('kiosk','information',      'Information',       'ℹ️', 70),
            ('kiosk','registration',     'Registration',      '📝', 80)
        ) AS v(app_id, code, label, icon, display_order)
        WHERE NOT EXISTS (SELECT 1 FROM menus WHERE menus.app_id = v.app_id AND menus.code = v.code)""",
        # Seed default profile linked to all kiosk menus
        """INSERT INTO menu_profiles (app_id, name, description, is_default)
        SELECT 'kiosk', 'Default — All Menus', 'Shows every menu (Donations, Soft Items, Sponsorship, Project Donations, Services, Shop, Information, Registration).', true
        WHERE NOT EXISTS (SELECT 1 FROM menu_profiles WHERE app_id = 'kiosk' AND name = 'Default — All Menus')""",
        """INSERT INTO menu_profile_items (profile_id, menu_id)
        SELECT p.id, m.id
        FROM   menu_profiles p, menus m
        WHERE  p.app_id = 'kiosk' AND p.name = 'Default — All Menus'
          AND  m.app_id = 'kiosk'
          AND  NOT EXISTS (
                SELECT 1 FROM menu_profile_items i WHERE i.profile_id = p.id AND i.menu_id = m.id
          )""",
        # Seed two example narrow profiles (idempotent)
        """INSERT INTO menu_profiles (app_id, name, description, is_default)
        SELECT 'kiosk', 'Donation-Only', 'Only the donation menus — for tap-and-go donation kiosks.', false
        WHERE NOT EXISTS (SELECT 1 FROM menu_profiles WHERE app_id = 'kiosk' AND name = 'Donation-Only')""",
        """INSERT INTO menu_profile_items (profile_id, menu_id)
        SELECT p.id, m.id
        FROM   menu_profiles p, menus m
        WHERE  p.app_id = 'kiosk' AND p.name = 'Donation-Only'
          AND  m.app_id = 'kiosk' AND m.code IN ('donations','sponsorship','project_donation')
          AND  NOT EXISTS (
                SELECT 1 FROM menu_profile_items i WHERE i.profile_id = p.id AND i.menu_id = m.id
          )""",
        """INSERT INTO menu_profiles (app_id, name, description, is_default)
        SELECT 'kiosk', 'Shop & Info', 'Shop and information only — reception kiosks.', false
        WHERE NOT EXISTS (SELECT 1 FROM menu_profiles WHERE app_id = 'kiosk' AND name = 'Shop & Info')""",
        """INSERT INTO menu_profile_items (profile_id, menu_id)
        SELECT p.id, m.id
        FROM   menu_profiles p, menus m
        WHERE  p.app_id = 'kiosk' AND p.name = 'Shop & Info'
          AND  m.app_id = 'kiosk' AND m.code IN ('shop','information','registration')
          AND  NOT EXISTS (
                SELECT 1 FROM menu_profile_items i WHERE i.profile_id = p.id AND i.menu_id = m.id
          )""",
        # ── Quick-donation kiosk profiles ─────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS kiosk_profiles (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id           VARCHAR(100) NOT NULL,
            branch_name         VARCHAR(200) NOT NULL DEFAULT '',
            user_id             UUID DEFAULT NULL,
            user_email          VARCHAR(200) NOT NULL,
            user_name           VARCHAR(200) NOT NULL DEFAULT '',
            device_id           UUID DEFAULT NULL,
            device_label        VARCHAR(255) DEFAULT '',
            stripe_reader_id    VARCHAR(255) DEFAULT '',
            device_provider     VARCHAR(50) DEFAULT 'stripe_terminal',
            profile_name        VARCHAR(200) NOT NULL,
            kiosk_type          VARCHAR(50) NOT NULL DEFAULT 'quick_donation',
            display_name        VARCHAR(200) DEFAULT '',
            preset_amounts      JSONB NOT NULL DEFAULT '[1, 2.5, 5, 10, 15, 20, 50]',
            default_purpose     VARCHAR(200) DEFAULT 'General Fund',
            gift_aid_prompt     BOOLEAN NOT NULL DEFAULT true,
            idle_timeout_secs   INT NOT NULL DEFAULT 90,
            theme               VARCHAR(50) DEFAULT 'saffron',
            is_active           BOOLEAN NOT NULL DEFAULT TRUE,
            last_active_at      TIMESTAMPTZ DEFAULT NULL,
            notes               TEXT DEFAULT '',
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at          TIMESTAMPTZ DEFAULT NULL,
            UNIQUE(branch_id, user_email)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_branch ON kiosk_profiles(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_user   ON kiosk_profiles(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_device ON kiosk_profiles(device_id)",
        # ── Deduplicate catalog_items — keep one row per (name, category, price) ─
        # Keeps the row with the earliest created_at; safe to re-run (idempotent)
        """
        DELETE FROM catalog_items
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY lower(name), category, price
                           ORDER BY created_at ASC, id ASC
                       ) AS rn
                FROM catalog_items
                WHERE deleted_at IS NULL
            ) t
            WHERE rn > 1
        )
        """,
        # ── Email / WhatsApp receipt templates ────────────────────────────────
        """CREATE TABLE IF NOT EXISTS email_templates (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            template_key VARCHAR(100) UNIQUE NOT NULL,
            name         VARCHAR(200) NOT NULL DEFAULT '',
            subject      TEXT NOT NULL DEFAULT '',
            html_body    TEXT NOT NULL DEFAULT '',
            text_body    TEXT NOT NULL DEFAULT '',
            variables    JSONB NOT NULL DEFAULT '[]',
            is_active    BOOLEAN NOT NULL DEFAULT true,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_email_templates_key ON email_templates(template_key)",
        # ── Outgoing email audit log ──────────────────────────────────────────
        # Every email rendered by send_template() lands here BEFORE the SMTP
        # call, so a crash mid-send still leaves a paper trail. Status
        # transitions: PENDING → SENT (success) or FAILED (error captured).
        # variables is stored verbatim so /admin/sent-emails/{id}/resend can
        # re-render against the current template and retry without the
        # caller having to remember what context to pass.
        """CREATE TABLE IF NOT EXISTS sent_emails (
            id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            template_key    VARCHAR(100) NOT NULL DEFAULT '',
            to_email        VARCHAR(255) NOT NULL,
            from_email      VARCHAR(255) NOT NULL DEFAULT '',
            subject         TEXT         NOT NULL DEFAULT '',
            html_body       TEXT         NOT NULL DEFAULT '',
            text_body       TEXT         NOT NULL DEFAULT '',
            variables       JSONB        NOT NULL DEFAULT '{}'::jsonb,
            status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
            error           TEXT         NOT NULL DEFAULT '',
            attempts        INTEGER      NOT NULL DEFAULT 0,
            last_attempt_at TIMESTAMPTZ,
            sent_at         TIMESTAMPTZ,
            related_type    VARCHAR(50)  NOT NULL DEFAULT '',
            related_id      VARCHAR(100) NOT NULL DEFAULT '',
            triggered_by    VARCHAR(255) NOT NULL DEFAULT '',
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_sent_emails_status   ON sent_emails(status)",
        "CREATE INDEX IF NOT EXISTS idx_sent_emails_to       ON sent_emails(LOWER(to_email))",
        "CREATE INDEX IF NOT EXISTS idx_sent_emails_template ON sent_emails(template_key)",
        "CREATE INDEX IF NOT EXISTS idx_sent_emails_related  ON sent_emails(related_type, related_id)",
        "CREATE INDEX IF NOT EXISTS idx_sent_emails_failed   ON sent_emails(created_at DESC) WHERE status = 'FAILED'",
        # ── Temple Services ───────────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS temple_services (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id        VARCHAR(100) NOT NULL DEFAULT 'main',
            name             VARCHAR(300) NOT NULL,
            name_gu          VARCHAR(300) NOT NULL DEFAULT '',
            name_hi          VARCHAR(300) NOT NULL DEFAULT '',
            name_te          VARCHAR(300) NOT NULL DEFAULT '',
            description      TEXT,
            category         VARCHAR(50)  NOT NULL DEFAULT 'OTHER',
            price            NUMERIC(12,2) NOT NULL DEFAULT 0,
            currency         VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            duration         INTEGER,
            capacity         INTEGER,
            image_url        TEXT,
            gift_aid_eligible BOOLEAN NOT NULL DEFAULT false,
            is_active        BOOLEAN NOT NULL DEFAULT true,
            display_channel  VARCHAR(20)  NOT NULL DEFAULT 'both',
            is_live          BOOLEAN      NOT NULL DEFAULT true,
            available_from   TIMESTAMPTZ,
            available_until  TIMESTAMPTZ,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at       TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_temple_services_branch   ON temple_services(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_temple_services_category ON temple_services(category)",
        # ── Catalog Items ─────────────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS catalog_items (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name             VARCHAR(200) NOT NULL,
            name_gu          VARCHAR(200) NOT NULL DEFAULT '',
            name_hi          VARCHAR(200) NOT NULL DEFAULT '',
            name_te          VARCHAR(200) NOT NULL DEFAULT '',
            description      TEXT NOT NULL DEFAULT '',
            category         VARCHAR(50)  NOT NULL,
            price            NUMERIC(10,2) NOT NULL,
            currency         VARCHAR(3)   NOT NULL DEFAULT 'GBP',
            unit             VARCHAR(50)  NOT NULL DEFAULT '',
            emoji            VARCHAR(10)  NOT NULL DEFAULT '',
            image_url        TEXT NOT NULL DEFAULT '',
            gift_aid_eligible BOOLEAN NOT NULL DEFAULT false,
            is_active        BOOLEAN NOT NULL DEFAULT true,
            scope            VARCHAR(20)  NOT NULL DEFAULT 'GLOBAL',
            branch_id        VARCHAR(100) NOT NULL DEFAULT '',
            project_id       VARCHAR(60)  NOT NULL DEFAULT '',
            stock_qty        INTEGER,
            sort_order       INTEGER      NOT NULL DEFAULT 0,
            metadata_json    JSONB        NOT NULL DEFAULT '{}',
            available_from   TIMESTAMPTZ,
            available_until  TIMESTAMPTZ,
            display_channel  VARCHAR(20)  NOT NULL DEFAULT 'both',
            branch_stock     JSONB        NOT NULL DEFAULT '{}',
            is_live          BOOLEAN      NOT NULL DEFAULT true,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at       TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_catalog_items_category ON catalog_items(category)",
        "CREATE INDEX IF NOT EXISTS idx_catalog_items_branch   ON catalog_items(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_catalog_items_scope    ON catalog_items(scope)",
        # Per-item post-payment email (e.g. brick donor instructions).
        # When toggled on with a template_key, the backend sends one email
        # per item-line per order on payment success — additional to the
        # standard receipt.
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS send_email_on_payment BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS email_template_key VARCHAR(100) NOT NULL DEFAULT ''",
        # ── Kiosk: Baskets, Basket Items, Orders ──────────────────────────────
        """CREATE TABLE IF NOT EXISTS baskets (
            id         VARCHAR(36) PRIMARY KEY,
            session_id VARCHAR(36) NOT NULL,
            branch_id  VARCHAR(64) NOT NULL DEFAULT 'main',
            status     VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_baskets_session ON baskets(session_id)",
        """CREATE TABLE IF NOT EXISTS basket_items (
            id               VARCHAR(36)  PRIMARY KEY,
            basket_id        VARCHAR(36)  NOT NULL,
            item_type        VARCHAR(64)  NOT NULL,
            reference_id     VARCHAR(64),
            name             VARCHAR(256) NOT NULL,
            description      TEXT,
            quantity         INTEGER      NOT NULL DEFAULT 1,
            unit_price       NUMERIC(10,2) NOT NULL,
            total_price      NUMERIC(10,2) NOT NULL,
            gift_aid_eligible BOOLEAN     NOT NULL DEFAULT false,
            metadata         TEXT,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_basket_items_basket ON basket_items(basket_id)",
        """CREATE TABLE IF NOT EXISTS orders (
            id               VARCHAR(36)  PRIMARY KEY,
            branch_id        VARCHAR(64)  NOT NULL DEFAULT 'main',
            user_id          VARCHAR(200),
            basket_id        VARCHAR(36),
            reference        VARCHAR(64)  NOT NULL,
            status           VARCHAR(32)  NOT NULL DEFAULT 'PENDING',
            total_amount     NUMERIC(10,2) NOT NULL,
            currency         VARCHAR(3)   NOT NULL DEFAULT 'GBP',
            payment_provider VARCHAR(32),
            payment_ref      VARCHAR(256),
            idempotency_key  VARCHAR(64)  UNIQUE,
            customer_name    VARCHAR(256),
            customer_email   VARCHAR(256),
            customer_phone   VARCHAR(64),
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_reference ON orders(reference)",
        "CREATE INDEX IF NOT EXISTS idx_orders_branch   ON orders(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status)",
        "CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at DESC)",
        # ── Terminal Devices ─────────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS terminal_devices (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id          VARCHAR(100) NOT NULL,
            branch_name        VARCHAR(200) NOT NULL DEFAULT '',
            user_id            VARCHAR(100) DEFAULT NULL,
            user_name          VARCHAR(200) NOT NULL DEFAULT '',
            user_email         VARCHAR(200) NOT NULL DEFAULT '',
            label              VARCHAR(255) NOT NULL,
            provider           VARCHAR(50)  NOT NULL DEFAULT 'stripe_terminal',
            stripe_reader_id   VARCHAR(255) NOT NULL DEFAULT '',
            stripe_location_id VARCHAR(255) NOT NULL DEFAULT '',
            square_device_id   VARCHAR(255) NOT NULL DEFAULT '',
            device_type        VARCHAR(100) NOT NULL DEFAULT '',
            serial_number      VARCHAR(100) NOT NULL DEFAULT '',
            status             VARCHAR(50)  NOT NULL DEFAULT 'offline',
            is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
            last_seen_at       TIMESTAMPTZ  DEFAULT NULL,
            notes              TEXT         NOT NULL DEFAULT '',
            metadata_json      JSONB        NOT NULL DEFAULT '{}',
            created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at         TIMESTAMPTZ  DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_terminal_devices_branch ON terminal_devices(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_terminal_devices_active ON terminal_devices(is_active) WHERE deleted_at IS NULL",
        # Idempotent columns for providers added after initial schema
        "ALTER TABLE terminal_devices ADD COLUMN IF NOT EXISTS clover_device_id   VARCHAR(255) NOT NULL DEFAULT ''",
        "ALTER TABLE terminal_devices ADD COLUMN IF NOT EXISTS sumup_reader_serial VARCHAR(255) NOT NULL DEFAULT ''",
        # ── Gift Aid Declarations ─────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS gift_aid_declarations (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            order_ref           VARCHAR(100) NOT NULL,
            full_name           VARCHAR(200) NOT NULL,
            postcode            VARCHAR(20)  NOT NULL,
            address             TEXT         NOT NULL DEFAULT '',
            contact_email       VARCHAR(254) NOT NULL DEFAULT '',
            contact_phone       VARCHAR(50)  NOT NULL DEFAULT '',
            donation_amount     NUMERIC(10,2) NOT NULL,
            donation_date       DATE         NOT NULL,
            gift_aid_agreed     BOOLEAN      NOT NULL DEFAULT true,
            hmrc_submitted      BOOLEAN      NOT NULL DEFAULT false,
            hmrc_submission_ref VARCHAR(100),
            created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at          TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_gift_aid_decl_order_ref  ON gift_aid_declarations(order_ref)",
        "CREATE INDEX IF NOT EXISTS idx_gift_aid_decl_submitted  ON gift_aid_declarations(hmrc_submitted)",
        "ALTER TABLE gift_aid_declarations ADD COLUMN IF NOT EXISTS first_name VARCHAR(200) DEFAULT ''",
        "ALTER TABLE gift_aid_declarations ADD COLUMN IF NOT EXISTS surname    VARCHAR(200) DEFAULT ''",
        # ── Function Registry + Invocations ───────────────────────────────────
        """CREATE TABLE IF NOT EXISTS function_registry (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            function_name  VARCHAR(300) UNIQUE NOT NULL,
            display_name   VARCHAR(300) NOT NULL DEFAULT '',
            description    TEXT         NOT NULL DEFAULT '',
            fabric         VARCHAR(100) NOT NULL DEFAULT 'general',
            tags           JSONB        NOT NULL DEFAULT '[]',
            version        VARCHAR(50)  NOT NULL DEFAULT '1.0.0',
            module_path    VARCHAR(500) DEFAULT NULL,
            http_endpoint  VARCHAR(500) DEFAULT NULL,
            http_method    VARCHAR(10)  NOT NULL DEFAULT 'POST',
            input_schema   JSONB        NOT NULL DEFAULT '{}',
            output_schema  JSONB        NOT NULL DEFAULT '{}',
            example_input  JSONB        DEFAULT '{}',
            example_output JSONB        DEFAULT '{}',
            status         VARCHAR(50)  NOT NULL DEFAULT 'active',
            human_in_loop  BOOLEAN      NOT NULL DEFAULT false,
            requires_auth  BOOLEAN      NOT NULL DEFAULT true,
            required_roles JSONB        NOT NULL DEFAULT '[]',
            idempotent     BOOLEAN      NOT NULL DEFAULT false,
            total_calls    INTEGER      NOT NULL DEFAULT 0,
            success_count  INTEGER      NOT NULL DEFAULT 0,
            failure_count  INTEGER      NOT NULL DEFAULT 0,
            last_used_at   TIMESTAMPTZ  DEFAULT NULL,
            is_active      BOOLEAN      NOT NULL DEFAULT true,
            created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at     TIMESTAMPTZ  DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_fn_reg_fabric ON function_registry(fabric) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_fn_reg_status ON function_registry(status) WHERE deleted_at IS NULL",
        """CREATE TABLE IF NOT EXISTS function_invocations (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            function_id      UUID         REFERENCES function_registry(id) ON DELETE SET NULL,
            function_name    VARCHAR(300) NOT NULL,
            branch_id        VARCHAR(100) NOT NULL DEFAULT 'main',
            user_id          VARCHAR(200) DEFAULT NULL,
            user_email       VARCHAR(200) DEFAULT NULL,
            user_role        VARCHAR(100) DEFAULT NULL,
            triggered_by     VARCHAR(50)  NOT NULL DEFAULT 'manual',
            agent_session_id VARCHAR(200) DEFAULT NULL,
            agent_reasoning  TEXT         DEFAULT NULL,
            agent_query      TEXT         DEFAULT NULL,
            input_data       JSONB        NOT NULL DEFAULT '{}',
            output_data      JSONB        DEFAULT NULL,
            status           VARCHAR(50)  NOT NULL DEFAULT 'pending',
            error_message    TEXT         DEFAULT NULL,
            error_code       VARCHAR(100) DEFAULT NULL,
            duration_ms      INTEGER      DEFAULT NULL,
            request_id       VARCHAR(200) DEFAULT NULL,
            created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            completed_at     TIMESTAMPTZ  DEFAULT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_fn_inv_function_name ON function_invocations(function_name)",
        "CREATE INDEX IF NOT EXISTS idx_fn_inv_status       ON function_invocations(status)",
        "CREATE INDEX IF NOT EXISTS idx_fn_inv_created      ON function_invocations(created_at DESC)",
        # ── Finance: Accounts, Transactions, Transaction Lines ────────────────
        """CREATE TABLE IF NOT EXISTS accounts (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id   VARCHAR(100) NOT NULL DEFAULT 'main',
            code        VARCHAR(20)  NOT NULL,
            name        VARCHAR(200) NOT NULL,
            type        VARCHAR(30)  NOT NULL DEFAULT 'EXPENSE',
            balance     NUMERIC(12,2) NOT NULL DEFAULT 0,
            currency    VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            is_active   BOOLEAN      NOT NULL DEFAULT true,
            description TEXT         NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at  TIMESTAMPTZ,
            UNIQUE (branch_id, code)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_accounts_branch ON accounts(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_accounts_code   ON accounts(code)",
        """CREATE TABLE IF NOT EXISTS transactions (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id       VARCHAR(100) NOT NULL DEFAULT 'main',
            reference       VARCHAR(100) NOT NULL DEFAULT '',
            description     TEXT         NOT NULL DEFAULT '',
            date            DATE         NOT NULL,
            total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
            currency        VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            status          VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
            posted_by       VARCHAR(200) NOT NULL DEFAULT '',
            posted_at       TIMESTAMPTZ,
            idempotency_key VARCHAR(200) NOT NULL DEFAULT '',
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            deleted_at      TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_transactions_branch ON transactions(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_transactions_date   ON transactions(date)",
        "CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)",
        """CREATE TABLE IF NOT EXISTS transaction_lines (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            transaction_id UUID NOT NULL,
            account_id     UUID NOT NULL,
            description    TEXT NOT NULL DEFAULT '',
            debit_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
            credit_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_txn_lines_txn     ON transaction_lines(transaction_id)",
        "CREATE INDEX IF NOT EXISTS idx_txn_lines_account ON transaction_lines(account_id)",
        # ── GL Phase 2: extend transactions + transaction_lines (no new tables;
        #    we re-use the existing double-entry shape and add the columns the
        #    full reporting suite needs: nominal code link, fund (SORP),
        #    project (project costing), branch on the line (so a cross-branch
        #    consolidation entry can split across branches), and source-document
        #    linkage so every posting traces back to the PO/Invoice/Donation
        #    that triggered it.
        "ALTER TABLE transaction_lines ADD COLUMN IF NOT EXISTS nominal_code_id UUID",
        "ALTER TABLE transaction_lines ADD COLUMN IF NOT EXISTS nominal_code    VARCHAR(20) NOT NULL DEFAULT ''",
        "ALTER TABLE transaction_lines ADD COLUMN IF NOT EXISTS fund_type       VARCHAR(20) NOT NULL DEFAULT 'UNRESTRICTED'",
        "ALTER TABLE transaction_lines ADD COLUMN IF NOT EXISTS project_id      UUID",
        "ALTER TABLE transaction_lines ADD COLUMN IF NOT EXISTS branch_id       VARCHAR(100) NOT NULL DEFAULT 'main'",
        "CREATE INDEX IF NOT EXISTS idx_txn_lines_nominal ON transaction_lines(nominal_code_id)",
        "CREATE INDEX IF NOT EXISTS idx_txn_lines_project ON transaction_lines(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_txn_lines_fund    ON transaction_lines(fund_type)",
        "CREATE INDEX IF NOT EXISTS idx_txn_lines_branch  ON transaction_lines(branch_id)",
        # Source-document trace on the header. source_type matches the kind
        # of upstream record (po_receive/invoice_pay/donation/reimbursement/
        # manual/reversal); source_id is the originator's PK. reversal_of
        # points an inverse entry back at the one it cancels for clean audits.
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) NOT NULL DEFAULT 'manual'",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_id   UUID",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reversal_of UUID",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fund_type   VARCHAR(20) NOT NULL DEFAULT 'UNRESTRICTED'",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS project_id  UUID",
        "CREATE INDEX IF NOT EXISTS idx_transactions_source   ON transactions(source_type, source_id)",
        "CREATE INDEX IF NOT EXISTS idx_transactions_project  ON transactions(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_transactions_reversal ON transactions(reversal_of)",
        # ── HR: Leave Requests, Time Entries ─────────────────────────────────
        """CREATE TABLE IF NOT EXISTS leave_requests (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id      UUID NOT NULL,
            leave_policy_id  VARCHAR(100) NOT NULL DEFAULT '',
            start_date       DATE NOT NULL,
            end_date         DATE NOT NULL,
            days             NUMERIC(5,1) NOT NULL DEFAULT 0,
            reason           TEXT,
            status           VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
            reviewed_by      VARCHAR(200),
            reviewed_at      TIMESTAMPTZ,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id)",
        "CREATE INDEX IF NOT EXISTS idx_leave_requests_status   ON leave_requests(status)",
        # leave_type was added in PR #97 (admin form / stat-cards rely on it).
        # _ensure_hr_tables also ALTERs, but that only runs lazily on first
        # POST — adding it here means GET /hr/leave works on a fresh backend
        # immediately, instead of 500ing until someone submits a request.
        "ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS leave_type VARCHAR(50) NOT NULL DEFAULT 'annual'",
        # ── Reimbursement claims — employee / trustee / LMC member files an
        # expense claim with a receipt (photo via camera or file upload),
        # auto-routes to their manager for approval. receipt_data holds the
        # base64-encoded image (PDF / JPEG / PNG); for big or many receipts
        # this should move to an S3-style blob store, but inline-DB is fine
        # for the temple's volumes today.
        """CREATE TABLE IF NOT EXISTS reimbursement_claims (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            claimant_type      VARCHAR(20)  NOT NULL DEFAULT 'EMPLOYEE',
            claimant_id        UUID,
            claimant_name      VARCHAR(255) NOT NULL DEFAULT '',
            claimant_email     VARCHAR(255) NOT NULL DEFAULT '',
            branch_id          VARCHAR(100) NOT NULL DEFAULT 'main',
            amount             NUMERIC(12,2) NOT NULL,
            currency           VARCHAR(3)   NOT NULL DEFAULT 'GBP',
            category           VARCHAR(50)  NOT NULL DEFAULT 'GENERAL',
            expense_date       DATE,
            description        TEXT         NOT NULL DEFAULT '',
            receipt_data       TEXT,
            receipt_mime       VARCHAR(50),
            status             VARCHAR(20)  NOT NULL DEFAULT 'PENDING_APPROVAL',
            manager_id         UUID,
            manager_name       VARCHAR(255) NOT NULL DEFAULT '',
            reviewed_by        UUID,
            reviewed_by_name   VARCHAR(255) NOT NULL DEFAULT '',
            reviewed_at        TIMESTAMPTZ,
            review_notes       TEXT NOT NULL DEFAULT '',
            payment_method     VARCHAR(50)  NOT NULL DEFAULT '',
            payment_ref        VARCHAR(255) NOT NULL DEFAULT '',
            paid_at            TIMESTAMPTZ,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_reimbursements_claimant ON reimbursement_claims(claimant_id)",
        "CREATE INDEX IF NOT EXISTS idx_reimbursements_manager  ON reimbursement_claims(manager_id)",
        "CREATE INDEX IF NOT EXISTS idx_reimbursements_status   ON reimbursement_claims(status)",
        "CREATE INDEX IF NOT EXISTS idx_reimbursements_branch   ON reimbursement_claims(branch_id)",
        # ── Nominal codes (Chart of Accounts) ──────────────────────────────
        # UK Charity SORP-aligned. Granular per user spec — see seed below.
        # Fields cover scope (branch vs head office), fund_type (SORP),
        # activity_type (charitable vs trading vs governance vs support),
        # Gift Aid eligibility + HMRC category, VAT code + rate, and the
        # external account-code mapping for Xero / Sage / QuickBooks export.
        """CREATE TABLE IF NOT EXISTS nominal_codes (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code            VARCHAR(20)  UNIQUE NOT NULL,
            name            VARCHAR(200) NOT NULL,
            description     TEXT         NOT NULL DEFAULT '',
            type            VARCHAR(20)  NOT NULL DEFAULT 'INCOME',
            category        VARCHAR(64)  NOT NULL DEFAULT '',
            subcategory     VARCHAR(64)  NOT NULL DEFAULT '',
            scope           VARCHAR(20)  NOT NULL DEFAULT 'BOTH',
            branch_id       VARCHAR(100),
            fund_type       VARCHAR(20)  NOT NULL DEFAULT 'UNRESTRICTED',
            activity_type   VARCHAR(20)  NOT NULL DEFAULT 'CHARITABLE',
            gift_aid_eligible BOOLEAN    NOT NULL DEFAULT false,
            hmrc_category   VARCHAR(50)  NOT NULL DEFAULT '',
            vat_code        VARCHAR(20)  NOT NULL DEFAULT 'OUT_OF_SCOPE',
            vat_rate        NUMERIC(5,2) NOT NULL DEFAULT 0,
            xero_account_code   VARCHAR(20) NOT NULL DEFAULT '',
            sage_nominal_code   VARCHAR(20) NOT NULL DEFAULT '',
            quickbooks_account  VARCHAR(20) NOT NULL DEFAULT '',
            parent_code_id  UUID REFERENCES nominal_codes(id) ON DELETE SET NULL,
            sort_order      INTEGER NOT NULL DEFAULT 100,
            is_active       BOOLEAN NOT NULL DEFAULT true,
            notes           TEXT NOT NULL DEFAULT '',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_nominal_codes_code     ON nominal_codes(code)",
        "CREATE INDEX IF NOT EXISTS idx_nominal_codes_type     ON nominal_codes(type)",
        "CREATE INDEX IF NOT EXISTS idx_nominal_codes_branch   ON nominal_codes(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_nominal_codes_active   ON nominal_codes(is_active)",
        # Seed: comprehensive UK temple-charity chart of accounts.
        # ON CONFLICT (code) DO NOTHING — idempotent; admins edit later
        # from Settings → Nominal Codes (PR adds the admin page).
        # 4-digit ranges follow the UK SME accounting convention:
        # 1xxx assets, 2xxx liabilities, 3xxx funds/equity,
        # 4xxx income, 5xxx-7xxx expense, 8xxx governance/depreciation.
        """INSERT INTO nominal_codes
            (code, name, type, category, subcategory, scope, fund_type,
             activity_type, gift_aid_eligible, hmrc_category, vat_code, vat_rate, sort_order)
        VALUES
            ('1000','Cash at Bank — General','ASSET','BANK','CURRENT','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,1000),
            ('1010','Cash at Bank — Restricted Funds','ASSET','BANK','CURRENT','BOTH','RESTRICTED','CHARITABLE',false,'','OUT_OF_SCOPE',0,1010),
            ('1020','Petty Cash','ASSET','CASH','CURRENT','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,1020),
            ('1100','Accounts Receivable','ASSET','DEBTORS','CURRENT','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,1100),
            ('1200','Prepayments','ASSET','DEBTORS','CURRENT','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,1200),
            ('1300','Stock — Shop','ASSET','INVENTORY','CURRENT','BRANCH','UNRESTRICTED','TRADING',false,'','OUT_OF_SCOPE',0,1300),
            ('1500','Fixed Assets — Property','ASSET','FIXED_ASSETS','LONG_TERM','BOTH','UNRESTRICTED','CHARITABLE',false,'','OUT_OF_SCOPE',0,1500),
            ('1510','Fixed Assets — Equipment','ASSET','FIXED_ASSETS','LONG_TERM','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,1510),
            ('1520','Fixed Assets — Vehicles','ASSET','FIXED_ASSETS','LONG_TERM','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,1520),
            ('1600','Accumulated Depreciation','ASSET','FIXED_ASSETS','LONG_TERM','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,1600),
            ('2000','Accounts Payable','LIABILITY','CREDITORS','CURRENT','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,2000),
            ('2100','Accruals','LIABILITY','CREDITORS','CURRENT','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,2100),
            ('2200','PAYE / NI Owed','LIABILITY','CREDITORS','CURRENT','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,2200),
            ('2210','Pension Owed','LIABILITY','CREDITORS','CURRENT','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,2210),
            ('2300','VAT Owed','LIABILITY','CREDITORS','CURRENT','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,2300),
            ('2500','Loans Payable','LIABILITY','LOANS','LONG_TERM','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,2500),
            ('3000','Unrestricted Funds — General','EQUITY','FUNDS','RESERVES','BOTH','UNRESTRICTED','CHARITABLE',false,'','OUT_OF_SCOPE',0,3000),
            ('3010','Designated Funds — Building','EQUITY','FUNDS','RESERVES','BOTH','UNRESTRICTED','CHARITABLE',false,'','OUT_OF_SCOPE',0,3010),
            ('3100','Restricted Funds','EQUITY','FUNDS','RESERVES','BOTH','RESTRICTED','CHARITABLE',false,'','OUT_OF_SCOPE',0,3100),
            ('3200','Endowment Funds','EQUITY','FUNDS','RESERVES','BOTH','ENDOWMENT','CHARITABLE',false,'','OUT_OF_SCOPE',0,3200),
            ('4000','Donations — General (Unrestricted)','INCOME','DONATIONS','GENERAL','BOTH','UNRESTRICTED','CHARITABLE',true,'CASH_DONATION','OUT_OF_SCOPE',0,4000),
            ('4001','Donations — Cash (Anonymous, No Gift Aid)','INCOME','DONATIONS','GENERAL','BOTH','UNRESTRICTED','CHARITABLE',false,'AGGREGATED_DONATION','OUT_OF_SCOPE',0,4001),
            ('4002','Donations — Aarti / Bhog / Hundi','INCOME','DONATIONS','RITUAL','BOTH','UNRESTRICTED','CHARITABLE',false,'AGGREGATED_DONATION','OUT_OF_SCOPE',0,4002),
            ('4003','Donations — Major Gifts','INCOME','DONATIONS','GENERAL','BOTH','UNRESTRICTED','CHARITABLE',true,'CASH_DONATION','OUT_OF_SCOPE',0,4003),
            ('4010','Donations — Building Fund (Restricted)','INCOME','DONATIONS','RESTRICTED','BOTH','RESTRICTED','CHARITABLE',true,'CASH_DONATION','OUT_OF_SCOPE',0,4010),
            ('4011','Donations — Festival Fund (Restricted)','INCOME','DONATIONS','RESTRICTED','BOTH','RESTRICTED','CHARITABLE',true,'CASH_DONATION','OUT_OF_SCOPE',0,4011),
            ('4012','Donations — Murti Sponsorship (Restricted)','INCOME','DONATIONS','RESTRICTED','BOTH','RESTRICTED','CHARITABLE',true,'CASH_DONATION','OUT_OF_SCOPE',0,4012),
            ('4020','Donations — Monthly Giving','INCOME','DONATIONS','RECURRING','BOTH','UNRESTRICTED','CHARITABLE',true,'CASH_DONATION','OUT_OF_SCOPE',0,4020),
            ('4030','Donations — Online (PayPal / Card)','INCOME','DONATIONS','GENERAL','BOTH','UNRESTRICTED','CHARITABLE',true,'CASH_DONATION','OUT_OF_SCOPE',0,4030),
            ('4040','Donations — Legacy / Bequest','INCOME','DONATIONS','LEGACY','BOTH','UNRESTRICTED','CHARITABLE',false,'','OUT_OF_SCOPE',0,4040),
            ('4050','Gift Aid Reclaim (HMRC)','INCOME','DONATIONS','GIFT_AID','HEAD_OFFICE','UNRESTRICTED','CHARITABLE',false,'GIFT_AID_RECLAIM','OUT_OF_SCOPE',0,4050),
            ('4100','Service Income — Puja Bookings','INCOME','SERVICES','RITUAL','BRANCH','UNRESTRICTED','CHARITABLE',false,'','EXEMPT',0,4100),
            ('4101','Service Income — Wedding / Ceremony','INCOME','SERVICES','EVENT','BRANCH','UNRESTRICTED','CHARITABLE',false,'','EXEMPT',0,4101),
            ('4102','Service Income — Hall Hire','INCOME','SERVICES','EVENT','BRANCH','UNRESTRICTED','TRADING',false,'','STANDARD',20,4102),
            ('4103','Service Income — Catering / Langar Donations','INCOME','SERVICES','FOOD','BRANCH','UNRESTRICTED','CHARITABLE',false,'','EXEMPT',0,4103),
            ('4200','Shop Sales — Books','INCOME','SHOP','RETAIL','BRANCH','UNRESTRICTED','TRADING',false,'','ZERO',0,4200),
            ('4201','Shop Sales — Murtis / Idols','INCOME','SHOP','RETAIL','BRANCH','UNRESTRICTED','TRADING',false,'','STANDARD',20,4201),
            ('4202','Shop Sales — Prasad','INCOME','SHOP','FOOD','BRANCH','UNRESTRICTED','TRADING',false,'','ZERO',0,4202),
            ('4203','Shop Sales — Puja Items','INCOME','SHOP','RETAIL','BRANCH','UNRESTRICTED','TRADING',false,'','STANDARD',20,4203),
            ('4204','Shop Sales — Malas / Beads','INCOME','SHOP','RETAIL','BRANCH','UNRESTRICTED','TRADING',false,'','STANDARD',20,4204),
            ('4205','Shop Sales — Clothing','INCOME','SHOP','RETAIL','BRANCH','UNRESTRICTED','TRADING',false,'','STANDARD',20,4205),
            ('4300','Government Grants','INCOME','GRANTS','GOVERNMENT','HEAD_OFFICE','RESTRICTED','CHARITABLE',false,'','OUT_OF_SCOPE',0,4300),
            ('4301','Local Authority Grants','INCOME','GRANTS','LOCAL_AUTHORITY','BRANCH','RESTRICTED','CHARITABLE',false,'','OUT_OF_SCOPE',0,4301),
            ('4400','Bank Interest','INCOME','INVESTMENT','INTEREST','HEAD_OFFICE','UNRESTRICTED','INVESTMENT',false,'','OUT_OF_SCOPE',0,4400),
            ('4410','Rental Income','INCOME','INVESTMENT','RENT','BRANCH','UNRESTRICTED','INVESTMENT',false,'','EXEMPT',0,4410),
            ('5000','Religious Programs — Aarti / Bhajan','EXPENSE','CHARITABLE','PROGRAMS','BRANCH','UNRESTRICTED','CHARITABLE',false,'','OUT_OF_SCOPE',0,5000),
            ('5001','Festival Costs','EXPENSE','CHARITABLE','PROGRAMS','BRANCH','RESTRICTED','CHARITABLE',false,'','STANDARD',20,5001),
            ('5002','Free Meals (Langar / Annadan)','EXPENSE','CHARITABLE','PROGRAMS','BRANCH','UNRESTRICTED','CHARITABLE',false,'','ZERO',0,5002),
            ('5003','Educational Programs','EXPENSE','CHARITABLE','EDUCATION','BRANCH','UNRESTRICTED','CHARITABLE',false,'','OUT_OF_SCOPE',0,5003),
            ('5004','Murti & Deity Maintenance','EXPENSE','CHARITABLE','RITUAL','BRANCH','UNRESTRICTED','CHARITABLE',false,'','STANDARD',20,5004),
            ('5005','Priest / Pandit Fees','EXPENSE','CHARITABLE','PROGRAMS','BRANCH','UNRESTRICTED','CHARITABLE',false,'','EXEMPT',0,5005),
            ('5100','Salaries & Wages','EXPENSE','STAFF','PAYROLL','BOTH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,5100),
            ('5101','Employer NI','EXPENSE','STAFF','PAYROLL','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,5101),
            ('5102','Employer Pension','EXPENSE','STAFF','PAYROLL','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,5102),
            ('5103','Staff Training','EXPENSE','STAFF','TRAINING','BOTH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5103),
            ('5104','Staff Travel & Subsistence','EXPENSE','STAFF','TRAVEL','BOTH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5104),
            ('5105','DBS / Compliance Checks','EXPENSE','STAFF','COMPLIANCE','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,5105),
            ('5200','Rent / Lease','EXPENSE','PROPERTY','RENT','BRANCH','UNRESTRICTED','SUPPORT',false,'','EXEMPT',0,5200),
            ('5201','Utilities — Gas','EXPENSE','PROPERTY','UTILITIES','BRANCH','UNRESTRICTED','SUPPORT',false,'','REDUCED',5,5201),
            ('5202','Utilities — Electricity','EXPENSE','PROPERTY','UTILITIES','BRANCH','UNRESTRICTED','SUPPORT',false,'','REDUCED',5,5202),
            ('5203','Utilities — Water','EXPENSE','PROPERTY','UTILITIES','BRANCH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,5203),
            ('5204','Cleaning','EXPENSE','PROPERTY','MAINTENANCE','BRANCH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5204),
            ('5205','Repairs & Maintenance','EXPENSE','PROPERTY','MAINTENANCE','BRANCH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5205),
            ('5206','Insurance — Building','EXPENSE','PROPERTY','INSURANCE','BRANCH','UNRESTRICTED','SUPPORT',false,'','EXEMPT',0,5206),
            ('5207','Council Tax / Rates','EXPENSE','PROPERTY','TAX','BRANCH','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,5207),
            ('5208','Security','EXPENSE','PROPERTY','SECURITY','BRANCH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5208),
            ('5300','Office Supplies','EXPENSE','OPERATIONS','SUPPLIES','BOTH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5300),
            ('5301','IT — Software Subscriptions','EXPENSE','OPERATIONS','IT','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5301),
            ('5302','IT — Hardware','EXPENSE','OPERATIONS','IT','BOTH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5302),
            ('5303','Telecommunications','EXPENSE','OPERATIONS','IT','BRANCH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5303),
            ('5304','Postage & Courier','EXPENSE','OPERATIONS','SUPPLIES','BOTH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5304),
            ('5305','Bank Charges','EXPENSE','OPERATIONS','FINANCIAL','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','EXEMPT',0,5305),
            ('5306','Payment Processor Fees','EXPENSE','OPERATIONS','FINANCIAL','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','EXEMPT',0,5306),
            ('5400','Legal Fees','EXPENSE','PROFESSIONAL','LEGAL','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5400),
            ('5401','Accountancy & Audit','EXPENSE','PROFESSIONAL','ACCOUNTING','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5401),
            ('5402','Consultancy','EXPENSE','PROFESSIONAL','CONSULTING','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5402),
            ('5403','Bookkeeping','EXPENSE','PROFESSIONAL','ACCOUNTING','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5403),
            ('5500','Fundraising — Event Costs','EXPENSE','FUNDRAISING','EVENTS','BRANCH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5500),
            ('5501','Fundraising — Marketing','EXPENSE','FUNDRAISING','MARKETING','BOTH','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5501),
            ('5502','Fundraising — Donor Comms','EXPENSE','FUNDRAISING','MARKETING','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5502),
            ('5503','Fundraising — Website / Digital','EXPENSE','FUNDRAISING','MARKETING','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','STANDARD',20,5503),
            ('5600','Shop — COGS','EXPENSE','TRADING','COGS','BRANCH','UNRESTRICTED','TRADING',false,'','STANDARD',20,5600),
            ('5601','Shop — Stock Write-off','EXPENSE','TRADING','COGS','BRANCH','UNRESTRICTED','TRADING',false,'','OUT_OF_SCOPE',0,5601),
            ('5602','Catering — Food & Ingredients','EXPENSE','TRADING','COGS','BRANCH','UNRESTRICTED','CHARITABLE',false,'','ZERO',0,5602),
            ('8000','Governance — Trustee Meetings','EXPENSE','GOVERNANCE','BOARD','HEAD_OFFICE','UNRESTRICTED','GOVERNANCE',false,'','STANDARD',20,8000),
            ('8001','Governance — AGM Costs','EXPENSE','GOVERNANCE','BOARD','HEAD_OFFICE','UNRESTRICTED','GOVERNANCE',false,'','STANDARD',20,8001),
            ('8002','Governance — Statutory Reporting','EXPENSE','GOVERNANCE','COMPLIANCE','HEAD_OFFICE','UNRESTRICTED','GOVERNANCE',false,'','OUT_OF_SCOPE',0,8002),
            ('8003','Governance — Trustees Liability Insurance','EXPENSE','GOVERNANCE','COMPLIANCE','HEAD_OFFICE','UNRESTRICTED','GOVERNANCE',false,'','EXEMPT',0,8003),
            ('8100','Depreciation — Property','EXPENSE','GOVERNANCE','DEPRECIATION','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,8100),
            ('8101','Depreciation — Equipment','EXPENSE','GOVERNANCE','DEPRECIATION','HEAD_OFFICE','UNRESTRICTED','SUPPORT',false,'','OUT_OF_SCOPE',0,8101)
        ON CONFLICT (code) DO NOTHING""",
        """CREATE TABLE IF NOT EXISTS time_entries (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id UUID NOT NULL,
            branch_id   VARCHAR(100) NOT NULL DEFAULT 'main',
            date        DATE NOT NULL,
            hours_worked NUMERIC(5,2) NOT NULL DEFAULT 0,
            description TEXT,
            approved    BOOLEAN NOT NULL DEFAULT false,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_time_entries_employee ON time_entries(employee_id)",
        "CREATE INDEX IF NOT EXISTS idx_time_entries_date     ON time_entries(date)",
        # ── Payroll Runs ──────────────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS payroll_runs (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id       VARCHAR(100) NOT NULL DEFAULT 'main',
            period          VARCHAR(20)  NOT NULL,
            run_date        DATE         NOT NULL,
            status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
            processed_by    VARCHAR(200) NOT NULL DEFAULT '',
            completed_at    TIMESTAMPTZ,
            total_gross     NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_net       NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_tax       NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_ni        NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_pension   NUMERIC(12,2) NOT NULL DEFAULT 0,
            idempotency_key VARCHAR(200) NOT NULL DEFAULT '',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at      TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_payroll_runs_branch ON payroll_runs(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs(period)",
        # Extend payroll_runs with structured period info + employer-cost totals.
        # Existing rows backfill safely — period_label/start/end derive from
        # the freeform `period` string at admin write-time.
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS period_year   INTEGER",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS period_month  INTEGER",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS period_label  VARCHAR(40) NOT NULL DEFAULT ''",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS period_start  DATE",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS period_end    DATE",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS pay_date      DATE",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_employer_ni      NUMERIC(12,2) NOT NULL DEFAULT 0",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_employer_pension NUMERIC(12,2) NOT NULL DEFAULT 0",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_employer_cost    NUMERIC(12,2) NOT NULL DEFAULT 0",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS notes         TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS paid_at       TIMESTAMPTZ",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS finalised_at  TIMESTAMPTZ",
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS finalised_by  VARCHAR(200) NOT NULL DEFAULT ''",
        # Stop two concurrent runs creating duplicate (branch, year, month).
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_period ON payroll_runs(branch_id, period_year, period_month) WHERE period_year IS NOT NULL AND period_month IS NOT NULL AND deleted_at IS NULL",
        # ── Payslips ──────────────────────────────────────────────────────────
        # One row per (payroll_run × employee). Carries the full calculation
        # snapshot so historical payslips remain accurate even if the
        # employee's salary / tax_code / NI rate changes later.
        # `earnings_json` / `deductions_json` hold the per-line breakdown
        # rendered on the payslip itself (eg. basic + overtime + bonus, or
        # PAYE + NI + pension + student loan + adjustments). YTD columns
        # are snapshot at calculation time so the payslip itself is
        # self-contained.
        """CREATE TABLE IF NOT EXISTS payslips (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            payroll_run_id      UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
            employee_id         UUID NOT NULL,
            branch_id           VARCHAR(100) NOT NULL DEFAULT 'main',
            period_label        VARCHAR(40)  NOT NULL DEFAULT '',
            period_start        DATE,
            period_end          DATE,
            pay_date            DATE,
            -- Employee snapshot (historical accuracy)
            employee_name       VARCHAR(200) NOT NULL DEFAULT '',
            employee_number     VARCHAR(50)  NOT NULL DEFAULT '',
            tax_code            VARCHAR(20)  NOT NULL DEFAULT '1257L',
            ni_number           VARCHAR(20)  NOT NULL DEFAULT '',
            ni_category         VARCHAR(5)   NOT NULL DEFAULT 'A',
            -- Earnings
            basic_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
            overtime_pay        NUMERIC(12,2) NOT NULL DEFAULT 0,
            bonus_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
            other_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
            gross_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
            taxable_pay         NUMERIC(12,2) NOT NULL DEFAULT 0,
            hours_worked        NUMERIC(8,2)  NOT NULL DEFAULT 0,
            hourly_rate         NUMERIC(8,4)  NOT NULL DEFAULT 0,
            -- Deductions
            tax_deduction       NUMERIC(12,2) NOT NULL DEFAULT 0,
            ni_employee         NUMERIC(12,2) NOT NULL DEFAULT 0,
            pension_employee    NUMERIC(12,2) NOT NULL DEFAULT 0,
            student_loan        NUMERIC(12,2) NOT NULL DEFAULT 0,
            other_deductions    NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_deductions    NUMERIC(12,2) NOT NULL DEFAULT 0,
            net_pay             NUMERIC(12,2) NOT NULL DEFAULT 0,
            -- Employer costs
            ni_employer         NUMERIC(12,2) NOT NULL DEFAULT 0,
            pension_employer    NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_employer_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
            -- YTD snapshot
            ytd_gross           NUMERIC(12,2) NOT NULL DEFAULT 0,
            ytd_tax             NUMERIC(12,2) NOT NULL DEFAULT 0,
            ytd_ni              NUMERIC(12,2) NOT NULL DEFAULT 0,
            ytd_pension         NUMERIC(12,2) NOT NULL DEFAULT 0,
            ytd_net             NUMERIC(12,2) NOT NULL DEFAULT 0,
            -- Status
            status              VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
                -- DRAFT | FINALIZED | PAID
            payment_method      VARCHAR(40)  NOT NULL DEFAULT '',
            payment_ref         VARCHAR(100) NOT NULL DEFAULT '',
            paid_at             TIMESTAMPTZ,
            sent_at             TIMESTAMPTZ,
            viewed_at           TIMESTAMPTZ,
            -- Audit + breakdown
            earnings_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
            deductions_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
            notes               TEXT  NOT NULL DEFAULT '',
            calculated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (payroll_run_id, employee_id)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_payslips_run     ON payslips(payroll_run_id)",
        "CREATE INDEX IF NOT EXISTS idx_payslips_emp     ON payslips(employee_id)",
        "CREATE INDEX IF NOT EXISTS idx_payslips_branch  ON payslips(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_payslips_period  ON payslips(period_label)",
        "CREATE INDEX IF NOT EXISTS idx_payslips_status  ON payslips(status)",
        # ── Recurring Giving (Monthly Donations) ──────────────────────────────
        """CREATE TABLE IF NOT EXISTS recurring_giving_tiers (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            amount          DECIMAL(10,2) NOT NULL,
            label           VARCHAR(200)  NOT NULL DEFAULT '',
            description     VARCHAR(500)            DEFAULT '',
            frequency       VARCHAR(20)             DEFAULT 'MONTH',
            is_active       BOOLEAN                 DEFAULT true,
            is_default      BOOLEAN                 DEFAULT false,
            display_order   INT                     DEFAULT 0,
            paypal_plan_id  VARCHAR(255)            DEFAULT '',
            created_at      TIMESTAMPTZ             DEFAULT NOW(),
            updated_at      TIMESTAMPTZ             DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS recurring_giving_subscriptions (
            id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            paypal_subscription_id  VARCHAR(255) UNIQUE,
            paypal_plan_id          VARCHAR(255)            DEFAULT '',
            tier_id                 UUID        REFERENCES recurring_giving_tiers(id) ON DELETE SET NULL,
            amount                  DECIMAL(10,2) NOT NULL,
            frequency               VARCHAR(20)             DEFAULT 'MONTH',
            status                  VARCHAR(50)             DEFAULT 'PENDING_APPROVAL',
            branch_id               VARCHAR(100)            DEFAULT 'main',
            donor_name              VARCHAR(255)            DEFAULT '',
            donor_email             VARCHAR(255)            DEFAULT '',
            approved_at             TIMESTAMPTZ,
            cancelled_at            TIMESTAMPTZ,
            created_at              TIMESTAMPTZ             DEFAULT NOW(),
            updated_at              TIMESTAMPTZ             DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_rgs_status ON recurring_giving_subscriptions(status)",
        "CREATE INDEX IF NOT EXISTS idx_rgs_email  ON recurring_giving_subscriptions(donor_email)",
        # Add address/name columns to existing subscriptions table (idempotent)
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS donor_first_name VARCHAR(255) DEFAULT ''",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS donor_surname VARCHAR(255) DEFAULT ''",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS donor_postcode VARCHAR(50) DEFAULT ''",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS donor_address VARCHAR(500) DEFAULT ''",
        # ── Gift Aid declaration on the subscription ──────────────────────────
        # When the donor ticks "I'd like to add Gift Aid" on the monthly-giving
        # form, we capture the declaration here. The webhook handler that
        # creates per-month donations rows reads this and copies the flag onto
        # each donation, so the GASDS / Gift Aid claim picks up every recurring
        # payment automatically.
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS gift_aid_declared BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS gift_aid_declared_at TIMESTAMPTZ",
        # PayPal capture transaction ID (different from the PayPal order ID)
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS paypal_capture_id VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE orders    ADD COLUMN IF NOT EXISTS paypal_capture_id VARCHAR(200) NOT NULL DEFAULT ''",
        # Gift Aid on orders + basket_items (donations already has both).
        # gift_aid_eligible mirrors basket_items so the orders grid can show
        # "GA" badges without a per-item join; gift_aid_amount is the 25%
        # HMRC top-up that the Service Portal / Kiosk capture handlers
        # already compute from the eligible total at checkout time.
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_aid_eligible BOOLEAN       NOT NULL DEFAULT false",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_aid_amount   NUMERIC(12,2) NOT NULL DEFAULT 0",
        "ALTER TABLE basket_items ADD COLUMN IF NOT EXISTS gift_aid_amount NUMERIC(12,2) NOT NULL DEFAULT 0",
        # Source channel on donations (kiosk, quick-donation, service, paypal, etc.)
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS source VARCHAR(64) NOT NULL DEFAULT 'kiosk'",
        # ── Payment failure detail + actual settlement (Stripe/SumUp robustness) ──
        # last_failure_* : why a card payment failed (Stripe last_payment_error /
        #   SumUp decline). card_type: VISA/MASTERCARD/AMEX/OTHER for "why declined"
        #   visibility. Populated by the reconciliation sweeps + webhooks.
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS last_failure_code    VARCHAR(60)  DEFAULT NULL",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS last_failure_message VARCHAR(500) DEFAULT NULL",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS card_type            VARCHAR(30)  DEFAULT NULL",
        # actual_* : the REAL fee the processor kept and the REAL amount Shital
        #   receives, from settlement data (Stripe balance_transaction / SumUp
        #   transaction). NULL until settled — existing fee_amount/net_amount stay
        #   as the at-sale estimate. settled_at/payout_id link to the bank payout.
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS actual_fee_amount NUMERIC(12,2) DEFAULT NULL",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS actual_net_amount NUMERIC(12,2) DEFAULT NULL",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS settled_at        TIMESTAMPTZ   DEFAULT NULL",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS payout_id         VARCHAR(120)  DEFAULT NULL",
        # ── CRM: Contacts table ───────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS contacts (
            id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            email             VARCHAR(254) UNIQUE,
            first_name        VARCHAR(200) NOT NULL DEFAULT '',
            surname           VARCHAR(200) NOT NULL DEFAULT '',
            full_name         VARCHAR(400) NOT NULL DEFAULT '',
            phone             VARCHAR(50)  NOT NULL DEFAULT '',
            gdpr_consent      BOOLEAN      NOT NULL DEFAULT false,
            gdpr_consented_at TIMESTAMPTZ,
            tac_consent       BOOLEAN      NOT NULL DEFAULT false,
            tac_consented_at  TIMESTAMPTZ,
            first_source      VARCHAR(50)  NOT NULL DEFAULT '',
            first_branch_id   VARCHAR(100) NOT NULL DEFAULT '',
            created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_contacts_email   ON contacts(email)",
        "CREATE INDEX IF NOT EXISTS idx_contacts_surname ON contacts(surname)",
        "CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts(created_at DESC)",
        # ── CRM: Addresses table (linked to contacts, stores UPRN) ────────────
        """CREATE TABLE IF NOT EXISTS addresses (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id   UUID        REFERENCES contacts(id) ON DELETE CASCADE,
            formatted    TEXT        NOT NULL DEFAULT '',
            postcode     VARCHAR(20) NOT NULL DEFAULT '',
            uprn         VARCHAR(20) NOT NULL DEFAULT '',
            is_primary   BOOLEAN     NOT NULL DEFAULT true,
            lookup_source VARCHAR(30) NOT NULL DEFAULT '',
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_addresses_contact  ON addresses(contact_id)",
        "CREATE INDEX IF NOT EXISTS idx_addresses_postcode ON addresses(postcode)",
        "CREATE INDEX IF NOT EXISTS idx_addresses_uprn     ON addresses(uprn) WHERE uprn != ''",
        "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS house_number VARCHAR(50) NOT NULL DEFAULT ''",
        # Dedup + unique index — prevents addresses table accumulating
        # duplicates per (contact_id, postcode, house_number). Partial
        # so anonymous (contact_id IS NULL) rows aren't constrained.
        "CREATE UNIQUE INDEX IF NOT EXISTS addresses_unique_contact_pc_house "
        "ON addresses (contact_id, postcode, house_number) WHERE contact_id IS NOT NULL",
        # ── CRM: Accounts (companies/organisations).
        # NB. table is named crm_accounts because there is already a Finance
        # `accounts` table (chart of accounts: code, name, type, balance).
        # Self-heal: drop any half-applied state from the previous attempt that
        # tried to use bare `accounts` and collided with the Finance table.
        "ALTER TABLE addresses DROP CONSTRAINT IF EXISTS addresses_account_id_fkey",
        "DROP INDEX  IF EXISTS idx_addresses_account",
        "ALTER TABLE addresses DROP COLUMN IF EXISTS account_id",
        "DROP TABLE IF EXISTS account_services",
        "DROP TABLE IF EXISTS account_contacts",
        """CREATE TABLE IF NOT EXISTS crm_accounts (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name                 VARCHAR(300) NOT NULL,
            legal_name           VARCHAR(300) NOT NULL DEFAULT '',
            account_type         VARCHAR(50)  NOT NULL DEFAULT 'customer',
            status               VARCHAR(20)  NOT NULL DEFAULT 'active',
            website              VARCHAR(300) NOT NULL DEFAULT '',
            email                VARCHAR(254) NOT NULL DEFAULT '',
            phone                VARCHAR(50)  NOT NULL DEFAULT '',
            industry             VARCHAR(100) NOT NULL DEFAULT '',
            registration_number  VARCHAR(100) NOT NULL DEFAULT '',
            vat_number           VARCHAR(50)  NOT NULL DEFAULT '',
            charity_number       VARCHAR(50)  NOT NULL DEFAULT '',
            primary_contact_id   UUID REFERENCES contacts(id) ON DELETE SET NULL,
            parent_account_id    UUID REFERENCES crm_accounts(id) ON DELETE SET NULL,
            owner_user_id        UUID,
            branch_id            VARCHAR(64) NOT NULL DEFAULT '',
            notes                TEXT NOT NULL DEFAULT '',
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at           TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_crm_accounts_name    ON crm_accounts(name)",
        "CREATE INDEX IF NOT EXISTS idx_crm_accounts_type    ON crm_accounts(account_type)",
        "CREATE INDEX IF NOT EXISTS idx_crm_accounts_status  ON crm_accounts(status) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_crm_accounts_primary ON crm_accounts(primary_contact_id)",
        """CREATE TABLE IF NOT EXISTS crm_account_contacts (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id  UUID NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
            contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            role        VARCHAR(150) NOT NULL DEFAULT '',
            is_primary  BOOLEAN NOT NULL DEFAULT false,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (account_id, contact_id)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_crm_account_contacts_acct ON crm_account_contacts(account_id)",
        "CREATE INDEX IF NOT EXISTS idx_crm_account_contacts_cont ON crm_account_contacts(contact_id)",
        """CREATE TABLE IF NOT EXISTS crm_account_services (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id   UUID NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
            service_name VARCHAR(200) NOT NULL,
            service_type VARCHAR(50)  NOT NULL DEFAULT '',
            description  TEXT NOT NULL DEFAULT '',
            is_active    BOOLEAN NOT NULL DEFAULT true,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_crm_account_services_acct ON crm_account_services(account_id)",
        "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS crm_account_id UUID REFERENCES crm_accounts(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS idx_addresses_crm_account ON addresses(crm_account_id)",
        # ── CRM: Link contact_id into transaction tables ───────────────────────
        "ALTER TABLE orders                       ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id)",
        "ALTER TABLE donations                    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id)",
        "ALTER TABLE gift_aid_declarations        ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id)",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id)",
        # ── Kiosk device tracking + origin on orders ─────────────────────────
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS device_id    VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS device_label VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS source       VARCHAR(64)  NOT NULL DEFAULT 'kiosk'",
        # Store UPRN on gift_aid_declarations for HMRC record-keeping
        "ALTER TABLE gift_aid_declarations ADD COLUMN IF NOT EXISTS uprn VARCHAR(20) NOT NULL DEFAULT ''",
        # Seed default tiers if none exist
        """INSERT INTO recurring_giving_tiers (amount, label, description, is_active, is_default, display_order)
        SELECT * FROM (VALUES
            (5.00::DECIMAL,  'Lamp Supporter',  'Supports daily lamp lighting at the temple',    true, false, 1),
            (11.00::DECIMAL, 'Prasad Patron',   'Provides weekly prasad offering to devotees',   true, true,  2),
            (21.00::DECIMAL, 'Puja Sponsor',    'Sponsors a monthly puja ceremony',              true, false, 3),
            (51.00::DECIMAL, 'Festival Friend', 'Helps cover special festival and event costs',  true, false, 4)
        ) AS v(amount, label, description, is_active, is_default, display_order)
        WHERE NOT EXISTS (SELECT 1 FROM recurring_giving_tiers LIMIT 1)""",
        # Dedupe accidental duplicate tiers by (amount, label) — keep the
        # earliest id; protect any tier already linked to a subscription.
        """DELETE FROM recurring_giving_tiers t
        USING recurring_giving_tiers k
        WHERE  t.amount = k.amount
          AND  t.label  = k.label
          AND  t.id    > k.id
          AND  NOT EXISTS (
                SELECT 1 FROM recurring_giving_subscriptions s WHERE s.tier_id = t.id
          )""",
        # Prevent future duplicates at the database level.
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_giving_tiers_amount_label "
        "ON recurring_giving_tiers (amount, label)",
        # ── Bank / Cash / Payment Processor accounts + statement transactions ─
        # Distinct from the chart-of-accounts `accounts` table (which is for
        # double-entry bookkeeping / GL). This pair is for *real-world money
        # locations* — the temple's HSBC current account, in-house petty cash
        # tin, the locker safe, the PayPal balance, the SumUp / Stripe payouts
        # account. Statement imports land in `bank_transactions` as raw rows;
        # reconciliation against the GL is a later phase.
        """CREATE TABLE IF NOT EXISTS bank_accounts (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id           VARCHAR(100) NOT NULL DEFAULT 'main',
            name                VARCHAR(200) NOT NULL,
            account_type        VARCHAR(20)  NOT NULL DEFAULT 'BANK',
            parent_account_id   UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
            bank_name           VARCHAR(200) NOT NULL DEFAULT '',
            account_number      VARCHAR(50)  NOT NULL DEFAULT '',
            sort_code           VARCHAR(20)  NOT NULL DEFAULT '',
            iban                VARCHAR(50)  NOT NULL DEFAULT '',
            currency            VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            opening_balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
            current_balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
            location            VARCHAR(200) NOT NULL DEFAULT '',
            holder_name         VARCHAR(200) NOT NULL DEFAULT '',
            notes               TEXT NOT NULL DEFAULT '',
            is_active           BOOLEAN NOT NULL DEFAULT true,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_bank_accounts_branch ON bank_accounts(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_bank_accounts_type   ON bank_accounts(account_type)",
        "CREATE INDEX IF NOT EXISTS idx_bank_accounts_parent ON bank_accounts(parent_account_id)",
        """CREATE TABLE IF NOT EXISTS bank_transactions (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id          UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
            txn_date            DATE NOT NULL,
            value_date          DATE,
            description         TEXT NOT NULL DEFAULT '',
            counterparty        VARCHAR(255) NOT NULL DEFAULT '',
            reference           VARCHAR(255) NOT NULL DEFAULT '',
            amount              NUMERIC(14,2) NOT NULL,
            balance_after       NUMERIC(14,2),
            currency            VARCHAR(10)  NOT NULL DEFAULT 'GBP',
            txn_type            VARCHAR(20)  NOT NULL DEFAULT 'OTHER',
            source              VARCHAR(20)  NOT NULL DEFAULT 'MANUAL',
            statement_id        UUID,
            raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
            reconciled          BOOLEAN NOT NULL DEFAULT false,
            reconciled_with_id  UUID,
            notes               TEXT NOT NULL DEFAULT '',
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_bank_txn_account ON bank_transactions(account_id)",
        "CREATE INDEX IF NOT EXISTS idx_bank_txn_date    ON bank_transactions(txn_date DESC)",
        "CREATE INDEX IF NOT EXISTS idx_bank_txn_recon   ON bank_transactions(reconciled)",
        # ── Bank statement import history ─────────────────────────────────────
        # One row per uploaded statement file. file_hash dedups same-file
        # re-uploads. statement_id on bank_transactions points here once the
        # row is committed.
        """CREATE TABLE IF NOT EXISTS bank_statements (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id          UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
            file_name           VARCHAR(500) NOT NULL DEFAULT '',
            file_hash           VARCHAR(80)  NOT NULL DEFAULT '',
            file_format         VARCHAR(20)  NOT NULL DEFAULT 'CSV',
            detected_provider   VARCHAR(40)  NOT NULL DEFAULT '',
            period_start        DATE,
            period_end          DATE,
            transaction_count   INT          NOT NULL DEFAULT 0,
            duplicates_count    INT          NOT NULL DEFAULT 0,
            status              VARCHAR(20)  NOT NULL DEFAULT 'PARSED',
            uploaded_by_user_id UUID,
            uploaded_by_name    VARCHAR(255) NOT NULL DEFAULT '',
            error_message       TEXT         NOT NULL DEFAULT '',
            created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            committed_at        TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_bank_stmt_account ON bank_statements(account_id)",
        "CREATE INDEX IF NOT EXISTS idx_bank_stmt_hash    ON bank_statements(file_hash)",
        "CREATE INDEX IF NOT EXISTS idx_bank_stmt_status  ON bank_statements(status)",
        # ── Volunteer Registration ────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS volunteers (
            id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            reference_number            VARCHAR(40) UNIQUE NOT NULL,
            -- Personal
            title                       VARCHAR(20)         DEFAULT '',
            first_names                 VARCHAR(255) NOT NULL,
            last_name                   VARCHAR(255) NOT NULL,
            address                     TEXT                DEFAULT '',
            postcode                    VARCHAR(20)         DEFAULT '',
            mobile                      VARCHAR(50)         DEFAULT '',
            phone                       VARCHAR(50)         DEFAULT '',
            email                       VARCHAR(255) NOT NULL,
            age_range                   VARCHAR(20)         DEFAULT '',
            -- Emergency contact
            ec_title                    VARCHAR(20)         DEFAULT '',
            ec_full_name                VARCHAR(255)        DEFAULT '',
            ec_email                    VARCHAR(255)        DEFAULT '',
            ec_mobile                   VARCHAR(50)         DEFAULT '',
            ec_phone                    VARCHAR(50)         DEFAULT '',
            ec_address                  TEXT                DEFAULT '',
            ec_postcode                 VARCHAR(20)         DEFAULT '',
            -- Health
            has_health_restrictions     BOOLEAN             DEFAULT false,
            health_notes                TEXT                DEFAULT '',
            -- Police-check / criminal-record declaration
            has_criminal_record         BOOLEAN             DEFAULT false,
            criminal_record_details     TEXT                DEFAULT '',
            -- Referee 1
            ref1_title                  VARCHAR(20)         DEFAULT '',
            ref1_first_names            VARCHAR(255)        DEFAULT '',
            ref1_last_name              VARCHAR(255)        DEFAULT '',
            ref1_address                TEXT                DEFAULT '',
            ref1_postcode               VARCHAR(20)         DEFAULT '',
            ref1_mobile                 VARCHAR(50)         DEFAULT '',
            ref1_phone                  VARCHAR(50)         DEFAULT '',
            ref1_email                  VARCHAR(255)        DEFAULT '',
            -- Referee 2
            ref2_title                  VARCHAR(20)         DEFAULT '',
            ref2_first_names            VARCHAR(255)        DEFAULT '',
            ref2_last_name              VARCHAR(255)        DEFAULT '',
            ref2_address                TEXT                DEFAULT '',
            ref2_postcode               VARCHAR(20)         DEFAULT '',
            ref2_mobile                 VARCHAR(50)         DEFAULT '',
            ref2_phone                  VARCHAR(50)         DEFAULT '',
            ref2_email                  VARCHAR(255)        DEFAULT '',
            -- Skills (JSONB; structure: { "category": ["skill1", ...] })
            skills                      JSONB               DEFAULT '{}'::jsonb,
            skills_other_text           TEXT                DEFAULT '',
            -- Availability (JSONB; { weekday: { morning|afternoon|evening: "HH:MM-HH:MM" } })
            availability                JSONB               DEFAULT '{}'::jsonb,
            availability_pattern        VARCHAR(20)         DEFAULT '',
            -- Consents (paper form has 3 separate signatures + declarations)
            declaration_signed_at       TIMESTAMPTZ,
            confidentiality_agreed      BOOLEAN             DEFAULT false,
            marketing_consent           BOOLEAN             DEFAULT false,
            -- Workflow
            status                      VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            branch_id                   VARCHAR(100)        DEFAULT 'main',
            reviewed_by_user_id         UUID,
            reviewed_at                 TIMESTAMPTZ,
            rejection_reason            TEXT                DEFAULT '',
            -- Spam / audit
            submitted_ip                VARCHAR(45)         DEFAULT '',
            user_agent                  VARCHAR(500)        DEFAULT '',
            -- Timestamps
            created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_volunteers_status ON volunteers(status)",
        "CREATE INDEX IF NOT EXISTS idx_volunteers_email  ON volunteers(email)",
        "CREATE INDEX IF NOT EXISTS idx_volunteers_branch ON volunteers(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_volunteers_created ON volunteers(created_at DESC)",
        # ── Volunteer reference requests — first-class table ──────────────
        # Existing volunteers.ref1_*/ref2_* columns store referee details
        # inline on the volunteer row. This table makes each request a
        # first-class entity so admins can list/filter/CRUD them, track
        # multiple resends, and capture the full response payload
        # separately from the volunteer record itself.
        """CREATE TABLE IF NOT EXISTS volunteer_reference_requests (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            volunteer_id    UUID NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
            referee_index   SMALLINT NOT NULL DEFAULT 1,   -- 1 or 2 (the two on the paper form)
            referee_name    VARCHAR(255) NOT NULL DEFAULT '',
            referee_email   VARCHAR(255) NOT NULL DEFAULT '',
            referee_phone   VARCHAR(50)  NOT NULL DEFAULT '',
            relationship    VARCHAR(100) NOT NULL DEFAULT '',  -- how they know the applicant
            -- Magic-link token the referee uses to open the response form.
            request_token   VARCHAR(64)  UNIQUE,
            status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
              -- PENDING (not yet emailed) / SENT (email out, awaiting response)
              -- / OPENED (referee clicked link) / RESPONDED / EXPIRED / CANCELLED
            requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            sent_at         TIMESTAMPTZ,
            opened_at       TIMESTAMPTZ,
            responded_at    TIMESTAMPTZ,
            expires_at      TIMESTAMPTZ,
            send_count      INTEGER NOT NULL DEFAULT 0,
            last_send_error TEXT NOT NULL DEFAULT '',
            -- Free-form referee response. JSON so the response form can
            -- evolve without schema migrations.
            response_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
            notes           TEXT  NOT NULL DEFAULT '',
            requested_by    UUID,
            requested_by_name VARCHAR(255) NOT NULL DEFAULT '',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            -- One row per (volunteer, referee_index) — re-sending updates
            -- the existing row (status, send_count, sent_at), doesn't
            -- create duplicates.
            UNIQUE (volunteer_id, referee_index)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_vref_volunteer ON volunteer_reference_requests(volunteer_id)",
        "CREATE INDEX IF NOT EXISTS idx_vref_status    ON volunteer_reference_requests(status)",
        "CREATE INDEX IF NOT EXISTS idx_vref_token     ON volunteer_reference_requests(request_token)",
        "CREATE INDEX IF NOT EXISTS idx_vref_created   ON volunteer_reference_requests(created_at DESC)",
        # ── Volunteer ↔ Contact link (CRM dedup; criminal/health stay here) ───
        # The volunteer/donor/member is one PERSON in `contacts`; the volunteer
        # APPLICATION is a separate row keyed by contact_id. Sensitive fields
        # (criminal record, health) deliberately stay on volunteers, not on
        # contacts which is touched by every donation flow.
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL",
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS partial_save_token VARCHAR(64) NOT NULL DEFAULT ''",
        # Where the volunteer wants to help — array of branch codes, with the
        # literal 'remote' as a sentinel for online/remote-only. Distinct from
        # `branch_id` (which is the org branch that owns the application).
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS preferred_branches JSONB NOT NULL DEFAULT '[]'::jsonb",
        # ── Sava (one-day event) volunteers ───────────────────────────────────
        # Lighter-weight than the long-term Volunteer Registration. For
        # devotees who want to help at a single event (Shila Pooja, Aarti,
        # Langar) without going through references / DBS / health declaration.
        # Mirrors the SHITAL Liability Event Volunteer Form V1.
        """CREATE TABLE IF NOT EXISTS sava_volunteers (
            id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            reference_number    VARCHAR(20)  UNIQUE NOT NULL,
            branch_id           VARCHAR(100) NOT NULL DEFAULT 'main',
            full_name           VARCHAR(255) NOT NULL,
            email               VARCHAR(255) NOT NULL DEFAULT '',
            mobile              VARCHAR(50)  NOT NULL DEFAULT '',
            postcode            VARCHAR(20)  NOT NULL DEFAULT '',
            age_range           VARCHAR(20)  NOT NULL DEFAULT '',
            event_name          VARCHAR(255) NOT NULL DEFAULT '',
            event_date          DATE,
            event_location      VARCHAR(255) NOT NULL DEFAULT '',
            preferred_roles     JSONB        NOT NULL DEFAULT '[]'::jsonb,
            additional_notes    TEXT         NOT NULL DEFAULT '',
            agreement_signed_at TIMESTAMPTZ,
            status              VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
            contact_id          UUID         REFERENCES contacts(id) ON DELETE SET NULL,
            submitted_ip        VARCHAR(45)  NOT NULL DEFAULT '',
            user_agent          VARCHAR(500) NOT NULL DEFAULT '',
            created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_sava_volunteers_status ON sava_volunteers(status)",
        "CREATE INDEX IF NOT EXISTS idx_sava_volunteers_event  ON sava_volunteers(event_date DESC)",
        "CREATE INDEX IF NOT EXISTS idx_sava_volunteers_branch ON sava_volunteers(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_sava_volunteers_email  ON sava_volunteers(LOWER(email)) WHERE email != ''",
        # ── Recurring giving: failure tracking + admin cancel audit ───────────
        # Track payment failures (BILLING.SUBSCRIPTION.PAYMENT.FAILED webhooks)
        # so we can surface "card needs updating" warnings in admin without
        # forcing a round-trip to PayPal. cancel_reason / cancelled_by close
        # the audit loop when a trustee cancels via /admin/giving/.../cancel.
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS failed_payment_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS last_failure_at      TIMESTAMPTZ",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS last_failure_reason  VARCHAR(500) NOT NULL DEFAULT ''",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS cancel_reason        VARCHAR(500) NOT NULL DEFAULT ''",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS cancelled_by         VARCHAR(255) NOT NULL DEFAULT ''",
        # Payment-tracking columns previously added only via the lazy webhook
        # ALTER (recurring_giving._ensure_subscription_columns). The admin
        # /admin/giving/subscriptions SELECT references them, so a DB that
        # hadn't yet received a PayPal webhook returned 500 — and the Monthly
        # Giving page silently showed "No subscriptions yet" because the
        # frontend swallowed non-2xx responses.
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS last_payment_at      TIMESTAMPTZ",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS last_payment_amount  NUMERIC(10,2)",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS next_billing_date    DATE",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS total_payments       INTEGER NOT NULL DEFAULT 0",
        # Stripe Billing (recurring card) — a second recurring provider alongside
        # PayPal. payment_provider distinguishes the two; the stripe_* columns
        # mirror the paypal_* ones so one table + admin list serves both.
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS payment_provider       VARCHAR(20) NOT NULL DEFAULT 'paypal'",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id     VARCHAR(255)",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255)",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS stripe_price_id        VARCHAR(255)",
        "ALTER TABLE recurring_giving_subscriptions ADD COLUMN IF NOT EXISTS stripe_checkout_id     VARCHAR(255)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_rgs_stripe_sub ON recurring_giving_subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL",
        # Per-device donation attribution. Nullable: server-portal / PayPal /
        # manual entries have no originating kiosk, and rows pre-dating this
        # column are left NULL (the Incoming Funds dashboard surfaces them
        # under "Unattributed"). Indexed for the by-device aggregation.
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS kiosk_device_id UUID DEFAULT NULL",
        "CREATE INDEX IF NOT EXISTS idx_donations_kiosk_device ON donations(kiosk_device_id) WHERE kiosk_device_id IS NOT NULL",
        # ── Webhook event audit log ───────────────────────────────────────────
        # Every PayPal webhook gets stored here, idempotent on event_id, before
        # we touch any business state. Lets us replay a failed handler without
        # re-asking PayPal, and gives ops a paper trail when a donor disputes
        # a charge. processed=false rows with non-null error are the work
        # queue for retries.
        """CREATE TABLE IF NOT EXISTS recurring_giving_webhook_events (
            id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            event_id          VARCHAR(100) UNIQUE NOT NULL,
            event_type        VARCHAR(100) NOT NULL,
            subscription_id   VARCHAR(100) NOT NULL DEFAULT '',
            resource_id       VARCHAR(100) NOT NULL DEFAULT '',
            payload           JSONB        NOT NULL,
            processed         BOOLEAN      NOT NULL DEFAULT false,
            processed_at      TIMESTAMPTZ,
            error             TEXT         NOT NULL DEFAULT '',
            retry_count       INTEGER      NOT NULL DEFAULT 0,
            created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_rgwe_subscription ON recurring_giving_webhook_events(subscription_id)",
        "CREATE INDEX IF NOT EXISTS idx_rgwe_type         ON recurring_giving_webhook_events(event_type)",
        "CREATE INDEX IF NOT EXISTS idx_rgwe_unprocessed  ON recurring_giving_webhook_events(processed, created_at) WHERE processed = false",
        # ── DBS / safeguarding ────────────────────────────────────────────────
        # Volunteers without a current DBS certificate need one before they
        # can be approved for any role. Three states the volunteer can be
        # in (besides empty = not asked yet):
        #   have_certificate — uploaded a copy (see documents table below)
        #   apply_for_me     — wants SHITAL to apply on their behalf
        #   not_required     — trustee marked as not needed for the role
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS dbs_status VARCHAR(30) NOT NULL DEFAULT ''",
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS dbs_certificate_doc_id UUID",
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS dbs_application_status VARCHAR(30) NOT NULL DEFAULT ''",
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS dbs_notes TEXT NOT NULL DEFAULT ''",
        # ── Reference workflow ────────────────────────────────────────────────
        # Trustees click "Send reference requests" on the admin detail panel;
        # backend generates per-referee tokens and emails ref1/ref2 a magic
        # link. Each referee submits a reference response form, which lands
        # in ref{N}_response JSONB (relationship, capacity, character, etc).
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS references_sent_at TIMESTAMPTZ",
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS ref1_request_token VARCHAR(64) NOT NULL DEFAULT ''",
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS ref2_request_token VARCHAR(64) NOT NULL DEFAULT ''",
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS ref1_response JSONB NOT NULL DEFAULT '{}'::jsonb",
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS ref2_response JSONB NOT NULL DEFAULT '{}'::jsonb",
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS ref1_response_received_at TIMESTAMPTZ",
        "ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS ref2_response_received_at TIMESTAMPTZ",
        "CREATE INDEX IF NOT EXISTS idx_volunteers_ref1_token ON volunteers(ref1_request_token) WHERE ref1_request_token != ''",
        "CREATE INDEX IF NOT EXISTS idx_volunteers_ref2_token ON volunteers(ref2_request_token) WHERE ref2_request_token != ''",
        # ── Generic file attachments ──────────────────────────────────────────
        # Owner-typed file storage (e.g. all attachments for a volunteer, all
        # DBS certificates across the org). Files <5MB stored inline as BYTEA;
        # larger ones would need Azure Blob (not needed for DBS PDFs which
        # are typically <500KB).
        # Named `attachments` not `documents` because the existing `documents`
        # table in this repo is for compliance/policy documents with a
        # totally different schema (file_url, category, review_due, etc.).
        """CREATE TABLE IF NOT EXISTS attachments (
            id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_type  VARCHAR(50)  NOT NULL,
            owner_id    UUID         NOT NULL,
            filename    VARCHAR(255) NOT NULL,
            mime_type   VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
            size_bytes  INTEGER      NOT NULL DEFAULT 0,
            data        BYTEA        NOT NULL,
            label       VARCHAR(100) NOT NULL DEFAULT '',
            uploaded_by VARCHAR(200) NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_attachments_label ON attachments(owner_type, owner_id, label)",
        # ── Release notes / build features list ───────────────────────────────
        # One row per shipped feature/PR. Lets trustees + volunteers see what
        # changed in the latest deploy, and gives the team a queryable
        # changelog (what was added, when, by which PR).
        """CREATE TABLE IF NOT EXISTS release_notes (
            id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            git_sha     VARCHAR(40)  NOT NULL DEFAULT '',
            pr_number   INT,
            title       VARCHAR(300) NOT NULL,
            summary     TEXT         NOT NULL DEFAULT '',
            area        VARCHAR(50)  NOT NULL DEFAULT '',
            tags        JSONB        NOT NULL DEFAULT '[]'::jsonb,
            released_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_release_notes_released ON release_notes(released_at DESC)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_release_notes_pr ON release_notes(pr_number) WHERE pr_number IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_release_notes_area ON release_notes(area)",
        # ── Volunteer drafts (cross-device partial save) ──────────────────────
        # The wizard auto-saves to localStorage on every change. For applicants
        # who want to resume on a different device — or who clear browser data
        # mid-fill — we also persist to this table, keyed by an opaque token
        # the client stashes in the URL hash. Drafts expire after 30 days.
        """CREATE TABLE IF NOT EXISTS volunteer_drafts (
            id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            token       VARCHAR(64)  UNIQUE NOT NULL,
            email       VARCHAR(255) NOT NULL DEFAULT '',
            payload     JSONB        NOT NULL DEFAULT '{}'::jsonb,
            branch_id   VARCHAR(100) NOT NULL DEFAULT 'main',
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            expires_at  TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
        )""",
        "CREATE INDEX IF NOT EXISTS idx_volunteer_drafts_token   ON volunteer_drafts(token)",
        "CREATE INDEX IF NOT EXISTS idx_volunteer_drafts_email   ON volunteer_drafts(LOWER(email)) WHERE email != ''",
        "CREATE INDEX IF NOT EXISTS idx_volunteer_drafts_expires ON volunteer_drafts(expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_volunteers_contact ON volunteers(contact_id)",
        "CREATE INDEX IF NOT EXISTS idx_volunteers_partial_token ON volunteers(partial_save_token) WHERE partial_save_token != ''",
        # Backfill: link existing volunteer rows to a contact row by email.
        # Idempotent — only touches rows where contact_id IS NULL. Safe to
        # re-run; later schema patches won't overwrite an explicit contact_id.
        """
        WITH new_contacts AS (
            INSERT INTO contacts (id, email, first_name, surname, full_name, phone,
                                  gdpr_consent, gdpr_consented_at,
                                  tac_consent, tac_consented_at,
                                  first_source, first_branch_id, created_at, updated_at)
            SELECT  gen_random_uuid(),
                    LOWER(v.email),
                    v.first_names,
                    v.last_name,
                    TRIM(v.first_names || ' ' || v.last_name),
                    COALESCE(NULLIF(v.mobile,''), v.phone),
                    true, v.created_at,
                    v.confidentiality_agreed, v.created_at,
                    'volunteer-registration', v.branch_id, v.created_at, v.created_at
            FROM    volunteers v
            WHERE   v.contact_id IS NULL
              AND   v.email IS NOT NULL
              AND   v.email <> ''
            ON CONFLICT (email) DO UPDATE
              SET updated_at = EXCLUDED.updated_at
            RETURNING id, email
        )
        UPDATE volunteers
           SET contact_id = c.id
          FROM contacts c
         WHERE volunteers.contact_id IS NULL
           AND LOWER(volunteers.email) = c.email
        """,
        # ── Form-text overrides (admin-editable strings on public forms) ──────
        # Sparse table: only stores OVERRIDES. Defaults live in code (per
        # form_key catalogue in shital.api.routers.form_config). Lookup is
        # by (form_key, field_key); admin sets/clears overrides without
        # needing to seed every field.
        """CREATE TABLE IF NOT EXISTS form_text_overrides (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            form_key        VARCHAR(100) NOT NULL,
            field_key       VARCHAR(200) NOT NULL,
            override_text   TEXT NOT NULL DEFAULT '',
            updated_by      UUID,
            updated_by_name VARCHAR(255) NOT NULL DEFAULT '',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (form_key, field_key)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_form_text_form ON form_text_overrides(form_key)",
        # ── Board of Trustees Resolutions & Voting ────────────────────────────
        # Distinct sub-system: governance records (resolutions, votes, minutes,
        # conflicts, audit). PR 1 of 6 introduces the foundation tables only —
        # trustees, meetings, governing rules, plus skeletons for resolutions
        # and audit_log so subsequent PRs add columns / behaviours via
        # idempotent ALTERs without renaming.
        """CREATE TABLE IF NOT EXISTS trustees (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id         UUID,
            full_name       VARCHAR(255) NOT NULL,
            email           VARCHAR(255) NOT NULL,
            role            VARCHAR(40)  NOT NULL DEFAULT 'TRUSTEE',
            phone           VARCHAR(50)  NOT NULL DEFAULT '',
            address         TEXT         NOT NULL DEFAULT '',
            postcode        VARCHAR(20)  NOT NULL DEFAULT '',
            term_start      DATE,
            term_end        DATE,
            notes           TEXT NOT NULL DEFAULT '',
            is_active       BOOLEAN NOT NULL DEFAULT true,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_trustees_email  ON trustees(email)",
        "CREATE INDEX IF NOT EXISTS idx_trustees_role   ON trustees(role)",
        "CREATE INDEX IF NOT EXISTS idx_trustees_active ON trustees(is_active)",
        # Board roles registry — admins can add/edit/disable positions from
        # the Users & Roles page; the trustee form fetches the live list so
        # changes show up without a redeploy. Seeded below from
        # board.SEED_BOARD_ROLES so a fresh DB has the existing 10 entries.
        """CREATE TABLE IF NOT EXISTS board_roles (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code        VARCHAR(50) UNIQUE NOT NULL,
            label       VARCHAR(100) NOT NULL,
            category    VARCHAR(20) NOT NULL DEFAULT 'MAIN_BOARD',
            sort_order  INTEGER     NOT NULL DEFAULT 100,
            is_active   BOOLEAN     NOT NULL DEFAULT true,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_board_roles_category ON board_roles(category)",
        "CREATE INDEX IF NOT EXISTS idx_board_roles_active   ON board_roles(is_active)",
        # Seed (idempotent — ON CONFLICT DO NOTHING). Codes match the
        # hardcoded list from board.py's VALID_ROLES, so existing trustees
        # rows continue to resolve.
        """INSERT INTO board_roles (code, label, category, sort_order) VALUES
            ('CHAIR',               'Chair',               'MAIN_BOARD',  10),
            ('TREASURER',           'Treasurer',           'MAIN_BOARD',  20),
            ('SECRETARY',           'Secretary',           'MAIN_BOARD',  30),
            ('CEO',                 'CEO',                 'MAIN_BOARD',  40),
            ('TRUSTEE',             'Trustee',             'MAIN_BOARD',  50),
            ('LMC_CHAIR',           'LMC Chair',           'LMC',         110),
            ('LMC_TREASURER',       'LMC Treasurer',       'LMC',         120),
            ('LMC_MEMBER',          'LMC Member',          'LMC',         130),
            ('EXTERNAL_CONTRACTOR', 'External Contractor', 'NON_OFFICER', 210),
            ('TEMP_WORKER',         'Temp Worker',         'NON_OFFICER', 220)
        ON CONFLICT (code) DO NOTHING""",
        # PIN-protected magic-link voting. Each trustee sets their own 4-6
        # digit PIN to confirm a vote cast via an emailed magic link. PIN is
        # bcrypt-hashed; rate-limited via pin_failed_attempts +
        # pin_locked_until.
        "ALTER TABLE trustees ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE trustees ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ",
        "ALTER TABLE trustees ADD COLUMN IF NOT EXISTS pin_failed_attempts INT NOT NULL DEFAULT 0",
        "ALTER TABLE trustees ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ",
        # Magic-link tokens for trustees to read + vote on a specific
        # resolution without logging in. One token per (resolution, trustee).
        # Token stays valid until the resolution closes.
        """CREATE TABLE IF NOT EXISTS resolution_vote_tokens (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            token           VARCHAR(80) UNIQUE NOT NULL,
            resolution_id   UUID NOT NULL REFERENCES resolutions(id) ON DELETE CASCADE,
            trustee_id      UUID NOT NULL REFERENCES trustees(id) ON DELETE CASCADE,
            sent_via        VARCHAR(20) NOT NULL DEFAULT 'EMAIL',
            sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at    TIMESTAMPTZ,
            used_count      INT NOT NULL DEFAULT 0,
            UNIQUE (resolution_id, trustee_id)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_rvtok_token ON resolution_vote_tokens(token)",
        "CREATE INDEX IF NOT EXISTS idx_rvtok_res   ON resolution_vote_tokens(resolution_id)",
        # Singleton row keyed on a constant scope value — the charity has one
        # set of rules. Stored as a row (not env vars) so admins can edit
        # from UI without redeploying.
        """CREATE TABLE IF NOT EXISTS governing_rules (
            id                                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            scope                                  VARCHAR(40) NOT NULL DEFAULT 'DEFAULT',
            quorum_min                             INT NOT NULL DEFAULT 3,
            quorum_fraction_numerator              INT NOT NULL DEFAULT 1,
            quorum_fraction_denominator            INT NOT NULL DEFAULT 3,
            chair_casting_vote_enabled             BOOLEAN NOT NULL DEFAULT true,
            written_resolution_requires_unanimous  BOOLEAN NOT NULL DEFAULT true,
            anonymous_ballot_for_officer_elections BOOLEAN NOT NULL DEFAULT true,
            notice_period_days                     INT NOT NULL DEFAULT 7,
            data_retention_years                   INT NOT NULL DEFAULT 6,
            created_at                             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at                             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (scope)
        )""",
        # Seed the singleton DEFAULT row. Idempotent on re-run.
        """INSERT INTO governing_rules (scope) VALUES ('DEFAULT')
            ON CONFLICT (scope) DO NOTHING""",
        """CREATE TABLE IF NOT EXISTS board_meetings (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            meeting_type    VARCHAR(40) NOT NULL DEFAULT 'TRUSTEE_MEETING',
            mode            VARCHAR(20) NOT NULL DEFAULT 'IN_PERSON',
            title           VARCHAR(300) NOT NULL DEFAULT '',
            scheduled_at    TIMESTAMPTZ NOT NULL,
            location        VARCHAR(500) NOT NULL DEFAULT '',
            video_link      VARCHAR(500) NOT NULL DEFAULT '',
            organiser_id    UUID,
            agenda          TEXT NOT NULL DEFAULT '',
            attendance      JSONB NOT NULL DEFAULT '[]'::jsonb,
            quorum_at_open  INT,
            status          VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
            opened_at       TIMESTAMPTZ,
            closed_at       TIMESTAMPTZ,
            minutes_status  VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
            minutes_text    TEXT NOT NULL DEFAULT '',
            minutes_approved_at TIMESTAMPTZ,
            notes           TEXT NOT NULL DEFAULT '',
            created_by      UUID,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_board_meetings_status   ON board_meetings(status)",
        "CREATE INDEX IF NOT EXISTS idx_board_meetings_type     ON board_meetings(meeting_type)",
        "CREATE INDEX IF NOT EXISTS idx_board_meetings_when     ON board_meetings(scheduled_at DESC)",
        # Skeleton — populated in PR 2 (resolutions builder + amendments).
        """CREATE TABLE IF NOT EXISTS resolutions (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            meeting_id      UUID REFERENCES board_meetings(id) ON DELETE SET NULL,
            title           VARCHAR(500) NOT NULL,
            background      TEXT NOT NULL DEFAULT '',
            recommendation  TEXT NOT NULL DEFAULT '',
            risk_impact     TEXT NOT NULL DEFAULT '',
            budget_impact   TEXT NOT NULL DEFAULT '',
            category        VARCHAR(60) NOT NULL DEFAULT 'OPERATIONAL',
            decision_type   VARCHAR(30) NOT NULL DEFAULT 'BOARD_MEETING',
            status          VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
            decision_date   DATE,
            is_retrospective       BOOLEAN NOT NULL DEFAULT false,
            retrospective_reason   TEXT NOT NULL DEFAULT '',
            outcome         VARCHAR(30) NOT NULL DEFAULT '',
            outcome_summary TEXT NOT NULL DEFAULT '',
            created_by      UUID,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_resolutions_status      ON resolutions(status)",
        "CREATE INDEX IF NOT EXISTS idx_resolutions_meeting     ON resolutions(meeting_id)",
        "CREATE INDEX IF NOT EXISTS idx_resolutions_decision_dt ON resolutions(decision_date DESC)",
        # PR 2 — voting engine columns. Idempotent ALTERs so re-applying is safe.
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS created_by_trustee_id UUID",
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ",
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ",
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS quorum_at_close INT",
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS effective_quorum_at_close INT",
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS tally_for INT NOT NULL DEFAULT 0",
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS tally_against INT NOT NULL DEFAULT 0",
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS tally_abstain INT NOT NULL DEFAULT 0",
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS casting_vote_used BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS casting_vote_choice VARCHAR(10) NOT NULL DEFAULT ''",
        "ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb",
        # ── Resolution votes — one row per trustee per resolution ─────────────
        # The board acts collectively: each active trustee gets exactly one
        # vote. Chair's casting vote (when permitted by governing_rules) is
        # tracked separately on `resolutions.casting_vote_used` to keep its
        # special status auditable. Trustees can change their own vote up
        # until status flips to CLOSED.
        """CREATE TABLE IF NOT EXISTS resolution_votes (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            resolution_id   UUID NOT NULL REFERENCES resolutions(id) ON DELETE CASCADE,
            trustee_id      UUID NOT NULL REFERENCES trustees(id) ON DELETE RESTRICT,
            choice          VARCHAR(10) NOT NULL,
                -- FOR | AGAINST | ABSTAIN
            anonymous       BOOLEAN NOT NULL DEFAULT false,
                -- when true, trustee_id is hidden from non-admin readers
            comment         TEXT NOT NULL DEFAULT '',
            voted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (resolution_id, trustee_id)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_resolution_votes_res ON resolution_votes(resolution_id)",
        "CREATE INDEX IF NOT EXISTS idx_resolution_votes_tru ON resolution_votes(trustee_id)",
        """CREATE TABLE IF NOT EXISTS board_audit_log (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            actor_user_id   UUID,
            actor_name      VARCHAR(255) NOT NULL DEFAULT '',
            action          VARCHAR(80)  NOT NULL,
            entity_type     VARCHAR(60)  NOT NULL DEFAULT '',
            entity_id       UUID,
            metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
            ip_address      VARCHAR(45)  NOT NULL DEFAULT '',
            user_agent      VARCHAR(500) NOT NULL DEFAULT '',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_board_audit_action ON board_audit_log(action)",
        "CREATE INDEX IF NOT EXISTS idx_board_audit_entity ON board_audit_log(entity_type, entity_id)",
        "CREATE INDEX IF NOT EXISTS idx_board_audit_when   ON board_audit_log(created_at DESC)",

        # ── Mail Agent: agentic email triage of shared mailboxes ─────────────
        # mail_agent_messages = one row per email the agent has seen. Idempotency
        # is via UNIQUE (graph_message_id) so the poller can safely re-fetch.
        # tool_log is the full agent transcript for the audit trail.
        """CREATE TABLE IF NOT EXISTS mail_agent_messages (
            id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            mailbox               VARCHAR(254) NOT NULL,
            graph_message_id      VARCHAR(300) NOT NULL,
            conversation_id       VARCHAR(300) NOT NULL DEFAULT '',
            internet_message_id   VARCHAR(500) NOT NULL DEFAULT '',
            subject               VARCHAR(500) NOT NULL DEFAULT '',
            sender_email          VARCHAR(254) NOT NULL DEFAULT '',
            sender_name           VARCHAR(254) NOT NULL DEFAULT '',
            received_at           TIMESTAMPTZ,
            classification        VARCHAR(40)  NOT NULL DEFAULT '',
            agent_summary         TEXT         NOT NULL DEFAULT '',
            tool_log              JSONB        NOT NULL DEFAULT '[]'::jsonb,
            status                VARCHAR(20)  NOT NULL DEFAULT 'processing',
            needs_human_review    BOOLEAN      NOT NULL DEFAULT false,
            escalation_reason     TEXT         NOT NULL DEFAULT '',
            suggested_action      TEXT         NOT NULL DEFAULT '',
            processed_at          TIMESTAMPTZ,
            created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            UNIQUE (graph_message_id)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_mail_agent_mbx    ON mail_agent_messages(mailbox)",
        "CREATE INDEX IF NOT EXISTS idx_mail_agent_status ON mail_agent_messages(status)",
        "CREATE INDEX IF NOT EXISTS idx_mail_agent_review ON mail_agent_messages(needs_human_review) WHERE needs_human_review = true",
        "CREATE INDEX IF NOT EXISTS idx_mail_agent_class  ON mail_agent_messages(classification, received_at DESC)",

        # Links from an agent-processed email to the record(s) it created.
        # Polymorphic via (record_type, record_id) — the admin Inbox page joins
        # back to whichever table to surface "Open invoice INV-123" etc.
        """CREATE TABLE IF NOT EXISTS mail_agent_record_links (
            id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            mail_agent_message_id UUID NOT NULL REFERENCES mail_agent_messages(id) ON DELETE CASCADE,
            record_type           VARCHAR(40) NOT NULL,
            record_id             VARCHAR(64) NOT NULL,
            note                  TEXT NOT NULL DEFAULT '',
            created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_mail_agent_links_msg ON mail_agent_record_links(mail_agent_message_id)",
        "CREATE INDEX IF NOT EXISTS idx_mail_agent_links_rec ON mail_agent_record_links(record_type, record_id)",

        # CRM account needs_review flag — set true on accounts auto-created by
        # the mail agent so a human can sanity-check before they're trusted.
        "ALTER TABLE crm_accounts ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false",
        "CREATE INDEX IF NOT EXISTS idx_crm_accounts_needs_review ON crm_accounts(needs_review) WHERE needs_review = true",

        # Cases — complaints, safeguarding, service issues raised by the mail
        # agent (or manually). Distinct from the CRM accounts table.
        """CREATE TABLE IF NOT EXISTS cases (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title           VARCHAR(300) NOT NULL DEFAULT '',
            description     TEXT NOT NULL DEFAULT '',
            category        VARCHAR(40)  NOT NULL DEFAULT 'other',
            severity        VARCHAR(20)  NOT NULL DEFAULT 'medium',
            status          VARCHAR(20)  NOT NULL DEFAULT 'open',
            customer_email  VARCHAR(254) NOT NULL DEFAULT '',
            customer_name   VARCHAR(254) NOT NULL DEFAULT '',
            assignee_user_id UUID,
            source          VARCHAR(30)  NOT NULL DEFAULT 'manual',
            branch_id       VARCHAR(64)  NOT NULL DEFAULT '',
            resolved_at     TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_cases_status   ON cases(status)",
        "CREATE INDEX IF NOT EXISTS idx_cases_severity ON cases(severity)",
        "CREATE INDEX IF NOT EXISTS idx_cases_category ON cases(category)",

        # Agent tasks — action items raised by the mail agent. Named
        # agent_tasks (not tasks) to avoid collision with any existing
        # generic-tasks table the codebase may grow later.
        """CREATE TABLE IF NOT EXISTS agent_tasks (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title            VARCHAR(300) NOT NULL DEFAULT '',
            description      TEXT NOT NULL DEFAULT '',
            due_date         DATE,
            assignee_user_id UUID,
            assignee_role    VARCHAR(40) NOT NULL DEFAULT '',
            priority         VARCHAR(20) NOT NULL DEFAULT 'medium',
            status           VARCHAR(20) NOT NULL DEFAULT 'open',
            source           VARCHAR(30) NOT NULL DEFAULT 'manual',
            completed_at     TIMESTAMPTZ,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_agent_tasks_assignee ON agent_tasks(assignee_user_id)",
        "CREATE INDEX IF NOT EXISTS idx_agent_tasks_status   ON agent_tasks(status)",
        "CREATE INDEX IF NOT EXISTS idx_agent_tasks_due      ON agent_tasks(due_date)",

        # ── Purchasing & Sales: Purchase Orders + Sales Invoices (MVP) ───────
        # Header + lines pattern. Money columns NUMERIC(12,2), unit_price has
        # 4 dp so per-unit micro-pricing (eg. per-litre fuel) round-trips.
        # `nominal_code_id` links each line to chart-of-accounts for SORP
        # fund/activity reporting; `nominal_code` is denormalised for fast
        # display + survives if the underlying code is renamed/deleted.
        # supplier/customer point at the existing `contacts` table so the
        # CRM is the single source of truth — no separate supplier table.
        """CREATE TABLE IF NOT EXISTS purchase_orders (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            po_number           VARCHAR(40) UNIQUE NOT NULL,
            branch_id           VARCHAR(100) NOT NULL DEFAULT 'main',
            supplier_contact_id UUID,
            supplier_name       VARCHAR(200) NOT NULL DEFAULT '',
            status              VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
                -- DRAFT | SENT | RECEIVED | PART_RECEIVED | CANCELLED
            order_date          DATE         NOT NULL DEFAULT CURRENT_DATE,
            expected_date       DATE,
            currency            VARCHAR(3)   NOT NULL DEFAULT 'GBP',
            subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
            vat_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
            total               NUMERIC(12,2) NOT NULL DEFAULT 0,
            notes               TEXT         NOT NULL DEFAULT '',
            reference           VARCHAR(100) NOT NULL DEFAULT '',
            delivery_address    TEXT         NOT NULL DEFAULT '',
            created_by          VARCHAR(200) NOT NULL DEFAULT '',
            sent_at             TIMESTAMPTZ,
            received_at         TIMESTAMPTZ,
            cancelled_at        TIMESTAMPTZ,
            created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_purchase_orders_branch  ON purchase_orders(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_purchase_orders_status  ON purchase_orders(status)",
        "CREATE INDEX IF NOT EXISTS idx_purchase_orders_date    ON purchase_orders(order_date DESC)",
        "CREATE INDEX IF NOT EXISTS idx_purchase_orders_supp    ON purchase_orders(supplier_contact_id)",
        # Link PO to a CRM account (single source of truth for supplier name).
        # supplier_name is kept as a denormalised snapshot for historical
        # accuracy if the account is later renamed/merged.
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_account_id UUID",
        "CREATE INDEX IF NOT EXISTS idx_purchase_orders_supp_acc ON purchase_orders(supplier_account_id)",
        """CREATE TABLE IF NOT EXISTS purchase_order_lines (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            po_id           UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
            line_no         INTEGER NOT NULL DEFAULT 1,
            description     TEXT NOT NULL,
            nominal_code_id UUID,
            nominal_code    VARCHAR(20) NOT NULL DEFAULT '',
            quantity        NUMERIC(12,3) NOT NULL DEFAULT 1,
            unit_price      NUMERIC(12,4) NOT NULL DEFAULT 0,
            vat_rate        NUMERIC(5,2)  NOT NULL DEFAULT 0,
            vat_code        VARCHAR(20)   NOT NULL DEFAULT 'OUT_OF_SCOPE',
            line_net        NUMERIC(12,2) NOT NULL DEFAULT 0,
            line_vat        NUMERIC(12,2) NOT NULL DEFAULT 0,
            line_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
            received_qty    NUMERIC(12,3) NOT NULL DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_po_lines_po      ON purchase_order_lines(po_id)",
        "CREATE INDEX IF NOT EXISTS idx_po_lines_nom     ON purchase_order_lines(nominal_code_id)",
        """CREATE TABLE IF NOT EXISTS sales_invoices (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_number      VARCHAR(40) UNIQUE NOT NULL,
            branch_id           VARCHAR(100) NOT NULL DEFAULT 'main',
            customer_contact_id UUID,
            customer_name       VARCHAR(200) NOT NULL DEFAULT '',
            status              VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
                -- DRAFT | SENT | PAID | PART_PAID | VOID
            invoice_date        DATE         NOT NULL DEFAULT CURRENT_DATE,
            due_date            DATE,
            currency            VARCHAR(3)   NOT NULL DEFAULT 'GBP',
            subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
            vat_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
            total               NUMERIC(12,2) NOT NULL DEFAULT 0,
            paid_total          NUMERIC(12,2) NOT NULL DEFAULT 0,
            notes               TEXT         NOT NULL DEFAULT '',
            reference           VARCHAR(100) NOT NULL DEFAULT '',
            billing_address     TEXT         NOT NULL DEFAULT '',
            created_by          VARCHAR(200) NOT NULL DEFAULT '',
            sent_at             TIMESTAMPTZ,
            paid_at             TIMESTAMPTZ,
            voided_at           TIMESTAMPTZ,
            created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_sales_invoices_branch ON sales_invoices(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_sales_invoices_status ON sales_invoices(status)",
        "CREATE INDEX IF NOT EXISTS idx_sales_invoices_date   ON sales_invoices(invoice_date DESC)",
        "CREATE INDEX IF NOT EXISTS idx_sales_invoices_cust   ON sales_invoices(customer_contact_id)",
        # Link sales invoice to a CRM account (single source of truth for
        # customer name). customer_name kept as denormalised snapshot.
        "ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_account_id UUID",
        "CREATE INDEX IF NOT EXISTS idx_sales_invoices_cust_acc ON sales_invoices(customer_account_id)",
        """CREATE TABLE IF NOT EXISTS sales_invoice_lines (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_id      UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
            line_no         INTEGER NOT NULL DEFAULT 1,
            description     TEXT NOT NULL,
            nominal_code_id UUID,
            nominal_code    VARCHAR(20) NOT NULL DEFAULT '',
            quantity        NUMERIC(12,3) NOT NULL DEFAULT 1,
            unit_price      NUMERIC(12,4) NOT NULL DEFAULT 0,
            vat_rate        NUMERIC(5,2)  NOT NULL DEFAULT 0,
            vat_code        VARCHAR(20)   NOT NULL DEFAULT 'OUT_OF_SCOPE',
            line_net        NUMERIC(12,2) NOT NULL DEFAULT 0,
            line_vat        NUMERIC(12,2) NOT NULL DEFAULT 0,
            line_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_inv_lines_inv  ON sales_invoice_lines(invoice_id)",
        "CREATE INDEX IF NOT EXISTS idx_inv_lines_nom  ON sales_invoice_lines(nominal_code_id)",
        # ── Purchase Invoices (supplier bills) ───────────────────────────────
        # The bill we receive FROM a supplier. Optionally linked to a PO
        # for 3-way match. Posts DR Expense + VAT-input CR AP on RECEIVED;
        # payments post DR AP CR Bank. `supplier_invoice_number` is the
        # supplier's external reference (eg. their 'INV-12345'); our
        # internal sequential is `invoice_number` (BILL-YYYY-NNNN).
        """CREATE TABLE IF NOT EXISTS purchase_invoices (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_number          VARCHAR(40) UNIQUE NOT NULL,
            supplier_invoice_number VARCHAR(80) NOT NULL DEFAULT '',
            branch_id               VARCHAR(100) NOT NULL DEFAULT 'main',
            supplier_contact_id     UUID,
            supplier_name           VARCHAR(200) NOT NULL DEFAULT '',
            po_id                   UUID,
            status                  VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
            invoice_date            DATE         NOT NULL DEFAULT CURRENT_DATE,
            due_date                DATE,
            currency                VARCHAR(3)   NOT NULL DEFAULT 'GBP',
            subtotal                NUMERIC(12,2) NOT NULL DEFAULT 0,
            vat_total               NUMERIC(12,2) NOT NULL DEFAULT 0,
            total                   NUMERIC(12,2) NOT NULL DEFAULT 0,
            paid_total              NUMERIC(12,2) NOT NULL DEFAULT 0,
            notes                   TEXT         NOT NULL DEFAULT '',
            reference               VARCHAR(100) NOT NULL DEFAULT '',
            created_by              VARCHAR(200) NOT NULL DEFAULT '',
            received_at             TIMESTAMPTZ,
            paid_at                 TIMESTAMPTZ,
            voided_at               TIMESTAMPTZ,
            created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_purchase_invoices_branch ON purchase_invoices(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status ON purchase_invoices(status)",
        "CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date   ON purchase_invoices(invoice_date DESC)",
        "CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supp   ON purchase_invoices(supplier_contact_id)",
        # Link bill to a CRM account (single source of truth for supplier name).
        "ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS supplier_account_id UUID",
        "CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supp_acc ON purchase_invoices(supplier_account_id)",
        "CREATE INDEX IF NOT EXISTS idx_purchase_invoices_po     ON purchase_invoices(po_id)",
        # Partial unique index: dedupes per supplier on their external invoice
        # number (only enforced when both are present).
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_invoices_supp_ref ON purchase_invoices(supplier_contact_id, supplier_invoice_number) WHERE supplier_contact_id IS NOT NULL AND supplier_invoice_number <> ''",
        """CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_id      UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
            po_line_id      UUID,
            line_no         INTEGER NOT NULL DEFAULT 1,
            description     TEXT NOT NULL,
            nominal_code_id UUID,
            nominal_code    VARCHAR(20) NOT NULL DEFAULT '',
            quantity        NUMERIC(12,3) NOT NULL DEFAULT 1,
            unit_price      NUMERIC(12,4) NOT NULL DEFAULT 0,
            vat_rate        NUMERIC(5,2)  NOT NULL DEFAULT 0,
            vat_code        VARCHAR(20)   NOT NULL DEFAULT 'OUT_OF_SCOPE',
            line_net        NUMERIC(12,2) NOT NULL DEFAULT 0,
            line_vat        NUMERIC(12,2) NOT NULL DEFAULT 0,
            line_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_pi_lines_inv ON purchase_invoice_lines(invoice_id)",
        "CREATE INDEX IF NOT EXISTS idx_pi_lines_nom ON purchase_invoice_lines(nominal_code_id)",
        "CREATE INDEX IF NOT EXISTS idx_pi_lines_po  ON purchase_invoice_lines(po_line_id)",
        # ── Phase 3: Budgets ─────────────────────────────────────────────────
        # `budgets` is the period+branch header (one row per branch+year+
        # period(+project)). `budget_lines` allocates the budget across
        # nominal_codes (so a single budget header can split into 30+ codes
        # for fine-grained planning).
        #
        # The actuals side reuses transaction_lines from Phase 2 — variance
        # reporting JOINs budget_lines to transaction_lines on
        # (nominal_code_id, branch_id, fund_type, date BETWEEN
        # period_start AND period_end). No duplicated actuals storage.
        """CREATE TABLE IF NOT EXISTS budgets (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id       VARCHAR(100) NOT NULL DEFAULT 'main',
            fiscal_year     INTEGER NOT NULL,
            period_type     VARCHAR(20) NOT NULL DEFAULT 'YEAR',
                -- YEAR | QUARTER | MONTH
            period_label    VARCHAR(40) NOT NULL DEFAULT '',
                -- eg. '2026', '2026-Q1', '2026-04'
            period_start    DATE NOT NULL,
            period_end      DATE NOT NULL,
            name            VARCHAR(200) NOT NULL DEFAULT '',
            status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
                -- DRAFT | APPROVED | CLOSED
            fund_type       VARCHAR(20) NOT NULL DEFAULT 'UNRESTRICTED',
            project_id      UUID,
            total_income    NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_expense   NUMERIC(12,2) NOT NULL DEFAULT 0,
            net_budget      NUMERIC(12,2) NOT NULL DEFAULT 0,
            notes           TEXT NOT NULL DEFAULT '',
            created_by      VARCHAR(200) NOT NULL DEFAULT '',
            approved_by     VARCHAR(200) NOT NULL DEFAULT '',
            approved_at     TIMESTAMPTZ,
            closed_at       TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        # UNIQUE constraint with NULLs: Postgres treats NULLs as distinct
        # by default, so two budgets with project_id NULL won't collide
        # — we use a partial-index trick to dedupe non-project rows too.
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_per_period_proj ON budgets(branch_id, fiscal_year, period_type, period_label, project_id) WHERE project_id IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_per_period_noproj ON budgets(branch_id, fiscal_year, period_type, period_label) WHERE project_id IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_budgets_branch  ON budgets(branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_budgets_year    ON budgets(fiscal_year)",
        "CREATE INDEX IF NOT EXISTS idx_budgets_status  ON budgets(status)",
        "CREATE INDEX IF NOT EXISTS idx_budgets_project ON budgets(project_id)",
        """CREATE TABLE IF NOT EXISTS budget_lines (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            budget_id       UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
            nominal_code_id UUID NOT NULL,
            nominal_code    VARCHAR(20) NOT NULL DEFAULT '',
            fund_type       VARCHAR(20) NOT NULL DEFAULT 'UNRESTRICTED',
            project_id      UUID,
            amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
            notes           TEXT NOT NULL DEFAULT '',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_lines_per_code_proj ON budget_lines(budget_id, nominal_code_id, project_id) WHERE project_id IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_lines_per_code_noproj ON budget_lines(budget_id, nominal_code_id) WHERE project_id IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_budget_lines_budget  ON budget_lines(budget_id)",
        "CREATE INDEX IF NOT EXISTS idx_budget_lines_nominal ON budget_lines(nominal_code_id)",
        "CREATE INDEX IF NOT EXISTS idx_budget_lines_project ON budget_lines(project_id)",
        # ── Phase 4: Project costing additions ──────────────────────────────
        # The `projects` table already exists (line 361). We add lifecycle
        # + classification + budget-snapshot columns so project P&L reports
        # have everything they need without joining elsewhere. Actuals come
        # live from transaction_lines.project_id (added in Phase 2) — no
        # parallel actuals storage.
        # status values:        ACTIVE | PLANNING | ON_HOLD | COMPLETED | CANCELLED
        # project_type values:  GENERAL | CAPITAL | RESTRICTED_FUND | EVENT | GRANT | OUTREACH
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS status         VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE'",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type   VARCHAR(40)  NOT NULL DEFAULT 'GENERAL'",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS fund_type      VARCHAR(20)  NOT NULL DEFAULT 'UNRESTRICTED'",
        # budget_amount is a header snapshot; full per-code allocation
        # lives in budgets/budget_lines with project_id set
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_amount  NUMERIC(12,2) NOT NULL DEFAULT 0",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS manager_user_id UUID",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS sponsor_contact_id UUID",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS reference      VARCHAR(100) NOT NULL DEFAULT ''",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes          TEXT         NOT NULL DEFAULT ''",
        "CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)",
        "CREATE INDEX IF NOT EXISTS idx_projects_type   ON projects(project_type)",
        "CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(manager_user_id)",
        # mail-agent integration: tag rows it auto-creates so a human can
        # audit them later. 'manual' (default) vs 'mail_agent' vs 'import'.
        "ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'manual'",
        "CREATE INDEX IF NOT EXISTS idx_purchase_invoices_source ON purchase_invoices(source) WHERE source <> 'manual'",

        # ── Scheduled deploys ──────────────────────────────────────────────
        # Persisted queue of "promote at <future time>" requests. Lives in
        # the DB (not in-memory) so a prod promote — which recreates the
        # backend container mid-wait — doesn't lose pending entries. The
        # poller in lifespan() reads this table every 60s and fires due
        # rows via the deployer's /promote-prod. status flow:
        #   pending → fired      (poller hit, deployer call dispatched)
        #   pending → cancelled  (operator clicked ✕)
        #   pending → failed     (deployer rejected; error column populated)
        """CREATE TABLE IF NOT EXISTS scheduled_deploys (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            env           VARCHAR(10)  NOT NULL,
            scheduled_for TIMESTAMPTZ  NOT NULL,
            status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
            created_by    VARCHAR(255) NOT NULL,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            fired_at      TIMESTAMPTZ,
            error         TEXT
        )""",
        # Poller's hot query is "find pending rows that are due". Partial
        # index keeps it O(1) regardless of total history size.
        "CREATE INDEX IF NOT EXISTS idx_scheduled_deploys_pending ON scheduled_deploys(scheduled_for) WHERE status = 'pending'",
    ]

    # Each statement runs in its own transaction so one failure doesn't
    # abort the entire batch (PostgreSQL aborts the txn on any error).
    # Per-statement 30s timeout means a single bad ALTER waiting on a
    # held lock can't hang the entire startup. Last-known-good was a
    # 30/30 healthcheck failure traced back to a stuck schema patch
    # — adding the timeout + per-N progress logging so the pattern is
    # visible in container logs next time something stalls.
    #
    # 12-Jun perf: a successful patch is recorded by SHA in
    # schema_patches_applied. Subsequent boots skip it in O(query),
    # cutting cold-start time on prod (where most patches are already
    # applied and only a handful of new patches arrive per release).
    import asyncio
    import hashlib

    # Ensure the tracking table exists. ONE statement, separate txn so
    # any failure here doesn't poison the patch loop below.
    try:
        async with SessionLocal() as db:
            await asyncio.wait_for(
                db.execute(text(
                    "CREATE TABLE IF NOT EXISTS schema_patches_applied ("
                    "  sql_hash CHAR(64) PRIMARY KEY,"
                    "  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
                    ")"
                )),
                timeout=10,
            )
            await db.commit()
    except Exception as exc:
        logger.warning("schema_patches_table_create_failed", error=str(exc))

    # Load already-applied hashes in one query.
    applied: set[str] = set()
    try:
        async with SessionLocal() as db:
            rows = (await db.execute(
                text("SELECT sql_hash FROM schema_patches_applied")
            )).all()
            applied = {row[0] for row in rows}
    except Exception as exc:
        logger.warning("schema_patches_applied_query_failed", error=str(exc))

    def _hash(sql: str) -> str:
        # Normalize whitespace so trivial reformatting doesn't re-run a patch.
        return hashlib.sha256(" ".join(sql.split()).encode()).hexdigest()

    total = len(patches)
    pending = [(p, _hash(p)) for p in patches]
    pending = [(p, h) for (p, h) in pending if h not in applied]
    skipped = total - len(pending)

    if skipped:
        logger.info("schema_patch_skipped_cached", skipped=skipped, total=total)

    async def _mark_applied(h: str) -> None:
        try:
            async with SessionLocal() as db:
                await asyncio.wait_for(
                    db.execute(
                        text(
                            "INSERT INTO schema_patches_applied (sql_hash) "
                            "VALUES (:h) ON CONFLICT DO NOTHING"
                        ),
                        {"h": h},
                    ),
                    timeout=5,
                )
                await db.commit()
        except Exception:
            pass  # tracking is best-effort; never blocks startup

    for idx, (sql, h) in enumerate(pending):
        applied_this_round = False
        try:
            async with SessionLocal() as db:
                await asyncio.wait_for(db.execute(text(sql)), timeout=30)
                await db.commit()
                applied_this_round = True
        except TimeoutError:
            logger.warning("schema_patch_timeout", index=idx, sql_preview=sql[:80])
            # Don't mark applied — retry next boot.
        except Exception:
            # Column already exists / table missing / safe-skip — mark as
            # applied so we don't waste another 30s timeout slot retrying it.
            applied_this_round = True
        if applied_this_round:
            await _mark_applied(h)
        if idx and idx % 50 == 0:
            logger.info("schema_patch_progress", done=idx, total=len(pending))
    logger.info("schema_patch_done", total=total, skipped=skipped, applied=len(pending))
    await _seed_api_key_metadata()
    await _seed_catalog()
    await _seed_email_templates()
    await _seed_release_notes()
    await _seed_document_categories()


async def _seed_api_key_metadata() -> None:
    """Upsert known API key descriptors (no values) so the admin UI always shows them."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    KNOWN_KEYS = [  # noqa: N806
        # (key_name, description, group_name, is_sensitive)
        ("STRIPE_SECRET_KEY",         "Stripe secret key (sk_live_...)",                "Stripe",    True),
        ("STRIPE_PUBLISHABLE_KEY",    "Stripe publishable key (pk_live_...)",           "Stripe",    False),
        ("STRIPE_WEBHOOK_SECRET",     "Stripe webhook signing secret (whsec_...)",      "Stripe",    True),
        ("STRIPE_TERMINAL_LOCATION_ID","Stripe Terminal location ID",                   "Stripe",    False),
        ("ANTHROPIC_API_KEY",         "Anthropic / Claude API key",                     "AI",        True),
        ("OFFICE365_EMAIL",           "Office 365 sender email (noreply@shital.org.uk)", "Email",     False),
        ("OFFICE365_PASSWORD",        "Office 365 SMTP app password",                   "Email",     True),
        ("SENDGRID_API_KEY",          "SendGrid email API key (fallback if O365 not set)", "Email",  True),
        ("MS_CLIENT_ID",              "Microsoft Azure App (client) ID",                "Microsoft", False),
        ("MS_TENANT_ID",              "Microsoft Azure Directory (tenant) ID",          "Microsoft", False),
        ("MS_CLIENT_SECRET",          "Microsoft Azure client secret",                  "Microsoft", True),
        ("MS_REDIRECT_URI",           "Azure AD OAuth redirect URI — must match Azure exactly, e.g. https://admin.shital.org.uk/admin/auth-callback/ (trailing slash matters)", "Microsoft", False),
        ("GOOGLE_CLIENT_ID",          "Google OAuth client ID (also powers public donor Google login — add redirect https://service.shital.org.uk/api/v1/auth/donor/google/callback)", "Google", False),
        ("GOOGLE_CLIENT_SECRET",      "Google OAuth client secret",                     "Google",    True),
        ("DONOR_MS_CLIENT_ID",        "Microsoft consumer OAuth app (client) ID for PUBLIC donor login — SEPARATE from the admin MS_* app. Use 'common' tenant; redirect https://service.shital.org.uk/api/v1/auth/donor/microsoft/callback", "Donor Login", False),
        ("DONOR_MS_CLIENT_SECRET",    "Microsoft consumer OAuth app client secret for public donor login", "Donor Login", True),
        ("META_WHATSAPP_TOKEN",       "Meta WhatsApp Business API token",               "WhatsApp",  True),
        ("META_WHATSAPP_PHONE_ID",    "Meta WhatsApp phone number ID",                  "WhatsApp",  False),
        ("META_WHATSAPP_VERIFY_TOKEN","Meta WhatsApp webhook verify token",             "WhatsApp",  True),
        ("PAYPAL_CLIENT_ID",          "PayPal REST API client ID",                      "PayPal",    False),
        ("PAYPAL_CLIENT_SECRET",      "PayPal REST API client secret",                  "PayPal",    True),
        ("PAYPAL_ENV",                "PayPal environment: 'live' or 'sandbox'",        "PayPal",    False),
        ("HMRC_GIFT_AID_USER_ID",     "HMRC Government Gateway user ID",                "HMRC",      True),
        ("HMRC_GIFT_AID_PASSWORD",    "HMRC Government Gateway password",               "HMRC",      True),
        ("HMRC_GIFT_AID_VENDOR_ID",   "HMRC software vendor ID",                        "HMRC",      False),
        ("HMRC_GIFT_AID_CHARITY_HMO_REF","Charity HMRC reference number",              "HMRC",      False),
        ("GETADDRESS_API_KEY",        "GetAddress.io UK postcode lookup API key",       "Address",   True),
        ("IDEAL_POSTCODES_API_KEY",  "Ideal Postcodes UK address lookup API key",      "Address",   True),
        ("ADDRESS_LOOKUP_PROVIDER",  "Active address lookup provider (getaddress or ideal_postcodes)", "Address", False),
        ("SUMUP_ACCESS_TOKEN",       "SumUp Personal API key (sup_pk_...)",            "SumUp",     True),
        ("SUMUP_MERCHANT_CODE",      "SumUp merchant code (e.g. M602X5FC)",            "SumUp",     False),
        ("MEILISEARCH_MASTER_KEY",   "MeiliSearch master key",                         "Other",     True),
        ("VULTR_API_KEY",            "Vultr Personal Access Token — pulls real hosting cost into Finance → Hosting Costs",              "Hosting",   True),
        ("YOUTUBE_CHANNEL_ID",       "YouTube channel ID (UC...) for the temple's TV channel — drives live-status detection on shital.org.uk/tv", "TV",        False),
        ("YOUTUBE_CHANNEL_HANDLE",   "YouTube channel handle, e.g. @ShirdiSaiTempleUK — used for the 'Watch on YouTube' link",                  "TV",        False),
        ("YOUTUBE_DATA_API_KEY",     "YouTube Data API v3 key (AIzaSy...) — free from console.cloud.google.com",                              "TV",        True),
    ]

    async with SessionLocal() as db:
        for key_name, description, group_name, is_sensitive in KNOWN_KEYS:
            try:
                await db.execute(text("""
                    INSERT INTO api_keys_store (key_name, description, group_name, is_sensitive)
                    VALUES (:k, :d, :g, :s)
                    ON CONFLICT (key_name) DO UPDATE
                        SET description  = EXCLUDED.description,
                            group_name   = EXCLUDED.group_name,
                            is_sensitive = EXCLUDED.is_sensitive
                """), {"k": key_name, "d": description, "g": group_name, "s": is_sensitive})
            except Exception:
                pass
        await db.commit()
    logger.info("api_key_metadata_seeded")


async def _seed_catalog() -> None:
    """Seed catalog_items with default items if the table is empty.
    Idempotent — only inserts when zero rows exist in catalog_items.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    # Each tuple: (name, name_gu, name_hi, category, price, emoji, unit, gift_aid, sort_order, image_url)
    SEED_ITEMS = [  # noqa: N806
        # ── Quick Donation tiles (tap-and-go amounts, per branch/device) ─────
        ("Quick Dan £3",   "ઝડપ દાન £3",  "त्वरित दान £3",  "QUICK_DONATION", 3,   "🙏", "",  True,  10, ""),
        ("Quick Dan £5",   "ઝડપ દાન £5",  "त्वरित दान £5",  "QUICK_DONATION", 5,   "🙏", "",  True,  20, ""),
        ("Quick Dan £8",   "ઝડપ દાન £8",  "त्वरित दान £8",  "QUICK_DONATION", 8,   "🪔", "",  True,  30, ""),
        ("Quick Dan £11",  "ઝડપ દાન £11", "त्वरित दान £11", "QUICK_DONATION", 11,  "🪔", "",  True,  40, ""),
        ("Quick Dan £15",  "ઝડપ દાન £15", "त्वरित दान £15", "QUICK_DONATION", 15,  "✨", "",  True,  50, ""),
        ("Quick Dan £21",  "ઝડપ દાન £21", "त्वरित दान £21", "QUICK_DONATION", 21,  "✨", "",  True,  60, ""),
        ("Quick Dan £25",  "ઝડપ દાન £25", "त्वरित दान £25", "QUICK_DONATION", 25,  "👑", "",  True,  70, ""),
        # ── General Donations (gift-aid eligible preset amounts) ──────────────
        ("Sadharana Dan £1",    "સાધારણ દાન £1",   "सामान्य दान £1",   "GENERAL_DONATION", 1,   "🙏", "",      True,  10, "https://images.unsplash.com/photo-1567363421635-a35ed38eba9e?w=400&h=250&fit=crop&q=80"),
        ("Sadharana Dan £5",    "સાધારણ દાન £5",   "सामान्य दान £5",   "GENERAL_DONATION", 5,   "🙏", "",      True,  20, "https://images.unsplash.com/photo-1567363421635-a35ed38eba9e?w=400&h=250&fit=crop&q=80"),
        ("Sadharana Dan £10",   "સાધારણ દાન £10",  "सामान्य दान £10",  "GENERAL_DONATION", 10,  "🙏", "",      True,  30, "https://images.unsplash.com/photo-1567363421635-a35ed38eba9e?w=400&h=250&fit=crop&q=80"),
        ("Sadharana Dan £21",   "સાધારણ દાન £21",  "सामान्य दान £21",  "GENERAL_DONATION", 21,  "🪔", "",      True,  40, "https://images.unsplash.com/photo-1567363421635-a35ed38eba9e?w=400&h=250&fit=crop&q=80"),
        ("Maha Puja Dan £51",   "મહા પૂજા દાન £51","महा पूजा दान £51", "GENERAL_DONATION", 51,  "🪔", "",      True,  50, "https://images.unsplash.com/photo-1567363421635-a35ed38eba9e?w=400&h=250&fit=crop&q=80"),
        ("Swarna Dan £101",     "સ્વર્ણ દાન £101", "स्वर्ण दान £101",  "GENERAL_DONATION", 101, "✨", "",      True,  60, "https://images.unsplash.com/photo-1567363421635-a35ed38eba9e?w=400&h=250&fit=crop&q=80"),
        ("Rajat Dan £251",      "રજત દાન £251",    "रजत दान £251",    "GENERAL_DONATION", 251, "👑", "",      True,  70, "https://images.unsplash.com/photo-1567363421635-a35ed38eba9e?w=400&h=250&fit=crop&q=80"),
        # ── Soft / Food Donations (NOT gift-aid — physical goods) ─────────────
        ("Rice Bag 10kg",       "ચોખા 10kg",        "चावल 10kg",        "SOFT_DONATION",    15,  "🌾", "10kg",  False, 10, "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&h=250&fit=crop&q=80"),
        ("Rice Bag 25kg",       "ચોખા 25kg",        "चावल 25kg",        "SOFT_DONATION",    35,  "🌾", "25kg",  False, 20, "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&h=250&fit=crop&q=80"),
        ("Basmati Rice 5kg",    "બાસમતી 5kg",       "बासमती 5kg",       "SOFT_DONATION",    18,  "🌾", "5kg",   False, 30, "https://images.unsplash.com/photo-1536304993881-ff86d42818ef?w=400&h=250&fit=crop&q=80"),
        ("Atta (Wheat Flour) 10kg","આટો 10kg",      "आटा 10kg",         "SOFT_DONATION",    12,  "🌿", "10kg",  False, 40, "https://images.unsplash.com/photo-1588072432836-e10032774350?w=400&h=250&fit=crop&q=80"),
        ("Atta 20kg",           "આટો 20kg",         "आटा 20kg",         "SOFT_DONATION",    22,  "🌿", "20kg",  False, 50, "https://images.unsplash.com/photo-1588072432836-e10032774350?w=400&h=250&fit=crop&q=80"),
        ("Sunflower Oil 5L",    "સૂર્યમુખી તેલ 5L", "सूरजमुखी तेल 5L", "SOFT_DONATION",    8,   "🌻", "5L",    False, 60, "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&h=250&fit=crop&q=80"),
        ("Mustard Oil 5L",      "સરસવ તેલ 5L",      "सरसों का तेल 5L",  "SOFT_DONATION",    9,   "🌼", "5L",    False, 70, "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&h=250&fit=crop&q=80"),
        ("Sugar 5kg",           "ખાંડ 5kg",          "चीनी 5kg",         "SOFT_DONATION",    6,   "🍬", "5kg",   False, 80, "https://images.unsplash.com/photo-1559181567-c3190ca9959b?w=400&h=250&fit=crop&q=80"),
        ("Salt 2kg",            "મીઠું 2kg",         "नमक 2kg",           "SOFT_DONATION",    2,   "🧂", "2kg",   False, 90, "https://images.unsplash.com/photo-1596097635121-14b63b7a0c19?w=400&h=250&fit=crop&q=80"),
        ("Tea (Loose) 500g",    "ચા 500g",           "चाय 500g",          "SOFT_DONATION",    5,   "🍵", "500g",  False, 100,"https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=250&fit=crop&q=80"),
        ("Chana Daal 5kg",      "ચણા દાળ 5kg",       "चना दाल 5kg",       "SOFT_DONATION",    10,  "🫘", "5kg",   False, 110,"https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=400&h=250&fit=crop&q=80"),
        ("Toor Daal 5kg",       "તુવેર દાળ 5kg",     "तुअर दाल 5kg",      "SOFT_DONATION",    12,  "🫘", "5kg",   False, 120,"https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=400&h=250&fit=crop&q=80"),
        ("Masoor Daal 5kg",     "મસૂર દાળ 5kg",      "मसूर दाल 5kg",      "SOFT_DONATION",    9,   "🫘", "5kg",   False, 130,"https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=400&h=250&fit=crop&q=80"),
        # ── Project / Brick Donations (gift-aid eligible) ─────────────────────
        ("Red Brick",           "લાલ ઈંટ",           "लाल ईंट",           "PROJECT_DONATION",  1,  "🧱", "",      True,  10, "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80"),
        ("Bronze Brick",        "કાંસ્ય ઈંટ",        "कांस्य ईंट",        "PROJECT_DONATION",  5,  "🧱", "",      True,  20, "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80"),
        ("Silver Brick",        "ચાંદી ઈંટ",         "चांदी ईंट",         "PROJECT_DONATION",  11, "🧱", "",      True,  30, "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80"),
        ("Gold Brick",          "સોના ઈંટ",          "सोना ईंट",          "PROJECT_DONATION",  51, "🧱", "",      True,  40, "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80"),
        ("Platinum Brick",      "પ્લૈટિનમ ઈંટ",     "प्लेटिनम ईंट",     "PROJECT_DONATION",  101,"🧱", "",      True,  50, "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80"),
        ("Diamond Brick",       "હીરા ઈંટ",          "हीरा ईंट",          "PROJECT_DONATION",  251,"💎", "",      True,  60, "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80"),
        ("Shree Brick",         "શ્રી ઈંટ",          "श्री ईंट",          "PROJECT_DONATION",  501,"🕉️","",      True,  70, "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80"),
        # ── Shop / Puja Items (NOT gift-aid) ──────────────────────────────────
        ("Coconut (small)",     "નારિયળ (નાનો)",     "नारियल (छोटा)",     "SHOP",              1,  "🥥", "",      False, 10, "https://images.unsplash.com/photo-1580984969071-a8da5656c2fb?w=400&h=250&fit=crop&q=80"),
        ("Coconut (large)",     "નારિયળ (મોટો)",     "नारियल (बड़ा)",     "SHOP",              2,  "🥥", "",      False, 20, "https://images.unsplash.com/photo-1580984969071-a8da5656c2fb?w=400&h=250&fit=crop&q=80"),
        ("Incense Sticks Pack", "અગરબત્તી",          "अगरबत्ती",          "SHOP",              3,  "🕯️","pack",  False, 30, "https://images.unsplash.com/photo-1601315377985-f4e2a08bf4a0?w=400&h=250&fit=crop&q=80"),
        ("Camphor Tabs",        "કાફૂર",             "कपूर",              "SHOP",              2,  "⬜","",      False, 40, "https://images.unsplash.com/photo-1599940824399-b87987ceb72a?w=400&h=250&fit=crop&q=80"),
        ("Prasad Box (assorted)","પ્રસાદ",           "प्रसाद",            "SHOP",              5,  "🍮","",      False, 50, "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&h=250&fit=crop&q=80"),
        # ── Sponsorship ───────────────────────────────────────────────────────
        ("Festival Sponsor",    "ઉત્સવ પ્રાયોજક",   "उत्सव प्रायोजक",   "SPONSORSHIP",       51, "📖", "",      True,  10, "https://images.unsplash.com/photo-1582845512747-e42001c95638?w=400&h=250&fit=crop&q=80"),
        ("Langar Sponsor",      "લંગર પ્રાયોજક",    "लंगर प्रायोजक",    "SPONSORSHIP",       101,"🍲", "",      True,  20, "https://images.unsplash.com/photo-1582845512747-e42001c95638?w=400&h=250&fit=crop&q=80"),
        ("Aarti Sponsor",       "આરતી પ્રાયોજક",    "आरती प्रायोजक",    "SPONSORSHIP",       21, "🪔", "",      True,  30, "https://images.unsplash.com/photo-1582845512747-e42001c95638?w=400&h=250&fit=crop&q=80"),
    ]

    async with SessionLocal() as db:
        try:
            # Only seed if table is completely empty
            count_result = await db.execute(text("SELECT COUNT(*) FROM catalog_items WHERE deleted_at IS NULL"))
            count = count_result.scalar() or 0
            if count > 0:
                logger.info("catalog_seed_skipped", existing_items=count)
                return

            for (name, name_gu, name_hi, category, price, emoji, unit, gift_aid, sort_order, image_url) in SEED_ITEMS:
                await db.execute(text("""
                    INSERT INTO catalog_items
                        (id, name, name_gu, name_hi, name_te, description, category,
                         price, currency, unit, emoji, image_url,
                         gift_aid_eligible, is_active, scope, branch_id,
                         stock_qty, sort_order, metadata_json,
                         available_from, available_until, display_channel,
                         branch_stock, is_live, created_at, updated_at)
                    VALUES
                        (gen_random_uuid(), :name, :name_gu, :name_hi, '', '',
                         :category, :price, 'GBP', :unit, :emoji, :image_url,
                         :gift_aid, true, 'GLOBAL', '',
                         NULL, :sort_order, '{}',
                         NULL, NULL, 'both',
                         '{}', true, NOW(), NOW())
                """), {
                    "name": name, "name_gu": name_gu, "name_hi": name_hi,
                    "category": category, "price": price, "unit": unit,
                    "emoji": emoji, "image_url": image_url,
                    "gift_aid": gift_aid, "sort_order": sort_order,
                })
            await db.commit()
            logger.info("catalog_seed_done", items_inserted=len(SEED_ITEMS))
        except Exception as exc:
            logger.error("catalog_seed_failed", error=str(exc))


async def _seed_email_templates() -> None:
    """Upsert default email/WhatsApp receipt templates. Safe to re-run — uses ON CONFLICT DO NOTHING."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    donation_receipt_html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Donation Receipt — Shital Temple</title>
</head>
<body style="margin:0;padding:0;background:#F5F5F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F5;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- Header — logo + brand + charity number -->
  <tr>
    <td style="background:linear-gradient(135deg,#FF9933 0%,#E65100 100%);padding:36px 40px 28px;text-align:center;">
      {% if logo_url %}
        <img src="{{ logo_url }}" alt="Shital Temple"
             width="76" height="76"
             style="display:block;margin:0 auto 12px;border:0;outline:none;border-radius:14px;background:rgba(255,255,255,0.18);padding:8px;" />
      {% else %}
        <div style="font-size:42px;line-height:1;margin-bottom:10px;">🕉</div>
      {% endif %}
      <div style="color:#ffffff;font-size:28px;font-weight:900;letter-spacing:1px;">Shital Temple</div>
      <div style="color:rgba(255,255,255,0.92);font-size:15px;margin-top:6px;font-weight:500;">{{ branch_name }}</div>
      {% if charity_number %}
        <div style="color:rgba(255,255,255,0.85);font-size:11px;margin-top:8px;letter-spacing:0.6px;">
          Registered UK Charity No. <strong>{{ charity_number }}</strong>
        </div>
      {% endif %}
    </td>
  </tr>

  <!-- Confirmed bar -->
  <tr>
    <td style="background:#16A34A;padding:12px 40px;text-align:center;">
      <span style="color:#ffffff;font-weight:700;font-size:14px;letter-spacing:0.4px;">✓ Donation Confirmed — Thank You</span>
    </td>
  </tr>

  <!-- Greeting -->
  <tr>
    <td style="padding:36px 40px 8px;">
      {% if customer_name %}<p style="font-size:20px;font-weight:700;color:#111827;margin:0 0 12px 0;">Dear {{ customer_name }},</p>{% endif %}
      <p style="color:#4B5563;font-size:15px;line-height:1.7;margin:0;">
        Thank you for your generous donation to <strong style="color:#111827;">{{ branch_name }}</strong>.
        Every contribution directly supports our daily seva, prasad, festivals, and the
        community programmes that make this temple a home for our devotees.
      </p>
    </td>
  </tr>

  <!-- Order reference card -->
  <tr>
    <td style="padding:24px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#FFF7ED 0%,#FFEDD5 100%);border:1px solid #FDBA74;border-radius:12px;">
        <tr><td style="padding:18px 22px;">
          <div style="font-size:11px;color:#9A3412;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-weight:700;">Order Reference</div>
          <div style="font-size:22px;font-weight:900;color:#7C2D12;letter-spacing:3px;font-family:'SF Mono','Courier New',monospace;">{{ order_ref }}</div>
          <div style="font-size:12px;color:#9A3412;margin-top:6px;">
            {{ date }}{% if payment_provider %} · {{ payment_provider|upper }}{% endif %}{% if payment_ref %} · ref {{ payment_ref }}{% endif %}
          </div>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- Items table -->
  <tr>
    <td style="padding:24px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <th align="left"  style="font-size:11px;text-transform:uppercase;color:#9CA3AF;letter-spacing:1px;padding:0 0 10px 0;border-bottom:2px solid #F3F4F6;">Donation</th>
          <th align="center" style="font-size:11px;text-transform:uppercase;color:#9CA3AF;letter-spacing:1px;padding:0 0 10px 0;border-bottom:2px solid #F3F4F6;">Qty</th>
          <th align="right" style="font-size:11px;text-transform:uppercase;color:#9CA3AF;letter-spacing:1px;padding:0 0 10px 0;border-bottom:2px solid #F3F4F6;">Amount</th>
        </tr>
        {% for item in items %}
        <tr>
          <td             style="padding:14px 0;font-size:14px;color:#111827;border-bottom:1px solid #F9FAFB;">{{ item.name }}</td>
          <td align="center" style="padding:14px 0;font-size:14px;color:#6B7280;border-bottom:1px solid #F9FAFB;">{{ item.quantity }}</td>
          <td align="right" style="padding:14px 0;font-size:14px;color:#111827;font-weight:600;border-bottom:1px solid #F9FAFB;">£{{ "%.2f"|format((item.unitPrice or 0)|float * (item.quantity or 1)|int) }}</td>
        </tr>
        {% else %}
        <tr>
          <td colspan="3" style="padding:14px 0;font-size:14px;color:#4B5563;border-bottom:1px solid #F9FAFB;">Temple Donation</td>
        </tr>
        {% endfor %}
        <tr>
          <td colspan="2" style="padding:18px 0 0;font-size:16px;font-weight:900;color:#111827;">Total Donated</td>
          <td align="right" style="padding:18px 0 0;font-size:24px;font-weight:900;color:#E65100;">£{{ "%.2f"|format(total|float) }}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Impact strip -->
  <tr>
    <td style="padding:32px 40px 0;">
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#9CA3AF;font-weight:700;margin:0 0 14px 0;text-align:center;">Your donation supports</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="25%" align="center" style="padding:6px 4px;"><div style="font-size:24px;line-height:1;">🪔</div><div style="font-size:11px;color:#6B7280;margin-top:6px;font-weight:600;">Daily Aarti</div></td>
          <td width="25%" align="center" style="padding:6px 4px;"><div style="font-size:24px;line-height:1;">🍛</div><div style="font-size:11px;color:#6B7280;margin-top:6px;font-weight:600;">Prasad</div></td>
          <td width="25%" align="center" style="padding:6px 4px;"><div style="font-size:24px;line-height:1;">🛕</div><div style="font-size:11px;color:#6B7280;margin-top:6px;font-weight:600;">Maintenance</div></td>
          <td width="25%" align="center" style="padding:6px 4px;"><div style="font-size:24px;line-height:1;">📚</div><div style="font-size:11px;color:#6B7280;margin-top:6px;font-weight:600;">Education</div></td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Gift Aid CTA -->
  <tr>
    <td style="padding:24px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:12px;">
        <tr><td style="padding:18px 22px;">
          <div style="font-size:14px;font-weight:800;color:#15803D;margin-bottom:6px;">🎁 Boost this donation by 25% with Gift Aid</div>
          <div style="font-size:13px;color:#166534;line-height:1.65;">
            If you're a UK taxpayer, we can claim an extra <strong>25p for every £1</strong> you give —
            at no cost to you. Add Gift Aid by speaking to a temple administrator or replying to this
            email with your full name, address and postcode.
          </div>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- Monthly supporter CTA — prominent -->
  <tr>
    <td style="padding:18px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#FFF7ED 0%,#FFEDD5 100%);border:1px dashed #FDBA74;border-radius:12px;">
        <tr><td style="padding:24px 22px;text-align:center;">
          <div style="font-size:16px;font-weight:800;color:#9A3412;margin-bottom:6px;">🪔 Become a monthly supporter</div>
          <div style="font-size:13px;color:#9A3412;line-height:1.65;margin-bottom:14px;">
            Recurring giving is the steadiest way to keep daily seva running.<br>
            Even <strong>£5/month</strong> sponsors morning aarti for the whole community.
          </div>
          <a href="{{ monthly_url }}" style="display:inline-block;background:#E65100;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:0.3px;">Set up monthly giving →</a>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- Sign-off -->
  <tr>
    <td style="padding:32px 40px 8px;text-align:center;">
      <p style="color:#E65100;font-size:22px;font-weight:900;margin:0;">🙏 Jay Shri Krishna</p>
      <p style="color:#9CA3AF;font-size:12px;margin:8px 0 0 0;">Please retain this email as confirmation. This is not a Gift Aid declaration.</p>
    </td>
  </tr>

  <!-- Footer — links + charity info -->
  <tr>
    <td style="background:#FAFAFA;border-top:1px solid #F3F4F6;padding:28px 40px;text-align:center;">
      <p style="margin:0 0 14px 0;">
        <a href="{{ website_url }}"        style="color:#E65100;text-decoration:none;font-size:12px;font-weight:700;margin:0 10px;">🌐 Website</a>
        <span style="color:#D1D5DB;">·</span>
        <a href="{{ account_url }}"        style="color:#E65100;text-decoration:none;font-size:12px;font-weight:700;margin:0 10px;">👤 My Account</a>
        <span style="color:#D1D5DB;">·</span>
        <a href="{{ monthly_url }}"        style="color:#E65100;text-decoration:none;font-size:12px;font-weight:700;margin:0 10px;">🔄 Monthly Giving</a>
        <span style="color:#D1D5DB;">·</span>
        <a href="mailto:info@shital.org.uk" style="color:#E65100;text-decoration:none;font-size:12px;font-weight:700;margin:0 10px;">✉ Contact</a>
      </p>
      <p style="color:#6B7280;font-size:12px;font-weight:700;margin:0 0 4px 0;">
        {{ branch_name }}{% if charity_number %} · Registered UK Charity No. {{ charity_number }}{% endif %}
      </p>
      <p style="color:#9CA3AF;font-size:11px;margin:0;line-height:1.6;">
        You received this email because you donated at our kiosk terminal.<br>
        This receipt is for your records only.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>"""

    donation_receipt_text = """Shital Temple — {{ branch_name }}
Receipt Confirmation

{% if customer_name %}Dear {{ customer_name }},{% endif %}

Thank you for your generous donation!

Order Reference: {{ order_ref }}
Date: {{ date }}

Donations:
{% for item in items %}- {{ item.name }} x{{ item.quantity }} = £{{ "%.2f"|format((item.unitPrice or 0)|float * (item.quantity or 1)|int) }}
{% else %}- Temple Donation
{% endfor %}
Total: £{{ "%.2f"|format(total|float) }}

🙏 Jay Shri Krishna

{{ branch_name }}
Registered UK Charity

This receipt is for your records only."""

    donation_receipt_subject = "Your Donation Receipt — {{ branch_name }} ({{ order_ref }})"

    whatsapp_receipt_text = """🕉 *Shital Temple Receipt*
*{{ branch_name }}*

✅ Thank you{% if customer_name %}, {{ customer_name }}{% endif %}!

📋 *Order:* {{ order_ref }}
📅 *Date:* {{ date }}

{% for item in items %}• {{ item.name }} ×{{ item.quantity }} — £{{ "%.2f"|format((item.unitPrice or 0)|float * (item.quantity or 1)|int) }}
{% else %}• Temple Donation
{% endfor %}
💰 *Total Donated: £{{ "%.2f"|format(total|float) }}*

🎁 *Gift Aid:* If you are a UK taxpayer, we can claim an extra 25p for every £1 you donate at no cost to you. Ask a temple administrator to add Gift Aid.

🙏 *Jay Shri Krishna*
_{{ branch_name }} — Registered UK Charity_"""

    templates = [
        {
            "key": "donation_receipt",
            "name": "Donation Receipt — Email",
            "subject": donation_receipt_subject,
            "html_body": donation_receipt_html,
            "text_body": donation_receipt_text,
            "variables": '["order_ref","customer_name","total","items","branch_name","date"]',
        },
        {
            "key": "whatsapp_receipt",
            "name": "Donation Receipt — WhatsApp",
            "subject": "",
            "html_body": "",
            "text_body": whatsapp_receipt_text,
            "variables": '["order_ref","customer_name","total","items","branch_name","date"]',
        },
        {
            "key": "kiosk_print_receipt",
            "name": "Kiosk Thermal Print Receipt",
            "subject": "",
            "html_body": (
                '<div style="font-family:\'Courier New\',monospace;font-size:11pt;width:80mm;padding:6mm;background:white;color:black;">'
                '  <div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:8px;margin-bottom:8px;">'
                '    <div style="font-size:16px;font-weight:900;letter-spacing:1px;">🕉 Shital Temple</div>'
                '    <div style="font-size:11px;font-weight:700;margin-top:2px;">Branch: {{ branch_name }}</div>'
                '    {% if donor_name %}<div style="font-size:11px;font-weight:700;">Name: {{ donor_name }}</div>{% endif %}'
                '    <div style="font-size:9px;margin-top:4px;color:#555;">{{ date }}</div>'
                '  </div>'
                '  <div style="text-align:center;margin-bottom:8px;">'
                '    <div style="font-size:9px;color:#555;">ORDER REFERENCE</div>'
                '    <div style="font-size:13px;font-weight:900;letter-spacing:2px;">{{ order_ref }}</div>'
                '  </div>'
                '  {{ items_html | safe }}'
                '  <div style="border-top:2px solid #000;padding-top:5px;margin-bottom:6px;">'
                '    <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:900;">'
                '      <span>TOTAL</span><span>£{{ total }}</span>'
                '    </div>'
                '    <div style="font-size:9px;text-align:right;color:#555;">{{ payment_method }}</div>'
                '  </div>'
                '  {{ gift_aid_block | safe }}'
                '  <div style="border-top:1px dashed #000;padding-top:8px;text-align:center;font-size:9px;color:#444;">'
                '    <div style="font-weight:900;margin-bottom:2px;">Thank you for your generous donation 🙏</div>'
                '    <div>Jay Shri Krishna</div>'
                '    <div style="margin-top:4px;color:#777;">This receipt is your donation record.</div>'
                '    <div style="margin-top:4px;">kiosk.shital.org.uk</div>'
                '  </div>'
                '  <div style="height:{{ cut_margin_px }}px;">&nbsp;</div>'
                '</div>'
            ),
            "text_body": "",
            "variables": '["branch_name","donor_name","order_ref","date","items_html","total","payment_method","gift_aid_block","cut_margin_px"]',
        },
        # ── Recurring giving confirmation ───────────────────────────────────
        # Sent to the donor immediately after they approve their PayPal
        # subscription. Admin-editable like every other template — wording
        # tweaks via Admin → Settings → Email Templates → recurring_giving_confirmation.
        {
            "key": "recurring_giving_confirmation",
            "name": "Monthly Giving — Subscription Confirmation",
            "subject": "Thank you for your monthly support of SHITAL",
            "html_body": (
                '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:auto;color:#222">'
                '  <div style="text-align:center;margin-bottom:24px">'
                '    <img src="{{ logo_url }}" alt="SHITAL" style="width:64px;height:64px;border-radius:12px"/>'
                '    <h1 style="font-size:20px;margin:12px 0 4px;color:#9b1c1c">🙏 Thank you, {{ donor_first_name }}!</h1>'
                '    <p style="font-size:13px;color:#666;margin:0">Your monthly support is now set up</p>'
                '  </div>'
                '  <div style="background:#fff8e8;border:1px solid #f0d99a;border-radius:12px;padding:16px;margin:20px 0">'
                '    <p style="font-size:13px;color:#444;margin:0 0 8px"><strong>Amount:</strong> £{{ amount }} per {{ frequency }}</p>'
                '    <p style="font-size:13px;color:#444;margin:0 0 8px"><strong>Tier:</strong> {{ tier_label }}</p>'
                '    <p style="font-size:13px;color:#444;margin:0"><strong>Reference:</strong> {{ subscription_id }}</p>'
                '    {% if gift_aid_declared %}<p style="font-size:13px;color:#22863a;margin:8px 0 0">'
                '      ✓ Gift Aid declared — SHITAL will reclaim 25p extra for every £1.</p>{% endif %}'
                '  </div>'
                '  <p style="font-size:14px;line-height:1.6">'
                '    Your generosity keeps the lamps lit, the prasad flowing, and the temple thriving '
                '    for the community. Thank you for choosing to support us every month.'
                '  </p>'
                '  <p style="font-size:13px;color:#666">'
                '    Manage or cancel anytime through your PayPal account: '
                '    <a href="https://www.paypal.com/myaccount/autopay/">paypal.com/myaccount/autopay</a>'
                '  </p>'
                '  <p style="font-size:12px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:12px">'
                '    SHITAL — Shri Shirdi Saibaba Temple Association<br>'
                '    Registered UK Charity No. {{ charity_number }}<br>'
                '    <a href="https://shital.org.uk">shital.org.uk</a>'
                '  </p>'
                '</div>'
            ),
            "text_body": (
                "🙏 Thank you, {{ donor_first_name }}!\n\n"
                "Your monthly support of £{{ amount }} per {{ frequency }} ({{ tier_label }}) "
                "is now set up.\n\n"
                "Reference: {{ subscription_id }}\n"
                "{% if gift_aid_declared %}✓ Gift Aid declared — SHITAL will reclaim 25p extra "
                "for every £1.\n{% endif %}\n"
                "Your generosity keeps the lamps lit, the prasad flowing, and the temple "
                "thriving for the community. Thank you for choosing to support us every month.\n\n"
                "You can manage or cancel anytime through your PayPal account:\n"
                "https://www.paypal.com/myaccount/autopay/\n\n"
                "— SHITAL\n"
                "Shri Shirdi Saibaba Temple Association\n"
                "Registered UK Charity No. {{ charity_number }}"
            ),
            "variables": '["donor_first_name","amount","frequency","tier_label","subscription_id","gift_aid_declared","logo_url","charity_number"]',
        },
        # ── Volunteer reference request ─────────────────────────────────────
        # Sent to ref1_email and ref2_email when the trustee clicks
        # "Send reference requests" on the volunteer detail panel. The
        # token in {{ response_url }} authenticates the referee for the
        # public response form (one-time per token, valid 30 days).
        {
            "key": "volunteer_reference_request",
            "name": "Volunteer Reference Request",
            "subject": "Reference request — {{ applicant_name }} (SHITAL Volunteer)",
            "html_body": (
                '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:auto;color:#222">'
                '  <p>Dear {{ referee_name }},</p>'
                '  <p><strong>{{ applicant_name }}</strong> has applied to volunteer with '
                '     <a href="https://shital.org.uk">SHITAL — Shri Shirdi Saibaba Temple Association</a> '
                '     (Registered UK Charity No. {{ charity_number }}) and given your name as a character referee.</p>'
                '  <p>Please could you take 2&ndash;3 minutes to complete a short reference?'
                '     The form asks how you know the applicant, how long you have known them, '
                '     and a few questions about their suitability for volunteering with our community.</p>'
                '  <p style="margin:24px 0">'
                '    <a href="{{ response_url }}" '
                '       style="display:inline-block;background:linear-gradient(135deg,#D4AF37,#C5A028);'
                '              color:#3B0000;font-weight:700;text-decoration:none;'
                '              padding:12px 24px;border-radius:12px">'
                '      Provide Reference'
                '    </a>'
                '  </p>'
                '  <p style="font-size:12px;color:#666;word-break:break-all">'
                '    Or paste this URL into your browser:<br>{{ response_url }}'
                '  </p>'
                '  <p style="font-size:13px">Your response is confidential — only SHITAL trustees will see it. '
                '     The link is valid for 30 days. If you would rather not provide a reference, '
                '     you can reply to this email and we will remove your name from the application.</p>'
                '  <p style="font-size:12px;color:#999;margin-top:24px">'
                '    With thanks,<br>SHITAL Volunteer Coordinator<br>'
                '    Registered UK Charity No. {{ charity_number }}'
                '  </p>'
                '</div>'
            ),
            "text_body": (
                "Dear {{ referee_name }},\n\n"
                "{{ applicant_name }} has applied to volunteer with SHITAL "
                "(Shri Shirdi Saibaba Temple Association, Registered UK Charity "
                "No. {{ charity_number }}) and given your name as a character "
                "referee.\n\n"
                "Please could you take 2-3 minutes to complete a short reference "
                "at the link below. The form asks how you know the applicant, "
                "how long you have known them, and a few questions about their "
                "suitability for volunteering with our community.\n\n"
                "{{ response_url }}\n\n"
                "Your response is confidential — only SHITAL trustees will see "
                "it. The link is valid for 30 days. If you would rather not "
                "provide a reference, reply to this email and we will remove "
                "your name from the application.\n\n"
                "With thanks,\n"
                "SHITAL Volunteer Coordinator"
            ),
            "variables": '["referee_name","applicant_name","response_url","charity_number"]',
        },
        {
            # Sent when a trustee clicks "Email undertaking" on a key holding.
            # Variables: {{ holder_name }}, {{ key_name }}, {{ key_type_label }},
            #            {{ set_number }}, {{ sign_url }}, {{ custom_message }}.
            # Server falls back to a hard-coded body when this template is
            # missing or its bodies are blank — but editing it from Email
            # Templates admin lets trustees set the right tone without a deploy.
            "key": "key_undertaking",
            "name": "Key Undertaking — Sign Online",
            "subject": "Please sign your key undertaking — {{ key_name }}",
            "html_body": (
                "<p>Dear {{ holder_name }},</p>"
                "<p>You have been issued a <b>{{ key_type_label }}</b> "
                "(<b>{{ key_name }}</b>, set #{{ set_number }}) at Shital — "
                "Shirdi Sai Temple.</p>"
                "<p>Please sign the undertaking for this item using the secure link below. "
                "It only takes a minute:</p>"
                "<p style='text-align:center;margin:24px 0;'>"
                "<a href='{{ sign_url }}' style='background:#FF6B00;color:#fff;"
                "text-decoration:none;padding:12px 28px;border-radius:8px;"
                "font-weight:700;display:inline-block;'>Sign Undertaking →</a></p>"
                "{{ custom_message_html }}"
                "<p style='color:#888;font-size:12px;margin-top:32px;'>"
                "If you did not expect this email, please reply to let us know.<br>"
                "Thank you for your service to the temple.<br>"
                "— Trustees, Shital</p>"
            ),
            "text_body": (
                "Dear {{ holder_name }},\n\n"
                "You have been issued a {{ key_type_label }} "
                "({{ key_name }}, set #{{ set_number }}) at Shital — "
                "Shirdi Sai Temple.\n\n"
                "Please sign the undertaking for this item using the secure "
                "link below. It only takes a minute:\n\n"
                "    {{ sign_url }}\n\n"
                "{{ custom_message }}\n\n"
                "If you did not expect this email, please reply to let us know.\n\n"
                "Thank you for your service to the temple.\n"
                "Trustees, Shital."
            ),
            "variables": '["holder_name","key_name","key_type_label","set_number","sign_url","custom_message","custom_message_html"]',
        },
    ]

    async with SessionLocal() as db:
        for t in templates:
            try:
                # On conflict we keep any admin edits to subject/body but
                # ALWAYS re-activate. Without this an accidentally-disabled
                # template (or an earlier failed seed that left the row in
                # a half-baked state) silently breaks features that depend
                # on it (eg. volunteer_reference_request bug from PR #N+1).
                # NOTE: Use CAST(... AS JSONB), NOT `:variables::jsonb`.
                # asyncpg's `::` cast collides with SQLAlchemy's `:name`
                # param syntax — SQLAlchemy fails to substitute `:variables`
                # and asyncpg sees the literal token, raising
                # PostgresSyntaxError. That's why every boot logged
                # email_template_seed_failed once per template.
                await db.execute(text("""
                    INSERT INTO email_templates (template_key, name, subject, html_body, text_body, variables, is_active)
                    VALUES (:key, :name, :subject, :html_body, :text_body, CAST(:variables AS JSONB), true)
                    ON CONFLICT (template_key) DO UPDATE
                        SET is_active  = true,
                            -- Heal any rows that ended up with empty bodies
                            -- (eg. seed crashed mid-row on first deploy).
                            subject    = CASE WHEN email_templates.subject   = '' THEN EXCLUDED.subject   ELSE email_templates.subject   END,
                            html_body  = CASE WHEN email_templates.html_body = '' THEN EXCLUDED.html_body ELSE email_templates.html_body END,
                            text_body  = CASE WHEN email_templates.text_body = '' THEN EXCLUDED.text_body ELSE email_templates.text_body END,
                            updated_at = NOW()
                """), t)
            except Exception as exc:
                # Don't swallow silently — these are critical for volunteer +
                # donation flows. Log loud, keep going so one bad template
                # doesn't block the others.
                logger.error("email_template_seed_failed", template_key=t.get("key"), error=str(exc))
        await db.commit()
    logger.info("email_templates_seeded")


async def _seed_document_categories() -> None:
    """Seed the canonical charity document categories. Admins can later
    add/edit through the API, but these are always present after boot.

    Each category gets a folder_name that the DMS uses to lay files out
    on disk as MEDIA_DIR/documents/{folder_name}/{doc_id}.<ext> — so the
    on-disk structure mirrors the logical structure and back-end staff
    can navigate the file tree directly when needed."""
    cats = [
        # code, label, description, icon, folder, review_months, confidential, sort
        ("GOVERNANCE",         "Governance & Trustees", "Trustee resolutions, board minutes, AGM packs, Charity Commission filings.", "🏛️", "governance",        0,  False, 10),
        ("COMPLIANCE",         "Compliance & Safety",   "Safeguarding, GDPR, fire safety, health & safety, risk assessments, DBS checks.", "✅", "compliance",        12, True,  20),
        ("HR",                 "HR & Employment",       "Employment contracts, job descriptions, performance reviews, disciplinary records.", "👥", "hr",                0,  True,  30),
        ("PAYROLL",            "Payroll",               "Payslips, P60s, NI records, pension contributions.",                                    "💷", "payroll",           0,  True,  31),
        ("FINANCE",            "Finance",               "Annual accounts, audit reports, management accounts, ledgers, bank statements.",     "📊", "finance",          12, True,  40),
        ("INSURANCE",          "Insurance",             "Public liability, employers' liability, buildings, contents — policies + claims.",   "🛡️", "insurance",         12, False, 50),
        ("POLICIES",           "Policies",              "Written organisational policies — data protection, child safety, conflict of interest.","📜", "policies",          24, False, 60),
        ("CONTRACTS",          "Contracts & Agreements","Supplier contracts, MOUs, lease agreements, professional service agreements.",      "📝", "contracts",         12, False, 70),
        ("CERTIFICATES",       "Certificates & Licences","Charity registration, VAT, fundraising licences, gift aid claims, HMRC.",            "🏅", "certificates",      24, False, 80),
        ("KEY_UNDERTAKINGS",   "Key Undertakings",      "Signed undertakings from key holders. Auto-generated when a holder e-signs.",        "🔑", "key-undertakings",  0,  False, 90),
        ("VOLUNTEER_AGREEMENTS","Volunteer Agreements", "Signed volunteer agreements, role descriptions, induction records.",                  "🙋", "volunteer-agreements",0, True,  100),
        ("DONOR_CORRESPONDENCE","Donor Correspondence", "Major donor thank-you letters, pledge agreements, grant correspondence.",            "💌", "donors",            0,  True,  110),
        ("LEGAL",              "Legal",                 "Legal advice, opinions, court documents, lawyer correspondence.",                    "⚖️", "legal",             0,  True,  120),
        ("BUILDING",           "Building & Property",   "Title deeds, planning permission, lease documents, surveys, EPC.",                   "🏗️", "building",          0,  False, 130),
        ("PROJECTS",           "Project Records",       "Project charters, closure reports, lessons-learned — official records only.",        "📁", "projects",          0,  False, 140),
        ("TRAINING",           "Training & Development","Training records, attendance certificates, CPD logs.",                               "🎓", "training",          24, False, 150),
        ("IT",                 "IT & Systems",          "IT policies, system architecture, recovery procedures, backup logs.",               "💻", "it",                12, False, 160),
        ("EVENTS",             "Events & Festivals",    "Event plans, run sheets, festival programs, post-event reports.",                   "🎉", "events",            0,  False, 170),
        ("MEDIA",              "Media & Communications","Press releases, photos, video releases, marketing assets, brand guidelines.",       "📸", "media",             0,  False, 180),
        ("OTHER",              "Other",                 "Documents that don't fit any other category.",                                       "📄", "other",             0,  False, 999),
    ]
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        for c in cats:
            try:
                await db.execute(text("""
                    INSERT INTO document_categories
                        (code, label, description, icon, folder_name,
                         default_review_months, is_confidential_default,
                         sort_order, is_active)
                    VALUES (:code, :lab, :desc, :icon, :folder,
                            :rev, :conf, :sort, true)
                    ON CONFLICT (code) DO UPDATE SET
                        label                  = EXCLUDED.label,
                        description            = EXCLUDED.description,
                        icon                   = EXCLUDED.icon,
                        folder_name            = EXCLUDED.folder_name,
                        default_review_months  = EXCLUDED.default_review_months,
                        is_confidential_default= EXCLUDED.is_confidential_default,
                        sort_order             = EXCLUDED.sort_order,
                        is_active              = true,
                        updated_at             = NOW()
                """), {"code": c[0], "lab": c[1], "desc": c[2], "icon": c[3],
                       "folder": c[4], "rev": c[5], "conf": c[6], "sort": c[7]})
            except Exception as exc:  # noqa: BLE001
                logger.error("doc_category_seed_failed", code=c[0], error=str(exc))
        await db.commit()
    logger.info("document_categories_seeded")


async def _seed_release_notes() -> None:
    """Seed `release_notes` with the canonical list of features shipped per PR.

    Runs every backend startup. ON CONFLICT (pr_number) DO NOTHING so existing
    rows are preserved — admin can edit the title / summary / tags via the
    settings UI without the seed clobbering them on next deploy.

    To add a new release note: append a row to RELEASE_NOTES below and the
    next deploy will pick it up automatically. Trustees see them in
    Admin → Settings → System → Release Notes.
    """
    import json

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    # (pr_number, title, summary, area, tags, released_at_iso)
    # Sorted oldest → newest so the seeded `created_at` order matches reality.
    RELEASE_NOTES: list[dict[str, Any]] = [  # noqa: N806
        {"pr": 40, "title": "Bank statement CSV import",
         "summary": "Trustees can upload PayPal/Stripe/SumUp/NatWest CSVs to a "
                    "bank account; auto-detect format, dedupe by file hash + "
                    "(date,amount,reference), preview before commit, hard-undo.",
         "area": "finance", "tags": ["bank-accounts", "csv", "import"],
         "released_at": "2026-05-08T14:46:00Z"},
        {"pr": 41, "title": "Magic-link trustee voting",
         "summary": "Chair publishes a resolution → server emails each trustee "
                    "a unique link → trustee taps it on their phone, picks "
                    "FOR/AGAINST/ABSTAIN, enters PIN to confirm. CC25-aligned "
                    "audit trail; no login or app required.",
         "area": "board", "tags": ["voting", "magic-link", "pin"],
         "released_at": "2026-05-08T20:52:00Z"},
        {"pr": 42, "title": "PayPal Guest Card pre-fill (kiosk + service)",
         "summary": "Donor name/email/phone/address now pre-fill on the PayPal "
                    "Guest Card form across kiosk monthly giving + service "
                    "checkout. landing_page=BILLING + payer block + en-GB locale.",
         "area": "payments", "tags": ["paypal", "kiosk", "monthly-giving"],
         "released_at": "2026-05-08T20:51:00Z"},
        {"pr": 43, "title": "Volunteer registration wizard",
         "summary": "50-field volunteer form is now a 6-step wizard with "
                    "progress bar, per-step validation, localStorage auto-save, "
                    "MS auth fix and casting-vote-by-email fallback.",
         "area": "volunteers", "tags": ["wizard", "auto-save", "msauth"],
         "released_at": "2026-05-08T15:50:00Z"},
        {"pr": 44, "title": "Admin login: MS 365 troubleshooting",
         "summary": "Collapsible help on the login page, nginx rewrite from "
                    "/auth-callback → /admin/auth-callback/, MS_REDIRECT_URI "
                    "exposed in Admin → API Keys.",
         "area": "admin", "tags": ["auth", "ms365", "nginx"],
         "released_at": "2026-05-08T16:35:00Z"},
        {"pr": 45, "title": "SHITAL logo on service portal",
         "summary": "Replaced the temple emoji with the SHITAL logo image in "
                    "the public service portal header and the branch-picker "
                    "welcome card. Falls back to the emoji if the CDN is down.",
         "area": "service", "tags": ["branding", "logo"],
         "released_at": "2026-05-08T20:50:00Z"},
        {"pr": 46, "title": "MS_REDIRECT_URI compose defaults",
         "summary": "Both dev and prod compose files default to "
                    "/admin/auth-callback/ with trailing slash so a fresh "
                    "deploy works without touching the secrets store.",
         "area": "infra", "tags": ["compose", "auth", "msauth"],
         "released_at": "2026-05-08T20:50:00Z"},
        {"pr": 47, "title": "PayPal card-fields layout fix",
         "summary": "Hosted card iframe was 20px tall (clipped digits) and the "
                    "Pay button overlapped the expiry/CVV row. Now 48px with "
                    "horizontal padding only.",
         "area": "service", "tags": ["paypal", "checkout", "css"],
         "released_at": "2026-05-08T20:50:00Z"},
        {"pr": 48, "title": "Trustee role expansion + short volunteer ref",
         "summary": "10 trustee roles in 3 tiers (Main Board / LMC / "
                    "Non-Officer). Volunteer reference number shortened from "
                    "SHITAL-VOL-YYYYMMDD-NNNNNN (24 chars) to VOL-NNNNNN.",
         "area": "board", "tags": ["roles", "lmc", "ceo"],
         "released_at": "2026-05-08T20:51:00Z"},
        {"pr": 49, "title": "Quick Donation: no-reader admin redirect",
         "summary": "Devices without a card reader configured (stripe / sumup "
                    "/ clover all empty) now redirect to admin login on mount, "
                    "instead of letting staff hit a dead-end error after "
                    "tapping an amount.",
         "area": "kiosk", "tags": ["quick-donation", "ux"],
         "released_at": "2026-05-08T20:53:00Z"},
        {"pr": 50, "title": "Volunteer reference-request workflow + DBS scaffold",
         "summary": "Trustees click Send Reference Requests on the volunteer "
                    "detail panel; ref1/ref2 each get a magic-link email to a "
                    "confidential safeguarding-reference form on the service "
                    "portal. Plus DBS status fields and a generic attachments "
                    "table for future file uploads.",
         "area": "volunteers", "tags": ["references", "dbs", "magic-link"],
         "released_at": "2026-05-09T07:33:00Z"},
        {"pr": 51, "title": "Admin build hotfix — magic-link vote route",
         "summary": "Magic-link vote page was a Next.js dynamic [token] route, "
                    "incompatible with output:'export'. Refactored to read the "
                    "token from the URL hash. Was blocking every main build "
                    "for ~12h.",
         "area": "infra", "tags": ["admin", "build", "nextjs"],
         "released_at": "2026-05-09T07:43:00Z"},
        {"pr": 52, "title": "Startup hotfix — attachments table + patch timeout",
         "summary": "Renamed the new generic file table from documents → "
                    "attachments to avoid colliding with the existing "
                    "documents table. Added per-statement 30s timeout to "
                    "_patch_schema() with progress logging.",
         "area": "infra", "tags": ["schema", "startup", "robustness"],
         "released_at": "2026-05-09T08:04:00Z"},
    ]

    async with SessionLocal() as db:
        for n in RELEASE_NOTES:
            try:
                await db.execute(text("""
                    INSERT INTO release_notes
                        (pr_number, title, summary, area, tags, released_at)
                    VALUES
                        (:pr, :title, :summary, :area, CAST(:tags AS jsonb), :released_at)
                    ON CONFLICT (pr_number) DO NOTHING
                """), {
                    "pr": n["pr"], "title": n["title"], "summary": n["summary"],
                    "area": n["area"], "tags": json.dumps(n["tags"]),
                    "released_at": n["released_at"],
                })
            except Exception:
                pass
        await db.commit()
    logger.info("release_notes_seeded", total=len(RELEASE_NOTES))


app = FastAPI(
    title="Shital Temple ERP — Digital Brain API",
    description=(
        "Full ERP for Shital Hindu Temple network (UK Charity). "
        "Powered by Digital DNA micro-capabilities, Digital Space governance, "
        "and Claude AI Digital Brain orchestration."
    ),
    version="1.0.7",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ─── Domain exception → HTTP status mapping ────────────────────────────────────


@app.exception_handler(ForbiddenError)
async def _forbidden(request: Request, exc: ForbiddenError) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": exc.message, "code": exc.code})


@app.exception_handler(UnauthorizedError)
async def _unauthorized(request: Request, exc: UnauthorizedError) -> JSONResponse:
    return JSONResponse(status_code=401, content={"detail": exc.message, "code": exc.code})


@app.exception_handler(NotFoundError)
async def _not_found(request: Request, exc: NotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": exc.message, "code": exc.code})


@app.exception_handler(ConflictError)
async def _conflict(request: Request, exc: ConflictError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": exc.message, "code": exc.code})


@app.exception_handler(ShitalValidationError)
async def _validation(request: Request, exc: ShitalValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": exc.message, "code": exc.code})


# ─── Mount all routers (resilient — import errors logged but don't crash app) ──
def _mount(module: str, attr: str, prefix: str = "/api/v1") -> None:
    try:
        import importlib
        mod = importlib.import_module(module)
        app.include_router(getattr(mod, attr), prefix=prefix)
        logger.info("router_mounted", module=module)
    except Exception as exc:
        logger.error("router_mount_failed", module=module, error=str(exc))

_mount("shital.api.routers.auth",             "router")
_mount("shital.api.routers.auth_azure",       "router")
_mount("shital.api.routers.donor_auth",       "router")
_mount("shital.api.routers.kiosk",            "router")
_mount("shital.api.routers.terminal_devices", "router")
_mount("shital.api.routers.users",            "router")
_mount("shital.api.routers.items",            "router")
_mount("shital.api.routers.giftaid",          "router")
_mount("shital.api.routers.brain",            "router")
_mount("shital.api.routers.finance",          "router")
_mount("shital.api.routers.hr",               "router")
_mount("shital.api.routers.volunteer_references", "router")
_mount("shital.api.routers.reimbursements",   "router")
_mount("shital.api.routers.nominal_codes",    "router")
_mount("shital.api.routers.purchasing",       "router")
_mount("shital.api.routers.gl",               "router")
_mount("shital.api.routers.budgets",          "router")
_mount("shital.api.routers.project_costing",   "router")
_mount("shital.api.routers.project_management","router")
_mount("shital.api.routers.notifications",     "router")
_mount("shital.api.routers.reports",          "router")
_mount("shital.api.routers.payroll",          "router")
_mount("shital.api.routers.hr_alerts",        "router")
_mount("shital.api.routers.admin_kiosk",      "router")
_mount("shital.api.routers.email_templates",  "router")
_mount("shital.api.routers.functions",        "router")
_mount("shital.api.routers.assets",           "router")
_mount("shital.api.routers.key_register",     "router")
# Wire the public e-signature endpoints (/public/key-undertaking/{token})
# alongside the prefixed router so the holder's signing link works without
# auth or branch scoping.
try:
    from shital.api.routers.key_register import register_public_router as _krpub
    _krpub(app)
except Exception as _exc:  # noqa: BLE001
    logger.error("key_register_public_mount_failed", error=str(_exc))
_mount("shital.api.routers.bookings_router",  "router")
_mount("shital.api.routers.documents_router", "router")
_mount("shital.api.routers.api_keys",         "router")
_mount("shital.api.routers.api_keys",         "settings_router")
_mount("shital.api.routers.screen",           "router")
_mount("shital.api.routers.branches",         "router")
_mount("shital.api.routers.projects",             "router")
_mount("shital.api.routers.recurring_payments",   "router")
_mount("shital.api.routers.hosting",              "router")
_mount("shital.api.routers.broadcast",            "router")
_mount("shital.api.routers.system_alerts",        "router")
_mount("shital.api.routers.kiosk_devices",        "router")
_mount("shital.api.routers.paypal",               "router")
_mount("shital.api.routers.recurring_giving",     "router")
_mount("shital.api.routers.stripe_giving",        "router")
_mount("shital.api.routers.sava_volunteers",      "router")
_mount("shital.api.routers.bank_accounts",         "router")
_mount("shital.api.routers.bank_imports",          "router")
_mount("shital.api.routers.board",                 "router")
_mount("shital.api.routers.board_voting",          "router")
_mount("shital.api.routers.volunteers",            "router")
_mount("shital.api.routers.form_config",           "router")
_mount("shital.api.routers.contacts",             "router")
_mount("shital.api.routers.accounts",             "router")
_mount("shital.api.routers.app_permissions",      "router")
_mount("shital.api.routers.media_library",        "router")
_mount("shital.api.routers.menus",                 "router")
_mount("shital.api.routers.system",                "router")
_mount("shital.api.routers.release_notes",         "router")
_mount("shital.api.routers.mail_agent",            "router")


@app.get("/health", tags=["system"])
@app.get("/api/v1/ping", tags=["system"])
async def health() -> dict[str, Any]:
    # Liveness: always 200 once the process is up, so the deploy health-gate
    # passes immediately instead of waiting on the background schema patch.
    # `schema_ready` lets operators see whether first-boot migrations have
    # finished (false during the brief patch window right after a promote).
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": "1.0.7",
        "environment": settings.APP_ENV,
        "schema_ready": bool(getattr(app.state, "schema_ready", True)),
    }


@app.post("/api/v1/admin/patch-schema", tags=["admin"])
async def run_schema_patch() -> dict[str, Any]:
    """Run idempotent schema patcher on demand (safe to call multiple times)."""
    await _patch_schema()
    return {"patched": True}


@app.post("/api/v1/admin/seed-catalog", tags=["admin"])
async def run_catalog_seed() -> dict[str, Any]:
    """Force re-seed catalog_items (only inserts if table is empty). Safe to call multiple times."""
    await _seed_catalog()
    return {"seeded": True}


@app.get("/api/v1/dna", tags=["dna"])
async def dna_overview() -> dict[str, Any]:
    """Digital DNA — the single authoritative capability registry."""
    from shital.core.dna.registry import DigitalDNA
    caps = DigitalDNA.all_capabilities()
    by_fabric: dict[str, list[dict[str, Any]]] = {}
    for c in caps:
        f = c.fabric.value
        by_fabric.setdefault(f, []).append({
            "name": c.name, "description": c.description,
            "version": c.version, "status": c.status.value,
            "tags": c.tags, "human_in_loop": c.human_in_loop,
        })
    return {"total": len(caps), "by_fabric": by_fabric}
