from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RootSystem(Base):
    __tablename__ = "root_systems"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_now)

    nodes: Mapped[list[NodeSystem]] = relationship(back_populates="root", cascade="all, delete-orphan")


class NodeSystem(Base):
    __tablename__ = "node_systems"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    root_id: Mapped[str] = mapped_column(ForeignKey("root_systems.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    region: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(default=_now)

    root: Mapped[RootSystem] = relationship(back_populates="nodes")
    edges: Mapped[list[EdgeSystem]] = relationship(back_populates="node", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("root_id", "name", name="uq_node_per_root"),)


class EdgeSystem(Base):
    __tablename__ = "edge_systems"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    node_id: Mapped[str] = mapped_column(ForeignKey("node_systems.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    site_id: Mapped[str] = mapped_column(String(120), nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_now)

    node: Mapped[NodeSystem] = relationship(back_populates="edges")
    devices: Mapped[list[Device]] = relationship(back_populates="edge", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("node_id", "name", name="uq_edge_per_node"),)


class Device(Base):
    __tablename__ = "devices"

    device_dna: Mapped[str] = mapped_column(String(40), primary_key=True)
    edge_id: Mapped[str] = mapped_column(ForeignKey("edge_systems.id"), nullable=False)
    device_type: Mapped[str] = mapped_column(String(40), nullable=False)
    compute_stable_id: Mapped[str] = mapped_column(String(120), nullable=False)
    board_stable_id: Mapped[str | None] = mapped_column(String(120))
    hardware_revision: Mapped[str] = mapped_column(String(40), nullable=False)
    serial_number: Mapped[str | None] = mapped_column(String(80))
    mac_address: Mapped[str | None] = mapped_column(String(20))
    base_firmware_version: Mapped[str] = mapped_column(String(20), nullable=False)
    app_bundle_version: Mapped[str] = mapped_column(String(20), nullable=False)
    config_schema_version: Mapped[str] = mapped_column(String(20), nullable=False)
    components_json: Mapped[list] = mapped_column(JSON, default=list)
    pinmap_json: Mapped[dict | None] = mapped_column(JSON)
    dna_json: Mapped[dict | None] = mapped_column(JSON)
    brain_json: Mapped[dict | None] = mapped_column(JSON)
    firmware_bundle_path: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)

    edge: Mapped[EdgeSystem] = relationship(back_populates="devices")


class Process(Base):
    __tablename__ = "processes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    edge_id: Mapped[str | None] = mapped_column(ForeignKey("edge_systems.id"))
    graph_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    version: Mapped[str] = mapped_column(String(20), default="1.0.0")
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)


class APIKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    label: Mapped[str | None] = mapped_column(String(120))
    owner: Mapped[str] = mapped_column(String(120), nullable=False)
    tier: Mapped[str] = mapped_column(String(20), nullable=False, default="integration")
    scopes_json: Mapped[list] = mapped_column(JSON, default=list)
    rate_per_minute: Mapped[int] = mapped_column(default=120)
    rate_burst: Mapped[int] = mapped_column(default=30)
    issued_at: Mapped[datetime] = mapped_column(default=_now)
    expires_at: Mapped[datetime | None] = mapped_column()
    rotated_from: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(16), default="active")
    hash_alg: Mapped[str] = mapped_column(String(20), default="argon2id")
    key_hash: Mapped[str] = mapped_column(Text, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column()


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    at: Mapped[datetime] = mapped_column(default=_now, index=True)
    actor: Mapped[str] = mapped_column(String(120), nullable=False)
    actor_kind: Mapped[str] = mapped_column(String(20), default="api_key")
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target_kind: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(120))
    outcome: Mapped[str] = mapped_column(String(20), default="ok")
    detail_json: Mapped[dict | None] = mapped_column(JSON)
