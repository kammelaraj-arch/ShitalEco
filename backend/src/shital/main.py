"""
Shital Temple ERP — FastAPI application entry point.
Assembles Digital DNA capabilities, Digital Space governance, Digital Brain AI,
and all Foundation Fabrics into a unified agentic API.
"""
from __future__ import annotations
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse
import structlog

from shital.core.fabrics.config import settings

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    # Apply any missing schema columns at startup (idempotent, safe to re-run)
    try:
        await _patch_schema()
    except Exception as exc:
        logger.error("schema_patch_failed", error=str(exc))
    finally:
        # Dispose the pool so the patcher's connection doesn't pollute request connections
        try:
            from shital.core.fabrics.database import engine
            await engine.dispose()
        except Exception:
            pass

    # Register all Digital DNA micro-capabilities
    import shital.capabilities.finance.capabilities      # noqa: F401
    import shital.capabilities.payroll.capabilities      # noqa: F401
    import shital.capabilities.hr.capabilities           # noqa: F401
    import shital.capabilities.assets.capabilities       # noqa: F401
    import shital.capabilities.compliance.capabilities   # noqa: F401
    import shital.capabilities.auth.capabilities         # noqa: F401
    import shital.capabilities.notifications.capabilities # noqa: F401
    import shital.capabilities.payments.capabilities     # noqa: F401
    from shital.core.dna.registry import DigitalDNA
    logger.info("digital_dna_loaded", total_capabilities=len(DigitalDNA.all_capabilities()))
    yield
    logger.info("shital_shutdown")


async def _patch_schema() -> None:
    """Idempotent schema patcher — adds any columns migrations may have missed."""
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text

    patches = [
        # Migration 007 columns on catalog_items
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS available_from  TIMESTAMPTZ",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS display_channel VARCHAR(20) NOT NULL DEFAULT 'both'",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS branch_stock    JSONB NOT NULL DEFAULT '{}'",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS is_live         BOOLEAN NOT NULL DEFAULT true",
        # Migration 009 column on catalog_items
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS name_te         VARCHAR(200) NOT NULL DEFAULT ''",
        # Migration 007 columns on temple_services (if table exists)
        "ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS available_from  TIMESTAMPTZ",
        "ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ",
        "ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS display_channel VARCHAR(20) NOT NULL DEFAULT 'both'",
        "ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS is_live         BOOLEAN NOT NULL DEFAULT true",
        "ALTER TABLE temple_services ADD COLUMN IF NOT EXISTS name_te         VARCHAR(200) NOT NULL DEFAULT ''",
    ]

    async with SessionLocal() as db:
        for sql in patches:
            try:
                await db.execute(text(sql))
            except Exception:
                pass  # column already exists or table doesn't exist
        await db.commit()
    logger.info("schema_patch_done")


app = FastAPI(
    title="Shital Temple ERP — Digital Brain API",
    description=(
        "Full ERP for Shital Hindu Temple network (UK Charity). "
        "Powered by Digital DNA micro-capabilities, Digital Space governance, "
        "and Claude AI Digital Brain orchestration."
    ),
    version="1.0.4",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ─── Mount all routers (resilient — import errors logged but don't crash app) ──
def _mount(module: str, attr: str, prefix: str = "/api/v1") -> None:
    try:
        import importlib
        mod = importlib.import_module(module)
        app.include_router(getattr(mod, attr), prefix=prefix)
        logger.info("router_mounted", module=module)
    except Exception as exc:
        logger.error("router_mount_failed", module=module, error=str(exc))

_mount("shital.api.routers.auth",             "router")
_mount("shital.api.routers.auth_azure",       "router")
_mount("shital.api.routers.kiosk",            "router")
_mount("shital.api.routers.terminal_devices", "router")
_mount("shital.api.routers.users",            "router")
_mount("shital.api.routers.items",            "router")
_mount("shital.api.routers.giftaid",          "router")
_mount("shital.api.routers.brain",            "router")
_mount("shital.api.routers.finance",          "router")
_mount("shital.api.routers.hr",               "router")
_mount("shital.api.routers.payroll",          "router")
_mount("shital.api.routers.admin_kiosk",      "router")
_mount("shital.api.routers.email_templates",  "router")


@app.get("/health", tags=["system"])
@app.get("/api/v1/ping", tags=["system"])
async def health() -> dict[str, Any]:
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": "1.0.4",
        "environment": settings.APP_ENV,
    }


@app.get("/api/v1/dna", tags=["dna"])
async def dna_overview() -> dict[str, Any]:
    """Digital DNA — the single authoritative capability registry."""
    from shital.core.dna.registry import DigitalDNA
    caps = DigitalDNA.all_capabilities()
    by_fabric: dict[str, list[dict[str, Any]]] = {}
    for c in caps:
        f = c.fabric.value
        by_fabric.setdefault(f, []).append({
            "name": c.name, "description": c.description,
            "version": c.version, "status": c.status.value,
            "tags": c.tags, "human_in_loop": c.human_in_loop,
        })
    return {"total": len(caps), "by_fabric": by_fabric}
