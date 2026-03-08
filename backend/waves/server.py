"""JSON-RPC server over Unix socket (asyncio) — drop-in replacement for Go daemon."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from waves.audio import AudioCapture, finalize_wav_header, write_wav_header
from waves.config import Config
from waves.store import Segment, Session, Store

log = logging.getLogger(__name__)

# PCM16 mono 16kHz: 16000 samples/sec * 2 bytes/sample = 32000 bytes/sec
SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2
CHUNK_SECONDS = 10


@dataclass
class ActiveSession:
    session: Session
    task: asyncio.Task | None = None


class WavesServer:
    def __init__(self, socket_path: str, data_dir: str, store: Store, config: Config,
                 audio: AudioCapture):
        self.socket_path = socket_path
        self.data_dir = data_dir
        self.store = store
        self.config = config
        self.audio = audio
        self.start_time = time.time()
        self._active: ActiveSession | None = None
        self._lock = asyncio.Lock()
        # Transcription provider (set after init)
        self.transcriber: Any = None

    async def serve(self) -> None:
        """Start the Unix socket JSON-RPC server."""
        sock_path = Path(self.socket_path)
        sock_path.parent.mkdir(parents=True, exist_ok=True)

        # Remove stale socket
        if sock_path.exists():
            sock_path.unlink()

        server = await asyncio.start_unix_server(self._handle_client, path=str(sock_path))
        os.chmod(str(sock_path), 0o600)
        log.info("Listening on %s", self.socket_path)

        try:
            await server.serve_forever()
        finally:
            if sock_path.exists():
                sock_path.unlink()

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Handle a single JSON-RPC connection."""
        try:
            data = await reader.readline()
            if not data:
                return

            request = json.loads(data.decode())
            req_id = request.get("id")
            method = request.get("method", "")
            params = request.get("params", [{}])

            # params comes as [dict] from the Go JSON-RPC client
            args = params[0] if isinstance(params, list) and params else params or {}

            try:
                result = await self._dispatch(method, args)
                response = {"id": req_id, "result": result, "error": None}
            except Exception as e:
                log.exception("RPC error for %s", method)
                response = {"id": req_id, "result": None, "error": {"message": str(e)}}

            writer.write((json.dumps(response) + "\n").encode())
            await writer.drain()
        except Exception:
            log.exception("Client handler error")
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def _dispatch(self, method: str, args: dict) -> Any:
        """Route RPC method to handler."""
        handlers = {
            "Waves.Status": self._status,
            "Waves.GetConfig": self._get_config,
            "Waves.ListSessions": self._list_sessions,
            "Waves.GetSession": self._get_session,
            "Waves.StartRecording": self._start_recording,
            "Waves.StopRecording": self._stop_recording,
            "Waves.ListDevices": self._list_devices,
            "Waves.ListModels": self._list_models,
            "Waves.SetModel": self._set_model,
            "Waves.PullModel": self._pull_model,
            "Waves.Summarize": self._summarize,
            "Waves.TranscribeFile": self._transcribe_file,
        }
        handler = handlers.get(method)
        if not handler:
            raise ValueError(f"unknown method: {method}")
        return await handler(args)

    # -- RPC handlers --

    async def _status(self, args: dict) -> dict:
        uptime_secs = int(time.time() - self.start_time)
        h, rem = divmod(uptime_secs, 3600)
        m, s = divmod(rem, 60)
        if h > 0:
            uptime = f"{h}h{m}m{s}s"
        elif m > 0:
            uptime = f"{m}m{s}s"
        else:
            uptime = f"{s}s"

        total = await self.store.count_sessions()

        active_id = ""
        async with self._lock:
            state = "idle"
            if self._active:
                state = "recording"
                active_id = self._active.session.id

        return {
            "State": state,
            "Uptime": uptime,
            "TotalSessions": total,
            "ActiveSession": active_id,
        }

    async def _get_config(self, args: dict) -> dict:
        workflow_names = list(self.config.workflows.keys())
        return {
            "TranscriptionProvider": self.config.transcription.provider,
            "SummarizationProvider": self.config.summarization.provider,
            "Workflows": workflow_names,
        }

    async def _list_sessions(self, args: dict) -> dict:
        limit = args.get("Limit", 20)
        if limit <= 0:
            limit = 20
        sessions = await self.store.list_sessions(limit)
        result = []
        for s in sessions:
            dur = ""
            if s.ended_at is not None:
                dur_ms = s.ended_at - s.started_at
                dur = _format_duration(dur_ms)
            result.append({
                "ID": s.id,
                "Title": s.title,
                "StartedAt": _format_time(s.started_at),
                "Duration": dur,
                "Status": s.status,
            })
        return {"Sessions": result}

    async def _get_session(self, args: dict) -> dict:
        session_id = args.get("ID", "")
        if not session_id:
            raise ValueError("session ID required")

        sess = await self.store.get_session(session_id)
        if not sess:
            raise ValueError(f"session not found: {session_id}")

        segs = await self.store.get_segments(sess.id)

        dur = ""
        if sess.ended_at is not None:
            dur = _format_duration(sess.ended_at - sess.started_at)

        segments = []
        for seg in segs:
            ts = _format_timestamp(seg.start_ms)
            segments.append({"Timestamp": ts, "Text": seg.text})

        return {
            "Session": {
                "Title": sess.title,
                "StartedAt": _format_time(sess.started_at),
                "Duration": dur,
                "Summary": sess.summary,
                "Segments": segments,
            }
        }

    async def _start_recording(self, args: dict) -> dict:
        async with self._lock:
            if self._active:
                raise RuntimeError(f"already recording session {self._active.session.id}")

            session_id = str(uuid.uuid4())
            title = args.get("Title", "") or f"Meeting {time.strftime('%Y-%m-%d %H:%M')}"
            pid = args.get("PID", 0)
            device = args.get("Device", "")

            recordings_dir = Path(self.data_dir) / "recordings"
            recordings_dir.mkdir(parents=True, exist_ok=True)
            audio_path = str(recordings_dir / f"{session_id}.wav")

            now_ms = int(time.time() * 1000)
            sess = Session(
                id=session_id,
                title=title,
                started_at=now_ms,
                audio_path=audio_path,
                status="recording",
            )
            await self.store.create_session(sess)

            # Start audio capture
            if pid > 0:
                await self.audio.start_tap(pid)
            else:
                await self.audio.start_mic(device)

            # Start transcription loop in background
            task = asyncio.create_task(self._recording_loop(session_id, audio_path))
            self._active = ActiveSession(session=sess, task=task)

        return {"SessionID": session_id}

    async def _stop_recording(self, args: dict) -> dict:
        async with self._lock:
            if not self._active:
                raise RuntimeError("no active recording")

            active = self._active
            self._active = None

        # Stop audio capture (this will cause read_chunk to return empty, ending the loop)
        await self.audio.stop()

        # Wait for recording loop to finish
        if active.task:
            try:
                await asyncio.wait_for(active.task, timeout=30.0)
            except asyncio.TimeoutError:
                active.task.cancel()

        now_ms = int(time.time() * 1000)
        dur_ms = now_ms - active.session.started_at

        active.session.ended_at = now_ms
        active.session.status = "done"
        await self.store.update_session(active.session)

        return {
            "SessionID": active.session.id,
            "Duration": _format_duration(dur_ms),
        }

    async def _recording_loop(self, session_id: str, audio_path: str) -> None:
        """Read PCM from waves-audio, save WAV, and transcribe in chunks."""
        chunk_size = BYTES_PER_SECOND * CHUNK_SECONDS
        chunk_idx = 0

        try:
            with open(audio_path, "wb") as f:
                write_wav_header(f)

                while self.audio.capturing:
                    data = await self.audio.read_chunk(chunk_size)
                    if not data:
                        break

                    # Write to WAV file
                    f.write(data)
                    f.flush()

                    # Transcribe chunk if we have a provider
                    if self.transcriber and len(data) > 0:
                        offset_ms = chunk_idx * CHUNK_SECONDS * 1000
                        chunk_idx += 1
                        # Run transcription in background so we don't block reading
                        asyncio.create_task(
                            self._transcribe_chunk(session_id, data, offset_ms)
                        )

                # Finalize WAV header
                finalize_wav_header(f)

            log.info("Saved audio to %s", audio_path)
        except Exception:
            log.exception("Recording loop error for session %s", session_id)

    async def _transcribe_chunk(self, session_id: str, pcm_data: bytes, offset_ms: int) -> None:
        """Transcribe a single PCM chunk and store segments."""
        if not self.transcriber:
            return
        try:
            segments = await self.transcriber.transcribe_pcm(
                pcm_data, self.config.transcription.language,
            )
            for seg in segments:
                await self.store.add_segment(Segment(
                    id=0,
                    session_id=session_id,
                    start_ms=seg.start_ms + offset_ms,
                    end_ms=seg.end_ms + offset_ms,
                    text=seg.text,
                ))
            if segments:
                log.info("Transcribed chunk at %dms: %d segments", offset_ms, len(segments))
        except Exception:
            log.exception("Transcription error for chunk at %dms", offset_ms)

    async def _list_devices(self, args: dict) -> dict:
        devices = await self.audio.list_devices()
        return {"Devices": devices}

    async def _list_models(self, args: dict) -> dict:
        if self.transcriber and hasattr(self.transcriber, "list_models"):
            models = await self.transcriber.list_models()
            return {"Models": models}
        return {"Models": []}

    async def _set_model(self, args: dict) -> dict:
        name = args.get("Name", "")
        if not name:
            raise ValueError("model name required")
        if self.transcriber and hasattr(self.transcriber, "set_model"):
            await self.transcriber.set_model(name)
        else:
            raise ValueError("model selection not available for current provider")
        return {}

    async def _pull_model(self, args: dict) -> dict:
        repo = args.get("Repo", "")
        if not repo:
            raise ValueError("repo required")
        # TODO: implement HuggingFace model download
        raise ValueError("model download not yet implemented in Python backend")

    async def _summarize(self, args: dict) -> dict:
        session_id = args.get("SessionID", "")
        if not session_id:
            raise ValueError("session ID required")
        # TODO: implement summarization
        raise ValueError("summarization not yet implemented in Python backend")

    async def _transcribe_file(self, args: dict) -> dict:
        file_path = args.get("FilePath", "")
        title = args.get("Title", "")
        if not file_path:
            raise ValueError("file path required")
        if not Path(file_path).exists():
            raise ValueError(f"file not found: {file_path}")
        # TODO: implement file transcription
        raise ValueError("file transcription not yet implemented in Python backend")


# -- Helpers --

def _format_duration(ms: int) -> str:
    """Format milliseconds as a human-readable duration like Go's time.Duration.String()."""
    total_secs = abs(ms) // 1000
    h, rem = divmod(total_secs, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}h{m}m{s}s"
    elif m > 0:
        return f"{m}m{s}s"
    else:
        return f"{s}s"


def _format_time(ms: int) -> str:
    """Format unix milliseconds as ISO-ish time string."""
    import datetime
    dt = datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc)
    return dt.isoformat()


def _format_timestamp(ms: int) -> str:
    """Format milliseconds as HH:MM:SS timestamp."""
    total_secs = ms // 1000
    h, rem = divmod(total_secs, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"
