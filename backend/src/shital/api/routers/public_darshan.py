"""Public live-darshan feed lookup.

Minimal endpoint that the Service app calls from the Live Darshan page to
decide whether to render the video player or the Baba fallback still.

For now there's no table — every branch reports *offline* and the front end
shows the still. When a branch starts a real stream, an operator can set
the ``darshan_stream_url`` column on ``branches`` (added lazily by the
schema patch) and this endpoint will return ``status: "live"`` with that
URL. Keeping this contract separate from the frontend means the client
code doesn't have to change when streams come online.
"""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/public/darshan", tags=["public", "darshan"])


@router.get("/{branch_slug}")
async def darshan_feed(branch_slug: str) -> dict[str, object]:
    """Return the current stream URL for a branch, or an offline marker.

    ``branch_slug`` is either a branch code (``wembley``) or ``any`` when
    the visitor hasn't picked a specific centre. We look up the branch by
    code and return whatever ``darshan_stream_url`` column exists. If the
    column hasn't been added yet the except handler returns offline,
    which is the right default — the Service app falls back to Baba.
    """
    if not branch_slug or branch_slug.lower() == "any":
        return {"status": "offline", "url": "", "poster": ""}

    try:
        async with SessionLocal() as db:
            row = (
                await db.execute(
                    text(
                        """
                        SELECT darshan_stream_url, image_url
                          FROM branches
                         WHERE lower(branch_id) = lower(:slug)
                         LIMIT 1
                        """
                    ),
                    {"slug": branch_slug},
                )
            ).first()
    except Exception:
        # Column missing or DB blip → fall back to offline so the client
        # still has a usable response.
        return {"status": "offline", "url": "", "poster": ""}

    if not row:
        return {"status": "offline", "url": "", "poster": ""}

    stream_url = (row[0] or "").strip()
    poster = (row[1] or "").strip()

    if not stream_url:
        return {"status": "offline", "url": "", "poster": poster}

    return {"status": "live", "url": stream_url, "poster": poster}
