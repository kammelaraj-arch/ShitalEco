"""In-memory twin cache (desired / reported / current) with persistent backup."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any


class TwinCache:
    """Per-device, per-channel JSON cache.

    Channels: ``desired``, ``reported``, ``current``. Writes are merged
    field-by-field so partial telemetry frames don't wipe stable values.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._store: dict[str, dict[str, dict[str, Any]]] = {}
        self._touched: dict[tuple[str, str], datetime] = {}

    async def merge(self, device_dna: str, channel: str, payload: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            dev = self._store.setdefault(device_dna, {"desired": {}, "reported": {}, "current": {}})
            channel_state = dev.setdefault(channel, {})
            channel_state.update(payload or {})
            self._touched[(device_dna, channel)] = datetime.now(timezone.utc)
            return dict(channel_state)

    async def get(self, device_dna: str) -> dict[str, dict[str, Any]]:
        async with self._lock:
            dev = self._store.get(device_dna)
            if dev is None:
                return {"desired": {}, "reported": {}, "current": {}}
            return {k: dict(v) for k, v in dev.items()}

    async def all(self) -> dict[str, dict[str, dict[str, Any]]]:
        async with self._lock:
            return {dna: {k: dict(v) for k, v in chans.items()} for dna, chans in self._store.items()}

    async def last_touched(self, device_dna: str, channel: str) -> datetime | None:
        async with self._lock:
            return self._touched.get((device_dna, channel))


cache = TwinCache()
