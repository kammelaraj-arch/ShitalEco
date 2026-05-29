"""Mail Agent API — Inbox queue, approve/reject, manual sweep.

The admin "AI Inbox" page lists every email the agent has triaged, grouped by
classification with the agent's summary + linked records inline. Approve /
Reject sit on the Purchase Invoice records, not here — this router is for the
agent-level audit and triggering."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/mail-agent", tags=["mail-agent"])

PRIVILEGED = {"SUPER_ADMIN", "ADMIN", "FINANCE_MANAGER", "TRUSTEE"}


def _require(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Privileged role required")


@router.get("/inbox")
async def inbox(ctx: CurrentSpace, mailbox: str = "", classification: str = "",
                status: str = "", needs_review: bool = False,
                page: int = 1, per_page: int = 50) -> dict[str, Any]:
    """List triaged messages with their linked records inline. Newest first."""
    _require(ctx)
    per_page = max(1, min(per_page, 200))
    offset = (max(1, page) - 1) * per_page

    where = ["1=1"]
    params: dict[str, Any] = {"limit": per_page, "offset": offset}
    if mailbox.strip():
        where.append("mailbox = :mb")
        params["mb"] = mailbox.strip()
    if classification.strip():
        where.append("classification = :cl")
        params["cl"] = classification.strip()
    if status.strip():
        where.append("status = :st")
        params["st"] = status.strip()
    if needs_review:
        where.append("needs_human_review = true")
    sql_where = " AND ".join(where)

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT id, mailbox, subject, sender_email, sender_name, received_at,
                   classification, agent_summary, status, needs_human_review,
                   escalation_reason, processed_at, created_at
            FROM   mail_agent_messages
            WHERE  {sql_where}
            ORDER  BY COALESCE(received_at, created_at) DESC
            LIMIT  :limit OFFSET :offset
        """), params)).mappings().all()

        ids = [str(r["id"]) for r in rows]
        links: dict[str, list[dict[str, Any]]] = {i: [] for i in ids}
        if ids:
            # Generate the IN list at SQL-build time — passing a Python list
            # to `ANY(:ids::uuid[])` via SQLAlchemy text is asyncpg-version
            # sensitive. UUIDs are validated by the SELECT above so they're
            # safe to interpolate as named params.
            ph = ", ".join(f":id{i}" for i in range(len(ids)))
            link_params = {f"id{i}": uid for i, uid in enumerate(ids)}
            link_rows = (await db.execute(text(
                f"SELECT mail_agent_message_id::text AS mid, record_type, record_id, note, created_at "
                f"FROM mail_agent_record_links WHERE mail_agent_message_id::text IN ({ph}) "
                f"ORDER BY created_at"
            ), link_params)).mappings().all()
            for lr in link_rows:
                links[lr["mid"]].append({
                    "record_type": lr["record_type"],
                    "record_id":   lr["record_id"],
                    "note":        lr["note"],
                })

        total = (await db.execute(text(f"SELECT COUNT(*) FROM mail_agent_messages WHERE {sql_where}"),
                                  {k: v for k, v in params.items() if k not in ("limit", "offset")})).scalar() or 0

        by_classification = {row["classification"]: int(row["c"]) for row in
                             (await db.execute(text(
                                 "SELECT classification, COUNT(*) AS c FROM mail_agent_messages GROUP BY classification"
                             ))).mappings().all()}
        review_count = (await db.execute(text(
            "SELECT COUNT(*) FROM mail_agent_messages WHERE needs_human_review = true"
        ))).scalar() or 0

    return {
        "messages": [{
            "id":                  str(r["id"]),
            "mailbox":             r["mailbox"],
            "subject":             r["subject"],
            "sender_email":        r["sender_email"],
            "sender_name":         r["sender_name"],
            "received_at":         r["received_at"].isoformat() if r["received_at"] else None,
            "classification":      r["classification"],
            "agent_summary":       r["agent_summary"],
            "status":              r["status"],
            "needs_human_review":  r["needs_human_review"],
            "escalation_reason":   r["escalation_reason"],
            "processed_at":        r["processed_at"].isoformat() if r["processed_at"] else None,
            "links":               links[str(r["id"])],
        } for r in rows],
        "total":               int(total),
        "page":                page,
        "per_page":             per_page,
        "by_classification":   by_classification,
        "needs_review_count":  int(review_count),
    }


@router.get("/messages/{mid}")
async def get_message(ctx: CurrentSpace, mid: str) -> dict[str, Any]:
    """Full row including the agent's tool transcript."""
    _require(ctx)
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT * FROM mail_agent_messages WHERE id = :id"
        ), {"id": mid})).mappings().first()
        if not row:
            raise HTTPException(404, detail="Not found")
        links = (await db.execute(text(
            "SELECT record_type, record_id, note, created_at FROM mail_agent_record_links "
            "WHERE mail_agent_message_id = :id ORDER BY created_at"
        ), {"id": mid})).mappings().all()
    return {
        **{k: (v.isoformat() if hasattr(v, "isoformat") else (str(v) if k.endswith("_id") and v is not None else v))
           for k, v in dict(row).items()},
        "links": [dict(lr) for lr in links],
    }


@router.post("/clear-review/{mid}")
async def clear_review(ctx: CurrentSpace, mid: str) -> dict[str, Any]:
    """Mark a needs-review email as reviewed (after a human eyeballs it)."""
    _require(ctx)
    async with SessionLocal() as db:
        await db.execute(text(
            "UPDATE mail_agent_messages SET needs_human_review = false WHERE id = :id"
        ), {"id": mid})
        await db.commit()
    return {"ok": True}


@router.post("/sweep")
async def sweep_now(ctx: CurrentSpace) -> dict[str, Any]:
    """Manually trigger one poll of all configured mailboxes. Useful for
    testing — the background loop also runs every MAIL_AGENT_POLL_SECONDS."""
    _require(ctx)
    from shital.services.mail_agent import sweep_once
    return await sweep_once()


@router.post("/triage/{mailbox}/{message_id}")
async def triage_one(ctx: CurrentSpace, mailbox: str,
                     message_id: str) -> dict[str, Any]:
    """Re-trigger triage on a specific Graph message_id (debugging tool)."""
    _require(ctx)
    from shital.services import mailbox as mb
    from shital.services.mail_agent import triage_email
    full = await mb.get_message_body(mailbox, message_id)
    return await triage_email(mailbox, full)
