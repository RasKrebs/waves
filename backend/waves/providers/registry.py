"""Provider registry — resolves 'provider|model' specs to provider instances.

Syntax:
    "whisper-local"              → WhisperLocal with default model
    "whisper-local|ggml-large"   → WhisperLocal with specific model
    "openai|whisper-1"           → OpenAI Whisper API
    "deepgram|nova-2"            → Deepgram API
    "anthropic|claude-sonnet-4-20250514" → Anthropic Claude
    "ollama|llama3.2"            → Ollama local

To add a new provider, create a file in transcription/ or llm/ and call
register_transcription() or register_llm() at module level.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

log = logging.getLogger(__name__)

# Factory = callable(model: str | None, config: Any) -> provider instance
TranscriptionFactory = Callable[[str | None, Any], Any]
LLMFactory = Callable[[str | None, Any], Any]

_transcription_factories: dict[str, TranscriptionFactory] = {}
_llm_factories: dict[str, LLMFactory] = {}


def register_transcription(name: str, factory: TranscriptionFactory) -> None:
    _transcription_factories[name] = factory


def register_llm(name: str, factory: LLMFactory) -> None:
    _llm_factories[name] = factory


def parse_spec(spec: str) -> tuple[str, str | None]:
    """Parse 'provider|model' into (provider_name, model_or_None)."""
    if "|" in spec:
        provider, model = spec.split("|", 1)
        return provider.strip(), model.strip()
    return spec.strip(), None


def resolve_transcription(spec: str, config: Any) -> Any:
    """Create a transcription provider from a spec string."""
    provider_name, model = parse_spec(spec)
    factory = _transcription_factories.get(provider_name)
    if not factory:
        raise ValueError(
            f"unknown transcription provider: {provider_name!r}\n"
            f"available: {', '.join(sorted(_transcription_factories))}"
        )
    return factory(model, config)


def resolve_llm(spec: str, config: Any) -> Any:
    """Create an LLM provider from a spec string."""
    provider_name, model = parse_spec(spec)
    factory = _llm_factories.get(provider_name)
    if not factory:
        raise ValueError(
            f"unknown LLM provider: {provider_name!r}\n"
            f"available: {', '.join(sorted(_llm_factories))}"
        )
    return factory(model, config)


def available_transcription() -> list[str]:
    return sorted(_transcription_factories.keys())


def available_llm() -> list[str]:
    return sorted(_llm_factories.keys())


def load_builtin_providers() -> None:
    """Import all built-in provider modules so they register themselves."""
    # Transcription
    import waves.providers.transcription.whisper_local  # noqa: F401
    import waves.providers.transcription.openai_whisper  # noqa: F401
    import waves.providers.transcription.deepgram  # noqa: F401
    import waves.providers.transcription.huggingface  # noqa: F401
    import waves.providers.transcription.mlx  # noqa: F401

    # LLM
    import waves.providers.llm.anthropic  # noqa: F401
    import waves.providers.llm.openai_chat  # noqa: F401
    import waves.providers.llm.ollama  # noqa: F401
