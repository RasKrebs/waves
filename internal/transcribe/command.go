package transcribe

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// Command runs any user-configured binary for transcription.
// Supports template variables in args: {{.Input}}, {{.Language}}, {{.Model}}
// Supports output formats: json, srt, vtt, jsonl
type Command struct {
	binary       string
	args         []string
	model        string
	language     string
	outputFormat string // json, srt, vtt, jsonl
}

func NewCommand(binary string, args []string, model, language, outputFormat string) *Command {
	if outputFormat == "" {
		outputFormat = "json"
	}
	return &Command{
		binary:       binary,
		args:         args,
		model:        model,
		language:     language,
		outputFormat: outputFormat,
	}
}

func (c *Command) Name() string { return "command" }

func (c *Command) TranscribeFile(ctx context.Context, wavPath string, progress func(float64)) ([]Segment, error) {
	if c.binary == "" {
		return nil, fmt.Errorf("no command binary configured - set transcription.command.binary in config")
	}

	args := c.expandArgs(wavPath)

	cmd := exec.CommandContext(ctx, c.binary, args...)
	cmd.Stderr = os.Stderr

	if progress != nil {
		progress(0.1)
	}

	stdout, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("command %q failed: %w", c.binary, err)
	}

	if progress != nil {
		progress(0.9)
	}

	segs, err := c.parseOutput(string(stdout), wavPath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse output from %q (format=%s): %w", c.binary, c.outputFormat, err)
	}

	if progress != nil {
		progress(1.0)
	}
	return segs, nil
}

// StreamTranscribe implements StreamProvider for the command backend.
func (c *Command) StreamTranscribe(ctx context.Context, src io.Reader, segmentSec int, out chan<- Segment) error {
	tmpDir, err := os.MkdirTemp("", "waves-cmd-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	chunkIdx := 0
	buf := make([]byte, 16000*2*segmentSec)

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		n, err := io.ReadFull(src, buf)
		if err != nil && err != io.ErrUnexpectedEOF {
			return nil
		}
		if n == 0 {
			time.Sleep(100 * time.Millisecond)
			continue
		}

		wavPath := fmt.Sprintf("%s/chunk_%04d.wav", tmpDir, chunkIdx)
		chunkIdx++
		offset := time.Duration(chunkIdx-1) * time.Duration(segmentSec) * time.Second

		if err := WritePCM16ToWAV(wavPath, buf[:n], 16000, 1); err != nil {
			continue
		}

		txCtx, txCancel := context.WithTimeout(context.Background(), 2*time.Minute)
		segs, err := c.TranscribeFile(txCtx, wavPath, nil)
		txCancel()
		if err != nil {
			continue
		}
		for _, seg := range segs {
			seg.Start += offset
			seg.End += offset
			select {
			case out <- seg:
			case <-ctx.Done():
				return nil
			}
		}
	}
}

func (c *Command) expandArgs(wavPath string) []string {
	expanded := make([]string, len(c.args))
	for i, arg := range c.args {
		a := arg
		a = strings.ReplaceAll(a, "{{.Input}}", wavPath)
		a = strings.ReplaceAll(a, "{{.Language}}", c.language)
		a = strings.ReplaceAll(a, "{{.Model}}", c.model)
		expanded[i] = a
	}
	return expanded
}

func (c *Command) parseOutput(stdout, wavPath string) ([]Segment, error) {
	stdout = strings.TrimSpace(stdout)

	switch c.outputFormat {
	case "json":
		return c.parseJSON(stdout, wavPath)
	case "jsonl":
		return c.parseJSONL(stdout)
	case "srt":
		return parseSRT(stdout)
	case "vtt":
		return parseVTT(stdout)
	default:
		return c.parseJSON(stdout, wavPath)
	}
}

// parseJSON tries several common JSON shapes:
// 1. {"segments": [{"start": ..., "end": ..., "text": ...}]}
// 2. {"transcription": [{"timestamps": {"from": ..., "to": ...}, "text": ...}]}  (whisper.cpp)
// 3. [{"start": ..., "end": ..., "text": ...}]  (bare array)
func (c *Command) parseJSON(stdout, wavPath string) ([]Segment, error) {
	// If stdout is empty, try reading a sidecar .json file (whisper.cpp convention)
	if stdout == "" {
		jsonPath := wavPath + ".json"
		data, err := os.ReadFile(jsonPath)
		if err != nil {
			return nil, fmt.Errorf("no stdout and no sidecar json at %s", jsonPath)
		}
		stdout = string(data)
	}

	// Try shape 1: {"segments": [...]}
	var shape1 struct {
		Segments []struct {
			Start float64 `json:"start"`
			End   float64 `json:"end"`
			Text  string  `json:"text"`
		} `json:"segments"`
	}
	if err := json.Unmarshal([]byte(stdout), &shape1); err == nil && len(shape1.Segments) > 0 {
		segs := make([]Segment, 0, len(shape1.Segments))
		for _, s := range shape1.Segments {
			segs = append(segs, Segment{
				Start: time.Duration(s.Start * float64(time.Second)),
				End:   time.Duration(s.End * float64(time.Second)),
				Text:  strings.TrimSpace(s.Text),
			})
		}
		return segs, nil
	}

	// Try shape 2: whisper.cpp {"transcription": [...]}
	var shape2 whisperOutput
	if err := json.Unmarshal([]byte(stdout), &shape2); err == nil && len(shape2.Transcription) > 0 {
		return convertSegments(shape2.Transcription), nil
	}

	// Try shape 3: bare array [{"start": ..., "end": ..., "text": ...}]
	var shape3 []struct {
		Start float64 `json:"start"`
		End   float64 `json:"end"`
		Text  string  `json:"text"`
	}
	if err := json.Unmarshal([]byte(stdout), &shape3); err == nil && len(shape3) > 0 {
		segs := make([]Segment, 0, len(shape3))
		for _, s := range shape3 {
			segs = append(segs, Segment{
				Start: time.Duration(s.Start * float64(time.Second)),
				End:   time.Duration(s.End * float64(time.Second)),
				Text:  strings.TrimSpace(s.Text),
			})
		}
		return segs, nil
	}

	// Try shape 4: faster-whisper style {"text": "...", "segments": [...]} with nested word timestamps
	// or just a flat text response
	var shape4 struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(stdout), &shape4); err == nil && shape4.Text != "" {
		return []Segment{{Text: strings.TrimSpace(shape4.Text)}}, nil
	}

	return nil, fmt.Errorf("could not parse JSON output (tried segments, transcription, array, and text shapes)")
}

func (c *Command) parseJSONL(stdout string) ([]Segment, error) {
	var segs []Segment
	scanner := bufio.NewScanner(strings.NewReader(stdout))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var s struct {
			Start float64 `json:"start"`
			End   float64 `json:"end"`
			Text  string  `json:"text"`
		}
		if err := json.Unmarshal([]byte(line), &s); err != nil {
			continue
		}
		segs = append(segs, Segment{
			Start: time.Duration(s.Start * float64(time.Second)),
			End:   time.Duration(s.End * float64(time.Second)),
			Text:  strings.TrimSpace(s.Text),
		})
	}
	if len(segs) == 0 {
		return nil, fmt.Errorf("no segments parsed from JSONL output")
	}
	return segs, nil
}

// parseSRT parses SubRip subtitle format.
//
//	1
//	00:00:00,000 --> 00:00:02,500
//	Hello, how are you?
func parseSRT(text string) ([]Segment, error) {
	var segs []Segment
	blocks := splitBlocks(text)

	timeRe := regexp.MustCompile(`(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})`)

	for _, block := range blocks {
		lines := strings.Split(strings.TrimSpace(block), "\n")
		if len(lines) < 2 {
			continue
		}
		// Find the timestamp line
		for i, line := range lines {
			m := timeRe.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			start := parseSRTTime(m[1])
			end := parseSRTTime(m[2])
			// Text is everything after the timestamp line
			textLines := lines[i+1:]
			txt := strings.TrimSpace(strings.Join(textLines, " "))
			if txt != "" {
				segs = append(segs, Segment{Start: start, End: end, Text: txt})
			}
			break
		}
	}

	if len(segs) == 0 {
		return nil, fmt.Errorf("no segments parsed from SRT output")
	}
	return segs, nil
}

// parseVTT parses WebVTT subtitle format.
func parseVTT(text string) ([]Segment, error) {
	// Strip the WEBVTT header
	if idx := strings.Index(text, "\n\n"); idx != -1 {
		header := text[:idx]
		if strings.Contains(header, "WEBVTT") {
			text = text[idx+2:]
		}
	}
	return parseSRT(text) // VTT and SRT share the same timestamp/text format
}

func splitBlocks(text string) []string {
	// Split on double newlines
	var blocks []string
	current := ""
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "" {
			if current != "" {
				blocks = append(blocks, current)
				current = ""
			}
		} else {
			if current != "" {
				current += "\n"
			}
			current += line
		}
	}
	if current != "" {
		blocks = append(blocks, current)
	}
	return blocks
}

// parseSRTTime parses "00:00:02,500" or "00:00:02.500"
func parseSRTTime(s string) time.Duration {
	s = strings.ReplaceAll(s, ",", ".")
	var h, m, sec int
	var ms int
	fmt.Sscanf(s, "%d:%d:%d.%d", &h, &m, &sec, &ms)
	return time.Duration(h)*time.Hour +
		time.Duration(m)*time.Minute +
		time.Duration(sec)*time.Second +
		time.Duration(ms)*time.Millisecond
}
