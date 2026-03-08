package audio

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// SubprocessCapture spawns waves-audio and reads PCM16 mono 16kHz from its stdout.
// It implements io.Reader so it can be used as a drop-in source for StreamTranscribe.
type SubprocessCapture struct {
	binaryPath string

	mu        sync.Mutex
	cmd       *exec.Cmd
	stdout    io.ReadCloser
	capturing bool
}

func NewSubprocessCapture(binaryPath string) *SubprocessCapture {
	if binaryPath == "" {
		binaryPath = findWavesAudio()
	}
	return &SubprocessCapture{binaryPath: binaryPath}
}

// findWavesAudio looks for waves-audio next to the current executable, then on PATH.
func findWavesAudio() string {
	// Check next to the running binary (e.g. build/waves-audio alongside build/wavesd)
	if exe, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "waves-audio")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	// Fall back to PATH
	if p, err := exec.LookPath("waves-audio"); err == nil {
		return p
	}
	return "waves-audio"
}

// StartMic captures from a microphone / input device.
// Pass empty deviceUID for system default.
func (s *SubprocessCapture) StartMic(deviceUID string) error {
	args := []string{"mic"}
	if deviceUID != "" {
		args = append(args, "--device", deviceUID)
	}
	return s.startProcess(args)
}

// StartTap captures from a specific process by PID (macOS 14.2+).
func (s *SubprocessCapture) StartTap(pid int) error {
	return s.startProcess([]string{"tap", fmt.Sprintf("%d", pid)})
}

func (s *SubprocessCapture) startProcess(args []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.capturing {
		return fmt.Errorf("already capturing")
	}

	s.cmd = exec.Command(s.binaryPath, args...)

	stdout, err := s.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	s.stdout = stdout

	// Log stderr in background
	stderr, _ := s.cmd.StderrPipe()
	if stderr != nil {
		go func() {
			buf := make([]byte, 1024)
			for {
				n, err := stderr.Read(buf)
				if n > 0 {
					log.Printf("[waves-audio] %s", strings.TrimSpace(string(buf[:n])))
				}
				if err != nil {
					return
				}
			}
		}()
	}

	if err := s.cmd.Start(); err != nil {
		return fmt.Errorf("start waves-audio: %w", err)
	}

	s.capturing = true
	log.Printf("[audio] started waves-audio %v (pid %d)", args, s.cmd.Process.Pid)
	return nil
}

// Read implements io.Reader — reads PCM16 mono 16kHz bytes from the subprocess.
func (s *SubprocessCapture) Read(p []byte) (int, error) {
	s.mu.Lock()
	stdout := s.stdout
	capturing := s.capturing
	s.mu.Unlock()

	if !capturing || stdout == nil {
		return 0, io.EOF
	}

	return stdout.Read(p)
}

// Stop terminates the subprocess.
func (s *SubprocessCapture) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.capturing {
		return
	}

	s.capturing = false

	if s.cmd != nil && s.cmd.Process != nil {
		// Send SIGINT for graceful shutdown (matches signal handler in waves-audio)
		s.cmd.Process.Signal(os.Interrupt)
		// Give it a moment to flush, then force kill
		done := make(chan struct{})
		go func() { s.cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			s.cmd.Process.Kill()
			s.cmd.Wait()
		}
	}

	log.Printf("[audio] stopped waves-audio")
}

// ListProcesses runs `waves-audio list` and returns the output.
func (s *SubprocessCapture) ListProcesses() (string, error) {
	cmd := exec.Command(s.binaryPath, "list")
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// ListInputDevices runs `waves-audio devices` and returns the output.
func (s *SubprocessCapture) ListInputDevices() (string, error) {
	cmd := exec.Command(s.binaryPath, "devices")
	out, err := cmd.CombinedOutput()
	return string(out), err
}
