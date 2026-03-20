# Waves Python Backend — Architecture

## Overview

The backend replaces the Go daemon (`wavesd`) with a Python service that exposes the same JSON-RPC interface over Unix socket. The Electron app and CLI remain unchanged — they talk to the same socket with the same RPC methods.

## Directory Structure

```
backend/
  pyproject.toml               # uv project config, dependencies
  waves/
    __init__.py
    __main__.py                # Entry point: python -m waves [-v]
    server.py                  # JSON-RPC server (Unix socket, asyncio)
    config.py                  # YAML config loader (~/.config/waves/config.yaml)
    store.py                   # Async SQLite storage (sessions, segments, projects, notes)
    audio.py                   # Audio capture (spawn waves-audio, dual mode, WAV writing)

    providers/
      __init__.py
      base.py                  # Protocol definitions (TranscriptionProvider, LLMProvider, Segment)
      registry.py              # Provider registry — resolves "provider|model" spec strings

      transcription/
        __init__.py
        whisper_local.py       # whisper.cpp CLI (working)
        huggingface.py         # HuggingFace transformers (working)
        openai_whisper.py      # OpenAI Whisper API (working)
        deepgram.py            # Deepgram API (working)

      llm/
        __init__.py
        anthropic.py           # Anthropic Claude API (working)
        openai_chat.py         # OpenAI Chat Completions API (working)
        ollama.py              # Ollama local API (working)

    pipeline/
      __init__.py
      summarize.py             # Multi-step workflow runner (Workflow → LLM → output)
      enhance.py               # Two-stage pipeline: enhance_transcript() + generate_from_template()
```

## RPC Methods

| Method | Description |
|--------|-------------|
| `Waves.Status` | Returns state, uptime, session count, active session |
| `Waves.GetConfig` | Returns provider names and workflow list |
| `Waves.SetConfig` | Update config, hot-swap providers if changed |
| `Waves.ListSessions` | List sessions with optional limit |
| `Waves.GetSession` | Session detail with segments, notes, project info |
| `Waves.StartRecording` | Start capture (accepts PID, Device, IncludeMic, ProjectID) |
| `Waves.StopRecording` | Stop capture, finalize WAV, trigger auto-notes |
| `Waves.ListDevices` | List audio input devices |
| `Waves.ListProcesses` | List processes with active audio output |
| `Waves.ListModels` | List downloaded models (GGUF + transformers) |
| `Waves.SetModel` | Switch active transcription model |
| `Waves.PullModel` | Download model from HuggingFace |
| `Waves.Summarize` | Run multi-step workflow on session transcript |
| `Waves.TranscribeFile` | Transcribe an uploaded audio file |
| `Waves.RetranscribeSession` | Re-transcribe session with current model |
| `Waves.RenameSession` | Rename session (also renames audio file) |
| `Waves.CreateProject` | Create a new project |
| `Waves.ListProjects` | List all projects with session counts |
| `Waves.GetProject` | Get project detail with sessions |
| `Waves.UpdateProject` | Update project name/description |
| `Waves.DeleteProject` | Delete project (unassigns sessions) |
| `Waves.AssignSession` | Assign or unassign a session to/from a project |
| `Waves.GenerateNotes` | Generate notes using template or legacy prompt |
| `Waves.GetNotes` | List notes for a session |
| `Waves.UpdateNote` | Update note content |
| `Waves.DeleteNote` | Delete a note |
| `Waves.ListNoteTemplates` | List available note templates |

## Data Models

### Core Types

```python
@dataclass
class Segment:
    start_ms: int              # Milliseconds from recording start
    end_ms: int
    text: str
    speaker: str | None = None
    confidence: float = 1.0

@dataclass
class Session:
    id: str                    # UUID
    title: str
    started_at: int            # Unix milliseconds
    ended_at: int | None
    audio_path: str
    status: str                # recording | transcribing | done | failed
    summary: str
    model_used: str
    project_id: str | None     # FK to projects table

@dataclass
class Project:
    id: str
    name: str
    created_at: int
    description: str

@dataclass
class Note:
    id: str
    session_id: str
    project_id: str | None
    content: str
    note_type: str             # template key (e.g., "general-meeting", "standup") or legacy type
    created_at: int
    updated_at: int
```

## Pipeline Design

### Post-Recording Pipeline (Auto-Notes)

After `StopRecording`, the backend automatically runs this pipeline in the background:

```
Full transcript from DB
      |
      v
Stage 1: enhance_transcript()
      |  Model: claude-haiku-4-5-20251001 (configurable)
      |  Fixes: ASR errors, spelling, punctuation, name consistency
      |  Preserves: original meaning, structure
      |
      v
Enhanced transcript
      |
      v
Stage 2: generate_from_template()
      |  Model: claude-sonnet-4-20250514 (configurable)
      |  Input: enhanced transcript + markdown template
      |  Output: filled-in structured meeting notes
      |
      v
Note stored in DB, clients notified
```

Models are configurable independently:
- `summarization.enhancement_model` — fast/cheap model for cleanup
- `summarization.summarization_model` — quality model for note generation

### Manual Note Generation

Users can generate notes with any template via `GenerateNotes` RPC:
- Template-based: if `NoteType` matches a template key, runs the full two-stage pipeline
- Legacy: "action-items" and "summary" use simple single-prompt generation

### Multi-Step Workflows

The `Summarize` RPC runs configurable multi-step workflows:

```
Workflow definition (from config)
      |
      | For each step:
      |   1. Render prompt template ({{.Transcript}}, {{.PreviousOutput}})
      |   2. Call LLMProvider.complete(prompt)
      |   3. Store output for next step
      |
      v
Final output stored as session summary
```

### Note Templates

Markdown templates with variable substitution and HTML comment instructions:

```markdown
# {{.Title}}

**Date:** {{.Date}}
**Duration:** {{.Duration}}

## Attendees
<!-- List participants mentioned in the transcript -->

## Key Points
<!-- The most important information shared -->

## Action Items
- [ ] <!-- Task — Owner — Deadline -->
```

Built-in templates: `general-meeting`, `standup`. Users add custom templates in `config.yaml` under `note_templates:`.

## Provider Registry

Providers self-register via factory functions in `registry.py`:

```python
# Spec format: "provider|model" or just "provider"
resolve_llm("anthropic|claude-haiku-4-5-20251001", config)  # → AnthropicLLM instance
resolve_transcription("huggingface|syvai/hviske-v3", config)  # → HuggingFaceProvider instance
```

### Adding a Provider

Create a single Python file that implements the protocol and self-registers:

```python
# backend/waves/providers/llm/my_provider.py
from waves.providers.registry import register_llm

class MyLLM:
    def __init__(self, api_key: str, model: str):
        self._api_key = api_key
        self._model = model

    @property
    def name(self) -> str:
        return f"my-provider|{self._model}"

    async def complete(self, prompt: str, system: str = "", max_tokens: int = 4096, temperature: float = 0.3) -> str:
        # ... your logic ...
        return result

def _factory(model, config):
    return MyLLM(api_key=config.summarization.my_provider.api_key, model=model or "default")

register_llm("my-provider", _factory)
```

Then import it in `registry.py`'s `load_builtin_providers()`.

## Storage Schema

SQLite database at `~/Library/Application Support/Waves/waves.db`:

```sql
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    audio_path  TEXT,
    status      TEXT DEFAULT 'recording',
    summary     TEXT DEFAULT '',
    model_used  TEXT DEFAULT '',
    project_id  TEXT REFERENCES projects(id)
);

CREATE TABLE segments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER NOT NULL,
    text        TEXT NOT NULL
);

CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    description TEXT DEFAULT ''
);

CREATE TABLE notes (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    project_id  TEXT REFERENCES projects(id),
    content     TEXT NOT NULL DEFAULT '',
    note_type   TEXT NOT NULL DEFAULT 'meeting-notes',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_segments_session ON segments(session_id);
CREATE INDEX idx_notes_session ON notes(session_id);
CREATE INDEX idx_notes_project ON notes(project_id);
```

Migrations run on startup (e.g., adding `project_id` column to existing sessions table).

## Config

Location: `~/.config/waves/config.yaml`

```yaml
transcription:
  provider: huggingface|syvai/hviske-v3-conversation
  language: da
  whisper:
    binary: whisper-cli
    model: ggml-base.en
  openai:
    api_key: sk-...
  deepgram:
    api_key: ...

summarization:
  provider: anthropic
  enhancement_model: claude-haiku-4-5-20251001
  summarization_model: claude-sonnet-4-20250514
  claude:
    api_key: sk-ant-...
    model: claude-sonnet-4-20250514
  openai:
    api_key: sk-...
    model: gpt-4o
  ollama:
    model: llama3.2
    url: http://localhost:11434

note_templates:
  general-meeting:
    name: General Meeting
    description: Standard meeting notes with key points, decisions, action items
    template: |
      # {{.Title}}
      ...
  standup:
    name: Standup
    description: Daily standup format
    template: |
      # Standup — {{.Date}}
      ...

workflows:
  default:
    steps:
      - name: summarize
        prompt: "Summarize: {{.Transcript}}"
  action-items:
    steps:
      - name: summarize
        prompt: "Summarize briefly: {{.Transcript}}"
      - name: extract
        prompt: "Extract action items from: {{.PreviousOutput}}"
```

Config is hot-swappable via `SetConfig` RPC — providers are re-resolved when changed.

## Dependencies

Managed with `uv`. Run `cd backend && uv sync` to install.

Core: `pyyaml`, `aiosqlite`, `httpx`, `huggingface-hub`, `transformers`, `torch`, `accelerate`

Optional: `faster-whisper`, `llama-cpp-python` (for local models)

## Running

```bash
cd backend && uv run python -m waves -v    # standalone
make backend-run                            # via Makefile
make dev                                    # via Electron (automatic)
```
