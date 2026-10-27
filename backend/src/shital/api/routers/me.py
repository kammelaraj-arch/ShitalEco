"""Self-service profile endpoints — the signed-in user updates their own
display name, email, phone, and 4+ digit PIN.

Separate from `/users/{id}` (admin-manages-others), because the write
rules are different: the user never needs to supply a role, branch, or
is_active flag, and must only touch their own row.

Endpoints:
  GET  /me/profile         fetch own profile
  PUT  /me/profile         update display name / phone / email
  PUT  /me/pin             set / change PIN (4+ digits, bcrypt-hashed)
"""
from __future__ import annotations

import re
from typing import Any

import bcrypt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal

router = APIRouter(prefix="/me", tags=["me"])


_PIN_RE = re.compile(r"^\d{4,8}$")
_PHONE_RE = re.compile(r"^[\d +()\-]{5,30}$")


class ProfileIn(BaseModel):
    name: str | None = None            # display name
    email: EmailStr | None = None
    phone: str | None = None


class PinIn(BaseModel):
    pin: str                            # 4 to 8 digits
    current_pin: str | None = None      # required if a PIN is already set


def _row_to_profile(r: Any) -> dict[str, Any]:
    d = dict(r)
    return {
        "id":            str(d["id"]),
        "email":         d["email"],
        "name":          d["name"] or "",
        "phone":         d["phone"] or "",
        "role":          d["role"],
        "branch_id":     d["branch_id"] or "",
        "auth_provider": d["auth_provider"],
        "has_pin":       bool(d.get("pin_hash")),
    }


@router.get("/profile")
async def get_profile(ctx: CurrentSpace) -> dict[str, Any]:
    uid = str(getattr(ctx, "user_id", "") or "")
    if not uid or uid == "anonymous":
        raise HTTPException(401, detail="not signed in")
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT id, email, name, phone, role, branch_id, auth_provider,
                   pin_hash
            FROM users
            WHERE id = CAST(:uid AS uuid)
              AND deleted_at IS NULL
        """), {"uid": uid})).mappings().first()
    if not row:
        raise HTTPException(404, detail="user not found")
    return _row_to_profile(row)


@router.put("/profile")
async def update_profile(body: ProfileIn, ctx: CurrentSpace) -> dict[str, Any]:
    uid = str(getattr(ctx, "user_id", "") or "")
    if not uid or uid == "anonymous":
        raise HTTPException(401, detail="not signed in")

    sets: list[str] = []
    params: dict[str, Any] = {"uid": uid}

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(422, detail="display name cannot be blank")
        if len(name) > 200:
            raise HTTPException(422, detail="display name must be <= 200 chars")
        sets.append("name = :name")
        params["name"] = name

    if body.email is not None:
        new_email = str(body.email).strip().lower()
        async with SessionLocal() as db:
            clash = (await db.execute(text("""
                SELECT 1 FROM users
                WHERE LOWER(email) = :e
                  AND id <> CAST(:uid AS uuid)
                  AND deleted_at IS NULL
                LIMIT 1
            """), {"e": new_email, "uid": uid})).first()
        if clash:
            raise HTTPException(409, detail="email already used by another account")
        sets.append("email = :email")
        params["email"] = new_email

    if body.phone is not None:
        phone = body.phone.strip()
        if phone and not _PHONE_RE.match(phone):
            raise HTTPException(422, detail="phone must be digits, spaces or +()-")
        sets.append("phone = :phone")
        params["phone"] = phone or None

    if not sets:
        raise HTTPException(422, detail="nothing to update")

    sets.append("updated_at = NOW()")
    async with SessionLocal() as db:
        await db.execute(text(f"""
            UPDATE users
            SET {", ".join(sets)}
            WHERE id = CAST(:uid AS uuid)
              AND deleted_at IS NULL
        """), params)
        await db.commit()

    return await get_profile(ctx)


@router.put("/pin")
async def set_pin(body: PinIn, ctx: CurrentSpace) -> dict[str, Any]:
    uid = str(getattr(ctx, "user_id", "") or "")
    if not uid or uid == "anonymous":
        raise HTTPException(401, detail="not signed in")

    new_pin = (body.pin or "").strip()
    if not _PIN_RE.match(new_pin):
        raise HTTPException(422, detail="pin must be 4 to 8 digits")

    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT pin_hash FROM users
            WHERE id = CAST(:uid AS uuid)
              AND deleted_at IS NULL
        """), {"uid": uid})).mappings().first()
        if not row:
            raise HTTPException(404, detail="user not found")

        existing = row["pin_hash"]
        if existing:
            cur = (body.current_pin or "").strip()
            if not cur:
                raise HTTPException(422, detail="current PIN required to change")
            if not bcrypt.checkpw(cur.encode(), existing.encode()):
                raise HTTPException(403, detail="current PIN is wrong")

        new_hash = bcrypt.hashpw(new_pin.encode(), bcrypt.gensalt()).decode()
        await db.execute(text("""
            UPDATE users SET pin_hash = :h, updated_at = NOW()
            WHERE id = CAST(:uid AS uuid)
              AND deleted_at IS NULL
        """), {"h": new_hash, "uid": uid})
        await db.commit()

    return {"ok": True, "has_pin": True}
