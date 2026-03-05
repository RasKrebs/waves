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

// RestAPI sends audio to a user-defined REST endpoint.
// Expects the endpoint to return JSON with a "segments" array.
type RestAPI struct {
	url     string
	headers map[string]string
}

func NewRestAPI(url string, headers map[string]string) *RestAPI {
	return &RestAPI{url: url, headers: headers}
}

func (r *RestAPI) Name() string { return "rest-api" }

func (r *RestAPI) TranscribeFile(ctx context.Context, wavPath string, progress func(float64)) ([]Segment, error) {
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
	w.Close()

	req, err := http.NewRequestWithContext(ctx, "POST", r.url, &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}

	if progress != nil {
		progress(0.1)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("REST API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("REST API returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Segments []struct {
			Start float64 `json:"start"`
			End   float64 `json:"end"`
			Text  string  `json:"text"`
		} `json:"segments"`
	}
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
