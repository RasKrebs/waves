export interface DaemonStatus {
  State: string
  Uptime: string
  TotalSessions: number
  ActiveSession: string
}

export interface StartResult { SessionID: string }
export interface StopResult  { SessionID: string; Duration: string }

export interface SessionRow {
  ID: string
  Title: string
  StartedAt: string
  Duration: string
  Status: string
  ProjectID: string
  MeetingType: string
}

export interface SegmentView { Timestamp: string; Text: string }

export interface NoteView {
  ID: string
  Content: string
  NoteType: string
  CreatedAt: string
  UpdatedAt: string
}

export interface SessionDetail {
  Title: string
  StartedAt: string
  Duration: string
  Summary: string
  Segments: SegmentView[]
  AudioPath: string
  ProjectID: string
  MeetingType: string
  Notes: NoteView[]
}

export interface ProjectRow {
  ID: string
  Name: string
  Description: string
  CreatedAt: string
  SessionCount: number
}

export interface ProjectDetail {
  ID: string
  Name: string
  Description: string
  CreatedAt: string
  Sessions: SessionRow[]
}

export interface ModelRow { Name: string; Type: string; Size: string; Active: boolean }
export interface Device   { UID: string; Name: string }
export interface AudioProcess { PID: number; Active: boolean; Name: string }
export interface NoteTemplate {
  Key: string
  Name: string
  Description: string
  Template?: string
}

export interface EditChange {
  Original: string
  Proposed: string
  StartOffset: number
  EndOffset: number
}

export interface ConfigInfo { TranscriptionProvider: string; TranscriptionLanguage: string; SummarizationProvider: string; Workflows: string[] }

export interface DetectedMeetingInfo {
  PID: number
  BundleID: string
  AppName: string
}

declare global {
  interface Window {
    waves: {
      getStatus(): Promise<DaemonStatus>
      startRecording(title: string, opts?: { PID?: number; Device?: string; IncludeMic?: boolean; ProjectID?: string }): Promise<StartResult>
      stopRecording(): Promise<StopResult>
      listSessions(limit?: number): Promise<{ Sessions: SessionRow[] }>
      getSession(id: string, summarize?: boolean): Promise<{ Session: SessionDetail }>
      summarize(id: string, workflow?: string): Promise<{ Summary: string }>
      retranscribe(id: string): Promise<{ Segments: number }>
      renameSession(id: string, title: string): Promise<{ AudioPath: string }>
      deleteSession(id: string): Promise<{ Deleted: boolean }>

      // Projects
      createProject(name: string, description?: string): Promise<{ ProjectID: string }>
      listProjects(): Promise<{ Projects: ProjectRow[] }>
      getProject(id: string): Promise<{ Project: ProjectDetail }>
      updateProject(id: string, name: string, description: string): Promise<void>
      deleteProject(id: string): Promise<void>
      assignSession(sessionId: string, projectId: string | null): Promise<void>
      setMeetingType(sessionId: string, meetingType: string | null, regenerate?: boolean): Promise<void>
      listUnassignedSessions(): Promise<{ Sessions: SessionRow[]; Count: number }>

      // Notes
      generateNotes(sessionId: string, noteType?: string): Promise<{ Note: NoteView }>
      getNotes(sessionId: string): Promise<{ Notes: NoteView[] }>
      updateNote(id: string, content: string): Promise<void>
      deleteNote(id: string): Promise<void>
      listNoteTemplates(includeContent?: boolean): Promise<{ Templates: NoteTemplate[] }>
      editNote(noteId: string, selection: string, instruction: string): Promise<{ Changes: EditChange[] }>

      // Template CRUD
      createNoteTemplate(key: string, name: string, description: string, template: string): Promise<{ Key: string }>
      updateNoteTemplate(key: string, name: string, description: string, template: string): Promise<void>
      deleteNoteTemplate(key: string): Promise<void>

      // Meeting detection
      dismissMeeting(pid: number): Promise<void>
      getActiveMeeting(): Promise<DetectedMeetingInfo | null>

      listModels(): Promise<{ Models: ModelRow[] }>
      pullModel(repo: string): Promise<{ Name: string; Size: string }>
      setModel(name: string): Promise<void>
      listDevices(): Promise<{ Devices: Device[] }>
      listProcesses(): Promise<{ Processes: AudioProcess[] }>
      getConfig(): Promise<ConfigInfo>
      setConfig(config: Record<string, unknown>): Promise<void>
      uploadPick(): Promise<string | null>
      uploadTranscribe(filePath: string, title: string): Promise<{ SessionID: string }>
      getAudioUrl(audioPath: string): Promise<string | null>
      getDaemonState(): Promise<'running' | 'stopped' | 'starting'>
      getDaemonLogs(): Promise<string[]>
      restartDaemon(): Promise<'running' | 'stopped' | 'starting'>
      openDataDir(): Promise<void>
      openUrl(url: string): Promise<void>
      on(channel: string, cb: (...args: any[]) => void): void
      off(channel: string, cb: (...args: any[]) => void): void
    }
  }
}
