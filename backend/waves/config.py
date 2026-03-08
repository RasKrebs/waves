"""YAML config loader — reads ~/.config/waves/config.yaml (same as Go daemon)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass
class WhisperConfig:
    model: str = ""
    binary: str = "whisper-cli"


@dataclass
class APIConfig:
    api_key: str = ""
    model: str = ""


@dataclass
class CommandConfig:
    binary: str = ""
    args: list[str] = field(default_factory=list)
    model: str = ""
    output_format: str = "json"


@dataclass
class RestAPIConfig:
    url: str = ""
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class TranscriptionConfig:
    provider: str = "whisper-local"
    language: str = ""
    whisper: WhisperConfig = field(default_factory=WhisperConfig)
    openai: APIConfig = field(default_factory=APIConfig)
    deepgram: APIConfig = field(default_factory=APIConfig)
    rest_api: RestAPIConfig = field(default_factory=RestAPIConfig)
    command: CommandConfig = field(default_factory=CommandConfig)


@dataclass
class ClaudeConfig:
    api_key: str = ""
    model: str = "claude-sonnet-4-20250514"


@dataclass
class OllamaConfig:
    model: str = "llama3.2"
    url: str = "http://localhost:11434"


@dataclass
class SummarizationConfig:
    provider: str = "anthropic"
    claude: ClaudeConfig = field(default_factory=ClaudeConfig)
    openai: APIConfig = field(default_factory=APIConfig)
    ollama: OllamaConfig = field(default_factory=OllamaConfig)
    llama: APIConfig = field(default_factory=APIConfig)
    rest_api: RestAPIConfig = field(default_factory=RestAPIConfig)


@dataclass
class WorkflowStep:
    name: str = ""
    prompt: str = ""


@dataclass
class Workflow:
    steps: list[WorkflowStep] = field(default_factory=list)


DEFAULT_WORKFLOWS: dict[str, Workflow] = {
    "default": Workflow(steps=[
        WorkflowStep(
            name="summarize",
            prompt=(
                "Summarize the following meeting transcript concisely.\n"
                "Focus on key decisions, action items, and important discussion points.\n\n"
                "Transcript:\n{{.Transcript}}"
            ),
        ),
    ]),
    "action-items": Workflow(steps=[
        WorkflowStep(
            name="summarize",
            prompt="Summarize the following meeting transcript briefly:\n\n{{.Transcript}}",
        ),
        WorkflowStep(
            name="extract",
            prompt=(
                "Extract all action items from this meeting summary as a bullet list.\n"
                "Each item should include WHO is responsible and WHAT they need to do.\n\n"
                "Summary:\n{{.PreviousOutput}}"
            ),
        ),
    ]),
}


@dataclass
class Config:
    transcription: TranscriptionConfig = field(default_factory=TranscriptionConfig)
    summarization: SummarizationConfig = field(default_factory=SummarizationConfig)
    workflows: dict[str, Workflow] = field(default_factory=lambda: dict(DEFAULT_WORKFLOWS))


def default_path() -> Path:
    return Path.home() / ".config" / "waves" / "config.yaml"


def _merge_dataclass(dc: object, raw: dict) -> None:
    """Recursively merge a dict into a dataclass, only setting known fields."""
    from dataclasses import fields as dc_fields
    known = {f.name: f for f in dc_fields(dc)}
    for key, val in raw.items():
        # Config uses underscores, YAML may use hyphens
        attr = key.replace("-", "_")
        if attr not in known:
            continue
        f = known[attr]
        current = getattr(dc, attr)
        if isinstance(current, (WhisperConfig, APIConfig, CommandConfig, RestAPIConfig,
                                ClaudeConfig, OllamaConfig, TranscriptionConfig,
                                SummarizationConfig)):
            if isinstance(val, dict):
                _merge_dataclass(current, val)
        else:
            setattr(dc, attr, val)


def _dataclass_to_dict(dc: object) -> dict:
    """Convert a dataclass to a plain dict (recursive), skipping default/empty values."""
    from dataclasses import fields as dc_fields, is_dataclass
    result = {}
    for f in dc_fields(dc):
        val = getattr(dc, f.name)
        if is_dataclass(val):
            nested = _dataclass_to_dict(val)
            if nested:  # only include if non-empty
                result[f.name] = nested
        elif isinstance(val, dict):
            if val:
                result[f.name] = val
        elif isinstance(val, list):
            if val:
                result[f.name] = val
        elif val not in (None, "", 0, False):
            result[f.name] = val
    return result


def _deep_merge(base: dict, overlay: dict) -> dict:
    """Recursively merge overlay into base (mutates base)."""
    for key, val in overlay.items():
        if isinstance(val, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], val)
        else:
            base[key] = val
    return base


def save_partial(changes: dict, path: Path | None = None) -> None:
    """Merge partial changes into the YAML config file."""
    path = path or default_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    existing: dict = {}
    if path.exists():
        with open(path) as f:
            existing = yaml.safe_load(f) or {}

    _deep_merge(existing, changes)

    with open(path, "w") as f:
        yaml.dump(existing, f, default_flow_style=False, sort_keys=False)


def update(cfg: Config, changes: dict) -> None:
    """Apply a partial update dict to a Config and persist to YAML.

    Expected shape matches the YAML structure:
    {
        "transcription": {"provider": "huggingface|model", "language": "da"},
        "summarization": {"provider": "claude", "claude": {"api_key": "sk-..."}},
    }
    """
    if "transcription" in changes and isinstance(changes["transcription"], dict):
        _merge_dataclass(cfg.transcription, changes["transcription"])
    if "summarization" in changes and isinstance(changes["summarization"], dict):
        _merge_dataclass(cfg.summarization, changes["summarization"])
    save_partial(changes)


def load(path: Path | None = None) -> Config:
    path = path or default_path()
    cfg = Config()

    if not path.exists():
        return cfg

    with open(path) as f:
        raw = yaml.safe_load(f) or {}

    if "transcription" in raw and isinstance(raw["transcription"], dict):
        _merge_dataclass(cfg.transcription, raw["transcription"])

    if "summarization" in raw and isinstance(raw["summarization"], dict):
        _merge_dataclass(cfg.summarization, raw["summarization"])

    if "workflows" in raw and isinstance(raw["workflows"], dict):
        for name, wf_raw in raw["workflows"].items():
            steps = []
            for s in wf_raw.get("steps", []):
                steps.append(WorkflowStep(name=s.get("name", ""), prompt=s.get("prompt", "")))
            cfg.workflows[name] = Workflow(steps=steps)

    return cfg
