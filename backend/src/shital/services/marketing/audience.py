"""Shared audience resolver — one function that turns a list of
`(kind, params)` entries into a de-duplicated list of recipients.

Used by:
  * marketing campaigns (via marketing_campaigns table → audience_segments)
  * board announcements  (via resolution_announcement_audiences)

Why in services/marketing and not services/audience? History — the
board's board/fanout.py had an inline copy of this. This module
collapses the two into one. The recipient shape is
`{email, name, contact_id}` — contact_id is None for external_list
rows.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import text

from shital.core.fabrics.database import SessionLocal


async def resolve_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each entry is {kind: str, params: dict}. Returns the de-duplicated
    recipient list (email-level unique). Caller owns the opt-in check at
    send time."""
    seen: dict[str, dict[str, Any]] = {}
    async with SessionLocal() as db:
        for a in entries:
            kind = a.get("kind") or ""
            params = dict(a.get("params") or {})
            rows: list[dict[str, Any]] = []

            if kind == "all_contacts":
                rows = [dict(r) for r in (await db.execute(text("""
                    SELECT id AS contact_id, email,
                           COALESCE(NULLIF(full_name,''), first_name || ' ' || surname) AS name
                    FROM   contacts WHERE email IS NOT NULL AND email <> ''
                """))).mappings().all()]
            elif kind == "volunteers":
                rows = [dict(r) for r in (await db.execute(text("""
                    SELECT c.id AS contact_id, c.email,
                           COALESCE(NULLIF(c.full_name,''), c.first_name || ' ' || c.surname) AS name
                    FROM   contacts c
                    JOIN   volunteers v ON LOWER(v.email) = LOWER(c.email)
                    WHERE  v.status IN ('ACTIVE','APPROVED')
                """))).mappings().all()]
            elif kind == "recent_donors":
                months = int(params.get("months", 12) or 12)
                rows = [dict(r) for r in (await db.execute(text(f"""
                    SELECT c.id AS contact_id, c.email,
                           COALESCE(NULLIF(c.full_name,''), c.first_name || ' ' || c.surname) AS name
                    FROM   contacts c
                    JOIN   donations d ON d.contact_id = c.id
                    WHERE  d.deleted_at IS NULL
                      AND  d.created_at >= NOW() - INTERVAL '{months} months'
                """))).mappings().all()]
            elif kind == "trustees":
                rows = [dict(r) for r in (await db.execute(text("""
                    SELECT t.id AS contact_id, t.email, t.full_name AS name
                    FROM   trustees t WHERE t.is_active = true AND t.email <> ''
                """))).mappings().all()]
            elif kind == "individuals":
                ids = [str(x) for x in (params.get("contact_ids") or []) if x]
                if ids:
                    rows = [dict(r) for r in (await db.execute(text("""
                        SELECT id AS contact_id, email,
                               COALESCE(NULLIF(full_name,''), first_name || ' ' || surname) AS name
                        FROM   contacts
                        WHERE  id = ANY(CAST(:ids AS uuid[])) AND email IS NOT NULL AND email <> ''
                    """), {"ids": ids})).mappings().all()]
            elif kind == "external_list":
                people = params.get("people") or []
                rows = [
                    {"contact_id": None, "email": str(p.get("email", "")).lower(), "name": p.get("name") or ""}
                    for p in people if "@" in str(p.get("email", ""))
                ]

            for row in rows:
                email = str(row.get("email") or "").strip().lower()
                if not email:
                    continue
                if email not in seen:
                    seen[email] = {
                        "email": email, "name": row.get("name") or "",
                        "contact_id": str(row.get("contact_id") or "") or None,
                    }

    return list(seen.values())


async def resolve_segment(segment_id: str) -> list[dict[str, Any]]:
    """Resolve a saved segment to a de-duplicated recipient list."""
    async with SessionLocal() as db:
        entries = (await db.execute(text("""
            SELECT kind, params FROM audience_segment_entries
             WHERE segment_id = CAST(:id AS uuid)
        """), {"id": segment_id})).mappings().all()
    return await resolve_entries([dict(e) for e in entries])


__all__ = ["resolve_entries", "resolve_segment"]
