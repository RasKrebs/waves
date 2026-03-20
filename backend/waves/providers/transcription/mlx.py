"""MLX transcription provider using parakeet-mlx.

Runs NVIDIA Parakeet models on Apple Silicon via MLX framework.
Supports word-level and sentence-level timestamps.

Usage in config.yaml:
    transcription:
      provider: mlx|animaslabs/parakeet-tdt-0.6b-v3-mlx

Requires: pip install parakeet-mlx
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from waves.providers.base import Segment
from waves.providers.registry import register_transcription

log = logging.getLogger(__name__)

DEFAULT_MODEL = "animaslabs/parakeet-tdt-0.6b-v3-mlx"


def _ensure_parakeet():
    try:
        import parakeet_mlx  # noqa: F401
    except ImportError:
        raise RuntimeError(
            "MLX provider requires 'parakeet-mlx'.\n"
            "Install with: uv pip install parakeet-mlx"
        )


class MLXParakeet:
    """Transcription using parakeet-mlx on Apple Silicon."""

    def __init__(self, model_id: str, language: str = ""):
        _ensure_parakeet()
        self._model_id = model_id
        self._language = language
        self._model = None  # lazy-loaded

    @property
    def name(self) -> str:
        return f"mlx|{self._model_id}"

    def _get_model(self):
        if self._model is not None:
            return self._model

        from parakeet_mlx import from_pretrained

        log.info("Loading MLX model %s ...", self._model_id)
        self._model = from_pretrained(self._model_id)
        log.info("MLX model loaded")
        return self._model

    async def transcribe_file(
        self, path: Path, language: str = "", on_progress=None
    ) -> list[Segment]:
        model = await asyncio.to_thread(self._get_model)

        def _run():
            return model.transcribe(
                str(path),
                chunk_duration=120.0,
                overlap_duration=15.0,
            )

        result = await asyncio.to_thread(_run)

        segments = []
        for sentence in getattr(result, "sentences", []):
            start_ms = int(sentence.start * 1000)
            end_ms = int(sentence.end * 1000)
            text = sentence.text.strip()
            if text:
                segments.append(Segment(start_ms=start_ms, end_ms=end_ms, text=text))

        # Fallback: no sentences but full text available
        if not segments and getattr(result, "text", "").strip():
            segments.append(Segment(start_ms=0, end_ms=0, text=result.text.strip()))

        return segments


# -- Self-registration --

def _factory(model: str | None, config) -> MLXParakeet:
    language = getattr(getattr(config, "transcription", None), "language", "") or ""
    return MLXParakeet(model_id=model or DEFAULT_MODEL, language=language)


register_transcription("mlx", _factory)
