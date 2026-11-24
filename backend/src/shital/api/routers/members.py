"""
Members register + AGM voting.

Routes (admin):
  GET    /admin/members                            list (filter by status / type)
  POST   /admin/members                            create
  GET    /admin/members/{mid}                      detail
  PUT    /admin/members/{mid}                      edit
  DELETE /admin/members/{mid}                      mark RESIGNED
  POST   /admin/members/import-csv                 CSV import (append + update)
  GET    /admin/members/stats                      counts tile

  POST   /admin/board/resolutions/{rid}/member-vote  mark resolution as a member vote
  POST   /admin/board/resolutions/{rid}/send-member-notice
                                                   fan-out notice via existing
                                                   send_raw_email path

Routes (public, magic-link):
  GET    /public/member/{token}                    detail of the member resolution
  POST   /public/member/{token}/vote               cast / change vote
"""
from __future__ import annotations

import csv
import hashlib
import json
import secrets
from datetime import UTC, datetime
from io import StringIO
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["members"])


def _require_admin(ctx: CurrentSpace) -> None:
    if ctx.role not in {"SUPER_ADMIN", "ADMIN", "TRUSTEE", "CHAIR",
                        "SECRETARY", "CEO"}:
        raise HTTPException(status_code=403, detail="Admin / trustee role required")


class MemberIn(BaseModel):
    full_name: str
    email: str = ""
    phone: str = ""
    address: str = ""
    postcode: str = ""
    membership_type: str = "ORDINARY"
    joined_at: str | None = None
    subscription_paid_until: str | None = None
    voting_rights: bool = True
    gift_aid_declared: bool = False
    notes: str = ""


class MemberPatch(BaseModel):
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    postcode: str | None = None
    membership_type: str | None = None
    joined_at: str | None = None
    resigned_at: str | None = None
    resignation_reason: str | None = None
    status: str | None = None
    subscription_paid_until: str | None = None
    voting_rights: bool | None = None
    gift_aid_declared: bool | None = None
    notes: str | None = None


class MemberResolutionIn(BaseModel):
    is_special: bool = False
    required_notice_days: int = 14
    members_quorum: int = 0
    closes_at: str | None = None


class CSVIn(BaseModel):
    csv_text: str


class VoteIn(BaseModel):
    choice: str   # FOR | AGAINST | ABSTAIN
    comment: str = ""


def _issue_token(member_id: str) -> tuple[str, str]:
    raw = f"m.{member_id}.{secrets.token_urlsafe(24)}"
    h = hashlib.sha256(raw.encode()).hexdigest()
    return raw, h


async def _audit(
    db: Any, *, action: str, entity_type: str, entity_id: str,
    ctx: CurrentSpace, metadata: dict[str, Any], ip: str, ua: str,
) -> None:
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO board_audit_log
        (actor_user_id, actor_name, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (:uid, :name, :act, :et, CAST(:eid AS uuid),
                CAST(:meta AS jsonb), :ip, :ua)
    """), {
        "uid":  str(ctx.user_id) if ctx.user_id else None,
        "name": ctx.user_email or "",
        "act":  action,
        "et":   entity_type,
        "eid":  entity_id,
        "meta": json.dumps(metadata),
        "ip": ip, "ua": ua,
    })


# ── Members admin ──────────────────────────────────────────────────────

@router.get("/admin/members")
async def list_members(
    ctx: CurrentSpace, status: str | None = None, membership_type: str | None = None,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    conds: list[str] = []
    params: dict[str, Any] = {}
    if status:
        conds.append("status = :s")
        params["s"] = status
    if membership_type:
        conds.append("membership_type = :mt")
        params["mt"] = membership_type
    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    async with SessionLocal() as db:
        rows = (await db.execute(text(
            f"SELECT id, full_name, email, phone, membership_type, "
            f"joined_at, resigned_at, status, subscription_paid_until, "
            f"voting_rights, gift_aid_declared, created_at "
            f"FROM members{where} ORDER BY full_name"
        ), params)).mappings().all()
    return {"members": [dict(r) for r in rows]}


@router.get("/admin/members/stats")
async def member_stats(ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT
              COUNT(*)                                        AS total,
              COUNT(*) FILTER (WHERE status = 'ACTIVE')       AS active,
              COUNT(*) FILTER (WHERE status = 'LAPSED')       AS lapsed,
              COUNT(*) FILTER (WHERE voting_rights = true AND status = 'ACTIVE') AS voting,
              COUNT(*) FILTER (
                  WHERE subscription_paid_until IS NOT NULL
                    AND subscription_paid_until <= CURRENT_DATE + INTERVAL '30 days'
                    AND status = 'ACTIVE'
              ) AS renewal_due_30d
            FROM members
        """))).mappings().one()
    return dict(row)


@router.post("/admin/members")
async def create_member(
    body: MemberIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO members
            (full_name, email, phone, address, postcode, membership_type,
             joined_at, subscription_paid_until, voting_rights,
             gift_aid_declared, notes, created_by)
            VALUES (:fn, :e, :p, :a, :pc, :mt, :ja, :spu, :vr, :ga, :n, :by)
            RETURNING id
        """), {
            "fn": body.full_name.strip()[:255],
            "e":  body.email.strip().lower()[:254],
            "p":  body.phone.strip()[:40],
            "a":  body.address.strip(),
            "pc": body.postcode.strip().upper()[:20],
            "mt": body.membership_type,
            "ja": body.joined_at,
            "spu": body.subscription_paid_until,
            "vr": body.voting_rights,
            "ga": body.gift_aid_declared,
            "n":  body.notes.strip(),
            "by": str(ctx.user_id) if ctx.user_id else None,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="MEMBER_CREATED", entity_type="members",
            entity_id=new_id, ctx=ctx,
            metadata={"full_name": body.full_name, "type": body.membership_type},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.get("/admin/members/{member_id}")
async def get_member(member_id: str, ctx: CurrentSpace) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text(
            "SELECT * FROM members WHERE id::text = :id"
        ), {"id": member_id})).mappings().one_or_none()
    if not row:
        raise HTTPException(404, detail="Member not found")
    return {"member": dict(row)}


@router.put("/admin/members/{member_id}")
async def update_member(
    member_id: str, body: MemberPatch,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    data: dict[str, Any] = body.model_dump(exclude_none=True)
    if not data:
        return {"id": member_id, "success": True, "noop": True}
    if "email" in data:
        data["email"] = data["email"].strip().lower()
    sets = [f"{k} = :{k}" for k in data]
    data["id"]  = member_id
    data["now"] = datetime.now(UTC)
    sets.append("updated_at = :now")
    async with SessionLocal() as db:
        res = await db.execute(text(
            f"UPDATE members SET {', '.join(sets)} WHERE id::text = :id RETURNING id"
        ), data)
        if not res.first():
            raise HTTPException(404, detail="Member not found")
        await _audit(
            db, action="MEMBER_UPDATED", entity_type="members",
            entity_id=member_id, ctx=ctx,
            metadata={"fields": list(body.model_dump(exclude_none=True).keys())},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": member_id, "success": True}


@router.delete("/admin/members/{member_id}")
async def resign_member(
    member_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = await db.execute(text(
            "UPDATE members SET status = 'RESIGNED', resigned_at = CURRENT_DATE, "
            "updated_at = NOW() WHERE id::text = :id RETURNING id"
        ), {"id": member_id})
        if not res.first():
            raise HTTPException(404, detail="Member not found")
        await _audit(
            db, action="MEMBER_RESIGNED", entity_type="members",
            entity_id=member_id, ctx=ctx, metadata={},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": member_id, "success": True}


@router.post("/admin/members/import-csv")
async def import_csv(
    body: CSVIn, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    """Accept CSV with columns: full_name, email, phone, membership_type,
    joined_at. Updates existing rows by email match (case-insensitive);
    inserts new ones otherwise."""
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    reader = csv.DictReader(StringIO(body.csv_text))
    created = 0
    updated = 0
    errors: list[str] = []
    async with SessionLocal() as db:
        for i, row in enumerate(reader, start=2):
            full_name = (row.get("full_name") or "").strip()
            email     = (row.get("email") or "").strip().lower()
            if not full_name:
                errors.append(f"row {i}: missing full_name")
                continue
            phone     = (row.get("phone") or "").strip()
            mt        = (row.get("membership_type") or "ORDINARY").upper()
            ja        = row.get("joined_at") or None
            if email:
                existing = (await db.execute(text(
                    "SELECT id FROM members WHERE LOWER(email) = :e"
                ), {"e": email})).first()
                if existing:
                    await db.execute(text("""
                        UPDATE members SET
                          full_name = :fn, phone = :p, membership_type = :mt,
                          joined_at = COALESCE(joined_at, :ja),
                          updated_at = NOW()
                        WHERE id = :id
                    """), {
                        "fn": full_name, "p": phone, "mt": mt, "ja": ja,
                        "id": existing[0],
                    })
                    updated += 1
                    continue
            await db.execute(text("""
                INSERT INTO members
                (full_name, email, phone, membership_type, joined_at, status)
                VALUES (:fn, :e, :p, :mt, :ja, 'ACTIVE')
            """), {"fn": full_name, "e": email, "p": phone, "mt": mt, "ja": ja})
            created += 1
        await _audit(
            db, action="MEMBERS_CSV_IMPORT", entity_type="members",
            entity_id="00000000-0000-0000-0000-000000000000", ctx=ctx,
            metadata={"created": created, "updated": updated,
                      "errors_count": len(errors)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"created": created, "updated": updated, "errors": errors,
            "success": True}


# ── AGM / Member resolutions ────────────────────────────────────────────

@router.post("/admin/board/resolutions/{resolution_id}/member-vote")
async def mark_as_member_vote(
    resolution_id: str, body: MemberResolutionIn,
    request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            INSERT INTO member_resolutions
            (resolution_id, is_special, required_notice_days,
             members_quorum, closes_at)
            VALUES (CAST(:rid AS uuid), :sp, :nd, :mq, :c)
            ON CONFLICT (resolution_id) DO UPDATE SET
              is_special          = EXCLUDED.is_special,
              required_notice_days= EXCLUDED.required_notice_days,
              members_quorum      = EXCLUDED.members_quorum,
              closes_at           = EXCLUDED.closes_at,
              updated_at          = NOW()
            RETURNING id
        """), {
            "rid": resolution_id,
            "sp":  body.is_special,
            "nd":  body.required_notice_days,
            "mq":  body.members_quorum,
            "c":   body.closes_at,
        })).first()
        new_id = str(row[0]) if row else ""
        await _audit(
            db, action="RESOLUTION_MARKED_MEMBER_VOTE",
            entity_type="member_resolutions", entity_id=new_id, ctx=ctx,
            metadata={"resolution_id": resolution_id,
                      "is_special": body.is_special,
                      "notice_days": body.required_notice_days},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"id": new_id, "success": True}


@router.post("/admin/board/resolutions/{resolution_id}/send-member-notice")
async def send_member_notice(
    resolution_id: str, request: Request, ctx: CurrentSpace,
) -> dict[str, Any]:
    _require_admin(ctx)
    from sqlalchemy import text

    from shital.api.routers.email_templates import send_raw_email
    from shital.core.fabrics.database import SessionLocal
    async with SessionLocal() as db:
        res = (await db.execute(text("""
            SELECT r.title, r.recommendation, mr.is_special,
                   mr.required_notice_days, mr.closes_at
            FROM   member_resolutions mr
            JOIN   resolutions r ON r.id = mr.resolution_id
            WHERE  r.id::text = :id
        """), {"id": resolution_id})).mappings().one_or_none()
        if not res:
            raise HTTPException(404, detail="Member resolution not found")
        members = (await db.execute(text(
            "SELECT id, full_name, email FROM members "
            "WHERE status = 'ACTIVE' AND voting_rights = true AND email <> ''"
        ))).mappings().all()
        subject = f"[AGM] {res['title']}"
        sent_ok = 0
        for m in members:
            # Issue a fresh magic token and persist its hash.
            raw, h = _issue_token(str(m["id"]))
            await db.execute(text(
                "UPDATE members SET magic_token_hash = :h, updated_at = NOW() "
                "WHERE id = :id"
            ), {"h": h, "id": m["id"]})
            link = f"https://shital.org.uk/member/{raw}"
            html = f"""
            <p>Dear {m['full_name']},</p>
            <p>You are entitled to vote on the following
            {'<b>special</b>' if res['is_special'] else ''} member resolution:</p>
            <h3>{res['title']}</h3>
            <div>{res['recommendation']}</div>
            <p><a href="{link}">Open the voting page</a> — {res['required_notice_days']} days' notice is being given.</p>
            <p>Jay Shri Krishna 🙏<br>Shital Board Secretariat</p>
            """.strip()
            result = await send_raw_email(
                to_email=m["email"], subject=subject,
                html_body=html, text_body="",
                template_key="member_resolution_notice",
                related_type="member_resolution",
                related_id=resolution_id,
                triggered_by="member_notice",
            )
            if result.get("sent"):
                sent_ok += 1
        await db.execute(text(
            "UPDATE member_resolutions SET members_notice_sent_at = NOW() "
            "WHERE resolution_id::text = :id"
        ), {"id": resolution_id})
        await _audit(
            db, action="MEMBER_NOTICE_SENT", entity_type="member_resolutions",
            entity_id=resolution_id, ctx=ctx,
            metadata={"sent": sent_ok, "total_voters": len(members)},
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
        await db.commit()
    return {"sent": sent_ok, "total_voters": len(members), "success": True}


# ── Public magic-link vote ─────────────────────────────────────────────

@router.get("/public/member/{token}")
async def public_member_detail(token: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    h = hashlib.sha256(token.encode()).hexdigest()
    async with SessionLocal() as db:
        row = (await db.execute(text("""
            SELECT m.id AS member_id, m.full_name,
                   r.id AS resolution_id, r.title, r.recommendation,
                   mr.is_special, mr.closes_at,
                   mr.tally_for, mr.tally_against, mr.tally_abstain,
                   mr.outcome,
                   mv.choice AS my_choice, mv.cast_at
            FROM   members m
            CROSS  JOIN LATERAL (
              SELECT * FROM member_resolutions
              ORDER BY created_at DESC LIMIT 1
            ) mr
            JOIN   resolutions r ON r.id = mr.resolution_id
            LEFT   JOIN member_votes mv
                   ON mv.member_resolution_id = mr.id AND mv.member_id = m.id
            WHERE  m.magic_token_hash = :h
        """), {"h": h})).mappings().one_or_none()
    if not row:
        raise HTTPException(401, detail="Invalid or expired token")
    return {"vote": dict(row)}


@router.post("/public/member/{token}/vote")
async def public_cast_vote(
    token: str, body: VoteIn, request: Request,
) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    if body.choice not in ("FOR", "AGAINST", "ABSTAIN"):
        raise HTTPException(400, detail="choice must be FOR / AGAINST / ABSTAIN")
    h = hashlib.sha256(token.encode()).hexdigest()
    async with SessionLocal() as db:
        member = (await db.execute(text(
            "SELECT id, voting_rights, status FROM members WHERE magic_token_hash = :h"
        ), {"h": h})).mappings().one_or_none()
        if not member:
            raise HTTPException(401, detail="Invalid or expired token")
        if member["status"] != "ACTIVE" or not member["voting_rights"]:
            raise HTTPException(403, detail="You are not currently entitled to vote")
        mr = (await db.execute(text(
            "SELECT id, closes_at FROM member_resolutions "
            "ORDER BY created_at DESC LIMIT 1"
        ))).mappings().one_or_none()
        if not mr:
            raise HTTPException(404, detail="No open member resolution")
        if mr["closes_at"] and mr["closes_at"] < datetime.now(UTC):
            raise HTTPException(400, detail="Voting has closed")
        await db.execute(text("""
            INSERT INTO member_votes
            (member_resolution_id, member_id, choice, comment, cast_ip)
            VALUES (:mrid, :mid, :c, :cm, :ip)
            ON CONFLICT (member_resolution_id, member_id) DO UPDATE SET
              choice = EXCLUDED.choice,
              comment = EXCLUDED.comment,
              cast_at = NOW(),
              cast_ip = EXCLUDED.cast_ip
        """), {
            "mrid": mr["id"], "mid": member["id"],
            "c":    body.choice, "cm": body.comment.strip()[:1000],
            "ip":   request.client.host if request.client else "",
        })
        # Recompute tallies on the member resolution row.
        counts = (await db.execute(text("""
            SELECT
              COUNT(*) FILTER (WHERE choice = 'FOR')     AS f,
              COUNT(*) FILTER (WHERE choice = 'AGAINST') AS a,
              COUNT(*) FILTER (WHERE choice = 'ABSTAIN') AS b,
              COUNT(*)                                   AS n
            FROM member_votes WHERE member_resolution_id = :mrid
        """), {"mrid": mr["id"]})).mappings().one()
        await db.execute(text("""
            UPDATE member_resolutions SET
              tally_for = :f, tally_against = :a, tally_abstain = :b,
              voters_total = :n, updated_at = NOW()
            WHERE id = :id
        """), {
            "f": counts["f"], "a": counts["a"], "b": counts["b"],
            "n": counts["n"], "id": mr["id"],
        })
        await db.commit()
    return {"success": True, "choice": body.choice}
