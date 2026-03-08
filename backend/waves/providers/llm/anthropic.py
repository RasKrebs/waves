"""Anthropic Claude LLM provider.

Usage in config.yaml:
    summarization:
      provider: anthropic|claude-sonnet-4-20250514
      claude:
        api_key: sk-ant-...
"""

from __future__ import annotations

import logging

import httpx

from waves.providers.registry import register_llm

log = logging.getLogger(__name__)

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


class AnthropicLLM:
    """LLM provider using Anthropic Messages API."""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514"):
        if not api_key:
            raise ValueError("Anthropic API key required — set summarization.claude.api_key in config")
        self._api_key = api_key
        self._model = model

    @property
    def name(self) -> str:
        return f"anthropic|{self._model}"

    async def complete(
        self,
        prompt: str,
        system: str = "",
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> str:
        messages = [{"role": "user", "content": prompt}]

        body: dict = {
            "model": self._model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": messages,
        }
        if system:
            body["system"] = system

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                ANTHROPIC_URL,
                headers={
                    "x-api-key": self._api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
            result = resp.json()

        # Extract text from content blocks
        content = result.get("content", [])
        parts = [block["text"] for block in content if block.get("type") == "text"]
        return "\n".join(parts)


# -- Self-registration --

def _factory(model: str | None, config) -> AnthropicLLM:
    claude_cfg = getattr(getattr(config, "summarization", None), "claude", None)
    api_key = claude_cfg.api_key if claude_cfg else ""
    default_model = claude_cfg.model if claude_cfg and claude_cfg.model else "claude-sonnet-4-20250514"
    return AnthropicLLM(
        api_key=api_key,
        model=model or default_model,
    )


register_llm("anthropic", _factory)
register_llm("claude", _factory)  # alias
