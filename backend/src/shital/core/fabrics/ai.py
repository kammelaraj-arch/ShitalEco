"""Unified AI client for Shital backend features.

User direction: use the charity's existing Microsoft org tenancy
rather than a paid Anthropic key. Azure OpenAI is the Microsoft-native
inference service — a charity on an M365 tenant can expose it to the
backend through the Azure for Nonprofits grant without extra cost.

Call shape across the app:

    data, model_label = await ai_json_object(system, user)

Returns (parsed_dict, provider_tag). Parses the model's reply as a
single JSON object, tolerant to code-fences the model sometimes wraps
output in. Returns ({}, provider_tag) if the reply is unparseable —
callers decide whether that's an error.

Provider order (first match wins):
  1. Azure OpenAI
       AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY + AZURE_OPENAI_DEPLOYMENT
     Values come from SecretsManager first, then settings. Preferred —
     this is the charity's own M365/Azure path.
  2. Anthropic
       ANTHROPIC_API_KEY (+ optional ANTHROPIC_MODEL)
     Kept only as an escape-hatch so existing environments don't break
     the moment they upgrade. If no Azure config is present and no
     Anthropic key either, we raise a clear 503-friendly RuntimeError.

Credentials are read lazily on every call (SecretsManager) so the
operator can rotate them from Admin → API Keys without a restart.
"""
from __future__ import annotations

import json
from typing import Any

import httpx

from shital.core.fabrics.config import settings
from shital.core.fabrics.secrets import SecretsManager


class AIProviderUnavailableError(RuntimeError):
    """Raised when no AI provider is configured on this environment."""


# Older callers imported `AIProviderUnavailable` — keep as an alias so the
# existing imports in board_resolution_extras / email_ingest keep working.
AIProviderUnavailable = AIProviderUnavailableError


class AIProviderError(RuntimeError):
    """Raised when the configured provider call fails."""


async def _secret_or_setting(key: str, setting_attr: str, default: str = "") -> str:
    val = await SecretsManager.get(key)
    if val:
        return val
    return getattr(settings, setting_attr, default) or default


def _coerce_json(raw: str) -> dict[str, Any]:
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.strip("`")
        if s.lower().startswith("json"):
            s = s[4:].strip()
    start = s.find("{")
    end = s.rfind("}")
    if start < 0 or end < 0 or end < start:
        return {}
    try:
        parsed = json.loads(s[start:end + 1])
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


async def _try_azure_openai(system: str, user: str, max_tokens: int) -> tuple[dict[str, Any], str] | None:
    endpoint = await _secret_or_setting("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_ENDPOINT")
    api_key = await _secret_or_setting("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_API_KEY")
    deployment = await _secret_or_setting("AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_DEPLOYMENT")
    api_version = await _secret_or_setting("AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_API_VERSION", "2024-10-21")
    if not (endpoint and api_key and deployment):
        return None

    url = (
        f"{endpoint.rstrip('/')}/openai/deployments/{deployment}"
        f"/chat/completions?api-version={api_version}"
    )
    payload = {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.2,
        # Strict JSON mode — the model returns a single object; _coerce_json
        # still tolerates fenced replies for older deployments that ignore
        # the hint.
        "response_format": {"type": "json_object"},
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                url,
                headers={"api-key": api_key, "Content-Type": "application/json"},
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise AIProviderError(f"Azure OpenAI network error: {exc}") from exc
    if not resp.is_success:
        raise AIProviderError(
            f"Azure OpenAI {resp.status_code}: {resp.text[:400] or '(empty body)'}"
        )
    data = resp.json()
    choices = data.get("choices") or []
    reply = ""
    if choices:
        reply = (choices[0].get("message") or {}).get("content", "") or ""
    return _coerce_json(reply), f"azure-openai:{deployment}"


def _try_anthropic(system: str, user: str, max_tokens: int) -> tuple[dict[str, Any], str] | None:
    api_key = getattr(settings, "ANTHROPIC_API_KEY", "") or ""
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError as exc:
        raise AIProviderError(f"Anthropic SDK missing: {exc}") from exc
    model = getattr(settings, "ANTHROPIC_MODEL", "") or "claude-3-5-sonnet-latest"
    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=model, max_tokens=max_tokens,
            system=system, messages=[{"role": "user", "content": user}],
        )
    except Exception as exc:
        raise AIProviderError(f"Anthropic call failed: {exc}") from exc
    raw = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "text", None))
    return _coerce_json(raw), f"anthropic:{model}"


async def ai_json_object(system: str, user: str, max_tokens: int = 1500) -> tuple[dict[str, Any], str]:
    """Primary entry point used by board_resolution_extras and email_ingest."""
    azure = await _try_azure_openai(system, user, max_tokens)
    if azure is not None:
        return azure
    anth = _try_anthropic(system, user, max_tokens)
    if anth is not None:
        return anth
    raise AIProviderUnavailable(
        "No AI provider configured. Set AZURE_OPENAI_ENDPOINT, "
        "AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT in Admin → API Keys."
    )


async def ai_provider_available() -> bool:
    """Cheap pre-flight — true if either provider has enough config to try."""
    endpoint = await _secret_or_setting("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_ENDPOINT")
    api_key = await _secret_or_setting("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_API_KEY")
    deployment = await _secret_or_setting("AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_DEPLOYMENT")
    if endpoint and api_key and deployment:
        return True
    return bool(getattr(settings, "ANTHROPIC_API_KEY", ""))


__all__ = [
    "AIProviderError",
    "AIProviderUnavailable",
    "AIProviderUnavailableError",
    "ai_json_object",
    "ai_provider_available",
]
