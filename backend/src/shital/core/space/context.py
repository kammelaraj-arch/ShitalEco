"""
Digital Space — The enterprise environment where approved building blocks come together.
Provides runtime context, scoping, and governance for every capability execution.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class DigitalSpace:
    """
    Runtime context injected into every capability call.
    Ensures branch-scoping, user identity, permissions, and audit trail.
    """
    user_id: str
    user_email: str
    role: str
    branch_id: str
    permissions: list[str]
    session_id: str
    ip_address: str | None = None
    user_agent: str | None = None
    request_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions or "super_admin" in self.permissions

    def require_permission(self, permission: str) -> None:
        if not self.has_permission(permission):
            from shital.core.fabrics.errors import ForbiddenError
            raise ForbiddenError(f"Permission '{permission}' required")

    def require_branch_scope(self, branch_id: str) -> None:
        """Branch managers and staff can only access their own branch."""
        if self.role in ("BRANCH_MANAGER", "STAFF") and self.branch_id != branch_id:
            from shital.core.fabrics.errors import ForbiddenError
            raise ForbiddenError("Access restricted to your branch")

    @property
    def log_context(self) -> dict[str, str | None]:
        return {
            "user_id": self.user_id,
            "branch_id": self.branch_id,
            "role": self.role,
            "request_id": self.request_id,
        }
