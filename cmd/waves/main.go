package main

import (
	"fmt"
	"net"
	"net/rpc/jsonrpc"
	"os"
	"path/filepath"
	"text/tabwriter"
	"time"

	"waves/internal/types"

	"github.com/spf13/cobra"
)

var socketPath string

var rootCmd = &cobra.Command{
	Use:   "waves",
	Short: "Waves - Local meeting transcription and summarization",
}

func main() {
	home, _ := os.UserHomeDir()
	defaultSocket := filepath.Join(home, "Library", "Application Support", "Waves", "daemon.sock")

	rootCmd.PersistentFlags().StringVar(&socketPath, "socket", defaultSocket, "Daemon socket path")

	rootCmd.AddCommand(
		statusCmd(),
		recordCmd(),
		stopCmd(),
		listCmd(),
		showCmd(),
		summarizeCmd(),
		modelsCmd(),
		configCmd(),
	)

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

// --- RPC client helper ---

func rpcCall(method string, args, reply interface{}) error {
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		return fmt.Errorf("cannot connect to daemon (is wavesd running?): %w", err)
	}
	client := jsonrpc.NewClient(conn)
	defer client.Close()
	return client.Call("Waves."+method, args, reply)
}

// --- Commands ---

func statusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show daemon status",
		RunE: func(cmd *cobra.Command, args []string) error {
			var reply types.StatusReply
			if err := rpcCall("Status", types.StatusArgs{}, &reply); err != nil {
				return err
			}
			fmt.Printf("Status:    %s\n", reply.State)
			fmt.Printf("Uptime:    %s\n", reply.Uptime)
			fmt.Printf("Sessions:  %d total\n", reply.TotalSessions)
			if reply.ActiveSession != "" {
				fmt.Printf("Recording: %s\n", reply.ActiveSession)
			}
			return nil
		},
	}
}

func recordCmd() *cobra.Command {
	var title, device string
	var pid int
	cmd := &cobra.Command{
		Use:   "record",
		Short: "Start recording a meeting",
		RunE: func(cmd *cobra.Command, args []string) error {
			var reply types.StartReply
			if err := rpcCall("StartRecording", types.StartArgs{Title: title, Device: device, PID: pid}, &reply); err != nil {
				return err
			}
			fmt.Printf("Recording started: session ID %s\n", reply.SessionID)
			fmt.Println("Press Ctrl+C or run `waves stop` to end.")
			return nil
		},
	}
	cmd.Flags().StringVarP(&title, "title", "t", "", "Meeting title (auto-generated if empty)")
	cmd.Flags().StringVarP(&device, "device", "d", "", "Audio input device UID (default: system default mic)")
	cmd.Flags().IntVarP(&pid, "pid", "p", 0, "Process ID to capture audio from (macOS 14.2+, e.g. Zoom/Teams)")
	return cmd
}

func stopCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop current recording",
		RunE: func(cmd *cobra.Command, args []string) error {
			var reply types.StopReply
			if err := rpcCall("StopRecording", types.StopArgs{}, &reply); err != nil {
				return err
			}
			fmt.Printf("Stopped recording session: %s\n", reply.SessionID)
			fmt.Printf("Duration: %s\n", reply.Duration)
			return nil
		},
	}
}

func listCmd() *cobra.Command {
	var limit int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List past meeting sessions",
		RunE: func(cmd *cobra.Command, args []string) error {
			var reply types.ListReply
			if err := rpcCall("ListSessions", types.ListArgs{Limit: limit}, &reply); err != nil {
				return err
			}
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "ID\tDATE\tTITLE\tDURATION\tSTATUS")
			for _, s := range reply.Sessions {
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n",
					s.ID[:8],
					s.StartedAt.Format("2006-01-02 15:04"),
					truncate(s.Title, 40),
					s.Duration,
					s.Status,
				)
			}
			w.Flush()
			return nil
		},
	}
	cmd.Flags().IntVarP(&limit, "limit", "n", 20, "Number of sessions to show")
	return cmd
}

func showCmd() *cobra.Command {
	var doSummarize bool
	cmd := &cobra.Command{
		Use:   "show <session-id>",
		Short: "Show transcript and summary for a session",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var reply types.ShowReply
			if err := rpcCall("GetSession", types.ShowArgs{ID: args[0], Summarize: doSummarize}, &reply); err != nil {
				return err
			}
			fmt.Printf("=== %s ===\n", reply.Session.Title)
			fmt.Printf("Date: %s | Duration: %s\n\n", reply.Session.StartedAt.Format(time.RFC1123), reply.Session.Duration)
			if reply.Session.Summary != "" {
				fmt.Println("--- SUMMARY ---")
				fmt.Println(reply.Session.Summary)
				fmt.Println()
			}
			fmt.Println("--- TRANSCRIPT ---")
			for _, seg := range reply.Session.Segments {
				fmt.Printf("[%s] %s\n", seg.Timestamp, seg.Text)
			}
			return nil
		},
	}
	cmd.Flags().BoolVarP(&doSummarize, "summarize", "s", false, "Generate summary if not already done")
	return cmd
}

func summarizeCmd() *cobra.Command {
	var workflow string
	cmd := &cobra.Command{
		Use:   "summarize <session-id>",
		Short: "Summarize a recorded session",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var reply types.SummarizeReply
			if err := rpcCall("Summarize", types.SummarizeArgs{SessionID: args[0], Workflow: workflow}, &reply); err != nil {
				return err
			}
			fmt.Println(reply.Summary)
			return nil
		},
	}
	cmd.Flags().StringVarP(&workflow, "workflow", "w", "default", "Workflow name from config")
	return cmd
}

func modelsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "models",
		Short: "Manage transcription models",
	}

	cmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List downloaded models",
		RunE: func(cmd *cobra.Command, args []string) error {
			var reply types.ModelsReply
			if err := rpcCall("ListModels", types.ModelsArgs{}, &reply); err != nil {
				return err
			}
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "NAME\tTYPE\tSIZE\tACTIVE")
			for _, m := range reply.Models {
				active := ""
				if m.Active {
					active = "*"
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", m.Name, m.Type, m.Size, active)
			}
			w.Flush()
			return nil
		},
	})

	cmd.AddCommand(&cobra.Command{
		Use:   "pull <hf-repo/model>",
		Short: "Download a model from HuggingFace",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("Pulling model %s...\n", args[0])
			var reply types.PullModelReply
			if err := rpcCall("PullModel", types.PullModelArgs{Repo: args[0]}, &reply); err != nil {
				return err
			}
			fmt.Printf("Downloaded: %s (%s)\n", reply.Name, reply.Size)
			return nil
		},
	})

	cmd.AddCommand(&cobra.Command{
		Use:   "set <model-name>",
		Short: "Set active transcription model",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var reply types.SetModelReply
			if err := rpcCall("SetModel", types.SetModelArgs{Name: args[0]}, &reply); err != nil {
				return err
			}
			fmt.Printf("Active model set to: %s\n", args[0])
			return nil
		},
	})

	return cmd
}

func configCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "config",
		Short: "Show current configuration",
		RunE: func(cmd *cobra.Command, args []string) error {
			var reply types.ConfigReply
			if err := rpcCall("GetConfig", types.ConfigArgs{}, &reply); err != nil {
				return err
			}
			fmt.Printf("Transcription: %s\n", reply.TranscriptionProvider)
			fmt.Printf("Summarization: %s\n", reply.SummarizationProvider)
			fmt.Printf("Workflows:     %v\n", reply.Workflows)
			return nil
		},
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-3] + "..."
}
