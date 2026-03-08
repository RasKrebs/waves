"""Deepgram API transcription provider.

Usage in config.yaml:
    transcription:
      provider: deepgram|nova-2
      deepgram:
        api_key: dg-...
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

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"


class DeepgramTranscription:
    """Transcription via Deepgram API."""

    def __init__(self, api_key: str, model: str = "nova-2", language: str = ""):
        if not api_key:
            raise ValueError("Deepgram API key required — set transcription.deepgram.api_key in config")
        self._api_key = api_key
        self._model = model
        self._language = language

    @property
    def name(self) -> str:
        return f"deepgram|{self._model}"

    async def transcribe_file(self, path: Path, language: str = "", on_progress=None) -> list[Segment]:
        lang = language or self._language

        params: dict = {
            "model": self._model,
            "smart_format": "true",
            "utterances": "true",
        }
        if lang:
            params["language"] = lang

        async with httpx.AsyncClient(timeout=120) as client:
            with open(path, "rb") as f:
                resp = await client.post(
                    DEEPGRAM_URL,
                    params=params,
                    headers={
                        "Authorization": f"Token {self._api_key}",
                        "Content-Type": "audio/wav",
                    },
                    content=f.read(),
                )
                resp.raise_for_status()
                result = resp.json()

        segments = []

        # Prefer utterances (sentence-level) over word-level
        utterances = result.get("results", {}).get("utterances", [])
        if utterances:
            for u in utterances:
                start_ms = int(u.get("start", 0) * 1000)
                end_ms = int(u.get("end", 0) * 1000)
                text = u.get("transcript", "").strip()
                if text:
                    segments.append(Segment(start_ms=start_ms, end_ms=end_ms, text=text))
            return segments

        # Fall back to channel alternatives
        channels = result.get("results", {}).get("channels", [])
        for ch in channels:
            for alt in ch.get("alternatives", []):
                text = alt.get("transcript", "").strip()
                if text:
                    segments.append(Segment(start_ms=0, end_ms=0, text=text))
                break  # first alternative only

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

def _factory(model: str | None, config) -> DeepgramTranscription:
    api_key = getattr(getattr(config, "transcription", None), "deepgram", None)
    api_key = api_key.api_key if api_key else ""
    language = getattr(getattr(config, "transcription", None), "language", "") or ""
    return DeepgramTranscription(
        api_key=api_key,
        model=model or "nova-2",
        language=language,
    )


register_transcription("deepgram", _factory)
