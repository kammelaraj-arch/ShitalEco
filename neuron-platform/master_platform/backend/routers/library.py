from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..library_loader import LIBRARY_DIRS, load_catalog
from ..security.auth import require_scopes


router = APIRouter(prefix="/api/library", tags=["library"])


def _serialise(items):
    return [
        {
            "stable_id": it.stable_id,
            "name": it.name,
            "vendor": it.vendor,
            "version": it.version,
            "library": it.library,
            "category": it.category,
            "safety_class": it.safety_class,
            "manifest": it.manifest,
        }
        for it in items
    ]


def _route(library_name: str, dep_scope: str):
    @router.get(f"/{library_name.replace('_', '-').replace('-library', '')}",
                dependencies=[Depends(require_scopes(dep_scope))])
    async def _list_items() -> dict:
        catalog = load_catalog()
        return {"items": _serialise(catalog.list_library(library_name))}

    return _list_items


# Explicit endpoints (cleaner than dynamic route registration above).
@router.get("/components", dependencies=[Depends(require_scopes("library:read"))])
async def list_components() -> dict:
    cat = load_catalog()
    return {"items": _serialise(cat.list_library("components_library"))}


@router.get("/control-boards", dependencies=[Depends(require_scopes("library:read"))])
async def list_control_boards() -> dict:
    cat = load_catalog()
    return {"items": _serialise(cat.list_library("control_board_library"))}


@router.get("/micro-compute", dependencies=[Depends(require_scopes("library:read"))])
async def list_micro_compute() -> dict:
    cat = load_catalog()
    return {"items": _serialise(cat.list_library("micro_compute_library"))}


@router.get("/digital-twin-controls", dependencies=[Depends(require_scopes("library:read"))])
async def list_twin_controls() -> dict:
    cat = load_catalog()
    return {"items": _serialise(cat.list_library("digital_twin_controls_library"))}


@router.get("/ui-controls", dependencies=[Depends(require_scopes("library:read"))])
async def list_ui_controls() -> dict:
    cat = load_catalog()
    return {"items": _serialise(cat.list_library("ui_controls_library"))}


@router.get("/item/{stable_id}", dependencies=[Depends(require_scopes("library:read"))])
async def get_item(stable_id: str) -> dict:
    cat = load_catalog()
    item = cat.get(stable_id)
    if item is None:
        raise HTTPException(404, f"unknown library item: {stable_id}")
    return _serialise([item])[0]


@router.post("/reload", dependencies=[Depends(require_scopes("admin"))])
async def reload_library() -> dict:
    cat = load_catalog(force=True)
    return {
        "loaded": len(cat.by_id),
        "by_library": {k: len(v) for k, v in cat.by_library.items()},
    }
