# Waves

Local-first macOS meeting intelligence app. Captures system audio from any application (no virtual audio driver needed), transcribes with pluggable backends, and generates structured meeting notes with configurable LLM pipelines.

## Architecture

Four components communicating over Unix socket JSON-RPC:

```
┌─────────────┐   ┌───────────┐
│ Electron App│   │ waves CLI │
│ (TypeScript)│   │   (Go)    │
└──────┬──────┘   └─────┬─────┘
       │  JSON-RPC/Unix │
       └───────┬────────┘
         ┌─────┴──────┐
         │  Python     │
         │  Backend    │
         └─────┬──────┘
               │ stdin/stdout (PCM16)
         ┌─────┴──────┐
         │waves-audio  │
         │ (Swift CLI) │
         └─────────────┘
```

### Python Backend

The central backend and single source of truth. Manages recording sessions, runs transcription/enhancement/summarization, and stores everything in SQLite.

- JSON-RPC API over Unix socket (30+ methods)
- Spawns `waves-audio` for audio capture, reads raw PCM from stdout
- Pluggable transcription: whisper.cpp (local), HuggingFace, OpenAI, Deepgram
- Pluggable LLMs: Anthropic Claude, OpenAI, Ollama
- Two-stage note generation: enhancement (fast LLM) → template mapping (quality LLM)
- Projects, notes, and configurable note templates
- Dual audio capture (system audio + microphone simultaneously)

### `waves` — Go CLI

Thin command-line client for the backend.

```bash
waves status                    # backend status
waves record                    # record from default mic
waves record --pid 1234         # capture audio from a specific process
waves stop                      # stop recording
waves sessions                  # list past sessions
waves show <id>                 # show transcript
waves models list               # list whisper models
waves models pull <repo>        # download model from HuggingFace
```

### `waves-audio` — Swift CLI

Standalone Swift tool for audio capture on macOS 14.2+. Uses CoreAudio Process Tap API — no BlackHole or virtual audio drivers needed.

```bash
waves-audio list                 # list processes with active audio
waves-audio tap <pid>            # capture audio from a specific process
waves-audio tap-all              # capture all system audio
waves-audio mic                  # capture from default microphone
waves-audio devices              # list available input devices
```

### Electron App

Menu bar application (TypeScript + React) with Notion-like sidebar, project tree, inline recording controls, session detail with meeting notes, and settings. Hides dock icon — lives in the menu bar only.

## Build & Run

```bash
# Full dev (Python backend + Electron)
make dev                          # builds waves-audio, installs Python deps, starts Electron

# Python backend only
cd backend && uv sync             # install Python dependencies
make backend-run                  # run Python backend standalone

# Go CLI (legacy, still works)
make build                        # builds build/waves + build/waves-audio
```

### Requirements

- macOS 14.2+ (for process tap audio capture)
- Python 3.11+ with `uv` for backend
- Node.js 18+ (for Electron app)
- Swift 5.9+ (included with Xcode, for waves-audio)
- Go 1.21+ (only if using the Go CLI)
- "Screen & System Audio Recording" permission in System Settings > Privacy & Security

## Project Structure

```
backend/                          # Python backend (primary)
  waves/
    server.py                     # JSON-RPC server (asyncio, Unix socket)
    config.py                     # YAML config loader
    store.py                      # Async SQLite (sessions, segments, projects, notes)
    audio.py                      # Audio capture (spawn waves-audio, dual mode)
    providers/
      registry.py                 # Provider registry ("provider|model" spec resolution)
      transcription/              # whisper_local, huggingface, openai_whisper, deepgram
      llm/                        # anthropic, openai_chat, ollama
    pipeline/
      enhance.py                  # Transcript enhancement + template-based note generation
      summarize.py                # Multi-step workflow runner

cmd/                              # Go CLI
tools/waves-audio/                # Swift audio capture CLI
electron/                         # Electron app (Vite + TanStack Router + shadcn/ui)

PLAN.md                           # Feature roadmap
PRODUCT.md                        # Product vision
```

## Data Locations

| What | Where |
|------|-------|
| Database | `~/Library/Application Support/Waves/waves.db` |
| Recordings | `~/Library/Application Support/Waves/recordings/` |
| Models | `~/Library/Application Support/Waves/models/` |
| Socket | `~/Library/Application Support/Waves/daemon.sock` |
| Config | `~/.config/waves/config.yaml` |

## Configuration

Edit `~/.config/waves/config.yaml`:

```yaml
transcription:
  provider: huggingface|syvai/hviske-v3-conversation  # or whisper-local, openai, deepgram
  language: da

summarization:
  provider: anthropic
  enhancement_model: claude-haiku-4-5-20251001        # fast model for fixing transcript errors
  summarization_model: claude-sonnet-4-20250514       # quality model for generating notes
  claude:
    api_key: sk-ant-...

note_templates:
  general-meeting:
    name: General Meeting
    description: Standard meeting notes
    template: |
      # {{.Title}}
      ## Key Points
      ## Decisions Made
      ## Action Items
  standup:
    name: Standup
    description: Daily standup format
    template: |
      # Standup — {{.Date}}
      ## Team Updates
      ## Blockers

workflows:
  default:
    steps:
      - name: summarize
        prompt: "Summarize concisely: {{.Transcript}}"
```

## Permissions

On first run, macOS will prompt for:
- **Microphone** — for mic capture
- **Screen & System Audio Recording** — for process tap capture (System Settings > Privacy & Security)
