package summarize

import "context"

// Provider generates summaries from transcript text.
type Provider interface {
	Name() string
	Summarize(ctx context.Context, transcript string, prompt string) (string, error)
}
