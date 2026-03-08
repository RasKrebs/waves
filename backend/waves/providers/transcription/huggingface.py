"""HuggingFace Transformers transcription provider.

Loads any Whisper-compatible model from HuggingFace using the transformers
library. Supports safetensors, pytorch, and any format transformers handles.

Usage in config.yaml:
    transcription:
      provider: huggingface|syvai/hviske-v3-conversation

Or with a local snapshot:
    transcription:
      provider: huggingface|openai/whisper-large-v3

The model ID can be a HuggingFace repo (downloaded on first use) or a local
path to a previously downloaded model.
"""

from __future__ import annotations

import asyncio
import logging
import struct
import tempfile
from pathlib import Path

from waves.providers.base import Segment
from waves.providers.registry import register_transcription

log = logging.getLogger(__name__)


def _ensure_transformers():
    """Check that transformers + torch are installed."""
    try:
        import transformers  # noqa: F401
        import torch  # noqa: F401
    except ImportError:
        raise RuntimeError(
            "HuggingFace provider requires 'transformers' and 'torch'.\n"
            "Install with: uv pip install transformers torch"
        )


class HuggingFaceWhisper:
    """Transcription using HuggingFace transformers pipeline."""

    def __init__(self, model_id: str, language: str = "", device: str = "auto"):
        _ensure_transformers()
        self._model_id = model_id
        self._language = language
        self._device = device
        self._pipe = None  # lazy-loaded

    @property
    def name(self) -> str:
        return f"huggingface|{self._model_id}"

    def _get_pipeline(self):
        if self._pipe is not None:
            return self._pipe

        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

        log.info("Loading model %s ...", self._model_id)

        # Resolve local snapshot path if it exists in models dir
        model_path = self._resolve_model_path(self._model_id)

        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        device = self._device
        if device == "auto":
            if torch.cuda.is_available():
                device = "cuda"
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"

        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            model_path,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        )
        model.to(device)

        processor = AutoProcessor.from_pretrained(model_path)

        generate_kwargs = {}
        if self._language:
            generate_kwargs["language"] = self._language

        self._pipe = pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            torch_dtype=dtype,
            device=device,
            generate_kwargs=generate_kwargs,
        )
        log.info("Model loaded on %s", device)
        return self._pipe

    def _resolve_model_path(self, model_id: str) -> str:
        """Check if model was downloaded to local models dir, otherwise use HF ID."""
        home = Path.home()
        models_dir = home / "Library" / "Application Support" / "Waves" / "models"

        # Check for snapshot download format: org--model
        local = models_dir / model_id.replace("/", "--")
        if local.exists() and (local / "config.json").exists():
            log.info("Using local model at %s", local)
            return str(local)

        # Fall back to HF model ID (will download/cache via transformers)
        return model_id

    async def transcribe_file(
        self, path: Path, language: str = "", on_progress=None
    ) -> list[Segment]:
        pipe = await asyncio.to_thread(self._get_pipeline)

        kwargs: dict = {
            "return_timestamps": True,
            "chunk_length_s": 30,
            "batch_size": 8,
        }
        lang = language or self._language
        if lang:
            kwargs.setdefault("generate_kwargs", {})["language"] = lang

        result = await asyncio.to_thread(pipe, str(path), **kwargs)

        segments = []
        for chunk in result.get("chunks", []):
            ts = chunk.get("timestamp", (0, 0))
            start_ms = int((ts[0] or 0) * 1000)
            end_ms = int((ts[1] or 0) * 1000)
            text = chunk.get("text", "").strip()
            if text:
                segments.append(Segment(start_ms=start_ms, end_ms=end_ms, text=text))

        # Fallback: if no chunks but there's full text
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

def _factory(model: str | None, config) -> HuggingFaceWhisper:
    language = getattr(getattr(config, "transcription", None), "language", "") or ""
    if not model:
        raise ValueError(
            "huggingface provider requires a model ID, e.g. "
            "'huggingface|openai/whisper-large-v3' or "
            "'huggingface|syvai/hviske-v3-conversation'"
        )
    return HuggingFaceWhisper(model_id=model, language=language)


register_transcription("huggingface", _factory)
