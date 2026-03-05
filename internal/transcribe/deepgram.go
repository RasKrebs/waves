package transcribe

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Deepgram uses the Deepgram API for transcription.
type Deepgram struct {
	apiKey   string
	language string
}

func NewDeepgram(apiKey, language string) *Deepgram {
	return &Deepgram{apiKey: apiKey, language: language}
}

func (d *Deepgram) Name() string { return "deepgram" }

func (d *Deepgram) TranscribeFile(ctx context.Context, wavPath string, progress func(float64)) ([]Segment, error) {
	audioData, err := os.ReadFile(wavPath)
	if err != nil {
		return nil, err
	}

	url := "https://api.deepgram.com/v1/listen?punctuate=true&utterances=true"
	if d.language != "" {
		url += "&language=" + d.language
	}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(audioData))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Token "+d.apiKey)
	req.Header.Set("Content-Type", "audio/wav")

	if progress != nil {
		progress(0.1)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Deepgram API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Deepgram API returned %d: %s", resp.StatusCode, string(body))
	}

	var result deepgramResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if progress != nil {
		progress(1.0)
	}

	var segments []Segment
	for _, ch := range result.Results.Channels {
		for _, alt := range ch.Alternatives {
			for _, w := range alt.Words {
				segments = append(segments, Segment{
					Start: time.Duration(w.Start * float64(time.Second)),
					End:   time.Duration(w.End * float64(time.Second)),
					Text:  w.PunctuatedWord,
				})
			}
		}
	}

	// Merge words into sentence-level segments (group by pauses > 1s)
	return mergeWordSegments(segments, time.Second), nil
}

func mergeWordSegments(words []Segment, pauseThreshold time.Duration) []Segment {
	if len(words) == 0 {
		return nil
	}

	var merged []Segment
	current := words[0]

	for i := 1; i < len(words); i++ {
		gap := words[i].Start - current.End
		if gap > pauseThreshold {
			merged = append(merged, current)
			current = words[i]
		} else {
			current.End = words[i].End
			current.Text += " " + words[i].Text
		}
	}
	merged = append(merged, current)
	return merged
}

type deepgramResponse struct {
	Results struct {
		Channels []struct {
			Alternatives []struct {
				Words []deepgramWord `json:"words"`
			} `json:"alternatives"`
		} `json:"channels"`
	} `json:"results"`
}

type deepgramWord struct {
	Word            string  `json:"word"`
	PunctuatedWord  string  `json:"punctuated_word"`
	Start           float64 `json:"start"`
	End             float64 `json:"end"`
}
