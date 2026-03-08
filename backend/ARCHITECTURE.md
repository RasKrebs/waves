# Waves Python Backend — Architecture

## Overview

The backend replaces the Go daemon (`wavesd`) with a Python service that exposes the same JSON-RPC interface over Unix socket. The Electron app and CLI remain unchanged — they talk to the same socket with the same RPC methods.

**Status**: Core backend is implemented and working. The Go CLI (`waves status`) connects successfully to the Python backend. Electron spawns the Python backend via `uv run python -m waves`.

## Directory Structure

```
backend/
  pyproject.toml               # uv project config, dependencies
  waves/
    __init__.py
    __main__.py                # Entry point: python -m waves [-v]
    server.py                  # JSON-RPC server (Unix socket, asyncio)
    config.py                  # YAML config loader (~/.config/waves/config.yaml)
    store.py                   # Async SQLite storage (sessions, segments)
    audio.py                   # Audio capture (spawn waves-audio, stream PCM, WAV writing)

    providers/
      __init__.py
      base.py                  # Protocol definitions (TranscriptionProvider, LLMProvider, Segment)

      transcription/
        __init__.py
        whisper_local.py       # whisper.cpp CLI (implemented, working)
        whisper_hf.py          # HuggingFace transformers (planned)
        openai.py              # OpenAI Whisper API (planned)
        deepgram.py            # Deepgram API (planned)
        custom.py              # User-defined command or REST endpoint (planned)

      llm/
        __init__.py
        ollama.py              # Ollama REST API (planned)
        llama_cpp.py           # llama.cpp CLI (planned)
        anthropic.py           # Anthropic Claude API (planned)
        openai.py              # OpenAI Chat API (planned)
        custom.py              # User-defined REST endpoint (planned)

    pipeline/
      __init__.py
      transcription.py         # Streaming transcription orchestrator (planned)
      enhancement.py           # Post-session transcript cleanup (planned)
      summarization.py         # Strategy-based summary generation (planned)

    strategies/                # Built-in summary strategies (planned)
      default.md
      standup.md
      onboarding.md
```

## What's Implemented

### RPC Methods

| Method | Status | Notes |
|--------|--------|-------|
| `Waves.Status` | Working | Returns state, uptime, session count, active session |
| `Waves.GetConfig` | Working | Returns provider names and workflow list |
| `Waves.ListSessions` | Working | Reads from shared SQLite database |
| `Waves.GetSession` | Working | Returns session detail with segments |
| `Waves.StartRecording` | Working | Spawns waves-audio, saves WAV, transcribes chunks |
| `Waves.StopRecording` | Working | Stops capture, finalizes WAV, updates session |
| `Waves.ListDevices` | Working | Runs `waves-audio devices` |
| `Waves.ListModels` | Working | Scans model directory for .bin/.gguf files |
| `Waves.SetModel` | Working | Switches active whisper model |
| `Waves.PullModel` | Stub | Returns error (not yet implemented) |
| `Waves.Summarize` | Stub | Returns error (not yet implemented) |
| `Waves.TranscribeFile` | Stub | Returns error (not yet implemented) |

### Transcription Providers

| Provider | Status | Notes |
|----------|--------|-------|
| `whisper-local` | Working | whisper.cpp CLI, 10s chunked streaming, temp WAV files |
| `whisper-hf` | Planned | faster-whisper / HuggingFace transformers |
| `openai` | Planned | OpenAI Whisper API |
| `deepgram` | Planned | Deepgram API |
| `custom` | Planned | User-defined command or REST endpoint |

## Data Models

### Core Types

```python
@dataclass
class Segment:
    """A single transcription segment."""
    start_ms: int              # Milliseconds from recording start
    end_ms: int
    text: str
    speaker: str | None = None # Set by enhancement pass
    confidence: float = 1.0    # 0.0 - 1.0

@dataclass
class Session:
    """A recording session."""
    id: str                    # UUID
    title: str
    started_at: int            # Unix milliseconds
    ended_at: int | None
    audio_path: str
    status: str                # recording | transcribing | enhancing | done | failed
    summary: str
    model_used: str
```

### RPC Types (matching existing Go interface)

The backend accepts and returns the same JSON shapes the Electron app expects:

```python
# Waves.Status -> StatusReply
StatusReply = {
    "State": "idle" | "recording",
    "Uptime": "2h15m",
    "TotalSessions": 42,
    "ActiveSession": "" | "uuid"
}

# Waves.StartRecording(Title, Device, PID) -> StartReply
StartReply = { "SessionID": "uuid" }

# Waves.StopRecording -> StopReply
StopReply = { "SessionID": "uuid", "Duration": "5m30s" }

# Waves.ListSessions(Limit) -> ListReply
ListReply = {
    "Sessions": [
        { "ID": "uuid", "Title": "...", "StartedAt": "...", "Duration": "...", "Status": "done" }
    ]
}

# Waves.GetSession(ID, Summarize) -> SessionReply
SessionReply = {
    "Session": {
        "Title": "...",
        "StartedAt": "...",
        "Duration": "...",
        "Summary": "...",
        "Segments": [
            { "Timestamp": "00:01:30", "Text": "..." }
        ]
    }
}

# Waves.ListModels -> ModelsReply
ModelsReply = {
    "Models": [
        { "Name": "...", "Type": "whisper", "Size": "140MB", "Active": true }
    ]
}

# Waves.Summarize(SessionID, Workflow) -> SummarizeReply
SummarizeReply = { "Summary": "..." }
```

## Pipeline Design

### 1. Streaming Transcription (Implemented)

```
waves-audio stdout (PCM16 mono 16kHz)
      |
      v
AudioCapture.read_chunk(320KB)
      |
      | (10-second chunks, 320KB each)
      v
WhisperLocal.transcribe_pcm(chunk)
      |
      v
Segment(start_ms, end_ms, text)
      |
      +---> Store.add_segment()       # Persist to DB
      +---> (future: push to Electron via SSE/WebSocket)
```

The `AudioCapture` spawns `waves-audio` as a subprocess and reads PCM from stdout, same as the Go `SubprocessCapture`. Audio is simultaneously saved to a WAV file and dispatched in chunks for transcription.

### 2. Post-Session Enhancement (Planned)

Runs after recording stops. Takes the raw segments and improves them:

```
Store.get_segments(session_id)
      |
      v
EnhancementPipeline.enhance(segments, language)
      |
      | Batches segments into context-window-sized groups
      | Sends each batch to the LLM with instructions:
      |   - Fix transcription errors
      |   - Identify speakers if possible
      |   - Normalize formatting
      |   - Do NOT change meaning
      |
      v
Enhanced segments written back to DB
(original segments preserved in a separate column or table)
```

### 3. Strategy-Based Summarization (Planned)

```
Store.full_transcript(session_id)
      |
      v
Strategy file loaded from disk (markdown with frontmatter)
      |
      v
SummarizationPipeline.summarize(transcript, strategy)
      |
      | For each step in strategy:
      |   1. Render prompt template ({{.Transcript}}, {{.PreviousOutput}})
      |   2. Call LLMProvider.complete(prompt)
      |   3. Store output for next step
      |
      v
Final summary stored in session
```

## Provider Interfaces

### TranscriptionProvider

```python
class TranscriptionProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def transcribe_file(
        self,
        path: Path,
        language: str,
        on_progress: Callable[[float], None] | None = None,
    ) -> list[Segment]:
        """Transcribe an audio file. Returns all segments."""
        ...

class StreamingTranscriptionProvider(TranscriptionProvider, Protocol):
    async def transcribe_stream(
        self,
        audio: AsyncIterator[bytes],
        language: str,
        chunk_seconds: int = 10,
    ) -> AsyncIterator[Segment]:
        """Transcribe streaming audio. Yields segments as they're ready."""
        ...
```

### LLMProvider

```python
class LLMProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def complete(
        self,
        prompt: str,
        system: str = "",
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> str:
        """Generate a completion. Returns full text."""
        ...
```

### Adding a Provider

A new provider is a single Python file that implements the protocol:

```python
# backend/waves/providers/transcription/my_model.py
from waves.providers.base import Segment

class MyModelProvider:
    name = "my-model"

    async def transcribe_file(self, path, language, on_progress=None):
        # ... your transcription logic ...
        return [Segment(start_ms=..., end_ms=..., text=...)]

    async def transcribe_pcm(self, pcm_data, language):
        # ... write to temp WAV, transcribe ...
        return [Segment(...)]
```

Then register it in config:
```yaml
transcription:
  provider: my-model
  my-model:
    model_path: /path/to/model
```

## Config

Same location as before: `~/.config/waves/config.yaml`

Extended with new sections:

```yaml
# Transcription
transcription:
  provider: whisper-local   # whisper-local | whisper-hf | openai | deepgram | custom
  language: da              # ISO 639-1 (empty = auto)
  whisper:
    model: ggml-large-v3.bin
    binary: whisper-cli
  openai:
    api_key: sk-...
  deepgram:
    api_key: ...
  command:
    binary: /path/to/binary
    args: ["--input", "{{.Input}}", "--language", "{{.Language}}"]
    output_format: json

# Enhancement (post-session cleanup) — planned
enhancement:
  enabled: true
  provider: ollama
  ollama:
    model: llama3.2
    url: http://localhost:11434

# Summarization — planned
summarization:
  provider: ollama
  default_strategy: default
  ollama:
    model: llama3.2
    url: http://localhost:11434
  anthropic:
    api_key: sk-ant-...
    model: claude-sonnet-4-20250514
```

## Storage

Same SQLite schema as Go daemon (compatible, shares the same database file):

```sql
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    audio_path  TEXT,
    status      TEXT DEFAULT 'recording',
    summary     TEXT DEFAULT '',
    model_used  TEXT DEFAULT ''
);

CREATE TABLE segments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER NOT NULL,
    text        TEXT NOT NULL
);

CREATE INDEX idx_segments_session ON segments(session_id);
```

Future: add `enhanced` TEXT, `speaker` TEXT, `confidence` REAL columns to segments table for enhancement pipeline.

## Dependencies

Managed with `uv`. Run `cd backend && uv sync` to install.

```toml
[project]
name = "waves-backend"
requires-python = ">=3.11"
dependencies = [
    "pyyaml",
    "aiosqlite",
    "httpx",
    "huggingface-hub",
]

[project.optional-dependencies]
local = [
    "faster-whisper",
    "llama-cpp-python",
]
```

## Running

```bash
# Standalone
cd backend && uv run python -m waves -v

# Via Makefile
make backend-run

# Via Electron (automatic)
make dev
```
