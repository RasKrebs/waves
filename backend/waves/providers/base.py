"""Protocol definitions for transcription and LLM providers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, Callable, Protocol, runtime_checkable


@dataclass
class Segment:
    start_ms: int
    end_ms: int
    text: str
    speaker: str | None = None
    confidence: float = 1.0


@runtime_checkable
class TranscriptionProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def transcribe_file(
        self,
        path: Path,
        language: str,
        on_progress: Callable[[float], None] | None = None,
    ) -> list[Segment]:
        """Transcribe an audio file. Returns all segments."""
        ...


@runtime_checkable
class StreamingTranscriptionProvider(TranscriptionProvider, Protocol):
    async def transcribe_stream(
        self,
        audio: AsyncIterator[bytes],
        language: str,
        chunk_seconds: int = 10,
    ) -> AsyncIterator[Segment]:
        """Transcribe streaming audio. Yields segments as they're ready."""
        ...


@runtime_checkable
class LLMProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def complete(
        self,
        prompt: str,
        system: str = "",
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> str: ...
