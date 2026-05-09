from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import Form
from fastapi.responses import RedirectResponse
from sqlalchemy import desc

from ..db import get_session
from ..library_loader import load_catalog
from ..models import APIKey, Device, EdgeSystem, FirmwareChannel, FirmwareRelease, NodeSystem, RecipeRun, RootSystem
from ..runtime import recipe_runner
from ..security import signing
from ..security.audit import record
from ..security.ui_auth import ui_require_admin


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


@router.get("/ui/devices/{device_dna}/twin-fragment", response_class=HTMLResponse)
async def ui_device_twin_fragment(
    device_dna: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """HTMX fragment polled every few seconds by the device detail page."""
    import httpx
    device = await session.get(Device, device_dna)
    if device is None:
        return HTMLResponse("<div class='text-red-400 text-xs'>device not found</div>", status_code=404)
    edge = await session.get(EdgeSystem, device.edge_id)
    payload: dict = {"online": False, "reason": "edge_address_unset"}
    if edge and edge.address:
        url = f"{edge.address.rstrip('/')}/api/v1/twin/{device_dna}"
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(url)
            if resp.status_code == 200:
                payload = {"online": True, "twin": resp.json(), "edge_url": edge.address}
            else:
                payload = {"online": False, "reason": f"edge HTTP {resp.status_code}"}
        except httpx.HTTPError as exc:
            payload = {"online": False, "reason": f"edge unreachable ({exc.__class__.__name__})"}
    return templates.TemplateResponse(
        "_device_twin.html", {"request": request, "device": device, "payload": payload}
    )


@router.get("/ui/processes", response_class=HTMLResponse)
async def ui_processes(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    recipes = await recipe_runner.list_available_recipes()
    runs = (await session.execute(
        select(RecipeRun).order_by(RecipeRun.started_at.desc()).limit(30)
    )).scalars().all()
    twin_kinds = ["twin.heater_control", "twin.motor_control", "twin.weighscale_control"]
    return templates.TemplateResponse(
        "processes.html",
        {"request": request, "recipes": recipes, "runs": runs, "twin_kinds": twin_kinds},
    )


@router.get("/ui/devices/{device_dna}/ota", response_class=HTMLResponse)
async def ui_device_ota(
    device_dna: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    device = await session.get(Device, device_dna)
    if device is None:
        return RedirectResponse("/ui/devices", status_code=303)
    rels = (
        await session.execute(
            select(FirmwareRelease)
            .where(FirmwareRelease.device_dna == device_dna)
            .order_by(desc(FirmwareRelease.created_at))
        )
    ).scalars().all()
    chs = (
        await session.execute(
            select(FirmwareChannel).where(FirmwareChannel.device_dna == device_dna)
        )
    ).scalars().all()
    channels = {c.channel: c.active_release_id for c in chs}
    last = request.session.pop("ota_last_action", None)
    return templates.TemplateResponse(
        "ota.html",
        {
            "request": request,
            "device": device,
            "releases": rels,
            "releases_by_id": {r.id: r for r in rels},
            "channels": channels,
            "pubkey_b64": signing.public_key_b64(),
            "pubkey_kid": signing.signing_kid(),
            "last_action": last,
        },
    )


@router.post("/ui/devices/{device_dna}/promote")
async def ui_device_promote(
    device_dna: str,
    request: Request,
    channel: str = Form(...),
    release_id: str = Form(...),
    session: AsyncSession = Depends(get_session),
    actor: APIKey = Depends(ui_require_admin),
):
    device = await session.get(Device, device_dna)
    release = await session.get(FirmwareRelease, release_id)
    if device is None or release is None or release.device_dna != device_dna:
        request.session["ota_last_action"] = {"kind": "red", "message": "Release or device not found."}
        return RedirectResponse(f"/ui/devices/{device_dna}/ota", status_code=303)
    if channel not in ("dev", "beta", "stable"):
        request.session["ota_last_action"] = {"kind": "red", "message": f"Invalid channel: {channel}."}
        return RedirectResponse(f"/ui/devices/{device_dna}/ota", status_code=303)

    cur = await session.get(FirmwareChannel, (device_dna, channel))
    if cur is None:
        cur = FirmwareChannel(device_dna=device_dna, channel=channel)
        session.add(cur)
    cur.active_release_id = release.id
    cur.updated_by = actor.id
    if channel == "stable":
        device.firmware_bundle_path = release.bundle_path
    await record(
        session, actor=actor.id, actor_kind="ui_session",
        action="promote_firmware", target_kind="device", target_id=device_dna,
        detail={"channel": channel, "release_id": release.id,
                "app_bundle_version": release.app_bundle_version},
    )
    await session.commit()
    request.session["ota_last_action"] = {
        "kind": "emerald",
        "message": f"Promoted {release.app_bundle_version} → {channel}.",
    }
    return RedirectResponse(f"/ui/devices/{device_dna}/ota", status_code=303)


@router.post("/ui/devices/{device_dna}/rollback")
async def ui_device_rollback(
    device_dna: str,
    request: Request,
    channel: str = Form(...),
    session: AsyncSession = Depends(get_session),
    actor: APIKey = Depends(ui_require_admin),
):
    device = await session.get(Device, device_dna)
    if device is None or channel not in ("dev", "beta", "stable"):
        return RedirectResponse(f"/ui/devices/{device_dna}/ota", status_code=303)
    rels = (
        await session.execute(
            select(FirmwareRelease)
            .where(FirmwareRelease.device_dna == device_dna)
            .order_by(desc(FirmwareRelease.created_at))
        )
    ).scalars().all()
    if len(rels) < 2:
        request.session["ota_last_action"] = {
            "kind": "amber",
            "message": "Nothing to roll back to — only one release exists.",
        }
        return RedirectResponse(f"/ui/devices/{device_dna}/ota", status_code=303)
    prev = rels[1]
    cur = await session.get(FirmwareChannel, (device_dna, channel))
    if cur is None:
        cur = FirmwareChannel(device_dna=device_dna, channel=channel)
        session.add(cur)
    cur.active_release_id = prev.id
    cur.updated_by = actor.id
    if channel == "stable":
        device.firmware_bundle_path = prev.bundle_path
    await record(
        session, actor=actor.id, actor_kind="ui_session",
        action="rollback_firmware", target_kind="device", target_id=device_dna,
        detail={"channel": channel, "release_id": prev.id,
                "app_bundle_version": prev.app_bundle_version},
    )
    await session.commit()
    request.session["ota_last_action"] = {
        "kind": "emerald",
        "message": f"Rolled {channel} back to {prev.app_bundle_version}.",
    }
    return RedirectResponse(f"/ui/devices/{device_dna}/ota", status_code=303)


@router.get("/ui/recipes/{recipe_id}", response_class=HTMLResponse)
async def ui_recipe_run(
    recipe_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    from pathlib import Path
    import json
    from ..config import settings
    p = settings.libraries_dir / "digital_twin_controls_library" / "recipes" / f"{recipe_id}.json"
    if not p.exists():
        return templates.TemplateResponse(
            "processes.html",
            {"request": request, "recipes": await recipe_runner.list_available_recipes(),
             "runs": [], "twin_kinds": []},
        )
    with p.open(encoding="utf-8") as fh:
        recipe = json.load(fh)
    devices = (await session.execute(select(Device).order_by(Device.created_at.desc()))).scalars().all()
    return templates.TemplateResponse(
        "recipe_run.html",
        {"request": request, "recipe": recipe, "devices": devices},
    )
