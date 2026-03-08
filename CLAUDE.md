# Waves

Local-first macOS meeting transcription and summarization app. Captures system audio from any application (no virtual audio driver needed), transcribes with pluggable backends, and summarizes with configurable LLM workflows.

## Architecture

Four components communicating over Unix socket JSON-RPC:

1. **Python backend** (`backend/waves/`) - spawns waves-audio, runs transcription/summarization, SQLite storage
2. **`waves`** (Go CLI) - user-facing commands for recording, playback, model management
3. **`waves-audio`** (Swift CLI) - audio capture via CoreAudio Process Tap and AVAudioEngine
4. **Electron app** (TypeScript + React) - menu bar app with meeting detection, live transcript UI

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
    store.py                      # Async SQLite (sessions + segments tables)
    audio.py                      # Spawn waves-audio subprocess, stream PCM, WAV writing
    providers/
      base.py                     # Protocol definitions (TranscriptionProvider, LLMProvider)
      transcription/
        whisper_local.py          # whisper.cpp CLI backend (local)
      llm/                        # (not yet implemented)
    pipeline/                     # (not yet implemented)

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
    daemon.cts                    # Unix socket JSON-RPC client
    preload.cts                   # Secure bridge: window.waves.* API for renderer
  src/
    routes/                       # TanStack Router file-based routes
    types/waves.d.ts              # TypeScript types for renderer
    main.tsx                      # Renderer entry point
  components/                     # shadcn/ui components

scripts/
  setup.sh                       # Checks/installs dependencies
  install-cli.sh                  # Build + install CLI
  install-app.sh                  # Build + package Electron .dmg
  install-all.sh                  # Both CLI and app
```

## Key Design Decisions

- **Python backend managed with `uv`** — run `cd backend && uv sync` to install deps
- **Electron spawns Python backend** via `uv run python -m waves` (not the Go binary)
- **Go module path is `waves`** (not a github URL) since there's no remote repo yet
- **RPC service name is `Waves`** - all methods are `Waves.MethodName`
- **Audio capture via waves-audio** (Swift CLI) - uses CoreAudio Process Tap API (macOS 14.2+) for per-process capture without BlackHole. Falls back to AVAudioEngine for mic input. Binary must be ad-hoc code-signed with `com.apple.security.device.audio-input` entitlement or macOS will SIGKILL it. Do NOT add app-sandbox entitlement — it breaks stdout pipe output
- **Process tap requires "Screen & System Audio Recording" permission** in System Settings > Privacy & Security. Without it, audio buffers are silently zeroed by macOS
- **Some apps use helper subprocesses for audio** (e.g., Spotify uses `com.spotify.client.helper`). The main app PID may show as inactive (`○`) in `waves-audio list` while the helper has the actual audio stream
- **Config file at `~/.config/waves/config.yaml`** - YAML, loaded once at backend startup
- **Transcription is pluggable** via `TranscriptionProvider` protocol. Currently only `whisper-local` (whisper.cpp CLI) is implemented in Python; more providers coming
- **Summarization is pluggable** via `LLMProvider` protocol + `Workflow` pipelines (multi-step prompts with `{{.Transcript}}` and `{{.PreviousOutput}}` templates)
- **Language is a top-level transcription config field** (`transcription.language`) passed to all providers. Owner is not a native English speaker
- **Preload exposes `window.waves.*`** - all renderer<->main IPC goes through typed handlers
- **Electron app hides dock icon** (`LSUIElement: true`) - lives in the menu bar only

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

- **Python backend** running and serving all core RPC methods (Status, GetConfig, ListSessions, GetSession, StartRecording, StopRecording, ListDevices, ListModels, SetModel)
- **Go CLI works with Python backend** — `waves status` connects and shows correct state
- **Same SQLite database** — Python backend reads/writes the same `waves.db` as the Go daemon
- **Electron app spawns Python backend** via `uv run python -m waves`
- Audio capture via waves-audio Swift CLI (process tap + mic), no BlackHole needed
- Process tap capture confirmed working (Chromium browsers, Voice Memos, Spotify via helper PID)
- Live recording saves raw audio as WAV to ~/Library/Application Support/Waves/recordings/
- Streaming transcription via whisper.cpp CLI (10s chunked) implemented in Python
- Go daemon still functional as fallback (all providers implemented there)
- Electron app scaffolded with all views, meeting detection, tray, banner

## Known Gaps / Next Steps

- **Python backend: more transcription providers** — only `whisper-local` implemented; need openai, deepgram, whisper-hf, custom command
- **Python backend: summarization** — not yet implemented (Summarize RPC returns error)
- **Python backend: enhancement pipeline** — not yet implemented
- **Python backend: file transcription** — not yet implemented (TranscribeFile RPC returns error)
- **Python backend: model download** — PullModel RPC not yet implemented
- **No tests** - needs unit tests for store, transcription parsing, workflow engine
- **No real-time segment push** - backend stores segments but doesn't push them to Electron yet
- **Electron not fully tested end-to-end** - the full dev flow hasn't been validated in a live session
- **No tray icons** - references `assets/tray-idle.png` and `tray-recording.png` which don't exist yet
- **No code signing** - Electron packaging works but the app won't be signed for distribution
- **Config changes require backend restart** - no hot-reload of config
- **Process tap warmup** - first few IO callbacks (~4) return zero-filled buffers; short recordings (<7s) may miss audio
