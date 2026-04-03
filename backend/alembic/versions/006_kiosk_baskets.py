"""006 kiosk baskets

Revision ID: 006_kiosk_baskets
Revises: 005_azure_ad
Create Date: 2026-04-03 00:00:00.000000

Creates baskets, basket_items, and orders tables required by the kiosk checkout flow.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = "006_kiosk_baskets"
down_revision = "005_azure_ad"
branch_labels = None
depends_on = None


def _table_exists(conn, table: str) -> bool:
    result = conn.execute(
        text("""
            SELECT COUNT(*) AS cnt FROM information_schema.tables
            WHERE table_name = :tbl AND table_schema = current_schema()
        """),
        {"tbl": table},
    )
    row = result.mappings().first()
    return bool(row and row["cnt"] > 0)


def upgrade() -> None:
    conn = op.get_bind()

    if not _table_exists(conn, "baskets"):
        op.create_table(
            "baskets",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("session_id", sa.String(36), nullable=False),
            sa.Column("branch_id", sa.String(64), nullable=False, server_default="main"),
            sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )

    if not _table_exists(conn, "basket_items"):
        op.create_table(
            "basket_items",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("basket_id", sa.String(36), nullable=False, index=True),
            sa.Column("item_type", sa.String(64), nullable=False),
            sa.Column("reference_id", sa.String(64), nullable=True),
            sa.Column("name", sa.String(256), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("unit_price", sa.Numeric(10, 2), nullable=False),
            sa.Column("total_price", sa.Numeric(10, 2), nullable=False),
            sa.Column("gift_aid_eligible", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("metadata", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["basket_id"], ["baskets.id"], ondelete="CASCADE"),
        )

    if not _table_exists(conn, "orders"):
        op.create_table(
            "orders",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("branch_id", sa.String(64), nullable=False, server_default="main"),
            sa.Column("basket_id", sa.String(36), nullable=True),
            sa.Column("reference", sa.String(64), nullable=False, unique=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
            sa.Column("total_amount", sa.Numeric(10, 2), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False, server_default="GBP"),
            sa.Column("payment_provider", sa.String(32), nullable=True),
            sa.Column("payment_ref", sa.String(256), nullable=True),
            sa.Column("idempotency_key", sa.String(64), nullable=True, unique=True),
            sa.Column("customer_name", sa.String(256), nullable=True),
            sa.Column("customer_email", sa.String(256), nullable=True),
            sa.Column("customer_phone", sa.String(64), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("orders")
    op.drop_table("basket_items")
    op.drop_table("baskets")
