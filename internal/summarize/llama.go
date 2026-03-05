package summarize

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// Llama uses llama.cpp CLI for local LLM summarization.
type Llama struct {
	binaryPath string
	modelPath  string
}

func NewLlama(binaryPath, modelPath string) *Llama {
	if binaryPath == "" {
		binaryPath = "llama-cli"
	}
	return &Llama{binaryPath: binaryPath, modelPath: modelPath}
}

func (l *Llama) Name() string { return "llama-local" }

func (l *Llama) Summarize(ctx context.Context, transcript string, prompt string) (string, error) {
	if l.modelPath == "" {
		return "", fmt.Errorf("no llama model configured - set summarization.llama.model in config")
	}

	args := []string{
		"-m", l.modelPath,
		"-p", prompt,
		"-n", "2048",
		"--temp", "0.3",
		"--no-display-prompt",
	}

	cmd := exec.CommandContext(ctx, l.binaryPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("llama-cli failed: %w\nstderr: %s", err, stderr.String())
	}

	return strings.TrimSpace(stdout.String()), nil
}
