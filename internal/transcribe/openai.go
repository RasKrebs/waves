package transcribe

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"time"
)

// OpenAIWhisper uses the OpenAI Whisper API for transcription.
type OpenAIWhisper struct {
	apiKey   string
	model    string
	language string
}

func NewOpenAIWhisper(apiKey, model, language string) *OpenAIWhisper {
	if model == "" {
		model = "whisper-1"
	}
	return &OpenAIWhisper{apiKey: apiKey, model: model, language: language}
}

func (o *OpenAIWhisper) Name() string { return "openai" }

func (o *OpenAIWhisper) TranscribeFile(ctx context.Context, wavPath string, progress func(float64)) ([]Segment, error) {
	f, err := os.Open(wavPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", "audio.wav")
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(fw, f); err != nil {
		return nil, err
	}
	w.WriteField("model", o.model)
	w.WriteField("response_format", "verbose_json")
	w.WriteField("timestamp_granularities[]", "segment")
	if o.language != "" {
		w.WriteField("language", o.language)
	}
	w.Close()

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.openai.com/v1/audio/transcriptions", &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+o.apiKey)
	req.Header.Set("Content-Type", w.FormDataContentType())

	if progress != nil {
		progress(0.1)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("OpenAI API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("OpenAI API returned %d: %s", resp.StatusCode, string(body))
	}

	var result openAIResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if progress != nil {
		progress(1.0)
	}

	segments := make([]Segment, 0, len(result.Segments))
	for _, s := range result.Segments {
		segments = append(segments, Segment{
			Start: time.Duration(s.Start * float64(time.Second)),
			End:   time.Duration(s.End * float64(time.Second)),
			Text:  s.Text,
		})
	}
	return segments, nil
}

type openAIResponse struct {
	Segments []openAISegment `json:"segments"`
}

type openAISegment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}
