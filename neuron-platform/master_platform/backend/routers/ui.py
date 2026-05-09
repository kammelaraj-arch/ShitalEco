from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..library_loader import load_catalog
from ..models import Device, EdgeSystem, NodeSystem, RootSystem


_BASE = Path(__file__).resolve().parent.parent
templates = Jinja2Templates(directory=str(_BASE / "templates"))

router = APIRouter(tags=["ui"])


@router.get("/", response_class=HTMLResponse)
async def ui_index(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    catalog = load_catalog()
    counts = {k: len(v) for k, v in catalog.by_library.items()}
    devices_count = (await session.execute(select(Device))).scalars().all()
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "library_counts": counts,
            "device_count": len(devices_count),
        },
    )


@router.get("/ui/library", response_class=HTMLResponse)
async def ui_library(request: Request):
    catalog = load_catalog()
    grouped = {
        lib: catalog.list_library(lib)
        for lib in (
            "components_library",
            "control_board_library",
            "micro_compute_library",
            "digital_twin_controls_library",
            "ui_controls_library",
            "business_library",
            "functional_library",
            "api_library",
        )
    }
    return templates.TemplateResponse(
        "library.html", {"request": request, "grouped": grouped}
    )


@router.get("/ui/systems", response_class=HTMLResponse)
async def ui_systems(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    roots = (await session.execute(select(RootSystem).order_by(RootSystem.created_at))).scalars().all()
    nodes = (await session.execute(select(NodeSystem).order_by(NodeSystem.created_at))).scalars().all()
    edges = (await session.execute(select(EdgeSystem).order_by(EdgeSystem.created_at))).scalars().all()
    return templates.TemplateResponse(
        "systems.html",
        {"request": request, "roots": roots, "nodes": nodes, "edges": edges},
    )


@router.get("/ui/devices", response_class=HTMLResponse)
async def ui_devices(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    devices = (await session.execute(select(Device).order_by(Device.created_at.desc()))).scalars().all()
    return templates.TemplateResponse(
        "devices.html", {"request": request, "devices": devices}
    )


@router.get("/ui/devices/{device_dna}", response_class=HTMLResponse)
async def ui_device_detail(
    device_dna: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    device = await session.get(Device, device_dna)
    return templates.TemplateResponse(
        "device.html", {"request": request, "device": device}
    )
