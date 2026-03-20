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
    """Manages waves-audio subprocess(es) for audio capture.

    Supports three modes:
    - Single mic capture (start_mic)
    - Single process tap (start_tap)
    - Dual capture: system audio + mic simultaneously (start_dual)

    In dual mode, two subprocesses run in parallel. Their PCM16 mono 16kHz
    streams are mixed to mono for transcription and can be interleaved to
    stereo for WAV archival.
    """

    def __init__(self, binary_path: str = ""):
        self._binary = binary_path or _find_waves_audio()
        self._processes: list[asyncio.subprocess.Process] = []
        self._capturing = False
        self._dual = False

    @property
    def capturing(self) -> bool:
        return self._capturing

    @property
    def dual(self) -> bool:
        return self._dual

    @property
    def channels(self) -> int:
        """Number of audio channels: 2 in dual mode, 1 otherwise."""
        return 2 if self._dual else 1

    async def start_mic(self, device_uid: str = "") -> None:
        args = ["mic"]
        if device_uid:
            args.extend(["--device", device_uid])
        await self._start([args])

    async def start_tap(self, pid: int) -> None:
        if pid <= 0:
            await self._start([["tap-all"]])
        else:
            await self._start([["tap", str(pid)]])

    async def start_dual(self, pid: int = -1, device_uid: str = "") -> None:
        """Start both system audio tap and mic capture simultaneously.

        In dual mode, process 0 is always the tap (system audio)
        and process 1 is always the mic.
        """
        tap_args = ["tap", str(pid)] if pid > 0 else ["tap-all"]
        mic_args = ["mic"]
        if device_uid:
            mic_args.extend(["--device", device_uid])
        await self._start([tap_args, mic_args])
        self._dual = True

    async def _start(self, arg_sets: list[list[str]]) -> None:
        if self._capturing:
            raise RuntimeError("Already capturing")

        for args in arg_sets:
            proc = await asyncio.create_subprocess_exec(
                self._binary, *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            self._processes.append(proc)
            log.info("Started waves-audio %s (pid %d)", args, proc.pid)
            # Log stderr in background
            asyncio.create_task(self._drain_stderr(proc))

        self._capturing = True

    async def _drain_stderr(self, proc: asyncio.subprocess.Process) -> None:
        if not proc.stderr:
            return
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            log.info("[waves-audio:%d] %s", proc.pid, line.decode().rstrip())

    async def read_chunk(self, size: int) -> bytes:
        """Read mono PCM chunk. In dual mode, reads from both sources and mixes."""
        if not self._capturing or not self._processes:
            return b""

        if not self._dual:
            return await self._read_from(self._processes[0], size)

        # Read from both processes in parallel, mix to mono
        chunks = await asyncio.gather(
            self._read_from(self._processes[0], size),
            self._read_from(self._processes[1], size),
        )
        return _mix_pcm16_chunks(chunks[0], chunks[1])

    async def read_dual_chunks(self, size_per_channel: int) -> tuple[bytes, bytes]:
        """Read from both sources. Returns (stereo_interleaved, mono_mixed).

        Only valid in dual mode. Returns both representations in a single
        read pass so we don't need to read twice.
        """
        if not self._dual or len(self._processes) < 2:
            data = await self.read_chunk(size_per_channel)
            return data, data

        left, right = await asyncio.gather(
            self._read_from(self._processes[0], size_per_channel),
            self._read_from(self._processes[1], size_per_channel),
        )
        stereo = _interleave_pcm16(left, right)
        mono = _mix_pcm16_chunks(left, right)
        return stereo, mono

    async def _read_from(self, proc: asyncio.subprocess.Process, size: int) -> bytes:
        if not proc.stdout:
            return b""
        try:
            return await proc.stdout.readexactly(size)
        except asyncio.IncompleteReadError as e:
            return e.partial
        except Exception:
            return b""

    async def stop(self) -> None:
        if not self._capturing:
            return

        self._capturing = False
        self._dual = False

        for proc in self._processes:
            if proc.returncode is None:
                try:
                    proc.send_signal(signal.SIGINT)
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()

        self._processes.clear()
        log.info("Stopped waves-audio")

    async def list_devices(self) -> list[dict[str, str]]:
        """Run `waves-audio devices` and parse tab-separated output."""
        return await self._run_and_parse("devices")

    async def list_processes(self) -> list[dict]:
        """Run `waves-audio list` and parse tab-separated output."""
        try:
            proc = await asyncio.create_subprocess_exec(
                self._binary, "list",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
            processes = []
            for line in stdout.decode().strip().splitlines():
                parts = line.split("\t")
                if len(parts) >= 3 and parts[0] != "PID":
                    processes.append({
                        "PID": int(parts[0]),
                        "Active": parts[1] == "●",
                        "Name": parts[2],
                    })
            return processes
        except FileNotFoundError:
            log.warning("waves-audio binary not found at %s", self._binary)
            return []
        except Exception:
            log.exception("Failed to list processes")
            return []

    async def _run_and_parse(self, command: str) -> list[dict[str, str]]:
        try:
            proc = await asyncio.create_subprocess_exec(
                self._binary, command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
            items = []
            for line in stdout.decode().strip().splitlines():
                parts = line.split("\t", 1)
                if len(parts) == 2:
                    items.append({"UID": parts[0], "Name": parts[1]})
                elif parts[0].strip():
                    items.append({"UID": parts[0].strip(), "Name": parts[0].strip()})
            return items
        except FileNotFoundError:
            log.warning("waves-audio binary not found at %s", self._binary)
            return []


def _mix_pcm16_chunks(a: bytes, b: bytes) -> bytes:
    """Mix two PCM16 mono chunks to mono by averaging samples."""
    import array

    sa = array.array("h")  # signed short
    sb = array.array("h")
    if a:
        sa.frombytes(a)
    if b:
        sb.frombytes(b)

    # Pad shorter array with silence
    max_len = max(len(sa), len(sb))
    while len(sa) < max_len:
        sa.append(0)
    while len(sb) < max_len:
        sb.append(0)

    out = array.array("h", [0] * max_len)
    for i in range(max_len):
        mixed = (sa[i] + sb[i]) // 2
        out[i] = max(-32768, min(32767, mixed))

    return out.tobytes()


def _interleave_pcm16(left: bytes, right: bytes) -> bytes:
    """Interleave two PCM16 mono streams into stereo (LRLRLR...)."""
    import array

    sl = array.array("h")
    sr = array.array("h")
    if left:
        sl.frombytes(left)
    if right:
        sr.frombytes(right)

    # Pad shorter
    max_len = max(len(sl), len(sr))
    while len(sl) < max_len:
        sl.append(0)
    while len(sr) < max_len:
        sr.append(0)

    out = array.array("h", [0] * (max_len * 2))
    for i in range(max_len):
        out[i * 2] = sl[i]
        out[i * 2 + 1] = sr[i]

    return out.tobytes()


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
