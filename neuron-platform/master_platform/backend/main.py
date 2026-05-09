from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .config import settings
from .db import SessionLocal, init_db
from .library_loader import load_catalog
from .models import APIKey
from .routers import apikeys, audit, devices, library, processes, systems, ui
from .security.keys import issue_payload


_log = logging.getLogger("neuron.master")


async def _bootstrap_admin_key() -> None:
    """Create a single admin key on first run if env requested it but DB is empty."""
    async with SessionLocal() as session:
        existing = await session.scalar(select(APIKey).where(APIKey.tier == "admin"))
        if existing is not None:
            return
        secret, kw = issue_payload(
            label="bootstrap-admin",
            owner="bootstrap",
            tier="admin",
            scopes=["admin"],
            rate_per_minute=600,
            rate_burst=200,
            ttl_days=None,
        )
        if settings.bootstrap_admin_key:
            # Honour an explicit override (for re-deploys with known secret).
            from argon2 import PasswordHasher
            kw["key_hash"] = PasswordHasher().hash(settings.bootstrap_admin_key)
            secret = settings.bootstrap_admin_key
        session.add(APIKey(**kw))
        await session.commit()
        _log.warning("BOOTSTRAP ADMIN API KEY (shown once): %s", secret)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.build_artifacts_dir).mkdir(parents=True, exist_ok=True)
    Path("data").mkdir(parents=True, exist_ok=True)
    await init_db()
    load_catalog(force=True)
    await _bootstrap_admin_key()
    yield


app = FastAPI(
    title="Neuron Platform — Master",
    version="0.2.0",
    description="Unified Master Platform: Admin + Build + Config + Library Registry + API Mgmt.",
    lifespan=lifespan,
)


_static_dir = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")

app.include_router(ui.router)
app.include_router(library.router)
app.include_router(systems.router)
app.include_router(devices.router)
app.include_router(processes.router)
app.include_router(apikeys.router)
app.include_router(audit.router)


@app.get("/healthz", tags=["meta"])
async def healthz() -> dict:
    catalog = load_catalog()
    return {
        "status": "ok",
        "library_items": len(catalog.by_id),
        "version": app.version,
    }
