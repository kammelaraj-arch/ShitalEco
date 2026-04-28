"""CRM Accounts (companies / organisations).

Reuses the existing contacts + addresses tables. An account links to
many contacts (with role) via account_contacts, has a list of services
it provides via account_services, and reuses the addresses table by
attaching addresses with a non-null account_id.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shital.api.deps import CurrentSpace

router = APIRouter(prefix="/admin/accounts", tags=["admin-accounts"])


# ─── Models ──────────────────────────────────────────────────────────────────

class AccountInput(BaseModel):
    name: str
    legal_name: str = ""
    account_type: str = "customer"  # customer / vendor / partner / donor / supplier / charity-partner
    status: str = "active"          # active / inactive / prospect
    website: str = ""
    email: str = ""
    phone: str = ""
    industry: str = ""
    registration_number: str = ""
    vat_number: str = ""
    charity_number: str = ""
    primary_contact_id: str | None = None
    parent_account_id: str | None = None
    branch_id: str = ""
    notes: str = ""


class LinkContactInput(BaseModel):
    contact_id: str
    role: str = ""
    is_primary: bool = False


class ServiceInput(BaseModel):
    service_name: str
    service_type: str = ""
    description: str = ""
    is_active: bool = True


class LinkAddressInput(BaseModel):
    address_id: str


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _account_to_dict(row: Any) -> dict[str, Any]:
    return {k: (str(v) if k.endswith("_id") and v is not None else v) for k, v in dict(row).items()}


# ─── Account list / create ──────────────────────────────────────────────────

@router.get("")
async def list_accounts(
    ctx: CurrentSpace,
    q: str = "",
    account_type: str = "",
    status: str = "",
    page: int = 1,
    per_page: int = 50,
) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    per_page = min(per_page, 200)
    offset = (page - 1) * per_page

    conditions = ["a.deleted_at IS NULL"]
    params: dict[str, Any] = {"limit": per_page, "offset": offset}

    if q:
        conditions.append("(a.name ILIKE :q OR a.legal_name ILIKE :q OR a.email ILIKE :q OR a.charity_number ILIKE :q)")
        params["q"] = f"%{q}%"
    if account_type:
        conditions.append("a.account_type = :account_type")
        params["account_type"] = account_type
    if status:
        conditions.append("a.status = :status")
        params["status"] = status

    where = " AND ".join(conditions)

    async with SessionLocal() as db:
        result = await db.execute(text(f"""
            SELECT
                a.id, a.name, a.legal_name, a.account_type, a.status,
                a.email, a.phone, a.website, a.industry, a.charity_number,
                a.branch_id, a.created_at, a.updated_at,
                pc.full_name AS primary_contact_name,
                (SELECT COUNT(*) FROM account_contacts ac WHERE ac.account_id = a.id) AS contacts_count,
                (SELECT COUNT(*) FROM account_services s WHERE s.account_id = a.id AND s.is_active) AS services_count
            FROM accounts a
            LEFT JOIN contacts pc ON pc.id = a.primary_contact_id
            WHERE {where}
            ORDER BY a.name
            LIMIT :limit OFFSET :offset
        """), params)
        rows = result.mappings().all()

        count_r = await db.execute(
            text(f"SELECT COUNT(*) AS cnt FROM accounts a WHERE {where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )
        total = int((count_r.mappings().first() or {}).get("cnt") or 0)

    return {
        "accounts": [_account_to_dict(r) for r in rows],
        "total": total, "page": page, "per_page": per_page,
    }


@router.post("")
async def create_account(ctx: CurrentSpace, body: AccountInput) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")

    async with SessionLocal() as db:
        result = await db.execute(text("""
            INSERT INTO accounts
                (name, legal_name, account_type, status, website, email, phone,
                 industry, registration_number, vat_number, charity_number,
                 primary_contact_id, parent_account_id, branch_id, notes, updated_at)
            VALUES
                (:name, :legal_name, :account_type, :status, :website, :email, :phone,
                 :industry, :registration_number, :vat_number, :charity_number,
                 :primary_contact_id, :parent_account_id, :branch_id, :notes, NOW())
            RETURNING id
        """), body.model_dump())
        new_id = str(result.mappings().first()["id"])

        # If primary_contact_id given, also create the link in account_contacts
        if body.primary_contact_id:
            await db.execute(text("""
                INSERT INTO account_contacts (account_id, contact_id, role, is_primary)
                VALUES (:aid, :cid, 'Primary', true)
                ON CONFLICT (account_id, contact_id) DO UPDATE SET is_primary = true
            """), {"aid": new_id, "cid": body.primary_contact_id})

        await db.commit()

    return {"id": new_id, "ok": True}


# ─── Single account: get / update / delete ───────────────────────────────────

@router.get("/{account_id}")
async def get_account(ctx: CurrentSpace, account_id: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        a = await db.execute(text("""
            SELECT a.*, pc.full_name AS primary_contact_name,
                   pa.name AS parent_account_name
            FROM accounts a
            LEFT JOIN contacts pc ON pc.id = a.primary_contact_id
            LEFT JOIN accounts pa ON pa.id = a.parent_account_id
            WHERE a.id = :id AND a.deleted_at IS NULL
        """), {"id": account_id})
        account = a.mappings().first()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")

        contacts_r = await db.execute(text("""
            SELECT ac.id AS link_id, ac.role, ac.is_primary, ac.created_at AS linked_at,
                   c.id AS contact_id, c.full_name, c.first_name, c.surname,
                   c.email, c.phone
            FROM account_contacts ac
            JOIN contacts c ON c.id = ac.contact_id
            WHERE ac.account_id = :id
            ORDER BY ac.is_primary DESC, c.full_name
        """), {"id": account_id})

        services_r = await db.execute(text("""
            SELECT id, service_name, service_type, description, is_active, created_at
            FROM account_services
            WHERE account_id = :id
            ORDER BY is_active DESC, service_name
        """), {"id": account_id})

        addresses_r = await db.execute(text("""
            SELECT id, formatted, postcode, house_number, uprn, is_primary, created_at
            FROM addresses
            WHERE account_id = :id
            ORDER BY is_primary DESC, created_at DESC
        """), {"id": account_id})

    return {
        "account":   _account_to_dict(account),
        "contacts":  [_account_to_dict(r) for r in contacts_r.mappings().all()],
        "services":  [_account_to_dict(r) for r in services_r.mappings().all()],
        "addresses": [_account_to_dict(r) for r in addresses_r.mappings().all()],
    }


@router.patch("/{account_id}")
async def update_account(ctx: CurrentSpace, account_id: str, body: AccountInput) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE accounts SET
                name                = :name,
                legal_name          = :legal_name,
                account_type        = :account_type,
                status              = :status,
                website             = :website,
                email               = :email,
                phone               = :phone,
                industry            = :industry,
                registration_number = :registration_number,
                vat_number          = :vat_number,
                charity_number      = :charity_number,
                primary_contact_id  = :primary_contact_id,
                parent_account_id   = :parent_account_id,
                branch_id           = :branch_id,
                notes               = :notes,
                updated_at          = NOW()
            WHERE id = :id AND deleted_at IS NULL
            RETURNING id
        """), {**body.model_dump(), "id": account_id})
        if not result.mappings().first():
            raise HTTPException(status_code=404, detail="Account not found")
        await db.commit()
    return {"ok": True}


@router.delete("/{account_id}")
async def delete_account(ctx: CurrentSpace, account_id: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        await db.execute(
            text("UPDATE accounts SET deleted_at = NOW() WHERE id = :id"),
            {"id": account_id},
        )
        await db.commit()
    return {"ok": True}


# ─── Linked contacts ─────────────────────────────────────────────────────────

@router.post("/{account_id}/contacts")
async def link_contact(ctx: CurrentSpace, account_id: str, body: LinkContactInput) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        # Promote/demote primary atomically
        if body.is_primary:
            await db.execute(text(
                "UPDATE account_contacts SET is_primary = false WHERE account_id = :aid"
            ), {"aid": account_id})

        await db.execute(text("""
            INSERT INTO account_contacts (account_id, contact_id, role, is_primary)
            VALUES (:aid, :cid, :role, :primary)
            ON CONFLICT (account_id, contact_id) DO UPDATE
                SET role = EXCLUDED.role, is_primary = EXCLUDED.is_primary
        """), {
            "aid": account_id, "cid": body.contact_id,
            "role": body.role, "primary": body.is_primary,
        })

        if body.is_primary:
            await db.execute(text(
                "UPDATE accounts SET primary_contact_id = :cid, updated_at = NOW() WHERE id = :aid"
            ), {"cid": body.contact_id, "aid": account_id})

        await db.commit()
    return {"ok": True}


@router.delete("/{account_id}/contacts/{contact_id}")
async def unlink_contact(ctx: CurrentSpace, account_id: str, contact_id: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        await db.execute(text(
            "DELETE FROM account_contacts WHERE account_id = :aid AND contact_id = :cid"
        ), {"aid": account_id, "cid": contact_id})
        # Clear primary if it pointed at the removed contact
        await db.execute(text("""
            UPDATE accounts SET primary_contact_id = NULL, updated_at = NOW()
            WHERE id = :aid AND primary_contact_id = :cid
        """), {"aid": account_id, "cid": contact_id})
        await db.commit()
    return {"ok": True}


# ─── Services ────────────────────────────────────────────────────────────────

@router.post("/{account_id}/services")
async def add_service(ctx: CurrentSpace, account_id: str, body: ServiceInput) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    if not body.service_name.strip():
        raise HTTPException(status_code=400, detail="service_name is required")

    async with SessionLocal() as db:
        result = await db.execute(text("""
            INSERT INTO account_services (account_id, service_name, service_type, description, is_active)
            VALUES (:aid, :name, :type, :desc, :active)
            RETURNING id
        """), {
            "aid": account_id, "name": body.service_name.strip(),
            "type": body.service_type, "desc": body.description, "active": body.is_active,
        })
        new_id = str(result.mappings().first()["id"])
        await db.commit()
    return {"id": new_id, "ok": True}


@router.delete("/{account_id}/services/{service_id}")
async def remove_service(ctx: CurrentSpace, account_id: str, service_id: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        await db.execute(text(
            "DELETE FROM account_services WHERE id = :id AND account_id = :aid"
        ), {"id": service_id, "aid": account_id})
        await db.commit()
    return {"ok": True}


# ─── Addresses ───────────────────────────────────────────────────────────────

@router.post("/{account_id}/addresses")
async def link_address(ctx: CurrentSpace, account_id: str, body: LinkAddressInput) -> dict[str, Any]:
    """Attach an existing address (looked up via /admin/addresses) to this account."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(text("""
            UPDATE addresses SET account_id = :aid
            WHERE id = :addr_id
            RETURNING id
        """), {"aid": account_id, "addr_id": body.address_id})
        if not result.mappings().first():
            raise HTTPException(status_code=404, detail="Address not found")
        await db.commit()
    return {"ok": True}


@router.delete("/{account_id}/addresses/{address_id}")
async def unlink_address(ctx: CurrentSpace, account_id: str, address_id: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        await db.execute(text("""
            UPDATE addresses SET account_id = NULL
            WHERE id = :addr_id AND account_id = :aid
        """), {"addr_id": address_id, "aid": account_id})
        await db.commit()
    return {"ok": True}


# Suppress unused-import warning in environments that don't use the import
_ = datetime
