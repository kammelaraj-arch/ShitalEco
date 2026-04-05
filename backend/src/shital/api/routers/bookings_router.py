"""Bookings router — room and hall booking management."""
from __future__ import annotations
from datetime import datetime
import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal
from sqlalchemy import text

router = APIRouter(prefix="/bookings", tags=["bookings"])


class BookingIn(BaseModel):
    title: str
    room: str = "Main Hall"
    booking_date: str
    start_time: str = "09:00"
    end_time: str = "10:00"
    organiser_name: str = ""
    organiser_email: str = ""
    organiser_phone: str = ""
    attendees: int = 0
    description: str = ""
    notes: str = ""


def _serialize(rows: list) -> list:
    out = []
    for r in rows:
        d = dict(r)
        for k in ("booking_date", "created_at", "updated_at", "deleted_at"):
            if d.get(k) and hasattr(d[k], "isoformat"):
                d[k] = d[k].isoformat()
        out.append(d)
    return out


@router.get("")
async def list_bookings(ctx: CurrentSpace, from_date: str = "", to_date: str = "", room: str = ""):
    async with SessionLocal() as db:
        where = "branch_id = :bid AND deleted_at IS NULL"
        params: dict = {"bid": ctx.branch_id}
        if from_date:
            where += " AND booking_date >= :from_date"
            params["from_date"] = from_date
        if to_date:
            where += " AND booking_date <= :to_date"
            params["to_date"] = to_date
        if room:
            where += " AND room = :room"
            params["room"] = room
        result = await db.execute(
            text(f"SELECT * FROM bookings WHERE {where} ORDER BY booking_date, start_time"),
            params,
        )
        rows = _serialize(result.mappings().all())
    return {"bookings": rows}


@router.post("")
async def create_booking(body: BookingIn, ctx: CurrentSpace):
    booking_id = str(uuid.uuid4())
    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO bookings
                (id, branch_id, title, description, room, booking_date,
                 start_time, end_time, organiser_name, organiser_email,
                 organiser_phone, attendees, status, notes, created_at, updated_at)
                VALUES (:id, :bid, :title, :desc, :room, :date, :start, :end,
                        :org_name, :org_email, :org_phone, :attendees,
                        'CONFIRMED', :notes, :now, :now)
            """),
            {
                "id": booking_id, "bid": ctx.branch_id, "title": body.title,
                "desc": body.description or None, "room": body.room,
                "date": body.booking_date, "start": body.start_time, "end": body.end_time,
                "org_name": body.organiser_name or None,
                "org_email": body.organiser_email or None,
                "org_phone": body.organiser_phone or None,
                "attendees": body.attendees, "notes": body.notes or None, "now": now,
            },
        )
        await db.commit()
    return {"id": booking_id, "title": body.title}


@router.delete("/{booking_id}")
async def cancel_booking(booking_id: str, ctx: CurrentSpace):
    async with SessionLocal() as db:
        await db.execute(
            text("UPDATE bookings SET status='CANCELLED', deleted_at=NOW(), updated_at=NOW() WHERE id=:id AND branch_id=:bid"),
            {"id": booking_id, "bid": ctx.branch_id},
        )
        await db.commit()
    return {"cancelled": booking_id}
