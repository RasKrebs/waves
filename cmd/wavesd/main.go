package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"waves/internal/audio"
	"waves/internal/config"
	"waves/internal/models"
	"waves/internal/server"
	"waves/internal/store"
	"waves/internal/summarize"
	"waves/internal/transcribe"
)

func main() {
	socketPath := flag.String("socket", defaultSocketPath(), "Unix socket path")
	dataDir := flag.String("data", defaultDataDir(), "Data directory for DB and recordings")
	configPath := flag.String("config", config.DefaultPath(), "Config file path")
	verbose := flag.Bool("v", false, "Verbose logging")
	flag.Parse()

	if *verbose {
		log.SetFlags(log.LstdFlags | log.Lshortfile)
	}

	if err := os.MkdirAll(*dataDir, 0755); err != nil {
		log.Fatalf("Failed to create data dir: %v", err)
	}

	// Load config
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize SQLite store
	db, err := store.New(filepath.Join(*dataDir, "waves.db"))
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	modelDir := filepath.Join(*dataDir, "models")

	// Initialize transcription provider
	lang := cfg.Transcription.Language
	var tr transcribe.StreamProvider
	switch cfg.Transcription.Provider {
	case "whisper-local", "":
		w, err := transcribe.NewWhisperLocal(modelDir, cfg.Transcription.Whisper.Binary, lang)
		if err != nil {
			log.Fatalf("Failed to initialize whisper: %v", err)
		}
		if cfg.Transcription.Whisper.Model != "" {
			w.SetModel(cfg.Transcription.Whisper.Model)
		}
		tr = w
	case "command":
		cmdCfg := cfg.Transcription.Command
		tr = transcribe.NewCommand(cmdCfg.Binary, cmdCfg.Args, cmdCfg.Model, lang, cmdCfg.OutputFormat)
	default:
		// API-based providers don't support streaming; wrap in a file-based streamer
		log.Printf("Note: %s provider doesn't support live streaming; using whisper-local as fallback for streaming", cfg.Transcription.Provider)
		w, err := transcribe.NewWhisperLocal(modelDir, "", lang)
		if err != nil {
			log.Fatalf("Failed to initialize fallback whisper: %v", err)
		}
		tr = w
	}

	// Initialize summarization provider
	var sum summarize.Provider
	switch cfg.Summarization.Provider {
	case "claude":
		sum = summarize.NewClaude(cfg.Summarization.Claude.APIKey, cfg.Summarization.Claude.Model)
	case "openai":
		sum = summarize.NewOpenAI(cfg.Summarization.OpenAI.APIKey, cfg.Summarization.OpenAI.Model)
	case "llama-local":
		sum = summarize.NewLlama(cfg.Summarization.Llama.Binary, cfg.Summarization.Llama.Model)
	case "rest-api":
		sum = summarize.NewRestAPI(cfg.Summarization.RestAPI.URL, cfg.Summarization.RestAPI.Headers)
	default:
		log.Printf("No summarization provider configured (set summarization.provider in config)")
	}

	// Initialize audio capture and model downloader
	capturer := audio.NewCapturer()
	downloader := models.NewDownloader(modelDir, cfg.Summarization.Claude.APIKey) // reuse token if available

	// Start JSON-RPC server
	srv := server.New(*socketPath, *dataDir, db, tr, capturer, cfg, downloader, sum)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		sigs := make(chan os.Signal, 1)
		signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
		<-sigs
		fmt.Println("\nShutting down wavesd...")
		cancel()
	}()

	log.Printf("wavesd starting, socket: %s", *socketPath)
	if err := srv.Run(ctx); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func defaultSocketPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "Waves", "daemon.sock")
}

func defaultDataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "Waves")
}
