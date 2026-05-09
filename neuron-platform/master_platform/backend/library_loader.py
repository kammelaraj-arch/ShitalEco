from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from threading import RLock
from typing import Any

import jsonschema

from .config import settings

LIBRARY_DIRS = (
    "components_library",
    "control_board_library",
    "micro_compute_library",
    "digital_twin_controls_library",
    "ui_controls_library",
)


@dataclass
class LibraryItem:
    stable_id: str
    library: str
    category: str
    version: str
    name: str
    vendor: str
    manifest: dict[str, Any]
    path: Path

    @property
    def safety_class(self) -> str:
        return self.manifest.get("safety_class", "nominal")


@dataclass
class LibraryCatalog:
    by_id: dict[str, LibraryItem] = field(default_factory=dict)
    by_library: dict[str, list[LibraryItem]] = field(default_factory=dict)

    def add(self, item: LibraryItem) -> None:
        self.by_id[item.stable_id] = item
        self.by_library.setdefault(item.library, []).append(item)

    def get(self, stable_id: str) -> LibraryItem | None:
        return self.by_id.get(stable_id)

    def list_library(self, library: str) -> list[LibraryItem]:
        return list(self.by_library.get(library, []))


class LibraryLoadError(RuntimeError):
    pass


_lock = RLock()
_catalog: LibraryCatalog | None = None


def _load_schema() -> dict[str, Any]:
    schema_path = settings.shared_schemas_dir / "manifest_schema.json"
    if not schema_path.exists():
        raise LibraryLoadError(f"manifest schema not found: {schema_path}")
    with schema_path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _scan(libraries_root: Path, schema: dict[str, Any]) -> LibraryCatalog:
    if not libraries_root.is_dir():
        raise LibraryLoadError(f"libraries dir not found: {libraries_root}")
    validator = jsonschema.Draft7Validator(schema)
    catalog = LibraryCatalog()
    for lib in LIBRARY_DIRS:
        manifest_dir = libraries_root / lib / "manifests"
        if not manifest_dir.is_dir():
            continue
        for path in sorted(manifest_dir.glob("*.json")):
            with path.open(encoding="utf-8") as fh:
                doc = json.load(fh)
            errors = sorted(validator.iter_errors(doc), key=lambda e: e.path)
            if errors:
                first = errors[0]
                raise LibraryLoadError(f"{path}: schema error: {first.message}")
            item = LibraryItem(
                stable_id=doc["stable_id"],
                library=doc["library"],
                category=doc["category"],
                version=doc["version"],
                name=doc["name"],
                vendor=doc["vendor"],
                manifest=doc,
                path=path,
            )
            if item.stable_id in catalog.by_id:
                raise LibraryLoadError(f"duplicate stable_id: {item.stable_id}")
            catalog.add(item)
    return catalog


def load_catalog(force: bool = False) -> LibraryCatalog:
    global _catalog
    with _lock:
        if _catalog is None or force:
            _catalog = _scan(settings.libraries_dir, _load_schema())
        return _catalog


@lru_cache(maxsize=1)
def shared_schema(name: str) -> dict[str, Any]:
    path = settings.shared_schemas_dir / f"{name}.json"
    if not path.exists():
        raise LibraryLoadError(f"shared schema missing: {path}")
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)
