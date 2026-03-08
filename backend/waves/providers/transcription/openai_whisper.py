"""OpenAI Whisper API transcription provider.

Usage in config.yaml:
    transcription:
      provider: openai|whisper-1
      openai:
        api_key: sk-...
"""

from __future__ import annotations

import logging
import struct
import tempfile
from pathlib import Path

import httpx

from waves.providers.base import Segment
from waves.providers.registry import register_transcription

log = logging.getLogger(__name__)

OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions"


class OpenAIWhisper:
    """Transcription via OpenAI Whisper API."""

    def __init__(self, api_key: str, model: str = "whisper-1", language: str = ""):
        if not api_key:
            raise ValueError("OpenAI API key required — set transcription.openai.api_key in config")
        self._api_key = api_key
        self._model = model
        self._language = language

    @property
    def name(self) -> str:
        return f"openai|{self._model}"

    async def transcribe_file(self, path: Path, language: str = "", on_progress=None) -> list[Segment]:
        lang = language or self._language

        async with httpx.AsyncClient(timeout=120) as client:
            with open(path, "rb") as f:
                files = {"file": (path.name, f, "audio/wav")}
                data: dict = {
                    "model": self._model,
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": "segment",
                }
                if lang:
                    data["language"] = lang

                resp = await client.post(
                    OPENAI_TRANSCRIPTION_URL,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    files=files,
                    data=data,
                )
                resp.raise_for_status()
                result = resp.json()

        segments = []
        for seg in result.get("segments", []):
            start_ms = int(seg.get("start", 0) * 1000)
            end_ms = int(seg.get("end", 0) * 1000)
            text = seg.get("text", "").strip()
            if text:
                segments.append(Segment(start_ms=start_ms, end_ms=end_ms, text=text))

        if not segments and result.get("text", "").strip():
            segments.append(Segment(start_ms=0, end_ms=0, text=result["text"].strip()))

        return segments

    async def transcribe_pcm(self, pcm_data: bytes, language: str = "") -> list[Segment]:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmp_path = f.name
            _write_pcm16_wav(f, pcm_data)

        try:
            return await self.transcribe_file(Path(tmp_path), language)
        finally:
            import os
            os.unlink(tmp_path)


def _write_pcm16_wav(f, pcm: bytes, sample_rate: int = 16000, channels: int = 1) -> None:
    data_size = len(pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_size,
        b"WAVE",
        b"fmt ", 16,
        1, channels,
        sample_rate,
        sample_rate * channels * 2,
        channels * 2,
        16,
        b"data", data_size,
    )
    f.write(header)
    f.write(pcm)


# -- Self-registration --

def _factory(model: str | None, config) -> OpenAIWhisper:
    api_key = getattr(getattr(config, "transcription", None), "openai", None)
    api_key = api_key.api_key if api_key else ""
    language = getattr(getattr(config, "transcription", None), "language", "") or ""
    return OpenAIWhisper(
        api_key=api_key,
        model=model or "whisper-1",
        language=language,
    )


register_transcription("openai", _factory)
