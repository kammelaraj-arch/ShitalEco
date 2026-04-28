"""
Shital Temple ERP — FastAPI application entry point.
Assembles Digital DNA capabilities, Digital Space governance, Digital Brain AI,
and all Foundation Fabrics into a unified agentic API.
"""
from __future__ import annotations

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

    # Idempotent schema patch + catalog seed on every startup
    # Must run BEFORE sync_from_digital_dna so function_registry table exists.
    try:
        await _patch_schema()
    except Exception as exc:
        logger.error("startup_patch_failed", error=str(exc))

    # Sync Digital DNA capabilities to the DB function registry
    try:
        from shital.api.routers.functions import sync_from_digital_dna
        result = await sync_from_digital_dna()
        logger.info("function_registry_synced",
                    synced=result["synced"], errors=len(result["errors"]))
    except Exception as exc:
        logger.error("function_registry_sync_failed", error=str(exc))

    yield
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
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_kiosk_devices_username ON kiosk_devices(device_username) WHERE device_username IS NOT NULL",
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
        # PayPal capture transaction ID (different from the PayPal order ID)
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS paypal_capture_id VARCHAR(200) NOT NULL DEFAULT ''",
        "ALTER TABLE orders    ADD COLUMN IF NOT EXISTS paypal_capture_id VARCHAR(200) NOT NULL DEFAULT ''",
        # Source channel on donations (kiosk, quick-donation, service, paypal, etc.)
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS source VARCHAR(64) NOT NULL DEFAULT 'kiosk'",
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
        # ── CRM: Accounts (companies/organisations) ────────────────────────────
        """CREATE TABLE IF NOT EXISTS accounts (
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
            parent_account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,
            owner_user_id        UUID,
            branch_id            VARCHAR(64) NOT NULL DEFAULT '',
            notes                TEXT NOT NULL DEFAULT '',
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at           TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS idx_accounts_name    ON accounts(name)",
        "CREATE INDEX IF NOT EXISTS idx_accounts_type    ON accounts(account_type)",
        "CREATE INDEX IF NOT EXISTS idx_accounts_status  ON accounts(status) WHERE deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_accounts_primary ON accounts(primary_contact_id)",
        """CREATE TABLE IF NOT EXISTS account_contacts (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            role        VARCHAR(150) NOT NULL DEFAULT '',
            is_primary  BOOLEAN NOT NULL DEFAULT false,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (account_id, contact_id)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_account_contacts_acct ON account_contacts(account_id)",
        "CREATE INDEX IF NOT EXISTS idx_account_contacts_cont ON account_contacts(contact_id)",
        """CREATE TABLE IF NOT EXISTS account_services (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            service_name VARCHAR(200) NOT NULL,
            service_type VARCHAR(50)  NOT NULL DEFAULT '',
            description  TEXT NOT NULL DEFAULT '',
            is_active    BOOLEAN NOT NULL DEFAULT true,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_account_services_acct ON account_services(account_id)",
        "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS idx_addresses_account ON addresses(account_id)",
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
    ]

    # Each statement runs in its own transaction so one failure doesn't
    # abort the entire batch (PostgreSQL aborts the txn on any error).
    for sql in patches:
        try:
            async with SessionLocal() as db:
                await db.execute(text(sql))
                await db.commit()
        except Exception:
            pass  # column already exists / table missing — safe to skip
    logger.info("schema_patch_done")
    await _seed_api_key_metadata()
    await _seed_catalog()
    await _seed_email_templates()


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
        ("GOOGLE_CLIENT_ID",          "Google OAuth client ID",                         "Google",    False),
        ("GOOGLE_CLIENT_SECRET",      "Google OAuth client secret",                     "Google",    True),
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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.10);">
  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#FF9933 0%,#FF6600 100%);padding:32px 40px;text-align:center;">
      <div style="font-size:36px;margin-bottom:8px;">🕉</div>
      <div style="color:#ffffff;font-size:26px;font-weight:900;letter-spacing:1px;">Shital Temple</div>
      <div style="color:rgba(255,255,255,0.85);font-size:14px;margin-top:4px;">{{ branch_name }}</div>
    </td>
  </tr>
  <!-- Confirmed bar -->
  <tr>
    <td style="background:#22C55E;padding:10px 40px;text-align:center;">
      <span style="color:#ffffff;font-weight:700;font-size:14px;letter-spacing:0.5px;">✓ Donation Confirmed — Thank You!</span>
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:36px 40px;">
      {% if customer_name %}<p style="font-size:18px;font-weight:700;color:#1a1a1a;margin:0 0 8px 0;">Dear {{ customer_name }},</p>{% endif %}
      <p style="color:#555555;font-size:15px;line-height:1.6;margin:0 0 28px 0;">Thank you for your generous donation to <strong>{{ branch_name }}</strong>. Your contribution directly supports our temple community, seva programmes, and charitable activities.</p>
      <!-- Order reference box -->
      <div style="background:#FFF8F0;border-left:5px solid #FF9933;padding:18px 22px;border-radius:8px;margin-bottom:28px;">
        <div style="font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">Order Reference</div>
        <div style="font-size:22px;font-weight:900;color:#1a1a1a;letter-spacing:3px;font-family:'Courier New',monospace;">{{ order_ref }}</div>
        <div style="font-size:12px;color:#999999;margin-top:6px;">{{ date }}</div>
      </div>
      <!-- Items table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;border-collapse:collapse;">
        <tr>
          <th align="left" style="font-size:11px;text-transform:uppercase;color:#999999;letter-spacing:1px;padding:0 0 10px 0;border-bottom:2px solid #f0f0f0;">Donation</th>
          <th align="center" style="font-size:11px;text-transform:uppercase;color:#999999;letter-spacing:1px;padding:0 0 10px 0;border-bottom:2px solid #f0f0f0;">Qty</th>
          <th align="right" style="font-size:11px;text-transform:uppercase;color:#999999;letter-spacing:1px;padding:0 0 10px 0;border-bottom:2px solid #f0f0f0;">Amount</th>
        </tr>
        {% for item in items %}
        <tr>
          <td style="padding:12px 0;font-size:14px;color:#1a1a1a;border-bottom:1px solid #f5f5f5;">{{ item.name }}</td>
          <td align="center" style="padding:12px 0;font-size:14px;color:#666666;border-bottom:1px solid #f5f5f5;">{{ item.quantity }}</td>
          <td align="right" style="padding:12px 0;font-size:14px;color:#1a1a1a;font-weight:600;border-bottom:1px solid #f5f5f5;">£{{ "%.2f"|format((item.unitPrice or 0)|float * (item.quantity or 1)|int) }}</td>
        </tr>
        {% else %}
        <tr>
          <td colspan="3" style="padding:12px 0;font-size:14px;color:#555555;border-bottom:1px solid #f5f5f5;">Temple Donation</td>
        </tr>
        {% endfor %}
        <tr>
          <td colspan="2" style="padding:16px 0 0 0;font-size:16px;font-weight:900;color:#1a1a1a;">Total Donated</td>
          <td align="right" style="padding:16px 0 0 0;font-size:22px;font-weight:900;color:#FF6600;">£{{ "%.2f"|format(total|float) }}</td>
        </tr>
      </table>
      <hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0;">
      <!-- Gift Aid notice -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:18px 22px;margin-bottom:28px;">
        <div style="font-size:13px;font-weight:700;color:#15803d;margin-bottom:6px;">🎁 Gift Aid — Boost Your Donation by 25%</div>
        <div style="font-size:13px;color:#166534;line-height:1.6;">If you are a UK taxpayer, the temple can claim Gift Aid on your donation at no extra cost to you. Please speak to a temple administrator or visit our website to add Gift Aid to this donation.</div>
      </div>
      <p style="color:#888888;font-size:13px;line-height:1.7;margin:0 0 24px 0;">Please retain this email as confirmation of your donation. This receipt is for your records only and is not a Gift Aid declaration.</p>
      <p style="color:#FF9933;font-size:20px;font-weight:900;text-align:center;margin:0;">🙏 Jay Shri Krishna</p>
    </td>
  </tr>
  <!-- Footer -->
  <tr>
    <td style="background:#f9f9f9;border-top:1px solid #eeeeee;padding:22px 40px;text-align:center;">
      <p style="color:#999999;font-size:12px;margin:0 0 4px 0;font-weight:600;">{{ branch_name }} · Registered UK Charity</p>
      <p style="color:#bbbbbb;font-size:11px;margin:0;">You received this email because you donated at our kiosk terminal. This is not a tax document.</p>
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
    ]

    async with SessionLocal() as db:
        for t in templates:
            try:
                await db.execute(text("""
                    INSERT INTO email_templates (template_key, name, subject, html_body, text_body, variables, is_active)
                    VALUES (:key, :name, :subject, :html_body, :text_body, :variables::jsonb, true)
                    ON CONFLICT (template_key) DO NOTHING
                """), t)
            except Exception:
                pass
        await db.commit()
    logger.info("email_templates_seeded")


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
_mount("shital.api.routers.kiosk",            "router")
_mount("shital.api.routers.terminal_devices", "router")
_mount("shital.api.routers.users",            "router")
_mount("shital.api.routers.items",            "router")
_mount("shital.api.routers.giftaid",          "router")
_mount("shital.api.routers.brain",            "router")
_mount("shital.api.routers.finance",          "router")
_mount("shital.api.routers.hr",               "router")
_mount("shital.api.routers.payroll",          "router")
_mount("shital.api.routers.admin_kiosk",      "router")
_mount("shital.api.routers.email_templates",  "router")
_mount("shital.api.routers.functions",        "router")
_mount("shital.api.routers.assets",           "router")
_mount("shital.api.routers.bookings_router",  "router")
_mount("shital.api.routers.documents_router", "router")
_mount("shital.api.routers.api_keys",         "router")
_mount("shital.api.routers.api_keys",         "settings_router")
_mount("shital.api.routers.screen",           "router")
_mount("shital.api.routers.branches",         "router")
_mount("shital.api.routers.projects",             "router")
_mount("shital.api.routers.recurring_payments",   "router")
_mount("shital.api.routers.kiosk_devices",        "router")
_mount("shital.api.routers.paypal",               "router")
_mount("shital.api.routers.recurring_giving",     "router")
_mount("shital.api.routers.contacts",             "router")
_mount("shital.api.routers.accounts",             "router")
_mount("shital.api.routers.app_permissions",      "router")
_mount("shital.api.routers.system",                "router")


@app.get("/health", tags=["system"])
@app.get("/api/v1/ping", tags=["system"])
async def health() -> dict[str, Any]:
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": "1.0.7",
        "environment": settings.APP_ENV,
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
