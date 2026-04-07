"""
Function Registry router — AI-callable capability catalogue with full audit trail.

Every function/capability in the system is registered here so the AI Brain can:
  1. Discover what functions exist (GET /functions/)
  2. Search by fabric/tag/keyword (GET /functions/?fabric=finance&search=donation)
  3. Get full schema for a specific function (GET /functions/{name})
  4. Invoke a function and have every call logged (POST /functions/{name}/invoke)
  5. Query the full immutable audit log (GET /functions/audit)
  6. Sync all Digital DNA capabilities from memory to DB (POST /functions/sync)

Audit records are IMMUTABLE — never updated or deleted. They provide a complete
chain of custody for every AI agent decision and action.
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/functions", tags=["function-registry"])


# ─── Pydantic models ──────────────────────────────────────────────────────────

class FunctionCreate(BaseModel):
    function_name: str
    display_name: str = ""
    description: str = ""
    fabric: str = "general"
    tags: list[str] = []
    version: str = "1.0.0"
    module_path: str | None = None
    http_endpoint: str | None = None
    http_method: str = "POST"
    input_schema: dict = {}
    output_schema: dict = {}
    example_input: dict = {}
    example_output: dict = {}
    status: str = "active"
    human_in_loop: bool = False
    requires_auth: bool = True
    required_roles: list[str] = []
    idempotent: bool = False


class FunctionUpdate(BaseModel):
    display_name: str | None = None
    description: str | None = None
    fabric: str | None = None
    tags: list[str] | None = None
    version: str | None = None
    module_path: str | None = None
    http_endpoint: str | None = None
    http_method: str | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    example_input: dict | None = None
    example_output: dict | None = None
    status: str | None = None
    human_in_loop: bool | None = None
    requires_auth: bool | None = None
    required_roles: list[str] | None = None
    idempotent: bool | None = None
    is_active: bool | None = None


class InvokeRequest(BaseModel):
    input_data: dict = {}
    triggered_by: str = "manual"       # manual | ai_agent | webhook | schedule
    agent_session_id: str | None = None
    agent_reasoning: str | None = None  # Why the AI chose this function
    agent_query: str | None = None      # Original user query that led to this call
    user_id: str | None = None
    user_email: str | None = None
    user_role: str | None = None
    branch_id: str = "main"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _row(r: Any) -> dict:
    d = dict(r)
    for k in ("created_at", "updated_at", "deleted_at", "last_used_at", "completed_at"):
        if d.get(k) and hasattr(d[k], "isoformat"):
            d[k] = d[k].isoformat()
    return d


# ─── Registry CRUD ────────────────────────────────────────────────────────────

@router.get("/")
async def list_functions(
    fabric: str = "",
    status: str = "active",
    search: str = "",
    tag: str = "",
    limit: int = Query(default=100, le=500),
    offset: int = 0,
):
    """
    List all registered functions. Designed for AI agent tool discovery.
    Use ?search=donation&fabric=finance to find relevant functions.
    Returns input/output schemas so the AI knows how to call each function.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    conditions = ["deleted_at IS NULL", "is_active = true"]
    params: dict[str, Any] = {"limit": limit, "offset": offset}

    if fabric:
        conditions.append("fabric = :fabric")
        params["fabric"] = fabric
    if status:
        conditions.append("status = :status")
        params["status"] = status
    if search:
        conditions.append(
            "(function_name ILIKE :search OR display_name ILIKE :search OR description ILIKE :search)"
        )
        params["search"] = f"%{search}%"
    if tag:
        conditions.append("tags @> :tag")
        params["tag"] = f'["{tag}"]'

    where = " AND ".join(conditions)
    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT id, function_name, display_name, description, fabric, tags,
                       version, status, http_endpoint, http_method,
                       input_schema, output_schema, example_input, example_output,
                       human_in_loop, requires_auth, required_roles, idempotent,
                       total_calls, success_count, failure_count, last_used_at,
                       created_at, updated_at
                FROM function_registry
                WHERE {where}
                ORDER BY fabric, function_name
                LIMIT :limit OFFSET :offset
            """),
            params,
        )
        rows = result.mappings().all()
        count_r = await db.execute(
            text(f"SELECT COUNT(*) AS cnt FROM function_registry WHERE {where}"),
            params,
        )
        total = count_r.mappings().first()["cnt"]

    return {
        "functions": [_row(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/fabrics")
async def list_fabrics():
    """Return all distinct fabrics with function counts — useful for AI category browsing."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(text("""
            SELECT fabric, COUNT(*) AS count,
                   SUM(total_calls) AS total_calls
            FROM function_registry
            WHERE deleted_at IS NULL AND is_active = true
            GROUP BY fabric
            ORDER BY fabric
        """))
        return {"fabrics": [dict(r) for r in result.mappings()]}


@router.get("/{function_name}")
async def get_function(function_name: str):
    """Get full details for one function — schemas, examples, usage stats."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            text("SELECT * FROM function_registry WHERE function_name = :name AND deleted_at IS NULL"),
            {"name": function_name},
        )
        row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Function '{function_name}' not found")
    return _row(row)


@router.post("/", status_code=201)
async def create_function(body: FunctionCreate):
    """Register a new function in the catalogue."""
    import json

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    fn_id = str(uuid.uuid4())
    now = datetime.utcnow()
    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO function_registry (
                    id, function_name, display_name, description, fabric, tags,
                    version, module_path, http_endpoint, http_method,
                    input_schema, output_schema, example_input, example_output,
                    status, human_in_loop, requires_auth, required_roles, idempotent,
                    created_at, updated_at
                ) VALUES (
                    :id, :name, :dname, :desc, :fabric, CAST(:tags AS JSONB),
                    :ver, :mod, :endpoint, :method,
                    CAST(:input_schema AS JSONB), CAST(:output_schema AS JSONB),
                    CAST(:example_input AS JSONB), CAST(:example_output AS JSONB),
                    :status, :hil, :auth, CAST(:roles AS JSONB), :idempotent,
                    :now, :now
                )
                ON CONFLICT (function_name) DO UPDATE SET
                    display_name     = EXCLUDED.display_name,
                    description      = EXCLUDED.description,
                    fabric           = EXCLUDED.fabric,
                    tags             = EXCLUDED.tags,
                    version          = EXCLUDED.version,
                    module_path      = EXCLUDED.module_path,
                    http_endpoint    = EXCLUDED.http_endpoint,
                    http_method      = EXCLUDED.http_method,
                    input_schema     = EXCLUDED.input_schema,
                    output_schema    = EXCLUDED.output_schema,
                    example_input    = EXCLUDED.example_input,
                    example_output   = EXCLUDED.example_output,
                    status           = EXCLUDED.status,
                    human_in_loop    = EXCLUDED.human_in_loop,
                    requires_auth    = EXCLUDED.requires_auth,
                    required_roles   = EXCLUDED.required_roles,
                    idempotent       = EXCLUDED.idempotent,
                    updated_at       = EXCLUDED.updated_at,
                    deleted_at       = NULL,
                    is_active        = true
            """),
            {
                "id": fn_id, "name": body.function_name,
                "dname": body.display_name or body.function_name,
                "desc": body.description, "fabric": body.fabric,
                "tags": json.dumps(body.tags),
                "ver": body.version,
                "mod": body.module_path, "endpoint": body.http_endpoint,
                "method": body.http_method,
                "input_schema": json.dumps(body.input_schema),
                "output_schema": json.dumps(body.output_schema),
                "example_input": json.dumps(body.example_input),
                "example_output": json.dumps(body.example_output),
                "status": body.status, "hil": body.human_in_loop,
                "auth": body.requires_auth,
                "roles": json.dumps(body.required_roles),
                "idempotent": body.idempotent,
                "now": now,
            },
        )
        await db.commit()

    return {"id": fn_id, "function_name": body.function_name, "created": True}


@router.put("/{function_name}")
async def update_function(function_name: str, body: FunctionUpdate):
    """Update a registered function's metadata or schemas."""
    import json

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    updates = body.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    now = datetime.utcnow()
    # Serialize list/dict fields to JSON strings for CAST
    json_fields = {"tags", "input_schema", "output_schema", "example_input", "example_output", "required_roles"}
    set_clauses = []
    params: dict[str, Any] = {"name": function_name, "now": now}
    for k, v in updates.items():
        if k in json_fields:
            set_clauses.append(f"{k} = CAST(:{k} AS JSONB)")
            params[k] = json.dumps(v)
        else:
            set_clauses.append(f"{k} = :{k}")
            params[k] = v
    set_clauses.append("updated_at = :now")

    async with SessionLocal() as db:
        result = await db.execute(
            text(
                f"UPDATE function_registry SET {', '.join(set_clauses)} "
                "WHERE function_name = :name AND deleted_at IS NULL"
            ),
            params,
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Function '{function_name}' not found")

    return {"function_name": function_name, "updated": True}


@router.delete("/{function_name}")
async def delete_function(function_name: str):
    """Soft-delete a function from the registry (audit history is preserved)."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    now = datetime.utcnow()
    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                UPDATE function_registry
                SET deleted_at = :now, is_active = false, updated_at = :now
                WHERE function_name = :name AND deleted_at IS NULL
            """),
            {"now": now, "name": function_name},
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Function '{function_name}' not found")

    return {"function_name": function_name, "deleted": True}


# ─── Invocation + Audit ───────────────────────────────────────────────────────

@router.post("/{function_name}/invoke")
async def invoke_function(function_name: str, body: InvokeRequest, request_id: str = ""):
    """
    Invoke a registered function and create an immutable audit record.

    The AI agent should call this endpoint rather than calling capabilities
    directly — this ensures every AI action is logged with full context
    (which query triggered it, why the AI chose this function, etc.).
    """
    import json

    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    invocation_id = str(uuid.uuid4())
    start_ms = int(time.time() * 1000)
    now = datetime.utcnow()

    # Resolve function from registry
    async with SessionLocal() as db:
        fn_r = await db.execute(
            text("SELECT * FROM function_registry WHERE function_name = :name AND deleted_at IS NULL"),
            {"name": function_name},
        )
        fn_row = fn_r.mappings().first()

    if not fn_row:
        raise HTTPException(status_code=404, detail=f"Function '{function_name}' not in registry")

    fn_id = str(fn_row["id"])
    status = "pending"
    output_data: Any = None
    error_message: str | None = None
    error_code: str | None = None

    # ── Try to call the actual Python capability ────────────────────────────
    try:
        from shital.core.dna.registry import DigitalDNA
        cap = DigitalDNA.get(function_name)
        if cap and cap.fn:
            # Build a minimal DigitalSpace context
            from shital.core.space.context import DigitalSpace
            ctx = DigitalSpace(
                user_id=body.user_id or "ai_agent",
                user_email=body.user_email or "ai@shital.internal",
                role=body.user_role or "SUPER_ADMIN",
                branch_id=body.branch_id,
                permissions=[],
                session_id=body.agent_session_id or str(uuid.uuid4()),
            )
            # Call with ctx + unpacked input_data
            output_data = await cap.fn(ctx, **body.input_data)
            if hasattr(output_data, "model_dump"):
                output_data = output_data.model_dump()
            status = "success"
        else:
            # Function is registered but has no Python callable — return schema info
            output_data = {
                "note": "Function registered but not yet callable via Python. Use http_endpoint.",
                "http_endpoint": fn_row["http_endpoint"],
                "input_schema": fn_row["input_schema"],
            }
            status = "success"
    except Exception as exc:
        status = "failed"
        error_message = str(exc)
        error_code = type(exc).__name__

    end_ms = int(time.time() * 1000)
    duration_ms = end_ms - start_ms
    completed_at = datetime.utcnow()

    # ── Write immutable audit record ────────────────────────────────────────
    async with SessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO function_invocations (
                    id, function_id, function_name,
                    branch_id, user_id, user_email, user_role,
                    triggered_by, agent_session_id, agent_reasoning, agent_query,
                    input_data, output_data,
                    status, error_message, error_code, duration_ms,
                    request_id, created_at, completed_at
                ) VALUES (
                    :id, :fn_id, :fn_name,
                    :branch, :uid, :email, :role,
                    :triggered_by, :session, :reasoning, :query,
                    CAST(:input AS JSONB), CAST(:output AS JSONB),
                    :status, :error, :ecode, :dur,
                    :req_id, :now, :completed
                )
            """),
            {
                "id": invocation_id, "fn_id": fn_id, "fn_name": function_name,
                "branch": body.branch_id, "uid": body.user_id,
                "email": body.user_email, "role": body.user_role,
                "triggered_by": body.triggered_by,
                "session": body.agent_session_id,
                "reasoning": body.agent_reasoning,
                "query": body.agent_query,
                "input": json.dumps(body.input_data),
                "output": json.dumps(output_data) if output_data is not None else "null",
                "status": status, "error": error_message,
                "ecode": error_code, "dur": duration_ms,
                "req_id": request_id or None, "now": now, "completed": completed_at,
            },
        )
        # Update usage counters on the registry entry
        counter_col = "success_count" if status == "success" else "failure_count"
        await db.execute(
            text(f"""
                UPDATE function_registry
                SET total_calls   = total_calls + 1,
                    {counter_col} = {counter_col} + 1,
                    last_used_at  = :now
                WHERE id = :fn_id
            """),
            {"now": completed_at, "fn_id": fn_id},
        )
        await db.commit()

    return {
        "invocation_id": invocation_id,
        "function_name": function_name,
        "status": status,
        "duration_ms": duration_ms,
        "output": output_data,
        "error": error_message,
    }


# ─── Audit log queries ────────────────────────────────────────────────────────

@router.get("/audit/log")
async def get_audit_log(
    function_name: str = "",
    triggered_by: str = "",
    status: str = "",
    user_email: str = "",
    agent_session_id: str = "",
    limit: int = Query(default=50, le=500),
    offset: int = 0,
):
    """
    Query the immutable invocation audit log.
    Supports filtering by function, caller, status, AI session, etc.
    Records are never modified — full chain of custody guaranteed.
    """
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    conditions: list[str] = []
    params: dict[str, Any] = {"limit": limit, "offset": offset}

    if function_name:
        conditions.append("function_name = :fn_name")
        params["fn_name"] = function_name
    if triggered_by:
        conditions.append("triggered_by = :triggered_by")
        params["triggered_by"] = triggered_by
    if status:
        conditions.append("status = :status")
        params["status"] = status
    if user_email:
        conditions.append("user_email ILIKE :email")
        params["email"] = f"%{user_email}%"
    if agent_session_id:
        conditions.append("agent_session_id = :session")
        params["session"] = agent_session_id

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    async with SessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT id, function_name, branch_id, user_id, user_email, user_role,
                       triggered_by, agent_session_id, agent_reasoning, agent_query,
                       input_data, output_data, status, error_message, error_code,
                       duration_ms, request_id, created_at, completed_at
                FROM function_invocations
                {where}
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        )
        rows = result.mappings().all()
        count_r = await db.execute(
            text(f"SELECT COUNT(*) AS cnt FROM function_invocations {where}"),
            params,
        )
        total = count_r.mappings().first()["cnt"]

    return {
        "invocations": [_row(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/audit/{function_name}")
async def get_function_audit(function_name: str, limit: int = 20):
    """Get recent audit log for a specific function."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT id, branch_id, user_email, user_role, triggered_by,
                       agent_session_id, agent_reasoning, input_data, output_data,
                       status, error_message, duration_ms, created_at, completed_at
                FROM function_invocations
                WHERE function_name = :name
                ORDER BY created_at DESC
                LIMIT :limit
            """),
            {"name": function_name, "limit": limit},
        )
        rows = result.mappings().all()

    return {"function_name": function_name, "invocations": [_row(r) for r in rows]}


# ─── Digital DNA sync ─────────────────────────────────────────────────────────

@router.post("/sync")
async def sync_from_digital_dna():
    """
    Sync all in-memory Digital DNA capabilities to the function_registry table.
    Safe to call multiple times — uses INSERT … ON CONFLICT DO UPDATE.
    Called automatically on startup.
    """
    import json

    from shital.core.dna.registry import DigitalDNA

    capabilities = DigitalDNA.all_capabilities()
    synced = 0
    errors: list[str] = []

    for cap in capabilities:
        try:
            from sqlalchemy import text

            from shital.core.fabrics.database import SessionLocal

            now = datetime.utcnow()
            fn_id = str(uuid.uuid4())

            # Build input/output schema from capability descriptor
            input_schema = {}
            for param_name, schema in cap.input_schema.items():
                if isinstance(schema, dict):
                    input_schema[param_name] = schema
                else:
                    input_schema[param_name] = {"type": "string", "description": str(schema)}

            async with SessionLocal() as db:
                await db.execute(
                    text("""
                        INSERT INTO function_registry (
                            id, function_name, display_name, description, fabric, tags,
                            version, module_path,
                            input_schema, output_schema,
                            status, human_in_loop, requires_auth, required_roles, idempotent,
                            created_at, updated_at
                        ) VALUES (
                            :id, :name, :dname, :desc, :fabric, CAST(:tags AS JSONB),
                            :ver, :mod,
                            CAST(:input_schema AS JSONB), CAST(:output_schema AS JSONB),
                            :status, :hil, true, '[]', :idem,
                            :now, :now
                        )
                        ON CONFLICT (function_name) DO UPDATE SET
                            display_name  = EXCLUDED.display_name,
                            description   = EXCLUDED.description,
                            fabric        = EXCLUDED.fabric,
                            tags          = EXCLUDED.tags,
                            version       = EXCLUDED.version,
                            module_path   = EXCLUDED.module_path,
                            input_schema  = EXCLUDED.input_schema,
                            status        = EXCLUDED.status,
                            human_in_loop = EXCLUDED.human_in_loop,
                            idempotent    = EXCLUDED.idempotent,
                            updated_at    = EXCLUDED.updated_at,
                            deleted_at    = NULL,
                            is_active     = true
                    """),
                    {
                        "id": fn_id,
                        "name": cap.name,
                        "dname": cap.name.replace("_", " ").title(),
                        "desc": cap.description,
                        "fabric": cap.fabric.value,
                        "tags": json.dumps(cap.tags or []),
                        "ver": cap.version,
                        "mod": f"shital.capabilities.{cap.fabric.value}.capabilities",
                        "input_schema": json.dumps(input_schema),
                        "output_schema": json.dumps(cap.output_schema or {}),
                        "status": cap.status.value,
                        "hil": cap.human_in_loop,
                        "idem": cap.idempotent,
                        "now": now,
                    },
                )
                await db.commit()
            synced += 1
        except Exception as exc:
            errors.append(f"{cap.name}: {exc}")

    return {
        "synced": synced,
        "total_capabilities": len(capabilities),
        "errors": errors,
    }
