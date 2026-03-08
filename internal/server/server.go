package server

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/rpc"
	"net/rpc/jsonrpc"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"waves/internal/audio"
	"waves/internal/config"
	"waves/internal/models"
	"waves/internal/store"
	"waves/internal/summarize"
	"waves/internal/transcribe"
	"waves/internal/types"
)

type Server struct {
	socketPath  string
	dataDir     string
	db          *store.DB
	transcriber transcribe.StreamProvider
	capturer    *audio.Capturer
	audioCap    *audio.SubprocessCapture
	cfg         *config.Config
	downloader  *models.Downloader
	summarizer  summarize.Provider

	mu            sync.Mutex
	activeSession *activeSession
	startTime     time.Time
}

type activeSession struct {
	session store.Session
	cancel  context.CancelFunc
	segCh   chan transcribe.Segment
}

func New(socketPath, dataDir string, db *store.DB, tr transcribe.StreamProvider, cap *audio.Capturer, audioCap *audio.SubprocessCapture, cfg *config.Config, dl *models.Downloader, sum summarize.Provider) *Server {
	return &Server{
		socketPath:  socketPath,
		dataDir:     dataDir,
		db:          db,
		transcriber: tr,
		capturer:    cap,
		audioCap:    audioCap,
		cfg:         cfg,
		downloader:  dl,
		summarizer:  sum,
		startTime:   time.Now(),
	}
}

func (s *Server) Run(ctx context.Context) error {
	os.Remove(s.socketPath)
	if err := os.MkdirAll(filepath.Dir(s.socketPath), 0755); err != nil {
		return err
	}

	ln, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", s.socketPath, err)
	}
	defer ln.Close()
	defer os.Remove(s.socketPath)

	rpc.RegisterName("Waves", &Handler{srv: s})

	go func() {
		<-ctx.Done()
		ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			default:
				continue
			}
		}
		go jsonrpc.ServeConn(conn)
	}
}

// Handler exposes RPC methods.
type Handler struct {
	srv *Server
}

// --- Status ---

func (h *Handler) Status(_ types.StatusArgs, reply *types.StatusReply) error {
	h.srv.mu.Lock()
	defer h.srv.mu.Unlock()

	reply.State = "idle"
	reply.Uptime = time.Since(h.srv.startTime).Round(time.Second).String()

	sessions, _ := h.srv.db.ListSessions(1000)
	reply.TotalSessions = len(sessions)

	if h.srv.activeSession != nil {
		reply.State = "recording"
		reply.ActiveSession = h.srv.activeSession.session.ID
	}
	return nil
}

// --- StartRecording ---

func (h *Handler) StartRecording(args types.StartArgs, reply *types.StartReply) error {
	h.srv.mu.Lock()
	defer h.srv.mu.Unlock()

	if h.srv.activeSession != nil {
		return fmt.Errorf("already recording session %s", h.srv.activeSession.session.ID)
	}

	sessionID := uuid.New().String()
	title := args.Title
	if title == "" {
		title = "Meeting " + time.Now().Format("2006-01-02 15:04")
	}

	audioPath := filepath.Join(h.srv.dataDir, "recordings", sessionID+".wav")
	os.MkdirAll(filepath.Dir(audioPath), 0755)

	sess := store.Session{
		ID:        sessionID,
		Title:     title,
		StartedAt: time.Now(),
		AudioPath: audioPath,
		Status:    "recording",
	}
	if err := h.srv.db.CreateSession(sess); err != nil {
		return fmt.Errorf("db error: %w", err)
	}

	// Use waves-audio subprocess for capture (supports both mic and process tap)
	if args.PID > 0 {
		if err := h.srv.audioCap.StartTap(args.PID); err != nil {
			return fmt.Errorf("process tap error: %w", err)
		}
	} else {
		if err := h.srv.audioCap.StartMic(args.Device); err != nil {
			return fmt.Errorf("audio capture error: %w", err)
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	segCh := make(chan transcribe.Segment, 100)

	h.srv.activeSession = &activeSession{
		session: sess,
		cancel:  cancel,
		segCh:   segCh,
	}

	go h.srv.streamTranscribe(ctx, sessionID, segCh)

	go func() {
		for seg := range segCh {
			h.srv.db.AddSegment(store.Segment{
				SessionID: sessionID,
				StartMS:   seg.Start.Milliseconds(),
				EndMS:     seg.End.Milliseconds(),
				Text:      seg.Text,
			})
		}
	}()

	reply.SessionID = sessionID
	return nil
}

func (s *Server) streamTranscribe(ctx context.Context, sessionID string, out chan<- transcribe.Segment) {
	defer close(out)
	log.Printf("[transcribe] starting stream transcription for session %s", sessionID)

	// Save raw audio to WAV file while streaming to transcriber
	audioPath := filepath.Join(s.dataDir, "recordings", sessionID+".wav")
	audioFile, err := os.Create(audioPath)
	if err != nil {
		log.Printf("[transcribe] failed to create audio file: %v", err)
		// Fall back to transcription without saving
		if err := s.transcriber.StreamTranscribe(ctx, s.audioCap, 10, out); err != nil {
			log.Printf("[transcribe] error for session %s: %v", sessionID, err)
		}
		return
	}

	// Write placeholder WAV header (44 bytes), will update data size at end
	header := make([]byte, 44)
	copy(header[0:], "RIFF")
	copy(header[8:], "WAVE")
	copy(header[12:], "fmt ")
	putU32LE(header, 16, 16)       // fmt chunk size
	putU16LE(header, 20, 1)        // PCM format
	putU16LE(header, 22, 1)        // mono
	putU32LE(header, 24, 16000)    // sample rate
	putU32LE(header, 28, 32000)    // byte rate (16000 * 1 * 2)
	putU16LE(header, 32, 2)        // block align
	putU16LE(header, 34, 16)       // bits per sample
	copy(header[36:], "data")
	audioFile.Write(header)

	// TeeReader: every byte read by transcriber also gets written to the file
	tee := io.TeeReader(s.audioCap, audioFile)

	if err := s.transcriber.StreamTranscribe(ctx, tee, 10, out); err != nil {
		log.Printf("[transcribe] error for session %s: %v", sessionID, err)
	}

	// Finalize WAV header with actual data size
	pos, _ := audioFile.Seek(0, io.SeekCurrent)
	dataSize := uint32(pos - 44)
	putU32LE(header, 4, 36+dataSize)
	putU32LE(header, 40, dataSize)
	audioFile.Seek(0, io.SeekStart)
	audioFile.Write(header)
	audioFile.Close()

	log.Printf("[transcribe] saved audio to %s (%d bytes)", audioPath, dataSize)
}

// --- StopRecording ---

func (h *Handler) StopRecording(_ types.StopArgs, reply *types.StopReply) error {
	h.srv.mu.Lock()
	defer h.srv.mu.Unlock()

	if h.srv.activeSession == nil {
		return fmt.Errorf("no active recording")
	}

	as := h.srv.activeSession
	as.cancel()
	h.srv.audioCap.Stop()

	now := time.Now()
	dur := now.Sub(as.session.StartedAt).Round(time.Second)
	as.session.EndedAt = &now
	as.session.Status = "done"
	h.srv.db.UpdateSession(as.session)

	reply.SessionID = as.session.ID
	reply.Duration = dur.String()

	h.srv.activeSession = nil
	return nil
}

// --- ListSessions ---

func (h *Handler) ListSessions(args types.ListArgs, reply *types.ListReply) error {
	limit := args.Limit
	if limit <= 0 {
		limit = 20
	}
	sessions, err := h.srv.db.ListSessions(limit)
	if err != nil {
		return err
	}
	for _, s := range sessions {
		dur := ""
		if s.EndedAt != nil {
			dur = s.EndedAt.Sub(s.StartedAt).Round(time.Second).String()
		}
		reply.Sessions = append(reply.Sessions, types.SessionSummary{
			ID:        s.ID,
			Title:     s.Title,
			StartedAt: s.StartedAt,
			Duration:  dur,
			Status:    s.Status,
		})
	}
	return nil
}

// --- GetSession ---

func (h *Handler) GetSession(args types.ShowArgs, reply *types.ShowReply) error {
	sess, err := h.srv.db.GetSession(args.ID)
	if err != nil {
		return fmt.Errorf("session not found: %w", err)
	}

	// Run summarization if requested and not already done
	if args.Summarize && sess.Summary == "" && h.srv.summarizer != nil {
		transcript, err := h.srv.db.FullTranscript(sess.ID)
		if err == nil && transcript != "" {
			workflowName := "default"
			wf, ok := h.srv.cfg.Workflows[workflowName]
			if ok {
				runner := summarize.NewWorkflowRunner(h.srv.summarizer)
				summary, err := runner.Run(context.Background(), transcript, wf)
				if err == nil {
					sess.Summary = summary
					h.srv.db.UpdateSession(*sess)
				}
			}
		}
	}

	segs, err := h.srv.db.GetSegments(sess.ID)
	if err != nil {
		return err
	}

	dur := ""
	if sess.EndedAt != nil {
		dur = sess.EndedAt.Sub(sess.StartedAt).Round(time.Second).String()
	}

	reply.Session = types.SessionDetail{
		Title:     sess.Title,
		StartedAt: sess.StartedAt,
		Duration:  dur,
		Summary:   sess.Summary,
	}
	for _, seg := range segs {
		ts := time.Duration(seg.StartMS) * time.Millisecond
		h := int(ts.Hours())
		m := int(ts.Minutes()) % 60
		sec := int(ts.Seconds()) % 60
		reply.Session.Segments = append(reply.Session.Segments, types.SegmentView{
			Timestamp: fmt.Sprintf("%02d:%02d:%02d", h, m, sec),
			Text:      seg.Text,
		})
	}
	return nil
}

// --- ListModels ---

func (h *Handler) ListModels(_ types.ModelsArgs, reply *types.ModelsReply) error {
	whisper, ok := h.srv.transcriber.(*transcribe.WhisperLocal)
	if !ok {
		return nil
	}
	modelList, err := whisper.ListModels()
	if err != nil {
		return err
	}
	activeModel := whisper.ActiveModel()
	for _, m := range modelList {
		reply.Models = append(reply.Models, types.ModelInfo{
			Name:   m.Name,
			Type:   "whisper",
			Size:   fmt.Sprintf("%.1f GB", m.SizeGB),
			Active: m.Path == activeModel,
		})
	}
	return nil
}

// --- SetModel ---

func (h *Handler) SetModel(args types.SetModelArgs, reply *types.SetModelReply) error {
	whisper, ok := h.srv.transcriber.(*transcribe.WhisperLocal)
	if !ok {
		return fmt.Errorf("model selection only available for whisper-local provider")
	}
	return whisper.SetModel(args.Name)
}

// --- PullModel ---

func (h *Handler) PullModel(args types.PullModelArgs, reply *types.PullModelReply) error {
	path, err := h.srv.downloader.PullWhisperModel(args.Repo, nil)
	if err != nil {
		return err
	}
	info, _ := os.Stat(path)
	reply.Name = filepath.Base(path)
	if info != nil {
		reply.Size = fmt.Sprintf("%.1f MB", float64(info.Size())/(1024*1024))
	}
	return nil
}

// --- ListDevices ---

func (h *Handler) ListDevices(_ types.DevicesArgs, reply *types.DevicesReply) error {
	devices, err := h.srv.capturer.ListDevices()
	if err != nil {
		return err
	}
	for _, d := range devices {
		reply.Devices = append(reply.Devices, types.DeviceInfo{
			UID:  d.UID,
			Name: d.Name,
		})
	}
	return nil
}

// --- Summarize ---

func (h *Handler) Summarize(args types.SummarizeArgs, reply *types.SummarizeReply) error {
	if h.srv.summarizer == nil {
		return fmt.Errorf("no summarization provider configured")
	}

	sess, err := h.srv.db.GetSession(args.SessionID)
	if err != nil {
		return fmt.Errorf("session not found: %w", err)
	}

	transcript, err := h.srv.db.FullTranscript(sess.ID)
	if err != nil {
		return err
	}
	if transcript == "" {
		return fmt.Errorf("session has no transcript")
	}

	workflowName := args.Workflow
	if workflowName == "" {
		workflowName = "default"
	}
	wf, ok := h.srv.cfg.Workflows[workflowName]
	if !ok {
		return fmt.Errorf("workflow %q not found", workflowName)
	}

	runner := summarize.NewWorkflowRunner(h.srv.summarizer)
	summary, err := runner.Run(context.Background(), transcript, wf)
	if err != nil {
		return err
	}

	sess.Summary = summary
	h.srv.db.UpdateSession(*sess)

	reply.Summary = summary
	return nil
}

// --- TranscribeFile ---

func (h *Handler) TranscribeFile(args types.TranscribeFileArgs, reply *types.TranscribeFileReply) error {
	if args.FilePath == "" {
		return fmt.Errorf("file path is required")
	}
	if _, err := os.Stat(args.FilePath); err != nil {
		return fmt.Errorf("file not found: %s", args.FilePath)
	}

	sessionID := uuid.New().String()
	title := args.Title
	if title == "" {
		title = filepath.Base(args.FilePath)
	}

	// Copy file to recordings directory
	destPath := filepath.Join(h.srv.dataDir, "recordings", sessionID+filepath.Ext(args.FilePath))
	os.MkdirAll(filepath.Dir(destPath), 0755)
	srcData, err := os.ReadFile(args.FilePath)
	if err != nil {
		return fmt.Errorf("read file: %w", err)
	}
	if err := os.WriteFile(destPath, srcData, 0644); err != nil {
		return fmt.Errorf("copy file: %w", err)
	}

	now := time.Now()
	sess := store.Session{
		ID:        sessionID,
		Title:     title,
		StartedAt: now,
		AudioPath: destPath,
		Status:    "transcribing",
	}
	if err := h.srv.db.CreateSession(sess); err != nil {
		return fmt.Errorf("db error: %w", err)
	}

	// Transcribe in background
	go func() {
		// Convert unsupported formats to WAV (whisper-cli supports wav, mp3, ogg, flac)
		transcribePath := destPath
		ext := strings.ToLower(filepath.Ext(destPath))
		if ext != ".wav" && ext != ".mp3" && ext != ".ogg" && ext != ".flac" {
			wavPath := strings.TrimSuffix(destPath, filepath.Ext(destPath)) + ".wav"
			log.Printf("[transcribe] converting %s to WAV", ext)
			cmd := exec.Command("ffmpeg", "-i", destPath, "-ar", "16000", "-ac", "1", "-y", wavPath)
			if out, err := cmd.CombinedOutput(); err != nil {
				log.Printf("[transcribe] ffmpeg conversion failed: %v\n%s", err, out)
				sess.Status = "failed"
				h.srv.db.UpdateSession(sess)
				return
			}
			transcribePath = wavPath
		}

		segments, err := h.srv.transcriber.TranscribeFile(context.Background(), transcribePath, nil)
		if err != nil {
			log.Printf("[transcribe] file transcription failed for %s: %v", destPath, err)
			sess.Status = "failed"
			h.srv.db.UpdateSession(sess)
			return
		}

		for _, seg := range segments {
			h.srv.db.AddSegment(store.Segment{
				SessionID: sessionID,
				StartMS:   seg.Start.Milliseconds(),
				EndMS:     seg.End.Milliseconds(),
				Text:      seg.Text,
			})
		}

		endTime := time.Now()
		sess.EndedAt = &endTime
		sess.Status = "done"
		h.srv.db.UpdateSession(sess)
	}()

	reply.SessionID = sessionID
	return nil
}

// --- WAV helpers ---

func putU32LE(b []byte, off int, v uint32) {
	b[off] = byte(v)
	b[off+1] = byte(v >> 8)
	b[off+2] = byte(v >> 16)
	b[off+3] = byte(v >> 24)
}

func putU16LE(b []byte, off int, v uint16) {
	b[off] = byte(v)
	b[off+1] = byte(v >> 8)
}

// --- GetConfig ---

func (h *Handler) GetConfig(_ types.ConfigArgs, reply *types.ConfigReply) error {
	reply.TranscriptionProvider = h.srv.cfg.Transcription.Provider
	reply.SummarizationProvider = h.srv.cfg.Summarization.Provider
	for name := range h.srv.cfg.Workflows {
		reply.Workflows = append(reply.Workflows, name)
	}
	return nil
}
