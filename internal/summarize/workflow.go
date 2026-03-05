package summarize

import (
	"context"
	"fmt"
	"strings"

	"waves/internal/config"
)

// WorkflowRunner executes multi-step summarization workflows.
type WorkflowRunner struct {
	provider Provider
}

func NewWorkflowRunner(provider Provider) *WorkflowRunner {
	return &WorkflowRunner{provider: provider}
}

// Run executes a workflow against the given transcript.
// Template variables available in prompts: {{.Transcript}}, {{.PreviousOutput}}
func (w *WorkflowRunner) Run(ctx context.Context, transcript string, workflow config.Workflow) (string, error) {
	if len(workflow.Steps) == 0 {
		return "", fmt.Errorf("workflow has no steps")
	}

	var previousOutput string

	for i, step := range workflow.Steps {
		prompt := step.Prompt
		prompt = strings.ReplaceAll(prompt, "{{.Transcript}}", transcript)
		prompt = strings.ReplaceAll(prompt, "{{.PreviousOutput}}", previousOutput)

		result, err := w.provider.Summarize(ctx, transcript, prompt)
		if err != nil {
			return "", fmt.Errorf("step %d (%s) failed: %w", i+1, step.Name, err)
		}
		previousOutput = result
	}

	return previousOutput, nil
}
