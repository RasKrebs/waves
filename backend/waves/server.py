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
from waves.config import Config, update as update_config
from waves.pipeline.edit import edit_note_selection
from waves.pipeline.enhance import enhance_transcript, generate_from_template
from waves.pipeline.summarize import run_workflow
from waves.store import Note, Project, Segment, Session, Store

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
        # Providers (set after init by __main__.py)
        self.transcriber: Any = None
        self.llm: Any = None

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
        except ConnectionResetError:
            pass  # Client disconnected (e.g. timeout) — nothing to do
        except BrokenPipeError:
            pass  # Client disconnected
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
            "Waves.ListProcesses": self._list_processes,
            "Waves.ListModels": self._list_models,
            "Waves.SetModel": self._set_model,
            "Waves.PullModel": self._pull_model,
            "Waves.Summarize": self._summarize,
            "Waves.TranscribeFile": self._transcribe_file,
            "Waves.RetranscribeSession": self._retranscribe_session,
            "Waves.RenameSession": self._rename_session,
            "Waves.DeleteSession": self._delete_session,
            "Waves.SetConfig": self._set_config,
            # Projects
            "Waves.CreateProject": self._create_project,
            "Waves.ListProjects": self._list_projects,
            "Waves.GetProject": self._get_project,
            "Waves.UpdateProject": self._update_project,
            "Waves.DeleteProject": self._delete_project,
            "Waves.AssignSession": self._assign_session,
            "Waves.SetMeetingType": self._set_meeting_type,
            "Waves.ListUnassignedSessions": self._list_unassigned_sessions,
            # Notes
            "Waves.GenerateNotes": self._generate_notes,
            "Waves.GetNotes": self._get_notes,
            "Waves.UpdateNote": self._update_note,
            "Waves.DeleteNote": self._delete_note,
            "Waves.ListNoteTemplates": self._list_note_templates,
            "Waves.EditNote": self._edit_note,
            "Waves.CreateNoteTemplate": self._create_note_template,
            "Waves.UpdateNoteTemplate": self._update_note_template,
            "Waves.DeleteNoteTemplate": self._delete_note_template,
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
            "TranscriptionLanguage": self.config.transcription.language,
            "SummarizationProvider": self.config.summarization.provider,
            "Workflows": workflow_names,
        }

    async def _set_config(self, args: dict) -> dict:
        """Update config, save to YAML, and hot-swap providers if changed."""
        changes = args.get("Config", {})
        if not changes:
            return {}

        old_transcription = self.config.transcription.provider
        old_summarization = self.config.summarization.provider

        update_config(self.config, changes)
        log.info("Config updated and saved")

        # Hot-swap transcription provider if it changed
        new_transcription = self.config.transcription.provider
        if new_transcription != old_transcription:
            try:
                from waves.providers.registry import resolve_transcription
                self.transcriber = resolve_transcription(new_transcription, self.config)
                log.info("Switched transcription to: %s", self.transcriber.name)
            except Exception as e:
                # Revert in-memory provider so old one keeps working
                log.warning("Could not switch transcription provider: %s", e)
                self.config.transcription.provider = old_transcription
                return {"Error": str(e)}

        # Hot-swap LLM provider if it changed
        new_summarization = self.config.summarization.provider
        if new_summarization != old_summarization:
            try:
                from waves.providers.registry import resolve_llm
                self.llm = resolve_llm(new_summarization, self.config)
                log.info("Switched LLM to: %s", self.llm.name)
            except Exception as e:
                log.warning("Could not switch LLM provider: %s", e)
                self.config.summarization.provider = old_summarization
                return {"Error": str(e)}

        return {}

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
                "ProjectID": s.project_id or "",
                "MeetingType": s.meeting_type or "",
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
        notes = await self.store.get_notes_for_session(sess.id)

        dur = ""
        if sess.ended_at is not None:
            dur = _format_duration(sess.ended_at - sess.started_at)

        segments = []
        for seg in segs:
            ts = _format_timestamp(seg.start_ms)
            segments.append({"Timestamp": ts, "Text": seg.text})

        note_views = [
            {
                "ID": n.id,
                "Content": n.content,
                "NoteType": n.note_type,
                "CreatedAt": _format_time(n.created_at),
                "UpdatedAt": _format_time(n.updated_at),
            }
            for n in notes
        ]

        return {
            "Session": {
                "Title": sess.title,
                "StartedAt": _format_time(sess.started_at),
                "Duration": dur,
                "Summary": sess.summary,
                "Segments": segments,
                "AudioPath": sess.audio_path or "",
                "ProjectID": sess.project_id or "",
                "MeetingType": sess.meeting_type or "",
                "Notes": note_views,
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
            include_mic = args.get("IncludeMic", False)
            project_id = args.get("ProjectID") or None

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
                project_id=project_id,
            )
            await self.store.create_session(sess)

            # Start audio capture
            # Determine capture mode from PID + IncludeMic flags:
            #   PID>0 + mic  → dual (process tap + mic)
            #   PID<=0 + mic → dual (all system audio + mic)
            #   PID>0 only   → single process tap
            #   PID<=0 only  → single system audio tap (tap-all)
            #   mic only     → mic capture (only when no system audio source)
            if include_mic and pid > 0:
                await self.audio.start_dual(pid=pid, device_uid=device)
            elif include_mic:
                await self.audio.start_dual(pid=-1, device_uid=device)
            elif pid > 0:
                await self.audio.start_tap(pid)
            else:
                # System audio only (no mic) — use tap-all
                await self.audio.start_tap(-1)

            # Start transcription loop in background
            channels = self.audio.channels
            task = asyncio.create_task(self._recording_loop(session_id, audio_path, channels))
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

        # Auto-generate meeting notes in the background
        asyncio.create_task(self._auto_generate_notes(active.session.id))

        return {
            "SessionID": active.session.id,
            "Duration": _format_duration(dur_ms),
        }

    def _resolve_llm_for_model(self, model: str) -> Any:
        """Create an LLM provider instance for a specific model.

        Uses the same provider type and API key as the main LLM but overrides the model.
        """
        from waves.providers.registry import resolve_llm
        provider_base = self.config.summarization.provider.split("|")[0]
        return resolve_llm(f"{provider_base}|{model}", self.config)

    async def _auto_generate_notes(self, session_id: str) -> None:
        """Automatically generate meeting notes after recording stops.

        Two-stage pipeline:
        1. Enhancement (fast model): fix transcription errors
        2. Template mapping (quality model): map into structured note template

        Runs in the background so _stop_recording returns immediately.
        """
        if not self.llm:
            log.info("Skipping auto-notes: no LLM provider configured")
            return

        try:
            transcript = await self.store.full_transcript(session_id)
            if not transcript or len(transcript.strip()) < 20:
                log.info("Skipping auto-notes for %s: transcript too short", session_id[:8])
                return

            sess = await self.store.get_session(session_id)
            if not sess:
                return

            log.info("Auto-generating meeting notes for session %s", session_id[:8])

            # Stage 1: Enhance transcript with fast model (fix ASR errors)
            enhancement_model = self.config.summarization.enhancement_model
            try:
                enhancer = self._resolve_llm_for_model(enhancement_model)
                enhanced = await enhance_transcript(
                    enhancer, transcript,
                    language_hint=self.config.transcription.language,
                )
            except Exception:
                log.warning("Enhancement failed, using raw transcript", exc_info=True)
                enhanced = transcript

            # Stage 2: Map enhanced transcript into template
            # Use session's meeting_type if set, otherwise default to "general-meeting"
            template_key = sess.meeting_type or "general-meeting"
            template = self.config.note_templates.get(template_key)

            summarization_model = self.config.summarization.summarization_model
            try:
                summarizer = self._resolve_llm_for_model(summarization_model)
            except Exception:
                log.warning("Could not create summarizer with model %s, using default", summarization_model)
                summarizer = self.llm

            if template:
                import datetime
                date_str = datetime.datetime.fromtimestamp(
                    sess.started_at / 1000, tz=datetime.timezone.utc
                ).strftime("%Y-%m-%d %H:%M")
                dur = ""
                if sess.ended_at:
                    dur = _format_duration(sess.ended_at - sess.started_at)

                content = await generate_from_template(
                    summarizer, enhanced, template.template,
                    title=sess.title, date=date_str, duration=dur,
                )
            else:
                # Fallback: simple prompt
                prompt = (
                    "Produce well-structured meeting notes in markdown.\n"
                    "Include: Key Points, Decisions, Action Items, Summary.\n\n"
                    f"TRANSCRIPT:\n{enhanced}"
                )
                content = await summarizer.complete(prompt, system="You are a helpful meeting assistant.")

            now_ms = int(time.time() * 1000)
            note = Note(
                id=str(uuid.uuid4()),
                session_id=session_id,
                project_id=sess.project_id,
                content=content,
                note_type=template_key,
                created_at=now_ms,
                updated_at=now_ms,
            )
            await self.store.create_note(note)
            log.info("Auto-generated meeting notes for session %s", session_id[:8])

            # Notify connected clients
            self._emit_event("notes:generated", {
                "SessionID": session_id,
                "NoteID": note.id,
                "NoteType": note.note_type,
            })

        except Exception:
            log.exception("Auto-note generation failed for session %s", session_id[:8])

    def _emit_event(self, event: str, data: dict) -> None:
        """Emit an event to the event log. Electron polls or subscribes to these."""
        # Store in a simple list for now — clients can poll via GetSession
        # which already returns notes. The event name is logged for debugging.
        log.info("Event: %s %s", event, data)

    async def _recording_loop(self, session_id: str, audio_path: str, channels: int = 1) -> None:
        """Read PCM from waves-audio, save WAV, and transcribe in chunks."""
        chunk_size = BYTES_PER_SECOND * CHUNK_SECONDS
        chunk_idx = 0
        is_dual = channels == 2

        try:
            with open(audio_path, "wb") as f:
                write_wav_header(f, channels=channels)

                while self.audio.capturing:
                    if is_dual:
                        # Single read pass returns both stereo (WAV) and mono (transcription)
                        wav_data, mono_data = await self.audio.read_dual_chunks(chunk_size)
                    else:
                        mono_data = await self.audio.read_chunk(chunk_size)
                        wav_data = mono_data

                    if not wav_data and not mono_data:
                        break

                    # Write to WAV file (stereo in dual mode, mono otherwise)
                    f.write(wav_data)
                    f.flush()

                    # Transcribe the mono mix
                    if self.transcriber and mono_data:
                        offset_ms = chunk_idx * CHUNK_SECONDS * 1000
                        chunk_idx += 1
                        asyncio.create_task(
                            self._transcribe_chunk(session_id, mono_data, offset_ms)
                        )

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

    async def _list_processes(self, args: dict) -> dict:
        """List processes with active audio output (for tap selection)."""
        processes = await self.audio.list_processes()
        return {"Processes": processes}

    async def _list_models(self, args: dict) -> dict:
        models = []
        model_dir = Path(self.data_dir) / "models"

        if model_dir.exists():
            # GGUF/bin files (whisper.cpp models)
            for f in sorted(model_dir.iterdir()):
                if f.is_file() and f.suffix in (".bin", ".gguf"):
                    size_gb = f.stat().st_size / (1024**3)
                    models.append({
                        "Name": f.stem,
                        "Type": "whisper.cpp",
                        "Size": f"{size_gb:.1f} GB",
                        "Active": self.transcriber and hasattr(self.transcriber, "_active_model")
                                  and str(f) == self.transcriber._active_model,
                    })

            # Transformers model directories (have config.json)
            for d in sorted(model_dir.iterdir()):
                if d.is_dir() and (d / "config.json").exists():
                    total = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
                    size_gb = total / (1024**3)
                    # Convert dir name back to HF repo format: org--model → org/model
                    hf_name = d.name.replace("--", "/")
                    is_active = (self.transcriber and hasattr(self.transcriber, "_model_id")
                                 and self.transcriber._model_id == hf_name)
                    models.append({
                        "Name": hf_name,
                        "Type": "transformers",
                        "Size": f"{size_gb:.1f} GB",
                        "Active": is_active,
                    })

        return {"Models": models}

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

        from huggingface_hub import list_repo_files, snapshot_download, hf_hub_download

        model_dir = Path(self.data_dir) / "models"
        model_dir.mkdir(parents=True, exist_ok=True)

        try:
            files = list_repo_files(repo)
        except Exception as e:
            raise ValueError(f"could not list repo {repo!r}: {e}")

        # Check what kind of model this is
        gguf_files = [f for f in files if f.endswith((".gguf", ".bin"))]
        is_transformers = any(f == "config.json" for f in files)

        if gguf_files:
            # GGUF/bin model — download the single model file
            target = gguf_files[0]
            log.info("Downloading GGUF model %s from %s", target, repo)

            local_path = await asyncio.to_thread(
                hf_hub_download,
                repo_id=repo,
                filename=target,
                local_dir=str(model_dir),
            )

            size_gb = Path(local_path).stat().st_size / (1024**3)
            name = Path(local_path).stem
            log.info("Downloaded %s (%.1f GB)", name, size_gb)
            return {"Name": name, "Size": f"{size_gb:.1f} GB"}

        elif is_transformers:
            # Transformers model — download full repo snapshot
            log.info("Downloading transformers model %s", repo)

            local_path = await asyncio.to_thread(
                snapshot_download,
                repo_id=repo,
                local_dir=str(model_dir / repo.replace("/", "--")),
            )

            # Estimate size from downloaded files
            total = sum(
                f.stat().st_size for f in Path(local_path).rglob("*") if f.is_file()
            )
            size_gb = total / (1024**3)
            name = repo
            log.info("Downloaded %s (%.1f GB)", name, size_gb)
            return {"Name": name, "Size": f"{size_gb:.1f} GB"}

        else:
            raise ValueError(
                f"no supported model files found in {repo!r} "
                f"(expected .gguf, .bin, or config.json for transformers)"
            )

    async def _summarize(self, args: dict) -> dict:
        session_id = args.get("SessionID", "")
        workflow_name = args.get("Workflow", "default")
        if not session_id:
            raise ValueError("session ID required")
        if not self.llm:
            raise ValueError("no LLM provider configured — set summarization.provider in config")

        sess = await self.store.get_session(session_id)
        if not sess:
            raise ValueError(f"session not found: {session_id}")

        transcript = await self.store.full_transcript(session_id)
        if not transcript:
            raise ValueError("session has no transcript segments")

        workflow = self.config.workflows.get(workflow_name)
        if not workflow:
            raise ValueError(
                f"workflow {workflow_name!r} not found, "
                f"available: {', '.join(self.config.workflows)}"
            )

        summary = await run_workflow(self.llm, workflow, transcript)

        # Persist summary
        sess.summary = summary
        await self.store.update_session(sess)

        return {"Summary": summary}

    async def _transcribe_file(self, args: dict) -> dict:
        file_path = args.get("FilePath", "")
        title = args.get("Title", "")
        if not file_path:
            raise ValueError("file path required")
        if not Path(file_path).exists():
            raise ValueError(f"file not found: {file_path}")
        if not self.transcriber:
            raise ValueError("no transcription provider configured")

        session_id = str(uuid.uuid4())
        now_ms = int(time.time() * 1000)
        sess = Session(
            id=session_id,
            title=title or Path(file_path).stem,
            started_at=now_ms,
            audio_path=file_path,
            status="transcribing",
        )
        await self.store.create_session(sess)

        try:
            segments = await self.transcriber.transcribe_file(
                Path(file_path),
                self.config.transcription.language,
            )
            for seg in segments:
                await self.store.add_segment(Segment(
                    id=0,
                    session_id=session_id,
                    start_ms=seg.start_ms,
                    end_ms=seg.end_ms,
                    text=seg.text,
                ))

            sess.status = "done"
            sess.ended_at = int(time.time() * 1000)
            await self.store.update_session(sess)
            log.info("Transcribed file %s: %d segments", file_path, len(segments))
        except Exception:
            sess.status = "failed"
            await self.store.update_session(sess)
            raise

        return {"SessionID": session_id}

    async def _retranscribe_session(self, args: dict) -> dict:
        session_id = args.get("SessionID", "")
        if not session_id:
            raise ValueError("session ID required")
        if not self.transcriber:
            raise ValueError("no transcription provider configured")

        sess = await self.store.get_session(session_id)
        if not sess:
            raise ValueError(f"session not found: {session_id}")
        if not sess.audio_path or not Path(sess.audio_path).exists():
            raise ValueError("session has no audio file")

        # Clear old segments
        deleted = await self.store.delete_segments(session_id)
        log.info("Cleared %d old segments for session %s", deleted, session_id)

        sess.status = "transcribing"
        sess.summary = ""
        await self.store.update_session(sess)

        try:
            segments = await self.transcriber.transcribe_file(
                Path(sess.audio_path),
                self.config.transcription.language,
            )
            for seg in segments:
                await self.store.add_segment(Segment(
                    id=0,
                    session_id=session_id,
                    start_ms=seg.start_ms,
                    end_ms=seg.end_ms,
                    text=seg.text,
                ))

            sess.status = "done"
            await self.store.update_session(sess)
            log.info("Retranscribed session %s: %d segments", session_id, len(segments))
        except Exception:
            sess.status = "failed"
            await self.store.update_session(sess)
            raise

        return {"Segments": len(segments)}

    # -- Project handlers --

    async def _create_project(self, args: dict) -> dict:
        name = args.get("Name", "").strip()
        if not name:
            raise ValueError("project name required")
        description = args.get("Description", "")
        project_id = str(uuid.uuid4())
        now_ms = int(time.time() * 1000)
        proj = Project(id=project_id, name=name, created_at=now_ms, description=description)
        await self.store.create_project(proj)
        log.info("Created project %s: %s", project_id[:8], name)
        return {"ProjectID": project_id}

    async def _list_projects(self, args: dict) -> dict:
        projects = await self.store.list_projects()
        result = []
        for p in projects:
            count = await self.store.project_session_count(p.id)
            result.append({
                "ID": p.id,
                "Name": p.name,
                "Description": p.description,
                "CreatedAt": _format_time(p.created_at),
                "SessionCount": count,
            })
        return {"Projects": result}

    async def _get_project(self, args: dict) -> dict:
        project_id = args.get("ID", "")
        if not project_id:
            raise ValueError("project ID required")
        proj = await self.store.get_project(project_id)
        if not proj:
            raise ValueError(f"project not found: {project_id}")

        sessions = await self.store.list_sessions_for_project(project_id)
        session_rows = []
        for s in sessions:
            dur = ""
            if s.ended_at is not None:
                dur = _format_duration(s.ended_at - s.started_at)
            session_rows.append({
                "ID": s.id,
                "Title": s.title,
                "StartedAt": _format_time(s.started_at),
                "Duration": dur,
                "Status": s.status,
            })

        return {
            "Project": {
                "ID": proj.id,
                "Name": proj.name,
                "Description": proj.description,
                "CreatedAt": _format_time(proj.created_at),
                "Sessions": session_rows,
            }
        }

    async def _update_project(self, args: dict) -> dict:
        project_id = args.get("ID", "")
        if not project_id:
            raise ValueError("project ID required")
        proj = await self.store.get_project(project_id)
        if not proj:
            raise ValueError(f"project not found: {project_id}")

        if "Name" in args:
            proj.name = args["Name"].strip()
        if "Description" in args:
            proj.description = args["Description"]
        await self.store.update_project(proj)
        return {}

    async def _delete_project(self, args: dict) -> dict:
        project_id = args.get("ID", "")
        if not project_id:
            raise ValueError("project ID required")
        proj = await self.store.get_project(project_id)
        if not proj:
            raise ValueError(f"project not found: {project_id}")
        await self.store.delete_project(project_id)
        log.info("Deleted project %s", project_id[:8])
        return {}

    async def _assign_session(self, args: dict) -> dict:
        session_id = args.get("SessionID", "")
        project_id = args.get("ProjectID")  # None to unassign
        if not session_id:
            raise ValueError("session ID required")

        sess = await self.store.get_session(session_id)
        if not sess:
            raise ValueError(f"session not found: {session_id}")

        if project_id:
            proj = await self.store.get_project(project_id)
            if not proj:
                raise ValueError(f"project not found: {project_id}")

        await self.store.assign_session_to_project(session_id, project_id)
        log.info("Assigned session %s to project %s", session_id[:8], (project_id or "none")[:8])
        return {}

    async def _set_meeting_type(self, args: dict) -> dict:
        session_id = args.get("SessionID", "")
        meeting_type = args.get("MeetingType") or None
        regenerate = args.get("Regenerate", False)
        if not session_id:
            raise ValueError("session ID required")

        sess = await self.store.get_session(session_id)
        if not sess:
            raise ValueError(f"session not found: {session_id}")

        await self.store.set_meeting_type(session_id, meeting_type)
        log.info("Set meeting type for %s to %s", session_id[:8], meeting_type or "none")

        if regenerate and meeting_type:
            # Delete existing notes and regenerate with the selected template
            existing_notes = await self.store.get_notes_for_session(sess.id)
            for note in existing_notes:
                await self.store.delete_note(note.id)
                log.info("Deleted note %s for regeneration", note.id[:8])

            # Generate new notes with selected template in background
            asyncio.create_task(self._auto_generate_notes(sess.id))

        return {}

    async def _list_unassigned_sessions(self, args: dict) -> dict:
        limit = args.get("Limit", 50)
        sessions = await self.store.list_unassigned_sessions(limit)
        result = []
        for s in sessions:
            dur = ""
            if s.ended_at is not None:
                dur = _format_duration(s.ended_at - s.started_at)
            result.append({
                "ID": s.id,
                "Title": s.title,
                "StartedAt": _format_time(s.started_at),
                "Duration": dur,
                "Status": s.status,
                "ProjectID": "",
                "MeetingType": s.meeting_type or "",
            })
        return {"Sessions": result, "Count": len(result)}

    # -- Note handlers --

    async def _generate_notes(self, args: dict) -> dict:
        """Generate meeting notes from a session's transcript using the LLM.

        Supports both template-based generation (NoteType matches a template key
        like "general-meeting" or "standup") and legacy note types ("action-items",
        "summary") which use simple prompts.
        """
        session_id = args.get("SessionID", "")
        note_type = args.get("NoteType", "general-meeting")
        if not session_id:
            raise ValueError("session ID required")
        if not self.llm:
            raise ValueError("no LLM provider configured — set summarization.provider in config")

        sess = await self.store.get_session(session_id)
        if not sess:
            raise ValueError(f"session not found: {session_id}")

        transcript = await self.store.full_transcript(session_id)
        if not transcript:
            raise ValueError("session has no transcript segments")

        # Check if note_type matches a template
        template = self.config.note_templates.get(note_type)

        if template:
            # Two-stage pipeline: enhance → template
            import datetime

            # Stage 1: Enhance transcript
            enhancement_model = self.config.summarization.enhancement_model
            try:
                enhancer = self._resolve_llm_for_model(enhancement_model)
                enhanced = await enhance_transcript(
                    enhancer, transcript,
                    language_hint=self.config.transcription.language,
                )
            except Exception:
                log.warning("Enhancement failed, using raw transcript", exc_info=True)
                enhanced = transcript

            # Stage 2: Generate from template
            summarization_model = self.config.summarization.summarization_model
            try:
                summarizer = self._resolve_llm_for_model(summarization_model)
            except Exception:
                summarizer = self.llm

            date_str = datetime.datetime.fromtimestamp(
                sess.started_at / 1000, tz=datetime.timezone.utc
            ).strftime("%Y-%m-%d %H:%M")
            dur = ""
            if sess.ended_at:
                dur = _format_duration(sess.ended_at - sess.started_at)

            content = await generate_from_template(
                summarizer, enhanced, template.template,
                title=sess.title, date=date_str, duration=dur,
            )
        else:
            # Legacy simple prompts for backward compat
            prompts = {
                "meeting-notes": (
                    "Produce well-structured meeting notes in markdown.\n"
                    "Include: Key Points, Decisions, Action Items, Summary.\n\n"
                    f"TRANSCRIPT:\n{transcript}"
                ),
                "action-items": (
                    "Extract all action items from this meeting transcript. "
                    "Format as a markdown checklist with owners and deadlines.\n\n"
                    f"TRANSCRIPT:\n{transcript}"
                ),
                "summary": (
                    "Provide a concise executive summary in 3-5 bullet points. "
                    "Focus on outcomes. What would someone who missed the meeting need to know?\n\n"
                    f"TRANSCRIPT:\n{transcript}"
                ),
            }
            prompt = prompts.get(note_type, prompts["meeting-notes"])
            content = await self.llm.complete(prompt, system="You are a helpful meeting assistant.")

        now_ms = int(time.time() * 1000)
        note = Note(
            id=str(uuid.uuid4()),
            session_id=session_id,
            project_id=sess.project_id,
            content=content,
            note_type=note_type,
            created_at=now_ms,
            updated_at=now_ms,
        )
        await self.store.create_note(note)
        log.info("Generated %s for session %s", note_type, session_id[:8])

        return {
            "Note": {
                "ID": note.id,
                "SessionID": note.session_id,
                "ProjectID": note.project_id or "",
                "Content": note.content,
                "NoteType": note.note_type,
                "CreatedAt": _format_time(note.created_at),
                "UpdatedAt": _format_time(note.updated_at),
            }
        }

    async def _get_notes(self, args: dict) -> dict:
        session_id = args.get("SessionID", "")
        if not session_id:
            raise ValueError("session ID required")
        notes = await self.store.get_notes_for_session(session_id)
        return {
            "Notes": [
                {
                    "ID": n.id,
                    "SessionID": n.session_id,
                    "ProjectID": n.project_id or "",
                    "Content": n.content,
                    "NoteType": n.note_type,
                    "CreatedAt": _format_time(n.created_at),
                    "UpdatedAt": _format_time(n.updated_at),
                }
                for n in notes
            ]
        }

    async def _update_note(self, args: dict) -> dict:
        note_id = args.get("ID", "")
        if not note_id:
            raise ValueError("note ID required")
        note = await self.store.get_note(note_id)
        if not note:
            raise ValueError(f"note not found: {note_id}")

        if "Content" in args:
            note.content = args["Content"]
        if "NoteType" in args:
            note.note_type = args["NoteType"]
        note.updated_at = int(time.time() * 1000)
        await self.store.update_note(note)
        return {}

    async def _delete_note(self, args: dict) -> dict:
        note_id = args.get("ID", "")
        if not note_id:
            raise ValueError("note ID required")
        await self.store.delete_note(note_id)
        return {}

    async def _list_note_templates(self, args: dict) -> dict:
        """List available note templates."""
        include_content = args.get("IncludeContent", False)
        templates = []
        for key, tmpl in self.config.note_templates.items():
            entry: dict = {
                "Key": key,
                "Name": tmpl.name,
                "Description": tmpl.description,
            }
            if include_content:
                entry["Template"] = tmpl.template
            templates.append(entry)
        return {"Templates": templates}

    async def _edit_note(self, args: dict) -> dict:
        """AI-powered inline note editing.

        Accepts a note ID, text selection, and user instruction.
        Returns proposed changes for the user to approve/reject.
        """
        note_id = args.get("NoteID", "")
        selection = args.get("Selection", "")
        instruction = args.get("Instruction", "")
        if not note_id:
            raise ValueError("note ID required")
        if not selection:
            raise ValueError("selection required")
        if not instruction:
            raise ValueError("instruction required")
        if not self.llm:
            raise ValueError("no LLM provider configured")

        note = await self.store.get_note(note_id)
        if not note:
            raise ValueError(f"note not found: {note_id}")

        # Find the selection in the note content and extract context
        content = note.content
        sel_idx = content.find(selection)
        if sel_idx < 0:
            raise ValueError("selection not found in note content")

        # Get ~200 chars of context around the selection
        ctx_start = max(0, sel_idx - 200)
        ctx_end = min(len(content), sel_idx + len(selection) + 200)
        context_before = content[ctx_start:sel_idx]
        context_after = content[sel_idx + len(selection):ctx_end]

        # Use the fast enhancement model for edits
        enhancement_model = self.config.summarization.enhancement_model
        try:
            editor = self._resolve_llm_for_model(enhancement_model)
        except Exception:
            editor = self.llm

        changes = await edit_note_selection(
            editor, content, selection, instruction,
            context_before=context_before,
            context_after=context_after,
        )

        return {
            "Changes": [
                {
                    "Original": c.original,
                    "Proposed": c.proposed,
                    "StartOffset": c.start_offset,
                    "EndOffset": c.end_offset,
                }
                for c in changes
            ]
        }

    async def _create_note_template(self, args: dict) -> dict:
        """Create a new note template and save to config."""
        from waves.config import NoteTemplate, save_partial

        key = args.get("Key", "")
        name = args.get("Name", "")
        description = args.get("Description", "")
        template = args.get("Template", "")
        if not key:
            raise ValueError("template key required")
        if not name:
            raise ValueError("template name required")
        if not template:
            raise ValueError("template content required")

        tmpl = NoteTemplate(name=name, description=description, template=template)
        self.config.note_templates[key] = tmpl

        # Persist to YAML
        save_partial({"note_templates": {
            key: {"name": name, "description": description, "template": template}
        }})
        log.info("Created note template: %s", key)
        return {"Key": key}

    async def _update_note_template(self, args: dict) -> dict:
        """Update an existing note template."""
        from waves.config import NoteTemplate, save_partial

        key = args.get("Key", "")
        if not key:
            raise ValueError("template key required")
        if key not in self.config.note_templates:
            raise ValueError(f"template not found: {key}")

        existing = self.config.note_templates[key]
        name = args.get("Name", existing.name)
        description = args.get("Description", existing.description)
        template = args.get("Template", existing.template)

        tmpl = NoteTemplate(name=name, description=description, template=template)
        self.config.note_templates[key] = tmpl

        save_partial({"note_templates": {
            key: {"name": name, "description": description, "template": template}
        }})
        log.info("Updated note template: %s", key)
        return {}

    async def _delete_note_template(self, args: dict) -> dict:
        """Delete a note template."""
        from waves.config import save_partial, default_path
        import yaml

        key = args.get("Key", "")
        if not key:
            raise ValueError("template key required")
        if key not in self.config.note_templates:
            raise ValueError(f"template not found: {key}")

        # Don't allow deleting built-in templates
        from waves.config import DEFAULT_NOTE_TEMPLATES
        if key in DEFAULT_NOTE_TEMPLATES:
            raise ValueError(f"cannot delete built-in template: {key}")

        del self.config.note_templates[key]

        # Remove from YAML file
        cfg_path = default_path()
        if cfg_path.exists():
            with open(cfg_path) as f:
                raw = yaml.safe_load(f) or {}
            if "note_templates" in raw and key in raw["note_templates"]:
                del raw["note_templates"][key]
                with open(cfg_path, "w") as f:
                    yaml.dump(raw, f, default_flow_style=False, sort_keys=False)

        log.info("Deleted note template: %s", key)
        return {}

    async def _rename_session(self, args: dict) -> dict:
        session_id = args.get("SessionID", "")
        title = args.get("Title", "")
        if not session_id:
            raise ValueError("session ID required")
        if not title:
            raise ValueError("title required")

        sess = await self.store.get_session(session_id)
        if not sess:
            raise ValueError(f"session not found: {session_id}")

        sess.title = title

        # Rename audio file to match title
        if sess.audio_path and Path(sess.audio_path).exists():
            old_path = Path(sess.audio_path)
            slug = title.lower().replace(" ", "-")
            # Remove non-alphanumeric chars except hyphens
            slug = "".join(c for c in slug if c.isalnum() or c == "-")
            slug = slug.strip("-")
            new_name = f"{slug}{old_path.suffix}"
            new_path = old_path.parent / new_name

            # Avoid overwriting existing files
            if new_path != old_path:
                counter = 1
                base_path = new_path
                while new_path.exists():
                    new_path = base_path.with_stem(f"{base_path.stem}-{counter}")
                    counter += 1

                old_path.rename(new_path)
                sess.audio_path = str(new_path)
                log.info("Renamed audio: %s -> %s", old_path.name, new_path.name)

        await self.store.update_session(sess)
        return {"AudioPath": sess.audio_path}

    async def _delete_session(self, args: dict) -> dict:
        session_id = args.get("SessionID", "")
        if not session_id:
            raise ValueError("session ID required")

        sess = await self.store.get_session(session_id)
        if not sess:
            raise ValueError(f"session not found: {session_id}")

        audio_path = await self.store.delete_session(sess.id)

        # Try to remove the audio file from disk
        if audio_path:
            try:
                if os.path.exists(audio_path):
                    os.remove(audio_path)
                    log.info("Deleted audio file: %s", audio_path)
            except Exception:
                log.warning("Failed to delete audio file: %s", audio_path, exc_info=True)

        return {"Deleted": True}


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
