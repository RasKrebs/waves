# Waves

Local-first macOS meeting intelligence app. Captures system audio from any application (no virtual audio driver needed), transcribes with pluggable backends, enhances transcripts with a fast LLM, and generates structured meeting notes from configurable templates.

## Architecture

Four components communicating over Unix socket JSON-RPC:

1. **Python backend** (`backend/waves/`) - spawns waves-audio, runs transcription/enhancement/summarization, SQLite storage
2. **`waves`** (Go CLI) - user-facing commands for recording, playback, model management
3. **`waves-audio`** (Swift CLI) - audio capture via CoreAudio Process Tap and AVAudioEngine
4. **Electron app** (TypeScript + React) - menu bar app with Notion-like sidebar, recording controls, meeting notes UI

The backend is the single source of truth. Both the CLI and Electron app are thin clients that call RPC methods on it. The backend spawns `waves-audio` as a subprocess and reads raw PCM16 mono 16kHz from its stdout.

**Note**: The Go daemon (`wavesd`) still exists in `cmd/wavesd/` and `internal/` but is no longer the primary backend. The Python backend is a drop-in replacement — same Unix socket, same RPC methods, same response shapes. The Go CLI works with either backend.

## Project Structure

```
backend/                          # Python backend (replaces Go daemon)
  pyproject.toml                  # uv project config + dependencies
  waves/
    __init__.py
    __main__.py                   # Entry point: python -m waves
    server.py                     # JSON-RPC server (Unix socket, asyncio)
    config.py                     # YAML config loader (~/.config/waves/config.yaml)
    store.py                      # Async SQLite (sessions, segments, projects, notes)
    audio.py                      # Spawn waves-audio subprocess, stream PCM, WAV writing
    providers/
      base.py                     # Protocol definitions (TranscriptionProvider, LLMProvider)
      registry.py                 # Provider registry — resolves "provider|model" specs
      transcription/
        whisper_local.py          # whisper.cpp CLI backend (local)
        huggingface.py            # HuggingFace transformers backend
        openai_whisper.py         # OpenAI Whisper API
        deepgram.py               # Deepgram API
      llm/
        anthropic.py              # Anthropic Claude API
        openai_chat.py            # OpenAI Chat Completions API
        ollama.py                 # Ollama local API
    pipeline/
      summarize.py                # Multi-step workflow runner
      enhance.py                  # Two-stage pipeline: transcript enhancement + template mapping

cmd/                              # Go (legacy, still functional)
  wavesd/main.go                  # Go daemon entry point
  waves/main.go                   # CLI entry point - cobra commands, calls RPC

internal/                         # Go daemon internals (legacy)
  audio/
    capture.go                    # Legacy CoreAudio capture via CGo
    subprocess.go                 # SubprocessCapture - spawns waves-audio
  config/config.go                # YAML config
  models/downloader.go            # HuggingFace model downloader
  server/server.go                # JSON-RPC server
  store/store.go                  # SQLite: sessions + segments tables
  types/types.go                  # Shared RPC request/reply types

  transcribe/
    provider.go                   # Provider interface + StreamProvider interface
    whisper.go                    # whisper.cpp CLI backend (local)
    command.go                    # Generic command backend
    openai.go                     # OpenAI Whisper API
    deepgram.go                   # Deepgram API
    restapi.go                    # Custom REST endpoint

  summarize/
    provider.go                   # Provider interface
    workflow.go                   # Multi-step pipeline runner
    claude.go                     # Anthropic Messages API
    openai.go                     # OpenAI Chat Completions API
    llama.go                      # llama.cpp CLI (local)
    restapi.go                    # Custom REST endpoint

tools/
  waves-audio/                    # Swift CLI for audio capture (macOS 14.2+)
    Sources/
      main.swift                  # CLI entry point (list, tap, mic, devices, tap-all)
      ProcessTapCapture.swift     # CoreAudio Process Tap + aggregate device capture
      MicCapture.swift            # AVAudioEngine microphone capture
      CoreAudioUtils.swift        # AudioObjectID extensions + property helpers
    Package.swift                 # Swift Package Manager config
    waves-audio.entitlements      # Audio input entitlement for code signing

electron/
  main/
    index.cts                     # Electron main process (tray, windows, Python backend lifecycle)
    daemon.cts                    # Unix socket JSON-RPC client (with retry on connect)
    preload.cts                   # Secure bridge: window.waves.* API for renderer
  src/
    routes/                       # TanStack Router file-based routes
      __root.tsx                  # Root layout (sidebar + content area)
      index.tsx                   # Redirects to /history
      history.tsx                 # Meetings list + detail with notes (supports ?session=id deep-link)
      record.tsx                  # Advanced recording with source picker
      upload.tsx                  # File upload for transcription
      projects.tsx                # Project management
      models.tsx                  # Model management
    lib/
      process-names.ts            # Maps macOS bundle IDs to friendly names
    types/waves.d.ts              # TypeScript types for renderer
    main.tsx                      # Renderer entry point
    routeTree.gen.ts              # TanStack Router route tree (manually maintained)
  components/
    app-sidebar.tsx               # Notion-like sidebar: recording controls, project tree, nav
    settings-dialog.tsx           # Settings dialog (General/Transcription/Summarization/Models)
    ui/                           # shadcn/ui components

scripts/
  setup.sh                       # Checks/installs dependencies
  install-cli.sh                  # Build + install CLI
  install-app.sh                  # Build + package Electron .dmg
  install-all.sh                  # Both CLI and app

PLAN.md                           # Feature roadmap (meeting detection, inline AI editing, etc.)
PRODUCT.md                        # Product vision and pipeline design
```

## Key Design Decisions

- **Python backend managed with `uv`** — run `cd backend && uv sync` to install deps
- **Electron spawns Python backend** via `uv run python -m waves` (not the Go binary)
- **Go module path is `waves`** (not a github URL) since there's no remote repo yet
- **RPC service name is `Waves`** - all methods are `Waves.MethodName`
- **Audio capture via waves-audio** (Swift CLI) - uses CoreAudio Process Tap API (macOS 14.2+) for per-process capture without BlackHole. Falls back to AVAudioEngine for mic input. Binary must be ad-hoc code-signed with `com.apple.security.device.audio-input` entitlement or macOS will SIGKILL it. Do NOT add app-sandbox entitlement — it breaks stdout pipe output
- **Process tap requires "Screen & System Audio Recording" permission** in System Settings > Privacy & Security. Without it, audio buffers are silently zeroed by macOS
- **Some apps use helper subprocesses for audio** (e.g., Spotify uses `com.spotify.client.helper`). The main app PID may show as inactive (`○`) in `waves-audio list` while the helper has the actual audio stream
- **Config file at `~/.config/waves/config.yaml`** - YAML, loaded once at backend startup, hot-swappable via SetConfig RPC
- **Provider registry** (`providers/registry.py`) — providers self-register via factory functions. Spec format: `"provider|model"` (e.g., `"anthropic|claude-haiku-4-5-20251001"`)
- **Two-stage note generation pipeline** — Enhancement (fast LLM fixes ASR errors) → Template mapping (quality LLM fills structured template). Models configurable independently: `summarization.enhancement_model` and `summarization.summarization_model`
- **Note templates** — Markdown templates with `{{.Title}}`, `{{.Date}}`, `{{.Duration}}` variables and HTML comment instructions for the LLM. Defaults: "general-meeting" and "standup". Users add custom templates in config YAML under `note_templates:`
- **Dual audio capture** — Backend can run two `waves-audio` subprocesses simultaneously (system audio tap + microphone). Interleaves to stereo WAV for archival, mixes to mono for transcription
- **Transcription is pluggable** via `TranscriptionProvider` protocol. Implemented: whisper-local, huggingface, openai, deepgram
- **LLM is pluggable** via `LLMProvider` protocol. Implemented: anthropic/claude, openai, ollama
- **Summarization uses Workflow pipelines** — multi-step prompts with `{{.Transcript}}` and `{{.PreviousOutput}}` templates
- **Language is a top-level transcription config field** (`transcription.language`) passed to all providers. Owner is not a native English speaker
- **Preload exposes `window.waves.*`** - all renderer<->main IPC goes through typed handlers
- **Electron app hides dock icon** (`LSUIElement: true`) - lives in the menu bar only
- **Daemon client has retry logic** — up to 5 retries with backoff when socket isn't ready yet (handles startup race condition)
- **Process name mapping** (`process-names.ts`) — maps macOS bundle IDs (e.g., `com.spotify.client`) to friendly names (e.g., "Spotify") for the UI

## Build & Run

```bash
# Python backend
cd backend && uv sync            # install Python dependencies
make backend-run                  # run Python backend standalone

# Full dev (Python backend + Electron)
make dev                          # builds waves-audio, installs Python deps, starts Electron

# Go (legacy)
make build                        # builds build/wavesd + build/waves + build/waves-audio
make run-daemon                   # go run ./cmd/wavesd -v
```

## Data Locations

- **Database**: `~/Library/Application Support/Waves/waves.db`
- **Models**: `~/Library/Application Support/Waves/models/`
- **Recordings**: `~/Library/Application Support/Waves/recordings/`
- **Socket**: `~/Library/Application Support/Waves/daemon.sock`
- **Config**: `~/.config/waves/config.yaml`

## Current State / What Works

- **Python backend** running and serving all RPC methods
- **Full RPC surface**: Status, GetConfig, SetConfig, ListSessions, GetSession, StartRecording, StopRecording, ListDevices, ListProcesses, ListModels, SetModel, PullModel, Summarize, TranscribeFile, RetranscribeSession, RenameSession
- **Projects**: CreateProject, ListProjects, GetProject, UpdateProject, DeleteProject, AssignSession
- **Notes**: GenerateNotes, GetNotes, UpdateNote, DeleteNote, ListNoteTemplates
- **Two-stage note generation**: Enhancement (Haiku) → Template mapping (Sonnet) with configurable models
- **Note templates**: "general-meeting" and "standup" built-in, user-customizable via config
- **Dual audio capture**: System audio + microphone recorded simultaneously, stereo WAV archival
- **4 transcription providers**: whisper-local, huggingface, openai, deepgram
- **3 LLM providers**: anthropic/claude, openai, ollama
- **Auto-generate notes** after recording stops (background task)
- **Go CLI works with Python backend** — `waves status` connects and shows correct state
- **Same SQLite database** — Python backend reads/writes the same `waves.db`
- **Electron app** with Notion-like sidebar, project tree, recording controls, session detail with meeting notes
- **Process name mapping** — bundle IDs shown as friendly app names in source picker
- **Daemon retry logic** — Electron handles socket not-ready race condition gracefully
- Audio capture via waves-audio Swift CLI (process tap + mic), no BlackHole needed
- Process tap capture confirmed working (Chromium browsers, Voice Memos, Spotify via helper PID)
- Live recording saves raw audio as WAV to ~/Library/Application Support/Waves/recordings/
- Streaming transcription (10s chunked) implemented
- HuggingFace model download via PullModel RPC

## Known Gaps / Next Steps

See `PLAN.md` for the full feature roadmap. Key gaps:

- **Meeting detection** — auto-detect Teams/Zoom/Meet and prompt to record (planned, not implemented)
- **Unassigned meeting flow** — no inbox/banner for meetings without a project
- **Meeting type selection** — users can't pick standup vs general from the UI yet (backend supports it)
- **Inline AI editing** — select text in notes, right-click "Edit with AI" (not implemented)
- **Calendar integration** — infer project/meeting type from calendar events (future)
- **Custom templates UI** — templates only editable via YAML config, no in-app editor
- **No tests** — needs unit tests for store, transcription parsing, pipeline
- **No real-time segment push** — backend stores segments but doesn't push to Electron yet
- **No tray icons** — references `assets/tray-idle.png` and `tray-recording.png` which don't exist yet
- **No code signing** — Electron packaging works but the app won't be signed for distribution
- **Process tap warmup** — first few IO callbacks (~4) return zero-filled buffers; short recordings (<7s) may miss audio
