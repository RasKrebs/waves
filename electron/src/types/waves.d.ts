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
}

export interface SegmentView { Timestamp: string; Text: string }
export interface SessionDetail {
  Title: string
  StartedAt: string
  Duration: string
  Summary: string
  Segments: SegmentView[]
}

export interface ModelRow { Name: string; Type: string; Size: string; Active: boolean }
export interface Device   { UID: string; Name: string }
export interface ConfigInfo { TranscriptionProvider: string; SummarizationProvider: string; Workflows: string[] }

declare global {
  interface Window {
    waves: {
      getStatus(): Promise<DaemonStatus>
      startRecording(title: string): Promise<StartResult>
      stopRecording(): Promise<StopResult>
      listSessions(limit?: number): Promise<{ Sessions: SessionRow[] }>
      getSession(id: string, summarize?: boolean): Promise<{ Session: SessionDetail }>
      summarize(id: string, workflow?: string): Promise<{ Summary: string }>
      listModels(): Promise<{ Models: ModelRow[] }>
      pullModel(repo: string): Promise<{ Name: string; Size: string }>
      setModel(name: string): Promise<void>
      listDevices(): Promise<{ Devices: Device[] }>
      getConfig(): Promise<ConfigInfo>
      uploadPick(): Promise<string | null>
      uploadTranscribe(filePath: string, title: string): Promise<{ SessionID: string }>
      openDataDir(): Promise<void>
      openUrl(url: string): Promise<void>
      on(channel: string, cb: (...args: any[]) => void): void
      off(channel: string, cb: (...args: any[]) => void): void
    }
  }
}
