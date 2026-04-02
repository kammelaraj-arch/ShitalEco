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


app = FastAPI(
    title="Shital Temple ERP — Digital Brain API",
    description=(
        "Full ERP for Shital Hindu Temple network (UK Charity). "
        "Powered by Digital DNA micro-capabilities, Digital Space governance, "
        "and Claude AI Digital Brain orchestration."
    ),
    version="1.0.0",
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

# ─── Mount all routers ────────────────────────────────────────────────────────
from shital.api.routers.auth import router as auth_router                          # noqa: E402
from shital.api.routers.auth_azure import router as auth_azure_router              # noqa: E402
from shital.api.routers.brain import router as brain_router                        # noqa: E402
from shital.api.routers.finance import router as finance_router                    # noqa: E402
from shital.api.routers.hr import router as hr_router                              # noqa: E402
from shital.api.routers.payroll import router as payroll_router                    # noqa: E402
from shital.api.routers.kiosk import router as kiosk_router                        # noqa: E402
from shital.api.routers.items import router as items_router                        # noqa: E402
from shital.api.routers.giftaid import router as giftaid_router                    # noqa: E402
from shital.api.routers.terminal_devices import router as terminal_devices_router  # noqa: E402
from shital.api.routers.users import router as users_router                        # noqa: E402

app.include_router(auth_router, prefix="/api/v1")
app.include_router(auth_azure_router, prefix="/api/v1")
app.include_router(brain_router, prefix="/api/v1")
app.include_router(finance_router, prefix="/api/v1")
app.include_router(hr_router, prefix="/api/v1")
app.include_router(payroll_router, prefix="/api/v1")
app.include_router(kiosk_router, prefix="/api/v1")
app.include_router(items_router, prefix="/api/v1")
app.include_router(giftaid_router, prefix="/api/v1")
app.include_router(terminal_devices_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")


@app.get("/health", tags=["system"])
async def health() -> dict[str, Any]:
    from shital.core.dna.registry import DigitalDNA
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": "1.0.0",
        "environment": settings.APP_ENV,
        "capabilities_registered": len(DigitalDNA.all_capabilities()),
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
