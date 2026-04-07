"""
Digital DNA — The single authoritative blueprint for all Organisation capabilities.

Like human DNA, this defines how every capability is built, governed, and operated.
It embeds standards, guardrails, RACI patterns, and reusable building blocks.
"""
from __future__ import annotations

import functools
import inspect
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, ParamSpec, TypeVar

P = ParamSpec("P")
T = TypeVar("T")


class CapabilityStatus(StrEnum):
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    EXPERIMENTAL = "experimental"


class Fabric(StrEnum):
    """Foundation Fabrics — shared capabilities that power all digital products."""
    DATA = "data"
    INTEGRATION = "integration"
    SECURITY = "security"
    OBSERVABILITY = "observability"
    AI = "ai"
    NOTIFICATIONS = "notifications"
    PAYMENTS = "payments"
    STORAGE = "storage"
    FINANCE = "finance"
    HR = "hr"
    PAYROLL = "payroll"
    ASSETS = "assets"
    COMPLIANCE = "compliance"
    BASKET = "basket"
    DOCUMENTS = "documents"
    AUTH = "auth"


@dataclass
class CapabilityDescriptor:
    name: str
    description: str
    fabric: Fabric
    requires_permissions: list[str]
    human_in_loop: bool
    idempotent: bool
    version: str
    status: CapabilityStatus
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    fn: Callable[..., Any]
    tags: list[str] = field(default_factory=list)
    raci: dict[str, list[str]] = field(default_factory=dict)


class DigitalDNA:
    """
    The Organisation's Digital DNA — single authoritative registry of all capabilities.
    Provides the blueprint from which the Digital Space assembles solutions.
    """
    _capabilities: dict[str, CapabilityDescriptor] = {}
    _fabric_index: dict[Fabric, list[str]] = {}

    @classmethod
    def register(cls, descriptor: CapabilityDescriptor) -> None:
        cls._capabilities[descriptor.name] = descriptor
        if descriptor.fabric not in cls._fabric_index:
            cls._fabric_index[descriptor.fabric] = []
        cls._fabric_index[descriptor.fabric].append(descriptor.name)

    @classmethod
    def get(cls, name: str) -> CapabilityDescriptor | None:
        return cls._capabilities.get(name)

    @classmethod
    def list_by_fabric(cls, fabric: Fabric) -> list[CapabilityDescriptor]:
        names = cls._fabric_index.get(fabric, [])
        return [cls._capabilities[n] for n in names]

    @classmethod
    def all_capabilities(cls) -> list[CapabilityDescriptor]:
        return list(cls._capabilities.values())

    @classmethod
    def as_claude_tools(cls, fabric: Fabric | None = None) -> list[dict[str, Any]]:
        """Export capabilities as Claude tool_use definitions for the Digital Brain."""
        caps = cls.list_by_fabric(fabric) if fabric else cls.all_capabilities()
        return [
            {
                "name": c.name,
                "description": c.description,
                "input_schema": {
                    "type": "object",
                    "properties": c.input_schema,
                    "required": list(c.input_schema.keys()),
                },
            }
            for c in caps
            if c.status == CapabilityStatus.ACTIVE
        ]


def capability(
    *,
    name: str,
    description: str,
    fabric: Fabric,
    requires: list[str] | None = None,
    human_in_loop: bool = False,
    idempotent: bool = False,
    version: str = "1.0",
    status: CapabilityStatus = CapabilityStatus.ACTIVE,
    tags: list[str] | None = None,
    raci: dict[str, list[str]] | None = None,
) -> Callable[[Callable[P, T]], Callable[P, T]]:
    """
    Decorator that registers a function as a Digital DNA capability (micro lego block).

    Usage:
        @capability(
            name="post_journal_entry",
            description="Post a double-entry journal to the ledger",
            fabric=Fabric.FINANCE,
            requires=["finance:write"],
        )
        async def post_journal_entry(ctx: DigitalSpace, entry: JournalEntry) -> Result:
            ...
    """
    def decorator(fn: Callable[P, T]) -> Callable[P, T]:
        sig = inspect.signature(fn)
        input_schema: dict[str, Any] = {}
        for pname, param in sig.parameters.items():
            if pname in ("self", "ctx"):
                continue
            annotation = param.annotation
            if hasattr(annotation, "model_json_schema"):
                input_schema[pname] = annotation.model_json_schema()
            else:
                input_schema[pname] = {"type": "string"}

        descriptor = CapabilityDescriptor(
            name=name,
            description=description,
            fabric=fabric,
            requires_permissions=requires or [],
            human_in_loop=human_in_loop,
            idempotent=idempotent,
            version=version,
            status=status,
            input_schema=input_schema,
            output_schema={},
            fn=fn,
            tags=tags or [],
            raci=raci or {},
        )
        DigitalDNA.register(descriptor)

        @functools.wraps(fn)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            return await fn(*args, **kwargs)  # type: ignore[misc,return-value]

        return wrapper  # type: ignore[return-value]

    return decorator
