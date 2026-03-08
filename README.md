# Waves

Local-first macOS meeting transcription and summarization app. Captures system audio from any application (no virtual audio driver needed), transcribes with pluggable backends, and summarizes with configurable LLM workflows.

## Architecture

Four components communicating over Unix socket JSON-RPC:

```
┌─────────────┐   ┌───────────┐
│ Electron App│   │ waves CLI │
│ (TypeScript)│   │   (Go)    │
└──────┬──────┘   └─────┬─────┘
       │  JSON-RPC/Unix │
       └───────┬────────┘
         ┌─────┴─────┐
         │  wavesd    │
         │ (Go daemon)│
         └─────┬─────┘
               │ stdin/stdout (PCM16)
         ┌─────┴──────┐
         │waves-audio  │
         │ (Swift CLI) │
         └─────────────┘
```

### `wavesd` — Go Daemon

The central daemon and single source of truth. Manages recording sessions, runs transcription and summarization providers, and stores everything in SQLite.

- Exposes a JSON-RPC API over a Unix socket (`Waves.StartRecording`, `Waves.StopRecording`, `Waves.ListSessions`, etc.)
- Spawns `waves-audio` as a subprocess for audio capture, reads raw PCM from its stdout
- Chunks audio into segments and runs them through the configured transcription provider
- Saves raw audio as WAV files alongside transcripts
- Pluggable transcription backends: whisper.cpp (local), OpenAI, Deepgram, generic command, REST API
- Pluggable summarization backends: Claude, OpenAI, llama.cpp (local), REST API
- Multi-step summarization workflows with template variables

### `waves` — Go CLI

Thin command-line client for the daemon.

```bash
waves status                    # daemon status
waves record                    # record from default mic
waves record --pid 1234         # capture audio from a specific process
waves record --device <uid>     # capture from a specific input device
waves stop                      # stop recording
waves sessions                  # list past sessions
waves show <id>                 # show transcript
waves show <id> --summarize     # show + generate summary
waves models list               # list whisper models
waves models pull <repo>        # download model from HuggingFace
waves models set <name>         # set active model
waves config                    # show current config
```

### `waves-audio` — Swift CLI

A standalone Swift command-line tool for audio capture on macOS.

**Why Swift?** CoreAudio's Process Tap API (`CATapDescription`, `AudioHardwareCreateProcessTap`) was introduced in macOS 14.2 and requires direct access to Apple's `AudioToolbox`, `AVFoundation`, and `CoreAudio` frameworks. These APIs are Objective-C/Swift-native with complex callback patterns, aggregate device configuration, and entitlement requirements that make them impractical to use from Go via CGo. Swift provides first-class framework access, proper entitlement support via code signing, and safe interop with CoreAudio's C-level buffer structures.

Outputs raw PCM16 mono 16kHz audio on stdout — all status/error messages go to stderr. This makes it composable with any tool that reads PCM audio (e.g., pipe directly to whisper-cli).

```bash
waves-audio list                 # list processes with active audio
waves-audio tap <pid>            # capture audio from a specific process
waves-audio tap-all              # capture all system audio
waves-audio mic                  # capture from default microphone
waves-audio mic --device <uid>   # capture from a specific input device
waves-audio devices              # list available input devices
```

**Capture modes:**

- **Process Tap** (`tap <pid>`) — Uses CoreAudio's `CATapDescription` + aggregate device to capture audio from a single process without any virtual audio driver. Requires macOS 14.2+ and "Screen & System Audio Recording" permission.
- **Global Tap** (`tap-all`) — Captures all system audio at once.
- **Microphone** (`mic`) — Standard input device capture via `AVAudioEngine`.

> **Note:** Some apps (like Spotify) use helper subprocesses for audio playback. Use `waves-audio list` to find the process with the `●` (active) indicator — it may be a helper process rather than the main app PID.

### Electron App

Menu bar application (TypeScript + React) with meeting detection, live transcript view, session history, model management, and settings. Auto-detects Teams/Zoom/Meet windows and offers to record. Hides dock icon (`LSUIElement: true`) — lives in the menu bar only.

## Build & Run

```bash
make build          # builds build/wavesd + build/waves + build/waves-audio
make run-daemon     # go run ./cmd/wavesd -v
make dev            # builds daemon + waves-audio, runs electron in dev mode
make install        # installs all binaries to /usr/local/bin
make setup          # runs scripts/setup.sh (installs all dependencies)
make config-init    # creates default config at ~/.config/waves/config.yaml
```

### Requirements

- macOS 14.2+ (for process tap audio capture)
- Go 1.21+
- Swift 5.9+ (included with Xcode)
- Node.js 18+ (for Electron app)
- whisper-cli (whisper.cpp) for local transcription
- "Screen & System Audio Recording" permission in System Settings > Privacy & Security (for process tap)

## Project Structure

```
cmd/
  wavesd/                       # Daemon entry point
  waves/                        # CLI entry point (cobra commands)

internal/
  audio/
    capture.go                  # Legacy CoreAudio capture via CGo
    subprocess.go               # SubprocessCapture — spawns waves-audio, implements io.Reader
  config/                       # YAML config loader
  models/                       # HuggingFace model downloader
  server/                       # JSON-RPC server + all RPC handlers
  store/                        # SQLite storage (sessions + segments)
  types/                        # Shared RPC request/reply types
  transcribe/                   # Transcription provider interface + implementations
  summarize/                    # Summarization provider interface + workflow engine

tools/
  waves-audio/                  # Swift CLI for audio capture
    Sources/
      main.swift                # CLI entry point (list, tap, mic, devices)
      ProcessTapCapture.swift   # CoreAudio Process Tap + aggregate device
      MicCapture.swift          # AVAudioEngine microphone capture
      CoreAudioUtils.swift      # AudioObjectID extensions + property helpers
    Package.swift               # Swift Package Manager config
    waves-audio.entitlements    # Audio input entitlement for code signing

electron/                       # Menu bar Electron app (TypeScript + React)

scripts/                        # Setup and install scripts
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
  provider: whisper-local  # whisper-local | command | openai | deepgram | rest-api
  language: en
  whisper:
    binary: whisper-cli
    model: ggml-base.en
  openai:
    api_key: sk-...
    model: whisper-1
  deepgram:
    api_key: ...

summarization:
  provider: claude  # claude | openai | llama-local | rest-api
  claude:
    api_key: sk-ant-...
    model: claude-sonnet-4-20250514
  openai:
    api_key: sk-...
    model: gpt-4o

workflows:
  default:
    steps:
      - name: summarize
        prompt: |
          Summarize the following meeting transcript concisely.
          Focus on key decisions, action items, and important discussion points.

          Transcript:
          {{.Transcript}}
  action-items:
    steps:
      - name: summarize
        prompt: "Summarize briefly: {{.Transcript}}"
      - name: extract
        prompt: "Extract action items from: {{.PreviousOutput}}"
```

## Permissions

On first run, macOS will prompt for:
- **Microphone** — for mic capture
- **Screen & System Audio Recording** — for process tap capture (System Settings > Privacy & Security)
- **Accessibility** — for meeting window title detection (optional, Electron app only)
