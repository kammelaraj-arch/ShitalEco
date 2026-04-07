"""
Compliance Capabilities — Governance, audit, GDPR, trustee declarations.
The AuditLog is IMMUTABLE — append-only, never update or delete.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import structlog
from pydantic import BaseModel

from shital.core.dna.registry import Fabric, capability
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()


class AuditLogInput(BaseModel):
    action: str
    resource: str
    resource_id: str = ""
    old_data: dict[str, Any] | None = None
    new_data: dict[str, Any] | None = None


class GovernanceDocInput(BaseModel):
    title: str
    doc_type: str
    version: str
    review_due: str = ""
    document_id: str = ""


class TrusteeDeclarationInput(BaseModel):
    declaration_type: str  # INTERESTS | FIT_PROPER | CONFLICT
    details: dict[str, Any] | None = None
    expires_at: str = ""


@capability(
    name="write_audit_log",
    description="Write an immutable audit log entry. Used automatically by all capability executions. The audit log can never be modified or deleted.",
    fabric=Fabric.COMPLIANCE,
    requires=[],
    idempotent=False,
    tags=["audit", "compliance"],
)
async def write_audit_log(ctx: DigitalSpace, data: AuditLogInput) -> dict[str, Any]:
    """Always succeeds — audit log is fire-and-forget critical infrastructure."""
    import json
    import uuid

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    try:
        async with SessionLocal() as db:
            log_id = str(uuid.uuid4())
            await db.execute(
                text("""
                    INSERT INTO audit_logs
                    (id, user_id, action, resource, resource_id,
                     old_data, new_data, ip_address, user_agent, branch_id, created_at)
                    VALUES (:id, :uid, :action, :resource, :rid,
                            :old, :new, :ip, :ua, :bid, :now)
                """),
                {
                    "id": log_id, "uid": ctx.user_id,
                    "action": data.action, "resource": data.resource,
                    "rid": data.resource_id or None,
                    "old": json.dumps(data.old_data) if data.old_data else None,
                    "new": json.dumps(data.new_data) if data.new_data else None,
                    "ip": ctx.ip_address, "ua": ctx.user_agent,
                    "bid": ctx.branch_id, "now": datetime.utcnow(),
                },
            )
            await db.commit()
        return {"logged": True, "audit_id": log_id}
    except Exception as exc:
        logger.error("audit_log_write_failed", error=str(exc))
        return {"logged": False, "error": str(exc)}


@capability(
    name="get_audit_logs",
    description="Retrieve immutable audit logs. Filter by resource, user, or date range. Used by auditors and trustees.",
    fabric=Fabric.COMPLIANCE,
    requires=["compliance:read"],
    idempotent=True,
    tags=["audit", "compliance"],
)
async def get_audit_logs(
    ctx: DigitalSpace,
    resource: str = "",
    resource_id: str = "",
    user_id_filter: str = "",
    from_date: str = "",
    to_date: str = "",
    limit: int = 50,
    cursor: str = "",
) -> dict[str, Any]:
    ctx.require_permission("compliance:read")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    conditions = ["al.branch_id = :bid"]
    params: dict[str, Any] = {"bid": ctx.branch_id, "limit": limit + 1}

    if resource:
        conditions.append("al.resource = :resource")
        params["resource"] = resource
    if resource_id:
        conditions.append("al.resource_id = :rid")
        params["rid"] = resource_id
    if user_id_filter:
        conditions.append("al.user_id = :uid_filter")
        params["uid_filter"] = user_id_filter
    if from_date:
        conditions.append("al.created_at >= :from_d")
        params["from_d"] = from_date
    if to_date:
        conditions.append("al.created_at <= :to_d")
        params["to_d"] = to_date
    if cursor:
        conditions.append("al.id > :cursor")
        params["cursor"] = cursor

    where = " AND ".join(conditions)
    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT al.id, al.user_id, al.action, al.resource, al.resource_id,
                       al.ip_address, al.created_at, u.name AS user_name
                FROM audit_logs al
                LEFT JOIN users u ON u.id = al.user_id
                WHERE {where}
                ORDER BY al.created_at DESC
                LIMIT :limit
            """),
            params,
        )
        rows = result.mappings().all()

    items = [dict(r) for r in rows[:limit]]
    next_cursor = rows[limit]["id"] if len(rows) > limit else None
    return {"items": items, "next_cursor": next_cursor}


@capability(
    name="get_compliance_dashboard",
    description="Get compliance dashboard — document status, trustee declarations, overdue reviews, pending actions.",
    fabric=Fabric.COMPLIANCE,
    requires=["compliance:read"],
    idempotent=True,
    tags=["compliance", "governance"],
)
async def get_compliance_dashboard(ctx: DigitalSpace) -> dict[str, Any]:
    ctx.require_permission("compliance:read")

    from datetime import date

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        doc_stats = await db.execute(
            text("""
                SELECT status, COUNT(*) AS cnt
                FROM governance_documents
                WHERE branch_id = :bid AND deleted_at IS NULL
                GROUP BY status
            """),
            {"bid": ctx.branch_id},
        )
        docs = {r["status"]: r["cnt"] for r in doc_stats.mappings()}

        overdue_docs = await db.execute(
            text("""
                SELECT COUNT(*) FROM governance_documents
                WHERE branch_id = :bid AND review_due < :today
                  AND status = 'APPROVED' AND deleted_at IS NULL
            """),
            {"bid": ctx.branch_id, "today": date.today()},
        )

        trustee_stats = await db.execute(
            text("""
                SELECT
                    COUNT(CASE WHEN expires_at IS NULL OR expires_at > :today THEN 1 END) AS active,
                    COUNT(CASE WHEN expires_at <= :today THEN 1 END) AS expired
                FROM trustee_declarations
                WHERE branch_id = :bid
            """),
            {"bid": ctx.branch_id, "today": date.today()},
        )
        td: dict = dict(trustee_stats.mappings().first() or {})

        recent_audit = await db.execute(
            text("""
                SELECT action, resource, created_at
                FROM audit_logs
                WHERE branch_id = :bid
                ORDER BY created_at DESC LIMIT 10
            """),
            {"bid": ctx.branch_id},
        )
        audit_entries = [dict(r) for r in recent_audit.mappings()]

    pending_actions = []
    if overdue_docs.scalar() or 0 > 0:
        pending_actions.append("Review overdue governance documents")
    if (td.get("expired") or 0) > 0:
        pending_actions.append("Renew expired trustee declarations")
    if docs.get("DRAFT", 0) > 0:
        pending_actions.append(f"{docs['DRAFT']} governance documents awaiting approval")

    return {
        "branch_id": ctx.branch_id,
        "documents": {
            "total": sum(docs.values()),
            "approved": docs.get("APPROVED", 0),
            "draft": docs.get("DRAFT", 0),
            "overdue_reviews": overdue_docs.scalar() or 0,
        },
        "trustees": {
            "active_declarations": td.get("active", 0),
            "expired_declarations": td.get("expired", 0),
        },
        "recent_audit_entries": audit_entries,
        "pending_actions": pending_actions,
    }


@capability(
    name="export_personal_data",
    description="GDPR Subject Access Request — export all personal data held for a specific user.",
    fabric=Fabric.COMPLIANCE,
    requires=["compliance:read"],
    human_in_loop=True,
    idempotent=True,
    tags=["gdpr", "compliance"],
)
async def export_personal_data(ctx: DigitalSpace, subject_user_id: str) -> dict[str, Any]:
    ctx.require_permission("compliance:read")

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        user = await db.execute(
            text("SELECT id, email, name, phone, role, created_at FROM users WHERE id = :id"),
            {"id": subject_user_id},
        )
        user_data = dict(user.mappings().first() or {})

        donations = await db.execute(
            text("SELECT id, amount, currency, purpose, created_at FROM donations WHERE user_id = :id AND deleted_at IS NULL"),
            {"id": subject_user_id},
        )
        bookings = await db.execute(
            text("SELECT id, booking_date, total_amount, status FROM service_bookings WHERE user_id = :id AND deleted_at IS NULL"),
            {"id": subject_user_id},
        )

    return {
        "subject_user_id": subject_user_id,
        "exported_at": datetime.utcnow().isoformat(),
        "requested_by": ctx.user_id,
        "data": {
            "profile": user_data,
            "donations": [dict(r) for r in donations.mappings()],
            "bookings": [dict(r) for r in bookings.mappings()],
        },
    }
