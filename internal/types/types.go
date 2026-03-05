package types

import "time"

// --- RPC Request/Reply types shared between CLI and server ---

// Status
type StatusArgs struct{}
type StatusReply struct {
	State         string
	Uptime        string
	TotalSessions int
	ActiveSession string
}

// Recording
type StartArgs struct{ Title string }
type StartReply struct{ SessionID string }

type StopArgs struct{}
type StopReply struct {
	SessionID string
	Duration  string
}

// Sessions
type ListArgs struct{ Limit int }
type ListReply struct {
	Sessions []SessionSummary
}
type SessionSummary struct {
	ID        string
	Title     string
	StartedAt time.Time
	Duration  string
	Status    string
}

type ShowArgs struct {
	ID        string
	Summarize bool
}
type ShowReply struct {
	Session SessionDetail
}
type SessionDetail struct {
	Title     string
	StartedAt time.Time
	Duration  string
	Summary   string
	Segments  []SegmentView
}
type SegmentView struct {
	Timestamp string
	Text      string
}

// Models
type ModelsArgs struct{}
type ModelsReply struct {
	Models []ModelInfo
}
type ModelInfo struct {
	Name   string
	Type   string
	Size   string
	Active bool
}

type SetModelArgs struct{ Name string }
type SetModelReply struct{}

type PullModelArgs struct{ Repo string }
type PullModelReply struct {
	Name string
	Size string
}

// Devices
type DevicesArgs struct{}
type DevicesReply struct {
	Devices []DeviceInfo
}
type DeviceInfo struct {
	UID  string
	Name string
}

// Summarize
type SummarizeArgs struct {
	SessionID string
	Workflow  string // workflow name from config, empty = default
}
type SummarizeReply struct {
	Summary string
}

// Config
type ConfigArgs struct{}
type ConfigReply struct {
	TranscriptionProvider string
	SummarizationProvider string
	Workflows             []string
}
