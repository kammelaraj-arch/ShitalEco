"""009 add name_te to catalog_items and temple_services

Revision ID: 009_name_te
Revises: 008_email_templates
Create Date: 2026-04-04
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = '009_name_te'
down_revision = '008_email_templates'
branch_labels = None
depends_on = None


def upgrade() -> None:
    try:
        op.add_column('catalog_items', sa.Column('name_te', sa.String(200), server_default='', nullable=True))
    except Exception:
        pass
    try:
        op.add_column('temple_services', sa.Column('name_te', sa.String(200), server_default='', nullable=True))
    except Exception:
        pass


def downgrade() -> None:
    try:
        op.drop_column('catalog_items', 'name_te')
    except Exception:
        pass
    try:
        op.drop_column('temple_services', 'name_te')
    except Exception:
        pass
