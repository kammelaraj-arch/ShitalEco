"""007 item scheduling — available_from/until, display_channel, branch_stock

Revision ID: 007_item_scheduling
Revises: 006_kiosk_baskets
Create Date: 2026-04-04
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '007_item_scheduling'
down_revision = '006_kiosk_baskets'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # available_from / available_until — null = always active
    try:
        op.add_column('catalog_items', sa.Column('available_from', sa.TIMESTAMP(timezone=True), nullable=True))
    except Exception:
        pass
    try:
        op.add_column('catalog_items', sa.Column('available_until', sa.TIMESTAMP(timezone=True), nullable=True))
    except Exception:
        pass
    # display_channel — 'kiosk' | 'web' | 'both'
    try:
        op.add_column('catalog_items', sa.Column('display_channel', sa.String(20), nullable=False, server_default='both'))
    except Exception:
        pass
    # branch_stock — JSONB map of branch_id -> stock qty, e.g. {"main": 10, "leicester": 5}
    try:
        op.add_column('catalog_items', sa.Column('branch_stock', postgresql.JSONB(), nullable=True, server_default='{}'))
    except Exception:
        pass
    # is_live — quick "go live" toggle separate from is_active (is_active = enabled; is_live = visible now)
    try:
        op.add_column('catalog_items', sa.Column('is_live', sa.Boolean(), nullable=False, server_default='true'))
    except Exception:
        pass

    # Same scheduling fields on temple_services
    try:
        op.add_column('temple_services', sa.Column('available_from', sa.TIMESTAMP(timezone=True), nullable=True))
    except Exception:
        pass
    try:
        op.add_column('temple_services', sa.Column('available_until', sa.TIMESTAMP(timezone=True), nullable=True))
    except Exception:
        pass
    try:
        op.add_column('temple_services', sa.Column('display_channel', sa.String(20), nullable=False, server_default='both'))
    except Exception:
        pass
    try:
        op.add_column('temple_services', sa.Column('is_live', sa.Boolean(), nullable=False, server_default='true'))
    except Exception:
        pass


def downgrade() -> None:
    for col in ['available_from', 'available_until', 'display_channel', 'branch_stock', 'is_live']:
        try:
            op.drop_column('catalog_items', col)
        except Exception:
            pass
    for col in ['available_from', 'available_until', 'display_channel']:
        try:
            op.drop_column('temple_services', col)
        except Exception:
            pass
