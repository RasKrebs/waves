# Waves

Local-first meeting transcription and summarization for macOS. Captures system audio from any application, transcribes in real-time with user-chosen models, and summarizes with customizable workflows.

## Why Waves?

Most transcription tools lock you into English-centric cloud APIs. Waves gives you full control over the entire pipeline — which models transcribe, which clean up, which summarize — so speakers of any language (Danish, Norwegian, German, etc.) can use fine-tuned models from HuggingFace, Ollama, or any provider they choose.

The goal is a modular, open platform where users can plug in their own models at every stage, share configurations as simple files, and keep everything running locally if they want to.

## Core Pipeline

```
Audio Capture  -->  Transcription  -->  Enhancement  -->  Summarization
(waves-audio)      (streaming)         (post-session)    (strategy-based)
```

### 1. Audio Capture

macOS system audio capture via CoreAudio Process Tap API (macOS 14.2+). Captures audio from any application — browsers, Teams, Zoom, Spotify — without virtual audio drivers. Also supports microphone input.

- Streams raw PCM16 mono 16kHz to the backend
- Per-process capture (tap a specific app's audio)
- No BlackHole or Soundflower needed
- Swift CLI (`waves-audio`) handles the macOS audio layer

### 2. Real-Time Transcription

Audio chunks stream to a transcription provider as they're captured. Transcribed segments return in near real-time to the UI.

- **Default**: Whisper models (via whisper.cpp, HuggingFace, or API)
- **Pluggable**: Any model that accepts audio and returns text segments
- **Multilingual**: User picks the model — Danish Whisper, Scandinavian fine-tunes, etc.
- **Streaming**: 10-second buffered chunks for live results during recording

### 3. Post-Session Enhancement

After recording stops, a second pass cleans up the raw transcript:

- Fix obvious transcription errors and repeated words
- Attempt speaker diarization (distinguish who said what)
- Normalize formatting, punctuation, proper nouns
- Does NOT change meaning — only augments and corrects

This runs a user-chosen LLM (local or cloud). Users who speak less-common languages can use a fine-tuned model that understands their language's patterns.

### 4. Strategy-Based Summarization

A third LLM generates a structured summary based on a user-defined strategy. Strategies are simple markdown template files:

- **Customer Onboarding** — key decisions, next steps, customer requirements
- **Standup** — what was done, blockers, action items per person
- **Interview** — candidate assessment, key answers, red/green flags
- **General** — concise summary with bullet points

Users create and share strategies as files. Each strategy defines prompts for the summarization LLM — what to extract, how to format it.

## Model Philosophy

Every model in the pipeline is user-configurable:

| Stage | Default | Alternatives |
|-------|---------|-------------|
| Transcription | whisper.cpp (local) | HuggingFace models, OpenAI Whisper API, Deepgram, custom binary |
| Enhancement | ollama (local) | Any LLM via llama.cpp, Anthropic, OpenAI, REST endpoint |
| Summarization | ollama (local) | Same as above |

**Local-first**: All stages can run entirely on-device via whisper.cpp, llama.cpp, or Ollama. No data leaves your machine unless you choose a cloud provider.

**Cloud-optional**: Anthropic Claude, OpenAI, Deepgram, or any REST endpoint can be used for any stage. Mix and match — local transcription with cloud summarization, or vice versa.

**HuggingFace native**: Download and use any compatible model directly from HuggingFace. The UI supports browsing, pulling, and switching models.

## Organization

### Sessions

Each recording produces a session containing:
- Raw audio (WAV)
- Timestamped transcript segments
- Enhanced transcript (post-processing)
- Summary (per chosen strategy)
- Metadata (title, duration, date, model used)

### Projects & Folders

Sessions can be organized into a hierarchical folder structure:
- Projects contain folders and sessions
- Folders can be nested (like Obsidian's vault)
- Drag-and-drop organization
- Default "Inbox" for unsorted sessions

### Strategies (Summary Templates)

Markdown files that define how a session gets summarized:

```markdown
---
name: Customer Onboarding
description: Extract key decisions and next steps from customer calls
model: claude-sonnet  # optional model override
---

## Step 1: Extract Key Points
Analyze this meeting transcript and extract:
- Customer requirements discussed
- Decisions made
- Open questions

{{.Transcript}}

## Step 2: Format Summary
From the analysis above, create a structured summary:

**Customer**: [name]
**Date**: [date]
**Key Decisions**: [bullets]
**Action Items**: [bullets with owner]
**Open Questions**: [bullets]

{{.PreviousOutput}}
```

## Architecture

### Components

```
Electron App (TypeScript + React)
    |
    | IPC / window.waves.*
    |
Electron Main Process
    |
    | Unix Socket JSON-RPC
    |
Python Backend (asyncio)
    |
    +-- Audio Manager (spawns waves-audio, receives PCM stream)
    +-- Transcription Pipeline (pluggable providers)
    +-- Enhancement Pipeline (post-session LLM pass)
    +-- Summarization Pipeline (strategy-based LLM pass)
    +-- Storage (SQLite)
    +-- Model Manager (HuggingFace, local files)
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
- Faster iteration on model integrations and new providers

### Data Exchange

The backend exposes the same JSON-RPC interface the Go daemon did — the Electron app doesn't need to change. Internally, each pipeline stage communicates through typed data models:

**Audio -> Transcription**:
```
PCM16 mono 16kHz byte stream  -->  TranscriptionSegment[]
```

**Transcription -> Enhancement**:
```
TranscriptionSegment[]  -->  EnhancedSegment[]
(adds: speaker, corrected_text, confidence)
```

**Enhancement -> Summarization**:
```
EnhancedSegment[] + Strategy  -->  Summary
```

### Provider Interface

Each pipeline stage uses the same pattern:

```python
class TranscriptionProvider(Protocol):
    name: str
    async def transcribe_stream(self, audio: AsyncIterator[bytes], language: str) -> AsyncIterator[Segment]: ...
    async def transcribe_file(self, path: Path, language: str) -> list[Segment]: ...

class LLMProvider(Protocol):
    name: str
    async def complete(self, prompt: str, system: str = "") -> str: ...
    async def stream(self, prompt: str, system: str = "") -> AsyncIterator[str]: ...
```

Users add new providers by implementing these interfaces — a single Python file.

## Features Summary

### Working Now
- macOS system audio capture (Process Tap, mic)
- Python backend with full RPC interface (Status, GetConfig, ListSessions, GetSession, StartRecording, StopRecording, ListDevices, ListModels, SetModel)
- Streaming transcription via whisper.cpp (10s chunked)
- Electron app with sidebar, recording UI, history
- Daemon communication layer (IPC + Unix socket)
- Go CLI works with Python backend
- Same SQLite database shared between Go and Python backends

### Next Up
- [ ] Additional transcription providers (openai, deepgram, whisper-hf, custom command)
- [ ] Post-session enhancement pipeline (LLM cleanup pass)
- [ ] Strategy-based summarization pipeline
- [ ] File upload transcription (TranscribeFile RPC)
- [ ] HuggingFace model browser and downloader (PullModel RPC)
- [ ] Electron UI completion (history detail, models page, upload page)

### Future
- [ ] Project/folder organization
- [ ] Strategy editor in the UI
- [ ] Speaker diarization
- [ ] Meeting detection (auto-record)
- [ ] Search across all transcripts
- [ ] Export (markdown, PDF, clipboard)
- [ ] Tray icon with recording controls
