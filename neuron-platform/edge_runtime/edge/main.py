from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from .config import settings
from .db import init_db
from .middleware import AccessPolicyMiddleware
from .policy import load_policy
from .routes_devices import router as devices_router
from .routes_emergency import router as emergency_router
from .routes_health import router as health_router, health_monitor_loop
from .routes_twin import router as twin_router
from .routes_ui import router as ui_router


_log = logging.getLogger("neuron.edge")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path("data").mkdir(parents=True, exist_ok=True)
    await init_db()
    stop_event = asyncio.Event()
    monitor_task = asyncio.create_task(health_monitor_loop(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        try:
            await asyncio.wait_for(monitor_task, timeout=2.0)
        except asyncio.TimeoutError:
            monitor_task.cancel()


policy = load_policy()

app = FastAPI(
    title="Neuron Edge Runtime",
    version="0.3.0",
    description="Site-local orchestration with deny-by-default allow-list and emergency channel.",
    lifespan=lifespan,
)

app.add_middleware(
    AccessPolicyMiddleware,
    policy=policy,
    port=settings.bind_port,
)

app.include_router(ui_router)
app.include_router(health_router)
app.include_router(devices_router)
app.include_router(twin_router)
app.include_router(emergency_router)
