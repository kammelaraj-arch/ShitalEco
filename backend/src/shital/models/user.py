"""
SQLAlchemy ORM models for the User/Auth domain.
Mirrors the Prisma schema: User, Session, OtpCode, AuditLog, Branch.
"""
from __future__ import annotations
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    String,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shital.core.fabrics.database import Base
from shital.core.fabrics.models import UUIDMixin, TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from shital.models.finance import Account, Transaction, GiftAidDeclaration, Donation
    from shital.models.hr import Employee, LeaveRequest, TimeEntry
    from shital.models.payroll import PayrollRun, PayslipLine
    from shital.models.assets import Asset
    from shital.models.compliance import GovernanceDocument, TrusteeDeclaration
    from shital.models.notifications import Notification
    from shital.models.documents import Document, DocumentAccess
    from shital.models.basket import Basket, Order


class Branch(Base, UUIDMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "branches"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    address: Mapped[dict] = mapped_column(JSON, nullable=False)
    phone: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    settings: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    # Relationships
    users: Mapped[list["User"]] = relationship("User", back_populates="branch")
    accounts: Mapped[list["Account"]] = relationship("Account", back_populates="branch")
    transactions: Mapped[list["Transaction"]] = relationship("Transaction", back_populates="branch")
    gift_aid_declarations: Mapped[list["GiftAidDeclaration"]] = relationship(
        "GiftAidDeclaration", back_populates="branch"
    )
    donations: Mapped[list["Donation"]] = relationship("Donation", back_populates="branch")
    employees: Mapped[list["Employee"]] = relationship("Employee", back_populates="branch")
    payroll_runs: Mapped[list["PayrollRun"]] = relationship("PayrollRun", back_populates="branch")
    assets: Mapped[list["Asset"]] = relationship("Asset", back_populates="branch")
    governance_documents: Mapped[list["GovernanceDocument"]] = relationship(
        "GovernanceDocument", back_populates="branch"
    )
    trustee_declarations: Mapped[list["TrusteeDeclaration"]] = relationship(
        "TrusteeDeclaration", back_populates="branch"
    )
    baskets: Mapped[list["Basket"]] = relationship("Basket", back_populates="branch")
    orders: Mapped[list["Order"]] = relationship("Order", back_populates="branch")
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="branch")

    __table_args__ = (Index("ix_branches_deleted_at", "deleted_at"),)


class User(Base, UUIDMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="DEVOTEE")
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    branch_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("branches.id"), nullable=True
    )

    # Relationships
    branch: Mapped["Branch | None"] = relationship("Branch", back_populates="users")
    sessions: Mapped[list["Session"]] = relationship(
        "Session", back_populates="user", cascade="all, delete-orphan"
    )
    otp_codes: Mapped[list["OtpCode"]] = relationship(
        "OtpCode", back_populates="user", cascade="all, delete-orphan"
    )
    employee: Mapped["Employee | None"] = relationship("Employee", back_populates="user")
    gift_aid_declarations: Mapped[list["GiftAidDeclaration"]] = relationship(
        "GiftAidDeclaration", back_populates="user"
    )
    donations: Mapped[list["Donation"]] = relationship("Donation", back_populates="user")
    leave_requests_reviewed: Mapped[list["LeaveRequest"]] = relationship(
        "LeaveRequest", foreign_keys="LeaveRequest.reviewed_by", back_populates="reviewer"
    )
    time_entries_approved: Mapped[list["TimeEntry"]] = relationship(
        "TimeEntry", foreign_keys="TimeEntry.approved_by", back_populates="approver"
    )
    assets_assigned: Mapped[list["Asset"]] = relationship(
        "Asset", foreign_keys="Asset.assigned_to", back_populates="assigned_user"
    )
    uploaded_documents: Mapped[list["Document"]] = relationship(
        "Document", foreign_keys="Document.uploaded_by", back_populates="uploader"
    )
    document_access: Mapped[list["DocumentAccess"]] = relationship(
        "DocumentAccess", foreign_keys="DocumentAccess.user_id", back_populates="user"
    )
    document_access_granted: Mapped[list["DocumentAccess"]] = relationship(
        "DocumentAccess", foreign_keys="DocumentAccess.granted_by", back_populates="grantor"
    )
    governance_approvals: Mapped[list["GovernanceDocument"]] = relationship(
        "GovernanceDocument",
        foreign_keys="GovernanceDocument.approved_by",
        back_populates="approver",
    )
    trustee_declarations: Mapped[list["TrusteeDeclaration"]] = relationship(
        "TrusteeDeclaration", back_populates="user"
    )
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification", back_populates="user", cascade="all, delete-orphan"
    )
    baskets: Mapped[list["Basket"]] = relationship("Basket", back_populates="user")
    orders: Mapped[list["Order"]] = relationship("Order", back_populates="user")
    audit_logs: Mapped[list["AuditLog"]] = relationship("AuditLog", back_populates="user")

    __table_args__ = (
        Index("ix_users_branch_id", "branch_id"),
        Index("ix_users_deleted_at", "deleted_at"),
        Index("ix_users_email", "email"),
    )


class Session(Base, UUIDMixin):
    __tablename__ = "sessions"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="sessions")

    __table_args__ = (
        Index("ix_sessions_user_id", "user_id"),
        Index("ix_sessions_token", "token"),
    )


class OtpCode(Base, UUIDMixin):
    __tablename__ = "otp_codes"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(10), nullable=False)
    purpose: Mapped[str] = mapped_column(String(50), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="otp_codes")

    __table_args__ = (Index("ix_otp_codes_user_id", "user_id"),)


class AuditLog(Base, UUIDMixin):
    """Immutable audit trail — no updatedAt, no deletedAt."""

    __tablename__ = "audit_logs"

    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    old_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    new_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    branch_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User | None"] = relationship("User", back_populates="audit_logs")

    __table_args__ = (
        Index("ix_audit_logs_user_id", "user_id"),
        Index("ix_audit_logs_branch_id", "branch_id"),
        Index("ix_audit_logs_resource", "resource", "resource_id"),
    )
