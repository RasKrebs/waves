"""Audio capture — spawns waves-audio subprocess and reads PCM16 mono 16kHz from stdout."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import signal
import struct
from pathlib import Path

log = logging.getLogger(__name__)


def _find_waves_audio() -> str:
    """Locate waves-audio binary: next to this script's project root, then PATH."""
    # Check project build directory
    project_root = Path(__file__).resolve().parent.parent.parent
    candidate = project_root / "build" / "waves-audio"
    if candidate.exists():
        return str(candidate)
    # Check tools directory (built in-place)
    candidate = project_root / "tools" / "waves-audio" / ".build" / "release" / "waves-audio"
    if candidate.exists():
        return str(candidate)
    # Fall back to PATH
    found = shutil.which("waves-audio")
    if found:
        return found
    return "waves-audio"


class AudioCapture:
    """Manages the waves-audio subprocess for audio capture."""

    def __init__(self, binary_path: str = ""):
        self._binary = binary_path or _find_waves_audio()
        self._process: asyncio.subprocess.Process | None = None
        self._capturing = False

    @property
    def capturing(self) -> bool:
        return self._capturing

    async def start_mic(self, device_uid: str = "") -> None:
        args = ["mic"]
        if device_uid:
            args.extend(["--device", device_uid])
        await self._start(args)

    async def start_tap(self, pid: int) -> None:
        await self._start(["tap", str(pid)])

    async def _start(self, args: list[str]) -> None:
        if self._capturing:
            raise RuntimeError("Already capturing")

        self._process = await asyncio.create_subprocess_exec(
            self._binary, *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._capturing = True
        log.info("Started waves-audio %s (pid %d)", args, self._process.pid)

        # Log stderr in background
        asyncio.create_task(self._drain_stderr())

    async def _drain_stderr(self) -> None:
        if not self._process or not self._process.stderr:
            return
        while True:
            line = await self._process.stderr.readline()
            if not line:
                break
            log.info("[waves-audio] %s", line.decode().rstrip())

    async def read_chunk(self, size: int) -> bytes:
        """Read exactly `size` bytes from stdout. Returns fewer at EOF."""
        if not self._capturing or not self._process or not self._process.stdout:
            return b""
        try:
            data = await self._process.stdout.readexactly(size)
            return data
        except asyncio.IncompleteReadError as e:
            return e.partial
        except Exception:
            return b""

    async def stop(self) -> None:
        if not self._capturing or not self._process:
            return

        self._capturing = False

        if self._process.returncode is None:
            # Send SIGINT for graceful shutdown
            try:
                self._process.send_signal(signal.SIGINT)
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(self._process.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                self._process.kill()
                await self._process.wait()

        log.info("Stopped waves-audio")

    async def list_devices(self) -> list[dict[str, str]]:
        """Run `waves-audio devices` and parse JSON output."""
        try:
            proc = await asyncio.create_subprocess_exec(
                self._binary, "devices",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
            # Parse line-based output: "UID\tName" per line
            devices = []
            for line in stdout.decode().strip().splitlines():
                parts = line.split("\t", 1)
                if len(parts) == 2:
                    devices.append({"UID": parts[0], "Name": parts[1]})
                elif parts[0].strip():
                    devices.append({"UID": parts[0].strip(), "Name": parts[0].strip()})
            return devices
        except FileNotFoundError:
            log.warning("waves-audio binary not found at %s", self._binary)
            return []


def write_wav_header(f, sample_rate: int = 16000, channels: int = 1, bits: int = 16) -> None:
    """Write a placeholder WAV header (44 bytes). Call finalize_wav_header when done."""
    byte_rate = sample_rate * channels * (bits // 8)
    block_align = channels * (bits // 8)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 0,  # placeholder file size
        b"WAVE",
        b"fmt ", 16,  # fmt chunk size
        1,  # PCM format
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits,
        b"data", 0,  # placeholder data size
    )
    f.write(header)


def finalize_wav_header(f) -> None:
    """Update the WAV header with the actual data size."""
    pos = f.tell()
    data_size = pos - 44
    f.seek(4)
    f.write(struct.pack("<I", 36 + data_size))
    f.seek(40)
    f.write(struct.pack("<I", data_size))
