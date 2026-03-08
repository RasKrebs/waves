"""Ollama LLM provider (local).

Usage in config.yaml:
    summarization:
      provider: ollama|llama3.2
"""

from __future__ import annotations

import logging

import httpx

from waves.providers.registry import register_llm

log = logging.getLogger(__name__)

DEFAULT_OLLAMA_URL = "http://localhost:11434"


class OllamaLLM:
    """LLM provider using Ollama's local API."""

    def __init__(self, model: str = "llama3.2", base_url: str = DEFAULT_OLLAMA_URL):
        self._model = model
        self._base_url = base_url.rstrip("/")

    @property
    def name(self) -> str:
        return f"ollama|{self._model}"

    async def complete(
        self,
        prompt: str,
        system: str = "",
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> str:
        body: dict = {
            "model": self._model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "num_predict": max_tokens,
                "temperature": temperature,
            },
        }
        if system:
            body["system"] = system

        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                f"{self._base_url}/api/generate",
                json=body,
            )
            resp.raise_for_status()
            result = resp.json()

        return result.get("response", "")


# -- Self-registration --

def _factory(model: str | None, config) -> OllamaLLM:
    return OllamaLLM(model=model or "llama3.2")


register_llm("ollama", _factory)
