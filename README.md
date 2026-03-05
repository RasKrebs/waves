# Waves

Local-first meeting transcription and summarization for macOS.
Captures system audio (including headphone output), transcribes with pluggable backends, summarizes with your choice of LLM.

## Architecture

```
+-------------------------------------+
|    Electron App (React + TS)        |  <- Meeting detection, UI
|  Auto-detects Teams/Meet/Zoom       |
|  Shows "Record Meeting?" banner     |
+--------------+-----------------------+
               | Unix socket JSON-RPC
+--------------v-----------------------+
|       wavesd daemon (Go)            |  <- Audio capture, transcription
|  CoreAudio -> BlackHole capture     |
|  Pluggable transcription backends   |
|  Pluggable summarization backends   |
|  SQLite session storage             |
+--------------+-----------------------+
               |
+--------------v-----------------------+
|        waves CLI (Go)               |  <- Manual control, scripting
+--------------------------------------+
```

## Prerequisites

### 1. BlackHole (virtual audio driver)
```bash
brew install blackhole-2ch
```

After installing, set up a Multi-Output Device in **Audio MIDI Setup**:
1. Open Audio MIDI Setup (in /Applications/Utilities)
2. Click + -> Create Multi-Output Device
3. Check both BlackHole 2ch AND your headphones/speakers
4. Set this Multi-Output Device as your system output in System Settings -> Sound

### 2. whisper.cpp (for local transcription)
```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make
sudo cp build/bin/whisper-cli /usr/local/bin/
```

### 3. Go 1.23+
```bash
brew install go
```

## Building

```bash
# Build daemon and CLI
make build

# Install binaries
make install

# Initialize config
make config-init
```

## Configuration

Edit `~/.config/waves/config.yaml`:

```yaml
transcription:
  provider: whisper-local  # whisper-local | openai | deepgram | rest-api
  whisper:
    model: ggml-base.en
    binary: whisper-cli
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
  llama:
    binary: llama-cli
    model: /path/to/model.gguf

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

### Transcription Providers

| Provider | Config key | Notes |
|----------|-----------|-------|
| whisper.cpp (local) | `whisper-local` | Default. Requires whisper-cli binary |
| OpenAI Whisper API | `openai` | Requires API key |
| Deepgram | `deepgram` | Requires API key |
| Custom REST API | `rest-api` | Any endpoint accepting multipart audio |

### Summarization Providers

| Provider | Config key | Notes |
|----------|-----------|-------|
| Claude (Anthropic) | `claude` | Default. Requires API key |
| OpenAI | `openai` | Requires API key |
| llama.cpp (local) | `llama-local` | Requires llama-cli binary + GGUF model |
| Custom REST API | `rest-api` | Any endpoint accepting JSON |

### Workflows

Workflows define multi-step summarization pipelines. Each step sends a prompt to the summarization provider. Available template variables:
- `{{.Transcript}}` - the full transcript text
- `{{.PreviousOutput}}` - output from the previous step

## Usage

### Start the daemon
```bash
wavesd
# Or: make run-daemon
```

### CLI
```bash
waves status                              # daemon status
waves record --title "Weekly standup"     # start recording
waves stop                                # stop recording
waves list                                # list sessions
waves show <id>                           # show transcript
waves show <id> --summarize               # show + generate summary
waves summarize <id>                      # summarize with default workflow
waves summarize <id> -w action-items      # use specific workflow
waves models list                         # list downloaded models
waves models pull ggerganov/whisper.cpp   # download model
waves models set ggml-base.en             # set active model
waves config                              # show current config
```

### Electron App
```bash
make electron-install  # install npm deps
make electron-dev      # dev mode with hot reload
make electron-build    # package as .dmg
```

## Data Storage

All data lives in `~/Library/Application Support/Waves/`:
```
Waves/
├── waves.db               # SQLite: sessions, segments, summaries
├── models/                # Downloaded model files
├── recordings/            # Raw audio
└── daemon.sock            # Unix socket (ephemeral)
```

## Permissions Required

On first run, macOS will prompt for:
- **Microphone** - for audio capture from BlackHole
- **Accessibility** - for meeting window title detection (optional)
