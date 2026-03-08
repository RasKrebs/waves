"""whisper.cpp CLI transcription provider — same approach as Go WhisperLocal."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import struct
import tempfile
from pathlib import Path

from waves.providers.base import Segment

log = logging.getLogger(__name__)


def _find_whisper_bin(configured: str = "") -> str:
    if configured:
        found = shutil.which(configured)
        if found:
            return found
        if Path(configured).exists():
            return configured
    for name in ["whisper-cli", "whisper"]:
        found = shutil.which(name)
        if found:
            return found
    return ""


class WhisperLocal:
    """Transcription using whisper.cpp CLI binary."""

    def __init__(self, model_dir: str, binary: str = "", language: str = ""):
        self._model_dir = Path(model_dir)
        self._model_dir.mkdir(parents=True, exist_ok=True)
        self._binary = _find_whisper_bin(binary)
        self._language = language
        self._active_model = ""

        # Auto-select first available model
        models = self._scan_models()
        if models:
            self._active_model = models[0]["path"]

    @property
    def name(self) -> str:
        return "whisper-local"

    def _scan_models(self) -> list[dict]:
        models = []
        if not self._model_dir.exists():
            return models
        for f in sorted(self._model_dir.iterdir()):
            if f.suffix in (".bin", ".gguf") and f.is_file():
                size_gb = f.stat().st_size / (1024**3)
                models.append({
                    "name": f.stem,
                    "path": str(f),
                    "size_gb": size_gb,
                })
        return models

    async def list_models(self) -> list[dict]:
        models = self._scan_models()
        return [
            {
                "Name": m["name"],
                "Type": "whisper",
                "Size": f"{m['size_gb']:.1f} GB",
                "Active": m["path"] == self._active_model,
            }
            for m in models
        ]

    async def set_model(self, name: str) -> None:
        for ext in (".bin", ".gguf"):
            path = self._model_dir / (name + ext)
            if path.exists():
                self._active_model = str(path)
                return
        raise ValueError(f"model {name!r} not found in {self._model_dir}")

    async def transcribe_file(
        self,
        path: Path,
        language: str = "",
        on_progress=None,
    ) -> list[Segment]:
        if not self._active_model:
            raise RuntimeError("no model loaded — run `waves models pull`")
        if not self._binary:
            raise RuntimeError("whisper-cli not found; install whisper.cpp")

        lang = language or self._language
        args = [
            self._binary,
            "-m", self._active_model,
            "-f", str(path),
            "-oj",  # output JSON
            "--print-progress",
        ]
        if lang:
            args.extend(["-l", lang])

        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_data, stderr_data = await proc.communicate()

        # Try parsing JSON from stdout
        try:
            raw = json.loads(stdout_data)
            return _convert_segments(raw.get("transcription", []))
        except (json.JSONDecodeError, ValueError):
            pass

        # Fall back to output file
        json_path = Path(str(path) + ".json")
        if json_path.exists():
            raw = json.loads(json_path.read_text())
            return _convert_segments(raw.get("transcription", []))

        if proc.returncode != 0:
            raise RuntimeError(f"whisper failed: {stderr_data.decode()[:500]}")

        return []

    async def transcribe_pcm(self, pcm_data: bytes, language: str = "") -> list[Segment]:
        """Transcribe raw PCM16 mono 16kHz data by writing to a temp WAV and calling whisper."""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmp_path = f.name
            _write_pcm16_wav(f, pcm_data)

        try:
            return await self.transcribe_file(Path(tmp_path), language)
        finally:
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


def _convert_segments(raw: list[dict]) -> list[Segment]:
    segments = []
    for r in raw:
        ts = r.get("timestamps", {})
        start = _parse_whisper_time(ts.get("from", ""))
        end = _parse_whisper_time(ts.get("to", ""))
        text = r.get("text", "").strip()
        if text:
            segments.append(Segment(start_ms=start, end_ms=end, text=text))
    return segments


def _parse_whisper_time(s: str) -> int:
    """Parse whisper timestamp like '00:01:30.500' to milliseconds."""
    if not s:
        return 0
    s = s.replace(",", ".")
    match = re.match(r"(\d+):(\d+):(\d+)(?:\.(\d+))?", s)
    if not match:
        return 0
    h, m, sec = int(match.group(1)), int(match.group(2)), int(match.group(3))
    ms_str = match.group(4) or "0"
    ms = int(ms_str.ljust(3, "0")[:3])
    return ((h * 3600 + m * 60 + sec) * 1000) + ms
