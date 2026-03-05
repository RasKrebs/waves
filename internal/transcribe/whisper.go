package transcribe

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// WhisperLocal uses whisper.cpp CLI for local transcription.
type WhisperLocal struct {
	modelDir    string
	activeModel string
	binaryPath  string
	language    string // ISO 639-1, empty = auto-detect
	mu          sync.Mutex
}

func NewWhisperLocal(modelDir, binaryPath, language string) (*WhisperLocal, error) {
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		return nil, err
	}

	bin := binaryPath
	if bin == "" {
		var err error
		bin, err = findWhisperBin()
		if err != nil {
			bin = "" // will fail at transcription time
		}
	}

	w := &WhisperLocal{modelDir: modelDir, binaryPath: bin, language: language}

	// Auto-select first available model
	models, _ := w.ListModels()
	if len(models) > 0 {
		w.activeModel = models[0].Path
	}
	return w, nil
}

func (w *WhisperLocal) Name() string { return "whisper-local" }

type ModelInfo struct {
	Name   string
	Path   string
	SizeGB float64
}

func (w *WhisperLocal) ListModels() ([]ModelInfo, error) {
	entries, err := os.ReadDir(w.modelDir)
	if err != nil {
		return nil, err
	}
	var models []ModelInfo
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := filepath.Ext(e.Name())
		if ext != ".bin" && ext != ".gguf" {
			continue
		}
		info, _ := e.Info()
		models = append(models, ModelInfo{
			Name:   strings.TrimSuffix(e.Name(), ext),
			Path:   filepath.Join(w.modelDir, e.Name()),
			SizeGB: float64(info.Size()) / (1024 * 1024 * 1024),
		})
	}
	return models, nil
}

func (w *WhisperLocal) SetModel(name string) error {
	// Try with common extensions
	for _, ext := range []string{".bin", ".gguf"} {
		path := filepath.Join(w.modelDir, name+ext)
		if _, err := os.Stat(path); err == nil {
			w.mu.Lock()
			w.activeModel = path
			w.mu.Unlock()
			return nil
		}
	}
	return fmt.Errorf("model %q not found in %s", name, w.modelDir)
}

func (w *WhisperLocal) ActiveModel() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.activeModel
}

func (w *WhisperLocal) TranscribeFile(ctx context.Context, wavPath string, progress func(float64)) ([]Segment, error) {
	w.mu.Lock()
	model := w.activeModel
	bin := w.binaryPath
	w.mu.Unlock()

	if model == "" {
		return nil, fmt.Errorf("no model loaded - run `waves models pull`")
	}
	if bin == "" {
		return nil, fmt.Errorf("whisper-cli not found; install whisper.cpp")
	}

	args := []string{
		"-m", model,
		"-f", wavPath,
		"-oj", // output JSON
		"--print-progress",
	}
	if w.language != "" {
		args = append(args, "-l", w.language)
	}

	cmd := exec.CommandContext(ctx, bin, args...)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start whisper: %w", err)
	}

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			if progress != nil && strings.Contains(line, "%") {
				var pct float64
				fmt.Sscanf(line, "%f%%", &pct)
				progress(pct / 100.0)
			}
		}
	}()

	var raw whisperOutput
	if err := json.NewDecoder(stdout).Decode(&raw); err != nil {
		cmd.Wait()
		return parseOutputFile(wavPath)
	}
	cmd.Wait()

	return convertSegments(raw.Transcription), nil
}

func (w *WhisperLocal) StreamTranscribe(ctx context.Context, src io.Reader, segmentSec int, out chan<- Segment) error {
	tmpDir, err := os.MkdirTemp("", "waves-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	chunkIdx := 0
	buf := make([]byte, 16000*2*segmentSec) // 16kHz * 2bytes * N seconds

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

		wavPath := filepath.Join(tmpDir, fmt.Sprintf("chunk_%04d.wav", chunkIdx))
		chunkIdx++
		offset := time.Duration(chunkIdx-1) * time.Duration(segmentSec) * time.Second

		if err := WritePCM16ToWAV(wavPath, buf[:n], 16000, 1); err != nil {
			continue
		}

		segs, err := w.TranscribeFile(ctx, wavPath, nil)
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

// --- whisper.cpp output parsing ---

type whisperOutput struct {
	Transcription []whisperSegment `json:"transcription"`
}

type whisperSegment struct {
	Timestamps struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"timestamps"`
	Text string `json:"text"`
}

func convertSegments(raw []whisperSegment) []Segment {
	segs := make([]Segment, 0, len(raw))
	for _, r := range raw {
		segs = append(segs, Segment{
			Start: parseWhisperTime(r.Timestamps.From),
			End:   parseWhisperTime(r.Timestamps.To),
			Text:  strings.TrimSpace(r.Text),
		})
	}
	return segs
}

func parseWhisperTime(s string) time.Duration {
	s = strings.ReplaceAll(s, ",", ".")
	var h, m, sec int
	var ms float64
	fmt.Sscanf(s, "%d:%d:%d.%f", &h, &m, &sec, &ms)
	return time.Duration(h)*time.Hour +
		time.Duration(m)*time.Minute +
		time.Duration(sec)*time.Second +
		time.Duration(ms)*time.Millisecond
}

func parseOutputFile(wavPath string) ([]Segment, error) {
	jsonPath := strings.TrimSuffix(wavPath, filepath.Ext(wavPath)) + ".json"
	f, err := os.Open(jsonPath)
	if err != nil {
		return nil, fmt.Errorf("whisper output not found at %s", jsonPath)
	}
	defer f.Close()
	var raw whisperOutput
	if err := json.NewDecoder(f).Decode(&raw); err != nil {
		return nil, err
	}
	return convertSegments(raw.Transcription), nil
}

func findWhisperBin() (string, error) {
	candidates := []string{
		"whisper-cli",
		"whisper",
		"/usr/local/bin/whisper-cli",
		filepath.Join(os.Getenv("HOME"), ".local/bin/whisper-cli"),
	}
	for _, c := range candidates {
		if path, err := exec.LookPath(c); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("whisper-cli not found")
}

// WritePCM16ToWAV writes raw PCM16 bytes to a WAV file.
func WritePCM16ToWAV(path string, pcm []byte, sampleRate, channels int) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	dataSize := uint32(len(pcm))
	header := make([]byte, 44)

	copy(header[0:], "RIFF")
	putU32(header, 4, 36+dataSize)
	copy(header[8:], "WAVE")
	copy(header[12:], "fmt ")
	putU32(header, 16, 16)
	putU16(header, 20, 1) // PCM
	putU16(header, 22, uint16(channels))
	putU32(header, 24, uint32(sampleRate))
	putU32(header, 28, uint32(sampleRate*channels*2))
	putU16(header, 32, uint16(channels*2))
	putU16(header, 34, 16)
	copy(header[36:], "data")
	putU32(header, 40, dataSize)

	f.Write(header)
	f.Write(pcm)
	return nil
}

func putU32(b []byte, off int, v uint32) {
	b[off] = byte(v)
	b[off+1] = byte(v >> 8)
	b[off+2] = byte(v >> 16)
	b[off+3] = byte(v >> 24)
}

func putU16(b []byte, off int, v uint16) {
	b[off] = byte(v)
	b[off+1] = byte(v >> 8)
}
