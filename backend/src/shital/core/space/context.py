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

    # Default-deny branch scoping: every role belongs to a single branch
    # and sees only their branch, UNLESS it is one of the national roles
    # listed here. This matches the charity's governance model — a Main
    # Board trustee / Accountant / HR Manager / Auditor serves the whole
    # charity, everyone else (LMC, Branch Manager, Staff, Volunteer, …)
    # belongs to one branch.
    #
    # SUPER_ADMIN is the platform/tech admin and is always cross-branch.
    # Main-board roles: CHAIR, TREASURER, SECRETARY, CEO, TRUSTEE.
    _CROSS_BRANCH_ROLES = frozenset({
        "SUPER_ADMIN",
        "TRUSTEE", "CHAIR", "TREASURER", "SECRETARY", "CEO",
        "ACCOUNTANT", "HR_MANAGER", "AUDITOR",
    })

    def require_branch_scope(self, branch_id: str) -> None:
        """Everyone is pinned to their own branch unless their role is a
        national/main-board role listed in `_CROSS_BRANCH_ROLES`."""
        if self.role in self._CROSS_BRANCH_ROLES:
            return
        if self.branch_id != branch_id:
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
