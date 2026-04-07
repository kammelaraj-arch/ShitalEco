"""
Digital Brain — AI-embedded intelligence that turns business intent into governed outcomes.

Uses Claude with tool_use to discover capabilities from Digital DNA,
orchestrate multi-step workflows, apply guardrails, and support human-in-the-loop.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import anthropic
import structlog

from shital.core.dna.registry import DigitalDNA, Fabric
from shital.core.fabrics.config import settings
from shital.core.space.context import DigitalSpace

logger = structlog.get_logger()

BRAIN_SYSTEM_PROMPT = """You are the Digital Brain of Shital Hindu Temple ERP — the AI intelligence
layer that turns trustee and staff intent into governed digital outcomes.

You have access to micro-capabilities across all domains: Finance, HR, Payroll, Donations,
Compliance, Assets, Notifications, and more. Each capability is a precise building block.

Your principles:
1. UNDERSTAND the user's intent fully before acting
2. IDENTIFY the correct capabilities needed
3. APPLY guardrails — never exceed the user's permissions
4. PREFER asking for confirmation on destructive or financial actions (human-in-loop)
5. EXPLAIN what you're doing and why at each step
6. REUSE approved capabilities — never invent your own data manipulation
7. ENSURE financial transactions balance (double-entry accounting)
8. SCOPE all queries to the user's branch unless they have cross-branch access
9. AUDIT every action automatically

You serve a UK registered Hindu temple charity. Act with integrity, transparency, and care.
Always respond in clear English. Offer Gujarati/Hindi summaries when relevant."""


class DigitalBrain:
    """
    The AI orchestration layer — understands intent, selects capabilities, executes safely.
    """

    def __init__(self) -> None:
        self.client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.model = settings.ANTHROPIC_MODEL

    async def process(
        self,
        ctx: DigitalSpace,
        messages: list[dict[str, Any]],
        fabric_filter: Fabric | None = None,
        max_turns: int = 10,
    ) -> str:
        """
        Process a conversation turn — understand intent, invoke capabilities, return response.
        Supports multi-turn tool use (agentic loop).
        """
        tools = DigitalDNA.as_claude_tools(fabric_filter)
        conversation = list(messages)
        turn = 0

        log = logger.bind(**ctx.log_context)

        while turn < max_turns:
            turn += 1
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=BRAIN_SYSTEM_PROMPT
                + f"\n\nUser context: role={ctx.role}, branch={ctx.branch_id}",
                messages=conversation,
                tools=tools if tools else anthropic.NOT_GIVEN,
            )

            # Collect assistant content
            assistant_content: list[dict[str, Any]] = []
            text_parts: list[str] = []

            for block in response.content:
                if block.type == "text":
                    text_parts.append(block.text)
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })

            conversation.append({"role": "assistant", "content": assistant_content})

            if response.stop_reason == "end_turn":
                return "\n".join(text_parts)

            if response.stop_reason == "tool_use":
                tool_results: list[dict[str, Any]] = []

                for block in response.content:
                    if block.type != "tool_use":
                        continue

                    cap = DigitalDNA.get(block.name)
                    if not cap:
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": f"Capability '{block.name}' not found",
                            "is_error": True,
                        })
                        continue

                    # Check permissions
                    missing = [
                        p for p in cap.requires_permissions if not ctx.has_permission(p)
                    ]
                    if missing:
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": f"Permission denied: {missing}",
                            "is_error": True,
                        })
                        continue

                    # Human-in-loop capabilities are flagged but still executed in automated mode
                    if cap.human_in_loop:
                        log.info("human_in_loop_capability", capability=block.name)

                    try:
                        result = await cap.fn(ctx, **block.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": json.dumps(result, default=str),
                        })
                        log.info("capability_executed", capability=block.name, success=True)
                    except Exception as e:
                        log.error("capability_failed", capability=block.name, error=str(e))
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": str(e),
                            "is_error": True,
                        })

                conversation.append({"role": "user", "content": tool_results})

        return "I've reached the maximum number of steps. Please try a more specific request."

    async def stream(
        self,
        ctx: DigitalSpace,
        messages: list[dict[str, Any]],
    ) -> AsyncIterator[str]:
        """Stream response tokens for real-time UX."""
        tools = DigitalDNA.as_claude_tools()
        with self.client.messages.stream(
            model=self.model,
            max_tokens=4096,
            system=BRAIN_SYSTEM_PROMPT,
            messages=messages,
            tools=tools if tools else anthropic.NOT_GIVEN,
        ) as stream:
            for text in stream.text_stream:
                yield text
