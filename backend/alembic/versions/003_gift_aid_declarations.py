"""Add gift_aid_declarations table and gift_aid_eligible columns.

Revision ID: 003
Revises: 002
Create Date: 2026-04-02
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002'
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
    op.create_table(
        'gift_aid_declarations',
        sa.Column('id', sa.UUID(), nullable=False, server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('order_ref', sa.String(100), nullable=False),
        sa.Column('full_name', sa.String(200), nullable=False),
        sa.Column('postcode', sa.String(20), nullable=False),
        sa.Column('address', sa.Text(), nullable=False, server_default=''),
        sa.Column('contact_email', sa.String(254), nullable=False, server_default=''),
        sa.Column('contact_phone', sa.String(50), nullable=False, server_default=''),
        sa.Column('donation_amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('donation_date', sa.Date(), nullable=False),
        sa.Column('gift_aid_agreed', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('hmrc_submitted', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('hmrc_submission_ref', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_gift_aid_order_ref', 'gift_aid_declarations', ['order_ref'])
    op.create_index('idx_gift_aid_submitted', 'gift_aid_declarations', ['hmrc_submitted'])
    op.create_index('idx_gift_aid_postcode', 'gift_aid_declarations', ['postcode'])

    # Settings table for admin-configurable keys (GetAddress, HMRC etc.)
    op.create_table(
        'app_settings',
        sa.Column('id', sa.UUID(), nullable=False, server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('key', sa.String(100), nullable=False, unique=True),
        sa.Column('value', sa.Text(), nullable=False, server_default=''),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_secret', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
    )


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
