"""
Shital Temple ERP — FastAPI application entry point.
Assembles Digital DNA capabilities, Digital Space governance, Digital Brain AI,
and all Foundation Fabrics into a unified agentic API.
"""
from __future__ import annotations
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse
import structlog

from shital.core.fabrics.config import settings

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    # Register all Digital DNA micro-capabilities
    import shital.capabilities.finance.capabilities      # noqa: F401
    import shital.capabilities.payroll.capabilities      # noqa: F401
    import shital.capabilities.hr.capabilities           # noqa: F401
    import shital.capabilities.assets.capabilities       # noqa: F401
    import shital.capabilities.compliance.capabilities   # noqa: F401
    import shital.capabilities.auth.capabilities         # noqa: F401
    import shital.capabilities.notifications.capabilities # noqa: F401
    import shital.capabilities.payments.capabilities     # noqa: F401
    from shital.core.dna.registry import DigitalDNA
    total_caps = len(DigitalDNA.all_capabilities())
    logger.info("digital_dna_loaded", total_capabilities=total_caps)

    # Sync Digital DNA capabilities to the DB function registry
    try:
        from shital.api.routers.functions import sync_from_digital_dna
        result = await sync_from_digital_dna()
        logger.info("function_registry_synced",
                    synced=result["synced"], errors=len(result["errors"]))
    except Exception as exc:
        logger.error("function_registry_sync_failed", error=str(exc))

    # Idempotent schema patch + catalog seed on every startup
    try:
        await _patch_schema()
    except Exception as exc:
        logger.error("startup_patch_failed", error=str(exc))

    yield
    logger.info("shital_shutdown")


async def _patch_schema() -> None:
    """Idempotent schema patcher — adds any columns migrations may have missed."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    patches = [
        # Migration 007 columns on catalog_items
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS available_from  TIMESTAMPTZ",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS display_channel VARCHAR(20) NOT NULL DEFAULT 'both'",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS branch_stock    JSONB NOT NULL DEFAULT '{}'",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS is_live         BOOLEAN NOT NULL DEFAULT true",
        # Migration 009 column on catalog_items
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS name_te         VARCHAR(200) NOT NULL DEFAULT ''",
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
    ]

    async with SessionLocal() as db:
        for sql in patches:
            try:
                await db.execute(text(sql))
            except Exception:
                pass  # column already exists or table doesn't exist
        await db.commit()
    logger.info("schema_patch_done")
    await _seed_api_key_metadata()
    await _seed_catalog()


async def _seed_api_key_metadata() -> None:
    """Upsert known API key descriptors (no values) so the admin UI always shows them."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    KNOWN_KEYS = [
        # (key_name, description, group_name, is_sensitive)
        ("STRIPE_SECRET_KEY",         "Stripe secret key (sk_live_...)",                "Stripe",    True),
        ("STRIPE_PUBLISHABLE_KEY",    "Stripe publishable key (pk_live_...)",           "Stripe",    False),
        ("STRIPE_WEBHOOK_SECRET",     "Stripe webhook signing secret (whsec_...)",      "Stripe",    True),
        ("STRIPE_TERMINAL_LOCATION_ID","Stripe Terminal location ID",                   "Stripe",    False),
        ("ANTHROPIC_API_KEY",         "Anthropic / Claude API key",                     "AI",        True),
        ("SENDGRID_API_KEY",          "SendGrid email API key",                         "Email",     True),
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
        ("HMRC_GIFT_AID_USER_ID",     "HMRC Government Gateway user ID",                "HMRC",      True),
        ("HMRC_GIFT_AID_PASSWORD",    "HMRC Government Gateway password",               "HMRC",      True),
        ("HMRC_GIFT_AID_VENDOR_ID",   "HMRC software vendor ID",                        "HMRC",      False),
        ("HMRC_GIFT_AID_CHARITY_HMO_REF","Charity HMRC reference number",              "HMRC",      False),
        ("GETADDRESS_API_KEY",        "GetAddress.io UK postcode lookup API key",       "Other",     True),
        ("MEILISEARCH_MASTER_KEY",    "MeiliSearch master key",                         "Other",     True),
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
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    # Each tuple: (name, name_gu, name_hi, category, price, emoji, unit, gift_aid, sort_order, image_url)
    SEED_ITEMS = [
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
