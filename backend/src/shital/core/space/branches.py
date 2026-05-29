"""
Branch-id canonicalisation.

ShitalEco stores branches with two identifiers:

    branches.id         UUID  (primary key, FK target for users.branch_id)
    branches.branch_id  short code  (e.g. "main", "wembley")

Historically the JWT carried the UUID form (since users.branch_id is a UUID),
which leaked into every authenticated INSERT that does `bid = ctx.branch_id`.
But the kiosk and donation tables expect the short code, so the same physical
device ended up showing three different branch values depending on which code
path inserted the row.

`resolve_branch_code` is the single boundary: give it any value the system
might hold (UUID, short code, empty) and it returns the canonical short code.
Looking up a UUID hits the DB at most once per process per branch — branches
are tiny and effectively static, so we cache forever in memory and let the
process restart pick up rare changes.
"""
from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

_uuid_to_code: dict[str, str] = {}


def looks_like_uuid(value: str) -> bool:
    return bool(_UUID_RE.match(value))


async def resolve_branch_code(db: AsyncSession, value: str | None) -> str:
    """Return the canonical short code for a branch reference.

    - empty / None        → "main"
    - already a short code → returned unchanged
    - UUID in branches.id  → its branches.branch_id
    - UUID with no match   → the input (don't silently relabel unknown data)
    """
    if not value:
        return "main"

    v = value.strip()
    if not v:
        return "main"

    if not looks_like_uuid(v):
        return v

    cached = _uuid_to_code.get(v)
    if cached is not None:
        return cached

    row = (
        await db.execute(
            text("SELECT branch_id FROM branches WHERE id = :id"),
            {"id": v},
        )
    ).first()
    if row and row[0]:
        _uuid_to_code[v] = row[0]
        return row[0]

    return v
