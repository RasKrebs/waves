package summarize

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// RestAPI sends transcript to a user-defined REST endpoint for summarization.
// Expects a JSON response with a "text" field.
type RestAPI struct {
	url     string
	headers map[string]string
}

func NewRestAPI(url string, headers map[string]string) *RestAPI {
	return &RestAPI{url: url, headers: headers}
}

func (r *RestAPI) Name() string { return "rest-api" }

func (r *RestAPI) Summarize(ctx context.Context, transcript string, prompt string) (string, error) {
	body := map[string]string{
		"transcript": transcript,
		"prompt":     prompt,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", r.url, bytes.NewReader(jsonBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("REST API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("REST API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.Text, nil
}
