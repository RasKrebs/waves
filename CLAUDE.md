# Waves

Local-first macOS meeting transcription and summarization app. Captures system audio (including through headphones via BlackHole), transcribes with pluggable backends, and summarizes with configurable LLM workflows.

## Architecture

Three layers communicating over Unix socket JSON-RPC:

1. **`wavesd`** (Go daemon) - audio capture, transcription, summarization, SQLite storage
2. **`waves`** (Go CLI) - user-facing commands for recording, playback, model management
3. **Electron app** (TypeScript + React) - menu bar app with meeting detection, live transcript UI

The daemon is the single source of truth. Both the CLI and Electron app are thin clients that call RPC methods on it.

## Project Structure

```
cmd/
  wavesd/main.go              # Daemon entry point - wires up all providers from config
  waves/main.go               # CLI entry point - cobra commands, calls RPC

internal/
  audio/capture.go            # CoreAudio capture via CGo (ring buffer, BlackHole detection)
  config/config.go            # YAML config (~/.config/waves/config.yaml)
  models/downloader.go        # HuggingFace model downloader
  server/server.go            # JSON-RPC server - all RPC handlers live here
  store/store.go              # SQLite: sessions + segments tables
  types/types.go              # Shared RPC request/reply types (used by CLI + server)

  transcribe/
    provider.go               # Provider interface + StreamProvider interface
    whisper.go                 # whisper.cpp CLI backend (local)
    command.go                 # Generic command backend - any binary with template args
    openai.go                  # OpenAI Whisper API
    deepgram.go                # Deepgram API
    restapi.go                 # Custom REST endpoint

  summarize/
    provider.go               # Provider interface
    workflow.go                # Multi-step pipeline runner ({{.Transcript}}, {{.PreviousOutput}})
    claude.go                  # Anthropic Messages API
    openai.go                  # OpenAI Chat Completions API
    llama.go                   # llama.cpp CLI (local)
    restapi.go                 # Custom REST endpoint

electron/
  src/
    main.ts                   # Electron main process (tray, windows, daemon lifecycle)
    daemon.ts                 # Unix socket JSON-RPC client -> Go daemon
    meeting-detector.ts       # Polls active-win for Teams/Zoom/Meet/etc.
    preload.ts                # Secure bridge: window.waves.* API for renderer
  renderer/
    App.tsx                   # Root layout with sidebar navigation
    views/LiveView.tsx        # Live transcript + recording controls
    views/HistoryView.tsx     # Session browser with transcript + summarize button
    views/ModelsView.tsx      # Model management + HuggingFace pull
    views/SettingsView.tsx    # Audio, providers, config display
    components/StatusBar.tsx  # Sidebar status + meeting banner overlay
    banner.html               # Standalone banner window for meeting detection popup
    index.css                 # Dark theme design system (IBM Plex, CSS custom properties)

scripts/
  setup.sh                   # Checks/installs: brew, go, node, blackhole, whisper.cpp, deps, config
  install-cli.sh             # setup + build + install wavesd/waves to /usr/local/bin
  install-app.sh             # setup + build + package Electron .dmg
  install-all.sh             # both CLI and app
```

## Key Design Decisions

- **Go module path is `waves`** (not a github URL) since there's no remote repo yet
- **RPC service name is `Waves`** - all methods are `Waves.MethodName`
- **Audio requires BlackHole** - virtual audio driver for loopback capture. User must set up a Multi-Output Device in Audio MIDI Setup
- **Config file at `~/.config/waves/config.yaml`** - YAML, loaded once at daemon startup
- **Transcription is pluggable** via `Provider` interface. The `command` provider lets users run ANY binary with template args (`{{.Input}}`, `{{.Language}}`, `{{.Model}}`). Output parsing supports json (multiple shapes), srt, vtt, jsonl
- **Summarization is pluggable** via `Provider` interface + `Workflow` pipelines (multi-step prompts with `{{.Transcript}}` and `{{.PreviousOutput}}` templates)
- **Language is a top-level transcription config field** (`transcription.language`) passed to all providers. Owner is not a native English speaker
- **Electron uses `active-win` v7** (CommonJS compatible; v8+ is ESM-only and breaks)
- **Preload exposes `window.waves.*`** - all renderer<->main IPC goes through typed handlers
- **Electron app hides dock icon** (`LSUIElement: true`) - lives in the menu bar only

## Build & Run

```bash
make build          # builds build/wavesd + build/waves
make run-daemon     # go run ./cmd/wavesd -v
make electron-dev   # daemon + electron in dev mode with hot reload
make setup          # runs scripts/setup.sh (installs all deps)
make install-all    # full install (CLI + Electron app)
```

## Data Locations

- **Database**: `~/Library/Application Support/Waves/waves.db`
- **Models**: `~/Library/Application Support/Waves/models/`
- **Recordings**: `~/Library/Application Support/Waves/recordings/`
- **Socket**: `~/Library/Application Support/Waves/daemon.sock`
- **Config**: `~/.config/waves/config.yaml`

## Current State / What Works

- Go daemon and CLI compile and build cleanly
- Full RPC API: Status, StartRecording, StopRecording, ListSessions, GetSession, ListModels, SetModel, PullModel, ListDevices, Summarize, GetConfig
- CoreAudio capture implementation (CGo) with BlackHole device detection
- All transcription providers implemented (whisper-local, command, openai, deepgram, rest-api)
- All summarization providers implemented (claude, openai, llama-local, rest-api)
- Workflow engine with multi-step pipelines
- Electron app scaffolded with all views, meeting detection, tray, banner
- Setup/install scripts

## Known Gaps / Next Steps

- **No tests** - needs unit tests for store, transcription parsing, workflow engine
- **No real-time segment push** - daemon stores segments but doesn't push them to Electron yet (renderer polls status but `transcript:segment` events aren't emitted from the server)
- **Electron not fully tested end-to-end** - npm install works, but the full dev flow (daemon + electron together) hasn't been validated in a live session
- **No tray icons** - references `assets/tray-idle.png` and `tray-recording.png` which don't exist yet
- **No code signing** - Electron packaging works but the app won't be signed for distribution
- **Config changes require daemon restart** - no hot-reload of config
- **HuggingFace token** - the downloader reuses the Claude API key as HF token which is wrong; should have its own `huggingface.token` config field
