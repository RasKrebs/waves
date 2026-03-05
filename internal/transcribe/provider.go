package transcribe

import (
	"context"
	"io"
	"time"
)

// Segment is a transcribed chunk with timestamp.
type Segment struct {
	Start time.Duration
	End   time.Duration
	Text  string
}

// Provider transcribes audio files. All backends implement this.
type Provider interface {
	Name() string
	TranscribeFile(ctx context.Context, wavPath string, progress func(float64)) ([]Segment, error)
}

// StreamProvider extends Provider with real-time streaming capability.
// Only local backends (whisper, etc.) support this.
type StreamProvider interface {
	Provider
	StreamTranscribe(ctx context.Context, src io.Reader, segmentSec int, out chan<- Segment) error
}
