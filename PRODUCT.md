# Waves

Local-first meeting intelligence for macOS. Captures system audio from any application, transcribes in real-time with user-chosen models, enhances transcripts, and generates structured meeting notes from configurable templates.

## Vision

Waves is a meeting intelligence assistant — not just a transcription tool. The goal is enabling users to **be present in meetings** rather than attentive to note-keeping and tracking. Waves handles the notes so you don't have to.

Most transcription tools lock you into English-centric cloud APIs. Waves gives you full control over the entire pipeline — which models transcribe, which clean up, which summarize — so speakers of any language (Danish, Norwegian, German, etc.) can use fine-tuned models from HuggingFace, Ollama, or any provider they choose.

The goal is a modular, open platform where users can plug in their own models at every stage, share configurations as simple files, and keep everything running locally if they want to.

## Core Pipeline

```
Audio Capture  -->  Transcription  -->  Enhancement  -->  Note Generation
(waves-audio)      (streaming)         (fast LLM)       (quality LLM + template)
```

### 1. Audio Capture

macOS system audio capture via CoreAudio Process Tap API (macOS 14.2+). Captures audio from any application — browsers, Teams, Zoom, Spotify — without virtual audio drivers. Also supports microphone input. Dual capture records both system audio and mic simultaneously.

- Streams raw PCM16 mono 16kHz to the backend
- Per-process capture (tap a specific app's audio) or global system audio
- Dual mode: system audio + mic → stereo WAV (archival) + mono mix (transcription)
- No BlackHole or Soundflower needed
- Swift CLI (`waves-audio`) handles the macOS audio layer

### 2. Real-Time Transcription

Audio chunks stream to a transcription provider as they're captured. Transcribed segments return in near real-time.

- **Providers**: whisper.cpp (local), HuggingFace transformers, OpenAI Whisper API, Deepgram API
- **Multilingual**: User picks the model — Danish Whisper, Scandinavian fine-tunes, etc.
- **Streaming**: 10-second buffered chunks for live results during recording
- **Pluggable**: Any model that accepts audio and returns text segments

### 3. Post-Session Enhancement

After recording stops, a fast LLM (default: Claude Haiku) cleans up the raw transcript:

- Fix obvious transcription errors and repeated words
- Normalize formatting, punctuation, proper nouns
- Consistent name spelling throughout
- Does NOT change meaning — only augments and corrects

### 4. Template-Based Note Generation

A quality LLM (default: Claude Sonnet) maps the enhanced transcript into a structured note template:

- **General Meeting** — attendees, key points, decisions, action items, notes
- **Standup** — team updates (yesterday/today/blockers), discussion points, action items
- **Custom** — users create templates as markdown with `{{.Title}}`, `{{.Date}}`, `{{.Duration}}` variables and HTML comment instructions

Templates define the structure; the LLM fills in every section with content from the transcript. Meeting notes are the **primary output** — the raw transcript is metadata.

## Model Philosophy

Every model in the pipeline is user-configurable:

| Stage | Default | Alternatives |
|-------|---------|-------------|
| Transcription | whisper.cpp / HuggingFace (local) | OpenAI Whisper API, Deepgram, custom |
| Enhancement | Claude Haiku (cloud) | Any LLM provider |
| Note Generation | Claude Sonnet (cloud) | Any LLM provider |

**Local-first**: Transcription can run entirely on-device. Cloud is optional.

**Cloud-optional**: Anthropic Claude, OpenAI, Deepgram, Ollama, or any REST endpoint can be used for any stage. Mix and match.

**HuggingFace native**: Download and use any compatible model directly from HuggingFace.

## Organization

### Sessions

Each recording produces a session containing:
- Raw audio (WAV, stereo if dual capture)
- Timestamped transcript segments
- Enhanced transcript (post-processing)
- Meeting notes (generated from template)
- Metadata (title, duration, date, project, meeting type)

### Projects

Sessions are organized into projects (like Notion workspaces or Obsidian vaults):
- Projects contain related meetings
- Notion-like sidebar with expandable project tree
- Sessions can be assigned to projects after recording
- Unassigned meetings appear in an inbox-style view

### Note Templates

Markdown templates that define how meeting notes are structured:

```markdown
# {{.Title}}

**Date:** {{.Date}}
**Duration:** {{.Duration}}

## Attendees
<!-- List participants mentioned in the transcript -->

## Key Points
<!-- The most important information shared -->

## Action Items
- [ ] <!-- Task — Owner — Deadline if mentioned -->
```

Users create and share templates. Each template defines the structure — the LLM fills it in.

## Architecture

### Components

```
Electron App (TypeScript + React)
    |
    | IPC / window.waves.*
    |
Electron Main Process
    |
    | Unix Socket JSON-RPC (with retry)
    |
Python Backend (asyncio)
    |
    +-- Audio Manager (spawns waves-audio, dual capture)
    +-- Provider Registry (resolves "provider|model" specs)
    +-- Transcription Pipeline (pluggable providers, streaming)
    +-- Enhancement Pipeline (fast LLM transcript cleanup)
    +-- Note Generation Pipeline (quality LLM + templates)
    +-- Storage (SQLite: sessions, segments, projects, notes)
    +-- Model Manager (HuggingFace download, local files)
    |
waves-audio (Swift CLI)
    |
    CoreAudio Process Tap / AVAudioEngine
```

### Why Python?

The original Go daemon works but makes it hard to integrate with the ML ecosystem:
- HuggingFace `transformers`, `datasets`, `huggingface_hub` are Python-native
- Most model fine-tunes, adapters, and tools are Python packages
- Ollama and llama-cpp-python have mature Python bindings
- Community contributions are far more likely in Python

### Provider Interface

Each pipeline stage uses the same pattern:

```python
class TranscriptionProvider(Protocol):
    name: str
    async def transcribe_file(self, path: Path, language: str) -> list[Segment]: ...

class LLMProvider(Protocol):
    name: str
    async def complete(self, prompt: str, system: str = "", max_tokens: int = 4096) -> str: ...
```

Users add new providers by implementing these interfaces — a single Python file that self-registers via the registry.

## Features Summary

### Working Now
- macOS system audio capture (process tap, global tap, mic, dual capture)
- Python backend with full RPC interface (30+ methods)
- Streaming transcription via 4 providers (whisper-local, huggingface, openai, deepgram)
- 3 LLM providers (anthropic/claude, openai, ollama)
- Two-stage note generation: enhancement (Haiku) → template mapping (Sonnet)
- 2 built-in note templates (general-meeting, standup), custom templates via config
- Auto-generate meeting notes after recording stops
- Projects with session assignment
- Electron app with Notion-like sidebar, project tree, recording controls
- Process name mapping (bundle IDs → friendly names)
- HuggingFace model download and management
- Go CLI works with Python backend
- Settings UI for provider/model/API key configuration

### Planned (see PLAN.md)
- Meeting detection & auto-record prompt
- Unassigned meeting inbox & assignment flow
- Meeting type selection UI
- Inline AI editing (select text → "Edit with AI" → approve diff)
- Calendar/mail integration
- Custom template editor UI
- Model management improvements
