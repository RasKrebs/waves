package config

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Transcription TranscriptionConfig            `yaml:"transcription"`
	Summarization SummarizationConfig            `yaml:"summarization"`
	Workflows     map[string]Workflow             `yaml:"workflows"`
}

type TranscriptionConfig struct {
	Provider string        `yaml:"provider"` // whisper-local, openai, deepgram, rest-api, command
	Language string        `yaml:"language"`  // ISO 639-1 language code (e.g. "no", "de", "fr"), empty = auto-detect
	Whisper  WhisperConfig `yaml:"whisper"`
	OpenAI   APIConfig     `yaml:"openai"`
	Deepgram APIConfig     `yaml:"deepgram"`
	RestAPI  RestAPIConfig `yaml:"rest_api"`
	Command  CommandConfig `yaml:"command"`
}

type SummarizationConfig struct {
	Provider string        `yaml:"provider"` // claude, openai, llama-local, rest-api
	Claude   ClaudeConfig  `yaml:"claude"`
	OpenAI   APIConfig     `yaml:"openai"`
	Llama    LlamaConfig   `yaml:"llama"`
	RestAPI  RestAPIConfig `yaml:"rest_api"`
}

type WhisperConfig struct {
	Model  string `yaml:"model"`  // model filename in models dir
	Binary string `yaml:"binary"` // path to whisper-cli, default: auto-detect
}

type ClaudeConfig struct {
	APIKey string `yaml:"api_key"`
	Model  string `yaml:"model"` // default: claude-sonnet-4-20250514
}

type APIConfig struct {
	APIKey string `yaml:"api_key"`
	Model  string `yaml:"model"`
}

type LlamaConfig struct {
	Binary string `yaml:"binary"` // path to llama-cli
	Model  string `yaml:"model"`  // path to .gguf model file
}

type RestAPIConfig struct {
	URL     string            `yaml:"url"`
	Headers map[string]string `yaml:"headers"`
}

// CommandConfig lets you use any transcription binary.
// Template variables in args: {{.Input}} (wav path), {{.Language}}, {{.Model}}
type CommandConfig struct {
	Binary       string   `yaml:"binary"`        // path to the binary
	Args         []string `yaml:"args"`           // arguments with template variables
	Model        string   `yaml:"model"`          // optional model name passed as {{.Model}}
	OutputFormat string   `yaml:"output_format"`  // json (default), srt, vtt, jsonl
}

type Workflow struct {
	Steps []WorkflowStep `yaml:"steps"`
}

type WorkflowStep struct {
	Name   string `yaml:"name"`
	Prompt string `yaml:"prompt"`
}

func DefaultConfig() *Config {
	return &Config{
		Transcription: TranscriptionConfig{
			Provider: "whisper-local",
			Whisper: WhisperConfig{
				Binary: "whisper-cli",
			},
		},
		Summarization: SummarizationConfig{
			Provider: "claude",
			Claude: ClaudeConfig{
				Model: "claude-sonnet-4-20250514",
			},
		},
		Workflows: map[string]Workflow{
			"default": {
				Steps: []WorkflowStep{
					{
						Name: "summarize",
						Prompt: `Summarize the following meeting transcript concisely.
Focus on key decisions, action items, and important discussion points.

Transcript:
{{.Transcript}}`,
					},
				},
			},
			"action-items": {
				Steps: []WorkflowStep{
					{
						Name: "summarize",
						Prompt: `Summarize the following meeting transcript briefly:

{{.Transcript}}`,
					},
					{
						Name: "extract",
						Prompt: `Extract all action items from this meeting summary as a bullet list.
Each item should include WHO is responsible and WHAT they need to do.

Summary:
{{.PreviousOutput}}`,
					},
				},
			},
		},
	}
}

func Load(path string) (*Config, error) {
	cfg := DefaultConfig()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, err
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func DefaultPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "waves", "config.yaml")
}

func Save(path string, cfg *Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
