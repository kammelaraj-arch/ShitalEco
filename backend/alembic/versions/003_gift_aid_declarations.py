"""Add gift_aid_declarations table and gift_aid_eligible columns.

Revision ID: 003
Revises: 002
Create Date: 2026-04-02
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002_catalog_items'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add gift_aid_eligible to temple_services if the table exists
    try:
        op.add_column('temple_services', sa.Column('gift_aid_eligible', sa.Boolean(), nullable=False, server_default='false'))
    except Exception:
        pass

    # Add gift_aid_eligible to basket_items if the table exists
    try:
        op.add_column('basket_items', sa.Column('gift_aid_eligible', sa.Boolean(), nullable=False, server_default='false'))
    except Exception:
        pass

    # Gift Aid declarations table
    conn = op.get_bind()
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS gift_aid_declarations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            order_ref VARCHAR(100) NOT NULL,
            full_name VARCHAR(200) NOT NULL,
            postcode VARCHAR(20) NOT NULL,
            address TEXT NOT NULL DEFAULT '',
            contact_email VARCHAR(254) NOT NULL DEFAULT '',
            contact_phone VARCHAR(50) NOT NULL DEFAULT '',
            donation_amount NUMERIC(10,2) NOT NULL,
            donation_date DATE NOT NULL,
            gift_aid_agreed BOOLEAN NOT NULL DEFAULT true,
            hmrc_submitted BOOLEAN NOT NULL DEFAULT false,
            hmrc_submission_ref VARCHAR(100),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        )
    """))
    conn.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_gift_aid_order_ref ON gift_aid_declarations(order_ref)"))
    conn.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_gift_aid_submitted ON gift_aid_declarations(hmrc_submitted)"))
    conn.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_gift_aid_postcode ON gift_aid_declarations(postcode)"))

    # Settings table for admin-configurable keys (GetAddress, HMRC etc.)
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS app_settings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key VARCHAR(100) NOT NULL UNIQUE,
            value TEXT NOT NULL DEFAULT '',
            description TEXT,
            is_secret BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))


def downgrade() -> None:
    op.drop_table('app_settings')
    op.drop_index('idx_gift_aid_postcode', 'gift_aid_declarations')
    op.drop_index('idx_gift_aid_submitted', 'gift_aid_declarations')
    op.drop_index('idx_gift_aid_order_ref', 'gift_aid_declarations')
    op.drop_table('gift_aid_declarations')
    try:
        op.drop_column('basket_items', 'gift_aid_eligible')
    except Exception:
        pass
    try:
        op.drop_column('temple_services', 'gift_aid_eligible')
    except Exception:
        pass
