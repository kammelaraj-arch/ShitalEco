"""
Digital Brain router — conversational AI endpoint for all agentic interactions.
"""
from __future__ import annotations
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from shital.api.deps import CurrentSpace
from shital.core.brain.orchestrator import DigitalBrain
from shital.core.dna.registry import Fabric

router = APIRouter(prefix="/brain", tags=["digital-brain"])

_brain = DigitalBrain()


class ChatRequest(BaseModel):
    messages: list[dict]
    fabric: str | None = None


@router.post("/chat")
async def chat(body: ChatRequest, ctx: CurrentSpace):
    fabric = Fabric(body.fabric) if body.fabric else None
    response = await _brain.process(ctx, body.messages, fabric_filter=fabric)
    return {"response": response, "role": "assistant"}


@router.post("/stream")
async def stream_chat(body: ChatRequest, ctx: CurrentSpace):
    async def event_stream() -> AsyncIterator[str]:
        async for chunk in _brain.stream(ctx, body.messages):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/capabilities")
async def list_capabilities(ctx: CurrentSpace, fabric: str | None = None):
    from shital.core.dna.registry import DigitalDNA
    fab = Fabric(fabric) if fabric else None
    caps = DigitalDNA.list_by_fabric(fab) if fab else DigitalDNA.all_capabilities()
    return {
        "capabilities": [
            {
                "name": c.name, "description": c.description,
                "fabric": c.fabric.value, "version": c.version,
                "status": c.status.value, "tags": c.tags,
                "requires_permissions": c.requires_permissions,
                "human_in_loop": c.human_in_loop,
            }
            for c in caps
        ],
        "total": len(caps),
    }
