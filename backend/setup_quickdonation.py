#!/usr/bin/env python3
"""
QuickDonation Kiosk — Database setup script.

Creates all required tables and seeds 16 kiosk accounts on Render PostgreSQL.
Run once after deploying the backend.

Usage:
    python3 setup_quickdonation.py

Or set DATABASE_URL environment variable:
    DATABASE_URL="postgresql+asyncpg://..." python3 setup_quickdonation.py
"""
import asyncio
import json
import os
import uuid
from datetime import datetime

RENDER_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://shitaleco_db_user:IL5Gc9UHj0fzaZoUSQdbAw3pfIiTSvPY@dpg-d779nt9r0fns73f1e2bg-a.oregon-postgres.render.com/shitaleco_db"
)

# Ensure asyncpg driver
if "postgresql://" in RENDER_DB_URL and "+asyncpg" not in RENDER_DB_URL:
    RENDER_DB_URL = RENDER_DB_URL.replace("postgresql://", "postgresql+asyncpg://")

BRANCHES = [
    {"id": "main",      "name": "Wembley",       "city": "Wembley, London",   "postcode": "HA9 0EW"},
    {"id": "leicester", "name": "Leicester",      "city": "Leicester",          "postcode": "LE1"},
    {"id": "reading",   "name": "Reading",        "city": "Reading, Berkshire", "postcode": "RG1"},
    {"id": "mk",        "name": "Milton Keynes",  "city": "Milton Keynes",      "postcode": "MK9"},
]

KIOSK_ACCOUNTS = [
    {"email": f"quickkiosk-wembley-{i}@shirdisai.org.uk",   "name": f"QuickKiosk Wembley {i}",       "branch": "main",      "password": "Wembley!Kiosk2024"} for i in range(1, 5)
] + [
    {"email": f"quickkiosk-leicester-{i}@shirdisai.org.uk",  "name": f"QuickKiosk Leicester {i}",     "branch": "leicester", "password": "Leicester!Kiosk2024"} for i in range(1, 5)
] + [
    {"email": f"quickkiosk-reading-{i}@shirdisai.org.uk",    "name": f"QuickKiosk Reading {i}",       "branch": "reading",   "password": "Reading!Kiosk2024"} for i in range(1, 5)
] + [
    {"email": f"quickkiosk-mk-{i}@shirdisai.org.uk",         "name": f"QuickKiosk Milton Keynes {i}", "branch": "mk",        "password": "MiltonKeynes!Kiosk2024"} for i in range(1, 5)
]


async def main():
    try:
        import bcrypt
    except ImportError:
        print("Installing bcrypt...")
        os.system("pip install bcrypt")
        import bcrypt

    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy import text

    print(f"\n📡 Connecting to Render PostgreSQL...")
    print(f"   Host: {RENDER_DB_URL.split('@')[1].split('/')[0]}")
    print(f"   DB:   {RENDER_DB_URL.split('/')[-1]}\n")

    engine = create_async_engine(RENDER_DB_URL, echo=False)

    async with engine.begin() as conn:
        # Test connection
        await conn.execute(text("SELECT 1"))
        print("✅ Connected to database\n")

        # ─── Create tables ──────────────────────────────────────────────
        print("📦 Creating tables...")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS branches (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(200) NOT NULL,
                code VARCHAR(50) UNIQUE NOT NULL,
                address JSONB NOT NULL DEFAULT '{}'::jsonb,
                phone VARCHAR(50) DEFAULT '',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                deleted_at TIMESTAMPTZ DEFAULT NULL
            )
        """))
        print("   ✅ branches")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email VARCHAR(200) UNIQUE NOT NULL,
                password_hash VARCHAR(200),
                name VARCHAR(200) NOT NULL,
                phone VARCHAR(50),
                role VARCHAR(50) NOT NULL DEFAULT 'DEVOTEE',
                mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                mfa_secret VARCHAR(200),
                avatar_url VARCHAR(500),
                last_login_at TIMESTAMPTZ,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                branch_id UUID REFERENCES branches(id),
                azure_oid VARCHAR(200),
                azure_upn VARCHAR(200),
                auth_provider VARCHAR(50) DEFAULT 'local',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                deleted_at TIMESTAMPTZ DEFAULT NULL
            )
        """))
        print("   ✅ users")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS baskets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id),
                session_id VARCHAR(200),
                branch_id VARCHAR(100) NOT NULL,
                status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
                expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("   ✅ baskets")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS basket_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                basket_id UUID NOT NULL REFERENCES baskets(id) ON DELETE CASCADE,
                item_type VARCHAR(50) NOT NULL,
                reference_id VARCHAR(200),
                name VARCHAR(200) NOT NULL,
                description TEXT,
                quantity INT NOT NULL DEFAULT 1,
                unit_price DECIMAL(19,4) NOT NULL,
                total_price DECIMAL(19,4) NOT NULL,
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        print("   ✅ basket_items")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS orders (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id),
                branch_id VARCHAR(100) NOT NULL,
                basket_id UUID,
                reference VARCHAR(100) UNIQUE NOT NULL,
                status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
                total_amount DECIMAL(19,4) NOT NULL,
                currency VARCHAR(10) NOT NULL DEFAULT 'GBP',
                payment_provider VARCHAR(50),
                payment_ref VARCHAR(200),
                idempotency_key VARCHAR(200) UNIQUE NOT NULL,
                metadata JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                deleted_at TIMESTAMPTZ DEFAULT NULL
            )
        """))
        print("   ✅ orders")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS donations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id),
                branch_id VARCHAR(100) NOT NULL,
                amount DECIMAL(19,4) NOT NULL,
                currency VARCHAR(10) NOT NULL DEFAULT 'GBP',
                gift_aid_eligible BOOLEAN NOT NULL DEFAULT FALSE,
                gift_aid_declaration_id UUID,
                gift_aid_amount DECIMAL(19,4),
                purpose VARCHAR(200) NOT NULL,
                reference VARCHAR(100) UNIQUE NOT NULL,
                payment_provider VARCHAR(50) NOT NULL,
                payment_ref VARCHAR(200),
                status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
                transaction_id UUID,
                idempotency_key VARCHAR(200) UNIQUE NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                deleted_at TIMESTAMPTZ DEFAULT NULL
            )
        """))
        print("   ✅ donations")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS terminal_devices (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                branch_id VARCHAR(100) NOT NULL,
                branch_name VARCHAR(200) DEFAULT '',
                user_id VARCHAR(100) DEFAULT NULL,
                user_name VARCHAR(200) DEFAULT '',
                user_email VARCHAR(200) DEFAULT '',
                label VARCHAR(255) NOT NULL,
                provider VARCHAR(50) NOT NULL DEFAULT 'stripe_terminal',
                stripe_reader_id VARCHAR(255) DEFAULT '',
                stripe_location_id VARCHAR(255) DEFAULT '',
                square_device_id VARCHAR(255) DEFAULT '',
                device_type VARCHAR(100) DEFAULT '',
                serial_number VARCHAR(100) DEFAULT '',
                status VARCHAR(50) DEFAULT 'offline',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                last_seen_at TIMESTAMPTZ DEFAULT NULL,
                notes TEXT DEFAULT '',
                metadata_json JSONB NOT NULL DEFAULT '{}',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                deleted_at TIMESTAMPTZ DEFAULT NULL
            )
        """))
        print("   ✅ terminal_devices")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS kiosk_profiles (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                branch_id VARCHAR(100) NOT NULL,
                branch_name VARCHAR(200) NOT NULL DEFAULT '',
                user_id UUID DEFAULT NULL,
                user_email VARCHAR(200) NOT NULL,
                user_name VARCHAR(200) NOT NULL DEFAULT '',
                device_id UUID DEFAULT NULL,
                device_label VARCHAR(255) DEFAULT '',
                stripe_reader_id VARCHAR(255) DEFAULT '',
                device_provider VARCHAR(50) DEFAULT 'stripe_terminal',
                profile_name VARCHAR(200) NOT NULL,
                kiosk_type VARCHAR(50) NOT NULL DEFAULT 'quick_donation',
                display_name VARCHAR(200) DEFAULT '',
                preset_amounts JSONB NOT NULL DEFAULT '[1, 2.5, 5, 10, 15, 20, 50]',
                default_purpose VARCHAR(200) DEFAULT 'General Fund',
                gift_aid_prompt BOOLEAN NOT NULL DEFAULT true,
                idle_timeout_secs INT NOT NULL DEFAULT 90,
                theme VARCHAR(50) DEFAULT 'saffron',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                last_active_at TIMESTAMPTZ DEFAULT NULL,
                notes TEXT DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                deleted_at TIMESTAMPTZ DEFAULT NULL,
                UNIQUE(branch_id, user_email)
            )
        """))
        print("   ✅ kiosk_profiles")

        # ─── Seed branches ──────────────────────────────────────────────
        print("\n🏛️  Seeding branches...")
        now = datetime.utcnow()

        for b in BRANCHES:
            branch_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"shital-branch-{b['id']}"))
            addr = json.dumps({"city": b["city"], "postcode": b["postcode"]})
            await conn.execute(
                text(
                    "INSERT INTO branches (id, name, code, address, phone, is_active, created_at, updated_at) "
                    "VALUES (:id, :name, :code, CAST(:addr AS jsonb), '', true, :now, :now) "
                    "ON CONFLICT (code) DO NOTHING"
                ),
                {"id": branch_uuid, "name": b["name"], "code": b["id"], "addr": addr, "now": now},
            )
            print(f"   ✅ {b['name']} ({b['id']})")

        # ─── Seed anonymous user ────────────────────────────────────────
        print("\n👤 Creating anonymous kiosk user...")
        anon_id = str(uuid.uuid4())
        await conn.execute(
            text(
                "INSERT INTO users (id, email, name, role, is_active, mfa_enabled, created_at, updated_at) "
                "VALUES (:id, 'anonymous-kiosk@shital.org', 'Anonymous Kiosk Donor', 'KIOSK', true, false, :now, :now) "
                "ON CONFLICT (email) DO NOTHING"
            ),
            {"id": anon_id, "now": now},
        )
        print("   ✅ anonymous-kiosk@shital.org")

        # ─── Seed kiosk accounts ────────────────────────────────────────
        print("\n🔑 Creating 16 kiosk accounts...")
        created = 0
        skipped = 0

        for acct in KIOSK_ACCOUNTS:
            # Check if exists
            existing = (await conn.execute(
                text("SELECT id FROM users WHERE email = :email AND deleted_at IS NULL LIMIT 1"),
                {"email": acct["email"]},
            )).first()

            if existing:
                skipped += 1
                continue

            # Get branch UUID
            branch_row = (await conn.execute(
                text("SELECT id, name FROM branches WHERE code = :code LIMIT 1"),
                {"code": acct["branch"]},
            )).mappings().first()
            branch_uuid = str(branch_row["id"]) if branch_row else None
            branch_name = branch_row["name"] if branch_row else acct["branch"]

            # Create user
            user_id = str(uuid.uuid4())
            hashed = bcrypt.hashpw(acct["password"].encode(), bcrypt.gensalt(12)).decode()

            await conn.execute(
                text(
                    "INSERT INTO users (id, email, password_hash, name, role, is_active, "
                    "mfa_enabled, branch_id, created_at, updated_at) "
                    "VALUES (:id, :email, :hash, :name, 'KIOSK', true, false, :bid, :now, :now)"
                ),
                {"id": user_id, "email": acct["email"], "hash": hashed,
                 "name": acct["name"], "bid": branch_uuid, "now": now},
            )

            # Create kiosk profile
            profile_id = str(uuid.uuid4())
            profile_name = f"QuickDonation — {branch_name}"
            await conn.execute(
                text(
                    "INSERT INTO kiosk_profiles "
                    "(id, branch_id, branch_name, user_id, user_email, user_name, "
                    " profile_name, kiosk_type, display_name, "
                    " preset_amounts, default_purpose, gift_aid_prompt, "
                    " idle_timeout_secs, theme, is_active, created_at, updated_at) "
                    "VALUES (:id, :bid, :bname, :uid, :email, :uname, "
                    " :pname, 'quick_donation', :dname, "
                    " '[1, 2.5, 5, 10, 15, 20, 50]'::jsonb, 'General Fund', true, "
                    " 90, 'saffron', true, :now, :now) "
                    "ON CONFLICT (branch_id, user_email) DO NOTHING"
                ),
                {"id": profile_id, "bid": acct["branch"], "bname": branch_name,
                 "uid": user_id, "email": acct["email"], "uname": acct["name"],
                 "pname": profile_name, "dname": f"Quick Donation {branch_name}", "now": now},
            )

            created += 1
            print(f"   ✅ {acct['email']}")

        if skipped:
            print(f"   ⏭️  Skipped {skipped} existing accounts")

        # ─── Create indexes ─────────────────────────────────────────────
        print("\n📇 Creating indexes...")
        for idx_sql in [
            "CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_branch ON kiosk_profiles(branch_id)",
            "CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_user ON kiosk_profiles(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_kiosk_profiles_device ON kiosk_profiles(device_id)",
            "CREATE INDEX IF NOT EXISTS idx_donations_user ON donations(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_donations_branch ON donations(branch_id)",
            "CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch_id)",
            "CREATE INDEX IF NOT EXISTS idx_baskets_branch ON baskets(branch_id)",
        ]:
            await conn.execute(text(idx_sql))
        print("   ✅ All indexes created")

        # ─── Verify ─────────────────────────────────────────────────────
        print("\n📊 Verification:")
        for table in ["branches", "users", "kiosk_profiles", "orders", "donations", "baskets"]:
            count = (await conn.execute(text(f"SELECT COUNT(*) AS cnt FROM {table}"))).scalar()
            print(f"   {table}: {count} rows")

    await engine.dispose()

    print(f"\n🎉 Done! Created {created} accounts, skipped {skipped}.")
    print(f"\n📋 Kiosk Login Credentials:")
    print(f"   {'Email':<50} {'Password':<25} Branch")
    print(f"   {'─'*50} {'─'*25} {'─'*15}")
    for acct in KIOSK_ACCOUNTS:
        if KIOSK_ACCOUNTS.index(acct) % 4 == 0:
            print(f"   {acct['email']:<50} {acct['password']:<25} {acct['branch']}")


if __name__ == "__main__":
    asyncio.run(main())
