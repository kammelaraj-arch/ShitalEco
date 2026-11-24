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

    # Roles pinned to a single branch. BRANCH_MANAGER / STAFF run the
    # branch day-to-day; VOLUNTEER contributes at their branch; LMC is the
    # branch-level governance committee (LMC_CHAIR / LMC_TREASURER /
    # LMC_MEMBER) so they see their own branch only, never org-wide.
    # Main-board roles (SUPER_ADMIN, TRUSTEE, CHAIR, ACCOUNTANT,
    # HR_MANAGER, AUDITOR) stay unscoped — they govern across branches.
    _BRANCH_SCOPED_ROLES = (
        "BRANCH_MANAGER", "STAFF", "VOLUNTEER",
        "LMC_CHAIR", "LMC_TREASURER", "LMC_MEMBER",
    )

    def require_branch_scope(self, branch_id: str) -> None:
        """Branch-scoped roles can only access their own branch."""
        if self.role in self._BRANCH_SCOPED_ROLES and self.branch_id != branch_id:
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
