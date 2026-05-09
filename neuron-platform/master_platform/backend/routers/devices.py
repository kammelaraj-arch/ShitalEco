from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..brain import build_brain
from ..db import get_session
from ..dna import build_dna, new_dna_id
from ..firmware import build_bundle
from ..library_loader import load_catalog
from ..models import APIKey, Device, EdgeSystem, NodeSystem
from ..pin_allocator import auto_allocate, PinAllocationError
from ..security.audit import record
from ..security.auth import require_scopes


router = APIRouter(prefix="/api/devices", tags=["devices"])


def _to_components_json(assignments):
    out = []
    for a in assignments or []:
        if hasattr(a, "model_dump"):
            d = a.model_dump()
        else:
            d = dict(a)
        if not d.get("instance_id"):
            d["instance_id"] = d["component_stable_id"].split(".")[-1]
        out.append(d)
    return out


@router.post("", response_model=schemas.DeviceOut, status_code=201)
async def register_device(
    payload: schemas.DeviceCreate,
    session: AsyncSession = Depends(get_session),
    api_key: APIKey = Depends(require_scopes("devices:write")),
):
    edge = await session.get(EdgeSystem, payload.edge_id)
    if edge is None:
        raise HTTPException(404, "edge system not found")
    catalog = load_catalog()
    if catalog.get(payload.compute_stable_id) is None:
        raise HTTPException(400, f"unknown compute '{payload.compute_stable_id}'")
    if payload.board_stable_id and catalog.get(payload.board_stable_id) is None:
        raise HTTPException(400, f"unknown board '{payload.board_stable_id}'")
    for comp in payload.components:
        if catalog.get(comp.component_stable_id) is None:
            raise HTTPException(400, f"unknown component '{comp.component_stable_id}'")

    device = Device(
        device_dna=new_dna_id(),
        edge_id=edge.id,
        device_type=payload.device_type,
        compute_stable_id=payload.compute_stable_id,
        board_stable_id=payload.board_stable_id,
        hardware_revision=payload.hardware_revision,
        serial_number=payload.serial_number,
        mac_address=payload.mac_address,
        base_firmware_version=payload.base_firmware_version,
        app_bundle_version=payload.app_bundle_version,
        config_schema_version=payload.config_schema_version,
        components_json=_to_components_json(payload.components),
    )
    session.add(device)
    await record(session, actor=api_key.id, action="register_device",
                 target_kind="device", target_id=device.device_dna)
    await session.commit()
    await session.refresh(device)
    return device


@router.get("", response_model=list[schemas.DeviceOut])
async def list_devices(
    edge_id: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: APIKey = Depends(require_scopes("devices:read")),
):
    stmt = select(Device).order_by(Device.created_at.desc())
    if edge_id:
        stmt = stmt.where(Device.edge_id == edge_id)
    res = await session.execute(stmt)
    return list(res.scalars())


@router.get("/{device_dna}", response_model=schemas.DeviceOut)
async def get_device(
    device_dna: str,
    session: AsyncSession = Depends(get_session),
    _: APIKey = Depends(require_scopes("devices:read")),
):
    device = await session.get(Device, device_dna)
    if device is None:
        raise HTTPException(404, "device not found")
    return device


async def _load_device(session: AsyncSession, dna: str) -> Device:
    device = await session.get(Device, dna)
    if device is None:
        raise HTTPException(404, "device not found")
    return device


@router.post("/{device_dna}/pinmap/auto")
async def pinmap_auto(
    device_dna: str,
    session: AsyncSession = Depends(get_session),
    api_key: APIKey = Depends(require_scopes("devices:write")),
):
    device = await _load_device(session, device_dna)
    catalog = load_catalog()
    components = [
        {
            "component_stable_id": c["component_stable_id"],
            "instance_id": c.get("instance_id"),
        }
        for c in (device.components_json or [])
    ]
    try:
        pinmap = auto_allocate(
            compute_stable_id=device.compute_stable_id,
            component_assignments=components,
            catalog=catalog,
            device_dna=device.device_dna,
            board_stable_id=device.board_stable_id,
        )
    except PinAllocationError as exc:
        raise HTTPException(400, str(exc))
    device.pinmap_json = pinmap
    await record(session, actor=api_key.id, action="pinmap_auto",
                 target_kind="device", target_id=device.device_dna,
                 detail={"conflicts": pinmap["conflicts"]})
    await session.commit()
    return pinmap


@router.post("/{device_dna}/pinmap/manual")
async def pinmap_manual(
    device_dna: str,
    payload: schemas.PinmapManual,
    session: AsyncSession = Depends(get_session),
    api_key: APIKey = Depends(require_scopes("devices:write")),
):
    device = await _load_device(session, device_dna)
    base = device.pinmap_json or {
        "device_dna": device.device_dna,
        "compute_id": device.compute_stable_id,
        "board_id": device.board_stable_id,
        "version": "1.0.0",
        "conflicts": [],
    }
    from datetime import datetime, timezone
    base.update({
        "assignments": payload.assignments,
        "generated_by": "manual_override",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })
    device.pinmap_json = base
    await record(session, actor=api_key.id, action="pinmap_manual",
                 target_kind="device", target_id=device.device_dna)
    await session.commit()
    return base


@router.post("/{device_dna}/generate-dna")
async def generate_dna(
    device_dna: str,
    session: AsyncSession = Depends(get_session),
    api_key: APIKey = Depends(require_scopes("devices:write")),
):
    device = await _load_device(session, device_dna)
    edge = await session.get(EdgeSystem, device.edge_id)
    node = await session.get(NodeSystem, edge.node_id) if edge else None
    catalog = load_catalog()
    components = [
        {
            "stable_id": c["component_stable_id"],
            "instance_id": c.get("instance_id") or c["component_stable_id"].split(".")[-1],
            "version": (catalog.get(c["component_stable_id"]).version
                        if catalog.get(c["component_stable_id"]) else "0.0.0"),
            "role": c.get("role") or "component",
        }
        for c in (device.components_json or [])
    ]
    twin_controls = sorted({
        tc
        for c in components
        for tc in (catalog.get(c["stable_id"]).manifest.get("compatibility", {}).get("twin_controls", [])
                   if catalog.get(c["stable_id"]) else [])
    })
    dna = build_dna(
        device_dna=device.device_dna,
        device_type=device.device_type,
        compute_stable_id=device.compute_stable_id,
        board_stable_id=device.board_stable_id,
        hardware_revision=device.hardware_revision,
        serial_number=device.serial_number,
        mac_address=device.mac_address,
        base_firmware_version=device.base_firmware_version,
        app_bundle_version=device.app_bundle_version,
        config_schema_version=device.config_schema_version,
        parent_node_id=node.id if node else "unknown",
        site_id=edge.site_id if edge else "unknown",
        issued_by=api_key.id,
        components=components,
        twin_controls=twin_controls,
    )
    device.dna_json = dna
    await record(session, actor=api_key.id, action="generate_dna",
                 target_kind="device", target_id=device.device_dna)
    await session.commit()
    return dna


@router.post("/{device_dna}/generate-brain-config")
async def generate_brain_config(
    device_dna: str,
    session: AsyncSession = Depends(get_session),
    api_key: APIKey = Depends(require_scopes("devices:write")),
):
    device = await _load_device(session, device_dna)
    if not device.dna_json:
        raise HTTPException(400, "DNA must be generated first")
    catalog = load_catalog()
    brain = build_brain(
        device_dna=device.device_dna,
        config_schema_version=device.config_schema_version,
        twin_controls=device.dna_json.get("twin_controls", []),
        catalog=catalog,
    )
    device.brain_json = brain
    await record(session, actor=api_key.id, action="generate_brain",
                 target_kind="device", target_id=device.device_dna)
    await session.commit()
    return brain


@router.post("/{device_dna}/build-firmware-bundle")
async def build_firmware(
    device_dna: str,
    session: AsyncSession = Depends(get_session),
    api_key: APIKey = Depends(require_scopes("devices:write")),
):
    device = await _load_device(session, device_dna)
    if not (device.dna_json and device.brain_json and device.pinmap_json):
        raise HTTPException(400, "device needs DNA + brain + pinmap before firmware build")
    catalog = load_catalog()
    path, info = build_bundle(
        device_dna=device.device_dna,
        dna=device.dna_json,
        brain=device.brain_json,
        pinmap=device.pinmap_json,
        catalog=catalog,
    )
    device.firmware_bundle_path = str(path)
    await record(session, actor=api_key.id, action="build_firmware",
                 target_kind="device", target_id=device.device_dna,
                 detail={"size_bytes": info["size_bytes"], "sha256": info["sha256"]})
    await session.commit()
    return {
        "device_dna": device.device_dna,
        "bundle_path": str(path),
        "size_bytes": info["size_bytes"],
        "sha256": info["sha256"],
        "manifest": info["manifest"],
    }


@router.get("/{device_dna}/firmware-bundle")
async def download_firmware(
    device_dna: str,
    session: AsyncSession = Depends(get_session),
    _: APIKey = Depends(require_scopes("devices:read")),
):
    device = await _load_device(session, device_dna)
    if not device.firmware_bundle_path:
        raise HTTPException(404, "no firmware bundle built for this device")
    return FileResponse(
        device.firmware_bundle_path,
        media_type="application/zip",
        filename=f"{device.device_dna}.zip",
    )
