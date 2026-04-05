"""
Smart Screen management router.
Handles content library, playlists, profiles and live scheduling for TV displays.
"""
from __future__ import annotations
from datetime import datetime, date
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from shital.api.deps import CurrentSpace, OptionalSpace

router = APIRouter(prefix="/screen", tags=["screen"])


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _db_one(sql: str, params: dict) -> dict | None:
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        r = await db.execute(text(sql), params)
        row = r.mappings().first()
    return dict(row) if row else None


async def _db_all(sql: str, params: dict | None = None) -> list[dict]:
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        r = await db.execute(text(sql), params or {})
        rows = r.mappings().all()
    return [dict(r) for r in rows]


async def _db_exec(sql: str, params: dict) -> None:
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        await db.execute(text(sql), params)
        await db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# CONTENT LIBRARY
# ══════════════════════════════════════════════════════════════════════════════

class ContentItemInput(BaseModel):
    title: str
    content_type: str = "IMAGE"          # IMAGE VIDEO AUDIO IMAGE_AUDIO YOUTUBE WEBSITE STREAM BROADCAST
    media_url: str = ""
    audio_url: str = ""
    thumbnail_url: str = ""
    duration_secs: int = 10              # 0 = natural (video/audio)
    is_live: bool = False
    youtube_id: str = ""
    website_url: str = ""
    description: str = ""
    tags: str = ""
    branch_id: str = "main"


@router.get("/content")
async def list_content(ctx: OptionalSpace, branch_id: str = "main", content_type: str = "") -> dict[str, Any]:
    sql = """
        SELECT id, title, content_type, media_url, audio_url, thumbnail_url,
               duration_secs, is_live, youtube_id, website_url,
               description, tags, branch_id, created_at
        FROM screen_content_items
        WHERE branch_id = :bid AND deleted_at IS NULL
        {type_filter}
        ORDER BY created_at DESC
    """
    params: dict = {"bid": branch_id}
    if content_type:
        sql = sql.replace("{type_filter}", "AND content_type = :ct")
        params["ct"] = content_type
    else:
        sql = sql.replace("{type_filter}", "")
    items = await _db_all(sql, params)
    return {"items": items, "count": len(items)}


@router.post("/content")
async def create_content(body: ContentItemInput, ctx: CurrentSpace) -> dict[str, Any]:
    import uuid
    item_id = str(uuid.uuid4())
    now = datetime.utcnow()
    await _db_exec("""
        INSERT INTO screen_content_items
            (id, branch_id, title, content_type, media_url, audio_url, thumbnail_url,
             duration_secs, is_live, youtube_id, website_url, description, tags,
             created_at, updated_at)
        VALUES
            (:id, :bid, :title, :ct, :media, :audio, :thumb,
             :dur, :live, :yt, :web, :desc, :tags,
             :now, :now)
    """, {
        "id": item_id, "bid": body.branch_id, "title": body.title,
        "ct": body.content_type, "media": body.media_url, "audio": body.audio_url,
        "thumb": body.thumbnail_url, "dur": body.duration_secs, "live": body.is_live,
        "yt": body.youtube_id, "web": body.website_url,
        "desc": body.description, "tags": body.tags, "now": now,
    })
    return {"id": item_id, "created": True}


@router.put("/content/{item_id}")
async def update_content(item_id: str, body: ContentItemInput, ctx: CurrentSpace) -> dict[str, Any]:
    now = datetime.utcnow()
    await _db_exec("""
        UPDATE screen_content_items SET
            title=:title, content_type=:ct, media_url=:media, audio_url=:audio,
            thumbnail_url=:thumb, duration_secs=:dur, is_live=:live,
            youtube_id=:yt, website_url=:web, description=:desc, tags=:tags,
            updated_at=:now
        WHERE id=:id AND deleted_at IS NULL
    """, {
        "id": item_id, "title": body.title, "ct": body.content_type,
        "media": body.media_url, "audio": body.audio_url, "thumb": body.thumbnail_url,
        "dur": body.duration_secs, "live": body.is_live, "yt": body.youtube_id,
        "web": body.website_url, "desc": body.description, "tags": body.tags, "now": now,
    })
    return {"id": item_id, "updated": True}


@router.delete("/content/{item_id}")
async def delete_content(item_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    await _db_exec(
        "UPDATE screen_content_items SET deleted_at=NOW() WHERE id=:id",
        {"id": item_id}
    )
    return {"id": item_id, "deleted": True}


# ══════════════════════════════════════════════════════════════════════════════
# PLAYLISTS
# ══════════════════════════════════════════════════════════════════════════════

class PlaylistInput(BaseModel):
    name: str
    description: str = ""
    shuffle: bool = False
    loop_playlist: bool = True
    branch_id: str = "main"


@router.get("/playlists")
async def list_playlists(ctx: OptionalSpace, branch_id: str = "main") -> dict[str, Any]:
    playlists = await _db_all("""
        SELECT p.id, p.name, p.description, p.shuffle, p.loop_playlist, p.branch_id,
               COUNT(pi.id) AS item_count
        FROM screen_playlists p
        LEFT JOIN screen_playlist_items pi ON pi.playlist_id = p.id
        WHERE p.branch_id = :bid AND p.deleted_at IS NULL
        GROUP BY p.id ORDER BY p.created_at DESC
    """, {"bid": branch_id})
    return {"playlists": playlists}


@router.post("/playlists")
async def create_playlist(body: PlaylistInput, ctx: CurrentSpace) -> dict[str, Any]:
    import uuid
    pl_id = str(uuid.uuid4())
    await _db_exec("""
        INSERT INTO screen_playlists (id, branch_id, name, description, shuffle, loop_playlist, created_at, updated_at)
        VALUES (:id, :bid, :name, :desc, :shuffle, :loop, NOW(), NOW())
    """, {"id": pl_id, "bid": body.branch_id, "name": body.name, "desc": body.description,
          "shuffle": body.shuffle, "loop": body.loop_playlist})
    return {"id": pl_id, "created": True}


@router.put("/playlists/{pl_id}")
async def update_playlist(pl_id: str, body: PlaylistInput, ctx: CurrentSpace) -> dict[str, Any]:
    await _db_exec("""
        UPDATE screen_playlists SET name=:name, description=:desc, shuffle=:shuffle,
            loop_playlist=:loop, updated_at=NOW()
        WHERE id=:id AND deleted_at IS NULL
    """, {"id": pl_id, "name": body.name, "desc": body.description,
          "shuffle": body.shuffle, "loop": body.loop_playlist})
    return {"id": pl_id, "updated": True}


@router.delete("/playlists/{pl_id}")
async def delete_playlist(pl_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    await _db_exec("UPDATE screen_playlists SET deleted_at=NOW() WHERE id=:id", {"id": pl_id})
    return {"id": pl_id, "deleted": True}


@router.get("/playlists/{pl_id}/items")
async def get_playlist_items(pl_id: str, ctx: OptionalSpace) -> dict[str, Any]:
    items = await _db_all("""
        SELECT pi.id AS playlist_item_id, pi.sort_order, pi.duration_secs AS duration_override,
               ci.id, ci.title, ci.content_type, ci.media_url, ci.audio_url, ci.thumbnail_url,
               ci.duration_secs, ci.is_live, ci.youtube_id, ci.website_url, ci.description
        FROM screen_playlist_items pi
        JOIN screen_content_items ci ON ci.id = pi.content_item_id
        WHERE pi.playlist_id = :pid AND ci.deleted_at IS NULL
        ORDER BY pi.sort_order ASC
    """, {"pid": pl_id})
    return {"items": items}


class PlaylistItemInput(BaseModel):
    content_item_id: str
    sort_order: int = 0
    duration_secs: int | None = None


@router.post("/playlists/{pl_id}/items")
async def add_playlist_item(pl_id: str, body: PlaylistItemInput, ctx: CurrentSpace) -> dict[str, Any]:
    import uuid
    item_id = str(uuid.uuid4())
    await _db_exec("""
        INSERT INTO screen_playlist_items (id, playlist_id, content_item_id, sort_order, duration_secs)
        VALUES (:id, :pid, :cid, :order, :dur)
    """, {"id": item_id, "pid": pl_id, "cid": body.content_item_id,
          "order": body.sort_order, "dur": body.duration_secs})
    return {"id": item_id, "created": True}


@router.delete("/playlists/{pl_id}/items/{item_id}")
async def remove_playlist_item(pl_id: str, item_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    await _db_exec(
        "DELETE FROM screen_playlist_items WHERE id=:id AND playlist_id=:pid",
        {"id": item_id, "pid": pl_id}
    )
    return {"deleted": True}


@router.put("/playlists/{pl_id}/items/reorder")
async def reorder_playlist(pl_id: str, body: list[dict], ctx: CurrentSpace) -> dict[str, Any]:
    """body: [{id: playlist_item_id, sort_order: int}]"""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        for item in body:
            await db.execute(
                text("UPDATE screen_playlist_items SET sort_order=:o WHERE id=:id AND playlist_id=:pid"),
                {"o": item["sort_order"], "id": item["id"], "pid": pl_id}
            )
        await db.commit()
    return {"reordered": True}


# ══════════════════════════════════════════════════════════════════════════════
# PROFILES (one per physical screen)
# ══════════════════════════════════════════════════════════════════════════════

class ProfileInput(BaseModel):
    name: str
    location: str = ""
    description: str = ""
    branch_id: str = "main"
    display_mode: str = "playlist"       # playlist | live | scheduled | temple
    default_playlist_id: str | None = None
    live_url: str = ""
    live_type: str = "stream"            # stream | youtube | website | broadcast
    schedule_json: str = "[]"
    is_active: bool = True


@router.get("/profiles")
async def list_profiles(ctx: OptionalSpace, branch_id: str = "main") -> dict[str, Any]:
    profiles = await _db_all("""
        SELECT p.id, p.name, p.location, p.description, p.branch_id,
               p.display_mode, p.default_playlist_id, p.live_url, p.live_type,
               p.schedule_json, p.is_active, p.created_at,
               pl.name AS playlist_name
        FROM screen_profiles p
        LEFT JOIN screen_playlists pl ON pl.id = p.default_playlist_id
        WHERE p.branch_id = :bid AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
    """, {"bid": branch_id})
    return {"profiles": profiles}


@router.post("/profiles")
async def create_profile(body: ProfileInput, ctx: CurrentSpace) -> dict[str, Any]:
    import uuid
    profile_id = str(uuid.uuid4())
    await _db_exec("""
        INSERT INTO screen_profiles
            (id, branch_id, name, location, description, display_mode,
             default_playlist_id, live_url, live_type, schedule_json, is_active,
             created_at, updated_at)
        VALUES
            (:id, :bid, :name, :loc, :desc, :mode,
             :pl_id, :live_url, :live_type, :sched::jsonb, :active,
             NOW(), NOW())
    """, {
        "id": profile_id, "bid": body.branch_id, "name": body.name,
        "loc": body.location, "desc": body.description, "mode": body.display_mode,
        "pl_id": body.default_playlist_id or None,
        "live_url": body.live_url, "live_type": body.live_type,
        "sched": body.schedule_json, "active": body.is_active,
    })
    return {"id": profile_id, "created": True}


@router.put("/profiles/{profile_id}")
async def update_profile(profile_id: str, body: ProfileInput, ctx: CurrentSpace) -> dict[str, Any]:
    await _db_exec("""
        UPDATE screen_profiles SET
            name=:name, location=:loc, description=:desc, display_mode=:mode,
            default_playlist_id=:pl_id, live_url=:live_url, live_type=:live_type,
            schedule_json=:sched::jsonb, is_active=:active, updated_at=NOW()
        WHERE id=:id AND deleted_at IS NULL
    """, {
        "id": profile_id, "name": body.name, "loc": body.location,
        "desc": body.description, "mode": body.display_mode,
        "pl_id": body.default_playlist_id or None,
        "live_url": body.live_url, "live_type": body.live_type,
        "sched": body.schedule_json, "active": body.is_active,
    })
    return {"id": profile_id, "updated": True}


@router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    await _db_exec(
        "UPDATE screen_profiles SET deleted_at=NOW() WHERE id=:id",
        {"id": profile_id}
    )
    return {"id": profile_id, "deleted": True}


@router.get("/profiles/{profile_id}/current")
async def get_current_content(profile_id: str, ctx: OptionalSpace) -> dict[str, Any]:
    """
    Returns what the screen should be showing RIGHT NOW.
    Checks schedule first, falls back to default_playlist, then temple mode.
    """
    import json as json_mod
    from datetime import datetime

    # Allow 'default' as alias
    if profile_id == "default":
        profiles = await _db_all(
            "SELECT id FROM screen_profiles WHERE is_active=true AND deleted_at IS NULL LIMIT 1", {}
        )
        if profiles:
            profile_id = profiles[0]["id"]
        else:
            return _temple_fallback()

    profile = await _db_one("""
        SELECT id, name, display_mode, default_playlist_id, live_url, live_type,
               schedule_json, is_active, branch_id
        FROM screen_profiles WHERE id=:id AND deleted_at IS NULL
    """, {"id": profile_id})

    if not profile:
        return _temple_fallback()

    mode = profile["display_mode"]

    # ── Live mode ───────────────────────────────────────────────────────────
    if mode == "live":
        return {
            "mode": "live",
            "live_url": profile["live_url"],
            "live_type": profile["live_type"],
            "profile": profile,
            "items": [],
        }

    # ── Scheduled mode ──────────────────────────────────────────────────────
    if mode == "scheduled":
        now = datetime.now()
        schedule = profile.get("schedule_json") or []
        if isinstance(schedule, str):
            try:
                schedule = json_mod.loads(schedule)
            except Exception:
                schedule = []

        current_slot = None
        for slot in schedule:
            slot_days = slot.get("days", list(range(7)))
            if now.weekday() in slot_days:
                start = slot.get("start_time", "00:00").split(":")
                end   = slot.get("end_time",   "23:59").split(":")
                s = now.replace(hour=int(start[0]), minute=int(start[1]), second=0)
                e = now.replace(hour=int(end[0]),   minute=int(end[1]),   second=0)
                if s <= now <= e:
                    current_slot = slot
                    break

        if current_slot and current_slot.get("playlist_id"):
            items = await _get_playlist_items(current_slot["playlist_id"])
            return {"mode": "playlist", "items": items, "profile": profile}

    # ── Temple default mode ─────────────────────────────────────────────────
    if mode == "temple":
        return _temple_fallback()

    # ── Playlist mode (default fallback) ───────────────────────────────────
    pl_id = profile.get("default_playlist_id")
    if pl_id:
        items = await _get_playlist_items(pl_id)
        return {"mode": "playlist", "items": items, "profile": profile}

    return _temple_fallback()


async def _get_playlist_items(pl_id: str) -> list[dict]:
    return await _db_all("""
        SELECT ci.id, ci.title, ci.content_type, ci.media_url, ci.audio_url,
               ci.thumbnail_url, ci.is_live, ci.youtube_id, ci.website_url, ci.description,
               COALESCE(pi.duration_secs, ci.duration_secs, 10) AS duration_secs
        FROM screen_playlist_items pi
        JOIN screen_content_items ci ON ci.id = pi.content_item_id
        WHERE pi.playlist_id = :pid AND ci.deleted_at IS NULL
        ORDER BY pi.sort_order ASC
    """, {"pid": pl_id})


def _temple_fallback() -> dict:
    return {
        "mode": "temple",
        "items": [],
        "profile": {"name": "Shital Hindu Temple", "display_mode": "temple"},
    }
