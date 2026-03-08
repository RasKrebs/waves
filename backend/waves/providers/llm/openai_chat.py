"""OpenAI Chat Completions LLM provider.

Usage in config.yaml:
    summarization:
      provider: openai|gpt-4o
      openai:
        api_key: sk-...
"""

from __future__ import annotations

import logging

import httpx

from waves.providers.registry import register_llm

log = logging.getLogger(__name__)

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


class OpenAIChatLLM:
    """LLM provider using OpenAI Chat Completions API."""

    def __init__(self, api_key: str, model: str = "gpt-4o"):
        if not api_key:
            raise ValueError("OpenAI API key required — set summarization.openai.api_key in config")
        self._api_key = api_key
        self._model = model

    @property
    def name(self) -> str:
        return f"openai|{self._model}"

    async def complete(
        self,
        prompt: str,
        system: str = "",
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                OPENAI_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            resp.raise_for_status()
            result = resp.json()

        choices = result.get("choices", [])
        if choices:
            return choices[0].get("message", {}).get("content", "")
        return ""


# -- Self-registration --

def _factory(model: str | None, config) -> OpenAIChatLLM:
    openai_cfg = getattr(getattr(config, "summarization", None), "openai", None)
    api_key = openai_cfg.api_key if openai_cfg else ""
    default_model = openai_cfg.model if openai_cfg and openai_cfg.model else "gpt-4o"
    return OpenAIChatLLM(
        api_key=api_key,
        model=model or default_model,
    )


register_llm("openai", _factory)
