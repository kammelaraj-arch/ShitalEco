"""Broadcast — temple online TV channel.

Owns three things:
  • Content library  (broadcast_assets)            — uploaded / linked
    recordings of past services, bhajans, discourses, festivals.
  • Recurring schedule (broadcast_schedule_blocks) — weekly grid of what
    should play when (e.g. "Mon-Fri 05:00 Morning aarti").
  • Live events       (broadcast_live_events)      — actual scheduled or
    in-progress live broadcasts, linked to YouTube stream IDs.

The public TV viewer (apps/tv/) calls /broadcast/now to render whatever
is currently live or, failing that, whichever scheduled block is
in-window. The admin (apps/admin/.../broadcast) calls everything else.

YouTube is the streaming backend — we never proxy video bytes. The DB
holds metadata, references and viewer-flow data so we own the audit
trail and donation-during-broadcast tie-back.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(tags=["broadcast"])


def _require_admin(ctx: CurrentSpace) -> None:
    if getattr(ctx, "role", "") not in {"SUPER_ADMIN", "ADMIN"}:
        raise HTTPException(status_code=403, detail="admin only")


def _ser(row: Any) -> dict[str, Any]:
    d: dict[str, Any] = {}
    for k, v in dict(row).items():
        if hasattr(v, "isoformat"):
            d[k] = v.isoformat()
        else:
            d[k] = v
    return d


_KINDS = {"AARTI", "BHAJAN", "KIRTAN", "DISCOURSE", "FESTIVAL", "INTERVIEW", "ANNOUNCEMENT", "OTHER"}
_LIVE_STATUSES = {"SCHEDULED", "LIVE", "ENDED", "CANCELLED"}


# ─── Content library ─────────────────────────────────────────────────────────

class AssetIn(BaseModel):
    title: str
    description: str = ""
    kind: str = "OTHER"
    language: str = "en"
    branch_id: str | None = None
    source_url: str = ""
    youtube_video_id: str | None = None
    duration_seconds: int = 0
    thumbnail_url: str = ""
    rights_cleared: bool = True
    tags: list[str] = []


@router.get("/admin/broadcast/assets")
async def list_assets(ctx: CurrentSpace, kind: str = "", branch_id: str = "",
                      search: str = "", limit: int = 100) -> dict[str, Any]:
    where = ["deleted_at IS NULL"]
    params: dict[str, Any] = {"lim": max(1, min(int(limit), 500))}
    if kind:
        where.append("kind = :k")
        params["k"] = kind.upper()
    if branch_id:
        where.append("branch_id = :b")
        params["b"] = branch_id
    if search.strip():
        where.append("(LOWER(title) LIKE :q OR LOWER(description) LIKE :q)")
        params["q"] = f"%{search.strip().lower()}%"
    sql = f"""
        SELECT id::text, title, description, kind, language, branch_id,
               source_url, youtube_video_id, duration_seconds, thumbnail_url,
               rights_cleared, tags, created_at, updated_at
        FROM broadcast_assets
        WHERE {' AND '.join(where)}
        ORDER BY created_at DESC
        LIMIT :lim
    """
    async with SessionLocal() as db:
        rows = (await db.execute(text(sql), params)).mappings().all()
    return {"items": [_ser(r) for r in rows]}


@router.post("/admin/broadcast/assets", status_code=201)
async def create_asset(body: AssetIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if not body.title.strip():
        raise HTTPException(400, detail="title required")
    kind = (body.kind or "OTHER").upper()
    if kind not in _KINDS:
        raise HTTPException(400, detail=f"kind must be one of {sorted(_KINDS)}")
    # Auto-extract youtube id from a paste of the full URL if supplied
    yt = body.youtube_video_id or _extract_youtube_id(body.source_url)
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        import json as _json
        await db.execute(text("""
            INSERT INTO broadcast_assets
                (id, title, description, kind, language, branch_id, source_url,
                 youtube_video_id, duration_seconds, thumbnail_url, rights_cleared,
                 tags, uploaded_by)
            VALUES
                (CAST(:id AS UUID), :t, :d, :k, :l, :b, :u, :yt, :dur, :th, :rc,
                 CAST(:tags AS JSONB), CAST(:by AS UUID))
        """), {
            "id":   new_id, "t": body.title.strip(), "d": body.description or "",
            "k":    kind, "l": body.language or "en",
            "b":    body.branch_id or None, "u": body.source_url or "",
            "yt":   yt, "dur": int(body.duration_seconds or 0),
            "th":   body.thumbnail_url or _yt_thumb(yt),
            "rc":   bool(body.rights_cleared),
            "tags": _json.dumps(body.tags or []),
            "by":   getattr(ctx, "user_id", None) or "",
        })
        await db.commit()
    return {"id": new_id, "ok": True}


@router.patch("/admin/broadcast/assets/{asset_id}")
async def update_asset(asset_id: str, body: AssetIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    import json as _json
    kind = (body.kind or "OTHER").upper()
    if kind not in _KINDS:
        raise HTTPException(400, detail=f"kind must be one of {sorted(_KINDS)}")
    yt = body.youtube_video_id or _extract_youtube_id(body.source_url)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE broadcast_assets SET
                title=:t, description=:d, kind=:k, language=:l, branch_id=:b,
                source_url=:u, youtube_video_id=:yt, duration_seconds=:dur,
                thumbnail_url=:th, rights_cleared=:rc, tags=CAST(:tags AS JSONB),
                updated_at=NOW()
            WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
        """), {
            "id":   asset_id, "t": body.title.strip(), "d": body.description or "",
            "k":    kind, "l": body.language or "en", "b": body.branch_id or None,
            "u":    body.source_url or "", "yt": yt,
            "dur":  int(body.duration_seconds or 0),
            "th":   body.thumbnail_url or _yt_thumb(yt),
            "rc":   bool(body.rights_cleared),
            "tags": _json.dumps(body.tags or []),
        })
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(404, detail="asset not found")
    return {"ok": True}


@router.delete("/admin/broadcast/assets/{asset_id}", status_code=204)
async def delete_asset(asset_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE broadcast_assets SET deleted_at = NOW()
            WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
        """), {"id": asset_id})
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(404, detail="asset not found")


# ─── Schedule grid ───────────────────────────────────────────────────────────

class ScheduleBlockIn(BaseModel):
    branch_id: str | None = None
    day_of_week: int    # 0=Mon … 6=Sun
    start_time: str     # "HH:MM"
    duration_min: int = 30
    asset_id: str | None = None
    title_override: str = ""
    is_live_slot: bool = False
    recurring: bool = True


@router.get("/admin/broadcast/schedule")
async def list_schedule(ctx: CurrentSpace, branch_id: str = "") -> dict[str, Any]:
    where = ["s.deleted_at IS NULL"]
    params: dict[str, Any] = {}
    if branch_id:
        where.append("(s.branch_id = :b OR s.branch_id IS NULL)")
        params["b"] = branch_id
    sql = f"""
        SELECT s.id::text, s.branch_id, s.day_of_week, s.start_time::text AS start_time,
               s.duration_min, s.asset_id::text AS asset_id, s.title_override,
               s.is_live_slot, s.recurring, s.created_at,
               a.title AS asset_title, a.kind AS asset_kind,
               a.thumbnail_url AS asset_thumb, a.duration_seconds AS asset_duration,
               a.youtube_video_id AS asset_yt
        FROM broadcast_schedule_blocks s
        LEFT JOIN broadcast_assets a ON a.id = s.asset_id
        WHERE {' AND '.join(where)}
        ORDER BY s.day_of_week, s.start_time
    """
    async with SessionLocal() as db:
        rows = (await db.execute(text(sql), params)).mappings().all()
    return {"items": [_ser(r) for r in rows]}


@router.post("/admin/broadcast/schedule", status_code=201)
async def create_schedule(body: ScheduleBlockIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if not 0 <= int(body.day_of_week) <= 6:
        raise HTTPException(400, detail="day_of_week must be 0-6")
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO broadcast_schedule_blocks
                (id, branch_id, day_of_week, start_time, duration_min,
                 asset_id, title_override, is_live_slot, recurring)
            VALUES
                (CAST(:id AS UUID), :b, :dow, CAST(:st AS TIME), :dur,
                 CASE WHEN :aid <> '' THEN CAST(:aid AS UUID) ELSE NULL END,
                 :tt, :live, :rec)
        """), {
            "id":  new_id, "b": body.branch_id or None,
            "dow": int(body.day_of_week), "st": body.start_time,
            "dur": max(1, int(body.duration_min or 30)),
            "aid": body.asset_id or "", "tt": body.title_override or "",
            "live": bool(body.is_live_slot), "rec": bool(body.recurring),
        })
        await db.commit()
    return {"id": new_id, "ok": True}


@router.patch("/admin/broadcast/schedule/{block_id}")
async def update_schedule(block_id: str, body: ScheduleBlockIn,
                          ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if not 0 <= int(body.day_of_week) <= 6:
        raise HTTPException(400, detail="day_of_week must be 0-6")
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE broadcast_schedule_blocks SET
                branch_id=:b, day_of_week=:dow, start_time=CAST(:st AS TIME),
                duration_min=:dur,
                asset_id=CASE WHEN :aid <> '' THEN CAST(:aid AS UUID) ELSE NULL END,
                title_override=:tt, is_live_slot=:live, recurring=:rec,
                updated_at=NOW()
            WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
        """), {
            "id":  block_id, "b": body.branch_id or None,
            "dow": int(body.day_of_week), "st": body.start_time,
            "dur": max(1, int(body.duration_min or 30)),
            "aid": body.asset_id or "", "tt": body.title_override or "",
            "live": bool(body.is_live_slot), "rec": bool(body.recurring),
        })
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(404, detail="schedule block not found")
    return {"ok": True}


@router.delete("/admin/broadcast/schedule/{block_id}", status_code=204)
async def delete_schedule(block_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE broadcast_schedule_blocks SET deleted_at = NOW()
            WHERE id = CAST(:id AS UUID) AND deleted_at IS NULL
        """), {"id": block_id})
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(404, detail="schedule block not found")


# ─── Live events ─────────────────────────────────────────────────────────────

class LiveEventIn(BaseModel):
    branch_id: str | None = None
    project_id: str | None = None
    title: str
    description: str = ""
    scheduled_at: str | None = None
    youtube_video_id: str | None = None
    stream_url: str = ""
    platform: str = "youtube"


@router.get("/admin/broadcast/live")
async def list_live(ctx: CurrentSpace, status: str = "", branch_id: str = "",
                    limit: int = 50) -> dict[str, Any]:
    where = ["1=1"]
    params: dict[str, Any] = {"lim": max(1, min(int(limit), 200))}
    if status:
        where.append("status = :st")
        params["st"] = status.upper()
    if branch_id:
        where.append("branch_id = :b")
        params["b"] = branch_id
    sql = f"""
        SELECT id::text, branch_id, project_id::text AS project_id, title,
               description, scheduled_at, started_at, ended_at, platform,
               youtube_video_id, stream_url, recording_url, viewer_count_peak,
               status, created_at
        FROM broadcast_live_events
        WHERE {' AND '.join(where)}
        ORDER BY COALESCE(scheduled_at, created_at) DESC
        LIMIT :lim
    """
    async with SessionLocal() as db:
        rows = (await db.execute(text(sql), params)).mappings().all()
    return {"items": [_ser(r) for r in rows]}


@router.post("/admin/broadcast/live", status_code=201)
async def create_live(body: LiveEventIn, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    if not body.title.strip():
        raise HTTPException(400, detail="title required")
    yt = body.youtube_video_id or _extract_youtube_id(body.stream_url)
    new_id = str(uuid.uuid4())
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO broadcast_live_events
                (id, branch_id, project_id, title, description, scheduled_at,
                 platform, youtube_video_id, stream_url, status, created_by)
            VALUES
                (CAST(:id AS UUID), :b,
                 CASE WHEN :p <> '' THEN CAST(:p AS UUID) ELSE NULL END,
                 :t, :d,
                 CASE WHEN :sched <> '' THEN CAST(:sched AS TIMESTAMPTZ) ELSE NULL END,
                 :plat, :yt, :url, 'SCHEDULED', CAST(:by AS UUID))
        """), {
            "id":   new_id, "b": body.branch_id or None,
            "p":    body.project_id or "",
            "t":    body.title.strip(), "d": body.description or "",
            "sched": body.scheduled_at or "",
            "plat": (body.platform or "youtube").lower(),
            "yt":   yt, "url": body.stream_url or "",
            "by":   getattr(ctx, "user_id", None) or "",
        })
        await db.commit()
    return {"id": new_id, "ok": True}


class LiveStateIn(BaseModel):
    status: str    # SCHEDULED | LIVE | ENDED | CANCELLED
    youtube_video_id: str | None = None
    recording_url: str = ""
    viewer_count_peak: int = 0


@router.patch("/admin/broadcast/live/{event_id}")
async def set_live_state(event_id: str, body: LiveStateIn,
                         ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    status = body.status.upper()
    if status not in _LIVE_STATUSES:
        raise HTTPException(400, detail=f"status must be one of {sorted(_LIVE_STATUSES)}")
    set_started = ", started_at = COALESCE(started_at, NOW())" if status == "LIVE" else ""
    set_ended   = ", ended_at = COALESCE(ended_at, NOW())"     if status == "ENDED" else ""
    async with SessionLocal() as db:
        result = await db.execute(text(f"""
            UPDATE broadcast_live_events SET
                status = :s,
                youtube_video_id = COALESCE(NULLIF(:yt,''), youtube_video_id),
                recording_url    = CASE WHEN :rec <> '' THEN :rec ELSE recording_url END,
                viewer_count_peak = GREATEST(viewer_count_peak, :peak),
                updated_at = NOW()
                {set_started}{set_ended}
            WHERE id = CAST(:id AS UUID)
        """), {"id": event_id, "s": status,
               "yt": body.youtube_video_id or "",
               "rec": body.recording_url or "",
               "peak": int(body.viewer_count_peak or 0)})
        await db.commit()
    if not getattr(result, "rowcount", 0):
        raise HTTPException(404, detail="live event not found")
    return {"ok": True}


@router.delete("/admin/broadcast/live/{event_id}", status_code=204)
async def delete_live(event_id: str, ctx: CurrentSpace) -> None:
    _require_admin(ctx)
    async with SessionLocal() as db:
        await db.execute(text("DELETE FROM broadcast_live_events WHERE id = CAST(:id AS UUID)"),
                         {"id": event_id})
        await db.commit()


# ─── Public viewer feed ──────────────────────────────────────────────────────

@router.get("/broadcast/now")
async def now_playing(branch_id: str = "") -> dict[str, Any]:
    """What's on the TV channel RIGHT NOW. Public — no auth.

    Priority order:
      1. An in-progress LIVE event for this branch
      2. An in-progress LIVE event for any branch (if no branch filter)
      3. The scheduled block in the current time-of-day window
      4. The next upcoming scheduled block (countdown view)
    """
    now = datetime.now(UTC)
    branch_filter = (branch_id or "").strip() or None

    async with SessionLocal() as db:
        # 1. Live event in progress
        params: dict[str, Any] = {}
        live_where = "status = 'LIVE'"
        if branch_filter:
            live_where += " AND (branch_id = :b OR branch_id IS NULL)"
            params["b"] = branch_filter
        live = (await db.execute(text(f"""
            SELECT id::text, branch_id, project_id::text AS project_id, title,
                   description, scheduled_at, started_at, platform,
                   youtube_video_id, stream_url, viewer_count_peak, status
            FROM broadcast_live_events
            WHERE {live_where}
            ORDER BY started_at DESC NULLS LAST, scheduled_at DESC NULLS LAST
            LIMIT 1
        """), params)).mappings().first()
        if live:
            return {"state": "LIVE", "event": _ser(dict(live))}

        # 3. Scheduled block in window — Postgres DOW: Mon=1..Sun=0; we store
        # Mon=0..Sun=6, so day_of_week = (EXTRACT(ISODOW) - 1).
        sched_where = ["s.deleted_at IS NULL"]
        sparams: dict[str, Any] = {}
        if branch_filter:
            sched_where.append("(s.branch_id = :b OR s.branch_id IS NULL)")
            sparams["b"] = branch_filter
        block = (await db.execute(text(f"""
            SELECT s.id::text, s.branch_id, s.day_of_week,
                   s.start_time::text AS start_time, s.duration_min,
                   s.asset_id::text AS asset_id, s.title_override,
                   a.title AS asset_title, a.kind AS asset_kind,
                   a.thumbnail_url AS asset_thumb,
                   a.youtube_video_id AS asset_yt, a.source_url AS asset_url,
                   a.duration_seconds AS asset_duration
            FROM broadcast_schedule_blocks s
            LEFT JOIN broadcast_assets a ON a.id = s.asset_id
            WHERE {' AND '.join(sched_where)}
              AND s.day_of_week = (EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Europe/London')::int - 1)
              AND NOW() AT TIME ZONE 'Europe/London' BETWEEN
                  (CURRENT_DATE + s.start_time) AND
                  (CURRENT_DATE + s.start_time + (s.duration_min || ' minutes')::interval)
            ORDER BY (s.branch_id = :b) DESC NULLS LAST, s.start_time DESC
            LIMIT 1
        """), {**sparams, "b": branch_filter or ""})).mappings().first()
        if block:
            return {"state": "SCHEDULED_NOW", "block": _ser(dict(block)),
                    "as_of": now.isoformat()}

        # 4. Next upcoming
        upcoming = (await db.execute(text(f"""
            SELECT s.id::text, s.branch_id, s.day_of_week,
                   s.start_time::text AS start_time, s.duration_min,
                   a.title AS asset_title, a.kind AS asset_kind,
                   a.thumbnail_url AS asset_thumb,
                   a.youtube_video_id AS asset_yt
            FROM broadcast_schedule_blocks s
            LEFT JOIN broadcast_assets a ON a.id = s.asset_id
            WHERE {' AND '.join(sched_where)}
            ORDER BY
                CASE WHEN s.day_of_week >= (EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Europe/London')::int - 1)
                     THEN s.day_of_week
                     ELSE s.day_of_week + 7 END,
                s.start_time
            LIMIT 1
        """), sparams)).mappings().first()
        if upcoming:
            return {"state": "UPCOMING", "block": _ser(dict(upcoming)),
                    "as_of": now.isoformat()}

    return {"state": "OFFLINE", "as_of": now.isoformat()}


@router.get("/broadcast/schedule")
async def public_schedule(branch_id: str = "") -> dict[str, Any]:
    """Public weekly schedule for the TV viewer page."""
    where = ["s.deleted_at IS NULL"]
    params: dict[str, Any] = {}
    if branch_id:
        where.append("(s.branch_id = :b OR s.branch_id IS NULL)")
        params["b"] = branch_id
    sql = f"""
        SELECT s.day_of_week, s.start_time::text AS start_time, s.duration_min,
               s.title_override, s.branch_id,
               a.title AS asset_title, a.kind AS asset_kind,
               a.thumbnail_url AS asset_thumb, a.youtube_video_id AS asset_yt
        FROM broadcast_schedule_blocks s
        LEFT JOIN broadcast_assets a ON a.id = s.asset_id
        WHERE {' AND '.join(where)}
        ORDER BY s.day_of_week, s.start_time
    """
    async with SessionLocal() as db:
        rows = (await db.execute(text(sql), params)).mappings().all()
    return {"items": [_ser(r) for r in rows]}


@router.get("/broadcast/archive")
async def public_archive(kind: str = "", limit: int = 50) -> dict[str, Any]:
    """Past broadcasts available for replay — both ended live events and the
    content library marked rights_cleared. Public — no auth."""
    out: list[dict[str, Any]] = []
    async with SessionLocal() as db:
        # Ended live events with a recording
        ev_rows = (await db.execute(text("""
            SELECT id::text, title, description, branch_id, ended_at,
                   youtube_video_id, recording_url, viewer_count_peak,
                   'live_replay' AS source
            FROM broadcast_live_events
            WHERE status = 'ENDED'
              AND (youtube_video_id IS NOT NULL OR recording_url <> '')
            ORDER BY ended_at DESC NULLS LAST
            LIMIT :lim
        """), {"lim": max(1, min(int(limit), 200))})).mappings().all()
        out.extend(_ser(r) for r in ev_rows)

        asset_where = ["deleted_at IS NULL", "rights_cleared = true"]
        params: dict[str, Any] = {"lim": max(1, min(int(limit), 200))}
        if kind:
            asset_where.append("kind = :k")
            params["k"] = kind.upper()
        asset_rows = (await db.execute(text(f"""
            SELECT id::text, title, description, branch_id, created_at AS ended_at,
                   youtube_video_id, source_url AS recording_url,
                   0 AS viewer_count_peak, 'asset' AS source
            FROM broadcast_assets
            WHERE {' AND '.join(asset_where)}
            ORDER BY created_at DESC
            LIMIT :lim
        """), params)).mappings().all()
        out.extend(_ser(r) for r in asset_rows)

    return {"items": out[:limit]}


# ─── helpers ─────────────────────────────────────────────────────────────────

def _extract_youtube_id(url: str) -> str | None:
    """Pull the 11-char video id out of a YouTube URL of any common shape."""
    if not url:
        return None
    import re
    pats = [
        r"youtube\.com/watch\?v=([\w-]{11})",
        r"youtu\.be/([\w-]{11})",
        r"youtube\.com/live/([\w-]{11})",
        r"youtube\.com/embed/([\w-]{11})",
        r"youtube\.com/shorts/([\w-]{11})",
    ]
    for p in pats:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return url.strip() if len(url.strip()) == 11 else None


def _yt_thumb(video_id: str | None) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg" if video_id else ""
