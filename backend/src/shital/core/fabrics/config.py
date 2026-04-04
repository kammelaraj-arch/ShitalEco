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
        # asyncpg does not accept sslmode= in URL; strip it and let connect_args handle SSL
        import re
        url = re.sub(r'[?&]sslmode=[^&]*', '', url)
        url = re.sub(r'\?$', '', url)  # clean up trailing ?
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

    # SendGrid
    SENDGRID_API_KEY: str = ""
    SENDGRID_FROM_EMAIL: str = "noreply@shital.org"

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