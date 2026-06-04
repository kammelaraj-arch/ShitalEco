from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database — Render provides plain postgresql:// scheme; asyncpg needs postgresql+asyncpg://
    DATABASE_URL: str = "postgresql+asyncpg://shital:shital@localhost:5432/shital"

    @property
    def async_database_url(self) -> str:
        url = self.DATABASE_URL
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        return url
    REDIS_URL: str = "redis://localhost:6379/0"

    # Auth
    JWT_SECRET: str = "change-me-to-32-char-min-secret-key-here"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ENCRYPTION_KEY: str = "0000000000000000000000000000000000000000000000000000000000000000"

    # Microsoft 365
    MS_CLIENT_ID: str = ""
    MS_CLIENT_SECRET: str = ""
    MS_TENANT_ID: str = ""
    SHAREPOINT_SITE_ID: str = ""
    SHAREPOINT_DRIVE_ID: str = ""

    # Google
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    # Anthropic
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-4-20250514"

    # Mail Agent — agentic triage of shared mailboxes
    # Comma-separated list of mailbox UPNs the agent should poll. Empty → agent disabled.
    # Service account in Azure AD must have ApplicationAccessPolicy granting access to each.
    # Pilot scope: accounts@ only — invoices and payment confirmations have the
    # clearest structured output for an agentic loop to handle well. Once that's
    # proven (clean classifications, no false-positive invoices, reasonable
    # supplier matching), add trustees@ and info@ via env var override.
    MAIL_AGENT_MAILBOXES: str = "accounts@shirdisai.org.uk,gtrustees@shirdisai.org.uk"
    MAIL_AGENT_POLL_SECONDS: int = 300        # 5 min; 0 = disabled
    MAIL_AGENT_MODEL: str = "claude-opus-4-7"  # used for the agentic loop
    MAIL_AGENT_MAX_ITER: int = 15             # cap tool turns per email
    # Pipeline selector:
    #   "agent" — Claude agentic triage (needs ANTHROPIC_API_KEY)
    #   "rules" — deterministic pdfplumber + regex + rapidfuzz vendor match
    #   "auto"  — Claude if a key is configured, otherwise rules (default)
    # Rules mode is free to run; covers ~80% of UK invoices and stages the
    # rest for manual review through the same inbox UI.
    MAIL_AGENT_MODE: str = "auto"
    # Hard floor on how far back to look on the first sweep. Without this,
    # a fresh prod install would try to triage years of accounts@ history
    # on first run — slow, expensive, and mostly noise. After the first
    # sweep, the poller resumes from the newest processed message and the
    # floor only matters again if the DB is wiped or the agent is paused
    # for longer than the floor.
    MAIL_AGENT_LOOKBACK_DAYS: int = 20
    # ── Optional service-account auth ─────────────────────────────────────
    # Either set these two for delegated OAuth (ROPC, "Resource Owner Password
    # Credentials" grant) using a service account that has been granted
    # FullAccess on the three shared mailboxes — OR leave them empty and the
    # mail agent uses app-only auth via MS_CLIENT_SECRET (requires Mail.Read
    # application permission + ApplicationAccessPolicy in Exchange — the
    # Microsoft-recommended path but needs an IT admin to set up).
    # Service account must NOT have MFA enabled or ROPC will fail.
    MAIL_AGENT_USER:     str = ""             # e.g. svc_emailrouter@shirdisai.org.uk
    MAIL_AGENT_PASSWORD: str = ""             # set in .env, never in code
    TEAMS_WEBHOOK_URL: str = ""               # MS Teams Incoming Webhook for alerts

    # SendGrid (legacy fallback)
    SENDGRID_API_KEY: str = ""
    SENDGRID_FROM_EMAIL: str = "noreply@shital.org.uk"

    # Office 365 SMTP (primary email — overrides SendGrid when password set)
    OFFICE365_EMAIL: str = "noreply@shital.org.uk"
    OFFICE365_PASSWORD: str = ""

    # Where volunteer-application notifications go. Empty → falls back to
    # OFFICE365_EMAIL (the trust's catch-all inbox). Set this to the
    # safeguarding lead's address once the role exists.
    VOLUNTEER_NOTIFY_EMAIL: str = ""

    # Meta WhatsApp
    META_WHATSAPP_TOKEN: str = ""
    META_WHATSAPP_PHONE_ID: str = ""
    META_WHATSAPP_VERIFY_TOKEN: str = ""

    # PayPal
    PAYPAL_CLIENT_ID: str = ""
    PAYPAL_CLIENT_SECRET: str = ""
    PAYPAL_MODE: str = "sandbox"

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_TERMINAL_LOCATION_ID: str = ""
    STRIPE_PUBLISHABLE_KEY: str = ""

    # Square
    SQUARE_ACCESS_TOKEN: str = ""
    SQUARE_ENVIRONMENT: str = "sandbox"  # sandbox | production
    SQUARE_LOCATION_ID: str = ""

    # Clover
    CLOVER_ACCESS_TOKEN: str = ""
    CLOVER_MERCHANT_ID: str = ""
    CLOVER_ENVIRONMENT: str = "sandbox"  # sandbox | production
    CLOVER_DEVICE_ID: str = ""

    # SumUp
    SUMUP_ACCESS_TOKEN: str = ""
    SUMUP_MERCHANT_CODE: str = ""
    SUMUP_READER_SERIAL: str = ""

    # Public base URL (used for webhook return_url)
    SITE_URL: str = "https://shital.org.uk"

    # On-disk media store for item/catalog images (bind-mounted volume in prod
    # so files survive container recreation). Keeps base64 blobs out of Postgres.
    MEDIA_DIR: str = "/app/media"

    # MeiliSearch
    MEILISEARCH_URL: str = "http://localhost:7700"
    MEILISEARCH_MASTER_KEY: str = ""

    # GetAddress.io (UK postcode lookup for Gift Aid)
    GETADDRESS_API_KEY: str = ""

    # HMRC Gift Aid
    HMRC_GIFT_AID_USER_ID: str = ""          # HMRC Government Gateway User ID
    HMRC_GIFT_AID_PASSWORD: str = ""         # HMRC Gateway Password
    HMRC_GIFT_AID_VENDOR_ID: str = ""        # Software vendor ID
    HMRC_GIFT_AID_CHARITY_HMO_REF: str = ""  # Charity HMRC reference (e.g. AB12345)
    HMRC_GIFT_AID_ENVIRONMENT: str = "test"  # test | live

    # App
    APP_ENV: str = "development"
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: str = "http://localhost:3000"
    APP_NAME: str = "Shital Temple ERP"
    CHARITY_NUMBER: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"


settings = Settings()  # type: ignore[call-arg]
