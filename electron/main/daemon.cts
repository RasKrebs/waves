import net from 'net'
import os from 'os'
import path from 'path'

function socketPath(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Waves', 'daemon.sock')
}

let requestId = 0

function callOnce<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath())
    const id = ++requestId

    const payload = JSON.stringify({ id, method: `Waves.${method}`, params: [params] }) + '\n'

    let buffer = ''

    socket.on('connect', () => socket.write(payload))
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      if (buffer.includes('\n')) {
        socket.destroy()
        try {
          const msg = JSON.parse(buffer.trim())
          if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
          else resolve(msg.result as T)
        } catch (e) {
          reject(e)
        }
      }
    })
    socket.on('error', reject)
    socket.setTimeout(30000, () => {
      socket.destroy()
      reject(new Error('Daemon request timed out'))
    })
  })
}

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  // Retry with backoff when daemon socket isn't ready yet
  const maxRetries = 5
  const baseDelay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callOnce<T>(method, params)
    } catch (err: any) {
      const isConnErr = err?.code === 'ENOENT' || err?.code === 'ECONNREFUSED'
      if (isConnErr && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, baseDelay * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error('Daemon not available')
}

// -- Types --

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
export interface SessionDetail {
  Title: string
  StartedAt: string
  Duration: string
  Summary: string
  Segments: SegmentView[]
}

export interface ModelRow { Name: string; Type: string; Size: string; Active: boolean }
export interface Device   { UID: string; Name: string }
export interface AudioProcess { PID: number; Active: boolean; Name: string }
export interface ConfigInfo { TranscriptionProvider: string; TranscriptionLanguage: string; SummarizationProvider: string; Workflows: string[] }

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

export interface NoteView {
  ID: string
  SessionID?: string
  ProjectID?: string
  Content: string
  NoteType: string
  CreatedAt: string
  UpdatedAt: string
}

// -- Client --

export class DaemonClient {
  getStatus()                                 { return call<DaemonStatus>('Status') }
  startRecording(title: string, opts: { PID?: number; Device?: string; IncludeMic?: boolean; ProjectID?: string } = {}) {
    return call<StartResult>('StartRecording', { Title: title, ...opts })
  }
  stopRecording()                             { return call<StopResult>('StopRecording') }
  listSessions(limit = 30)                    { return call<{ Sessions: SessionRow[] }>('ListSessions', { Limit: limit }) }
  getSession(id: string, summarize = false)   { return call<{ Session: SessionDetail }>('GetSession', { ID: id, Summarize: summarize }) }
  summarize(id: string, workflow = 'default') { return call<{ Summary: string }>('Summarize', { SessionID: id, Workflow: workflow }) }
  listModels()                                { return call<{ Models: ModelRow[] }>('ListModels') }
  pullModel(repo: string)                     { return call<{ Name: string; Size: string }>('PullModel', { Repo: repo }) }
  setModel(name: string)                      { return call<void>('SetModel', { Name: name }) }
  listDevices()                               { return call<{ Devices: Device[] }>('ListDevices') }
  listProcesses()                             { return call<{ Processes: AudioProcess[] }>('ListProcesses') }
  getConfig()                                 { return call<ConfigInfo>('GetConfig') }
  setConfig(config: Record<string, unknown>)  { return call<void>('SetConfig', { Config: config }) }
  transcribeFile(filePath: string, title: string) { return call<{ SessionID: string }>('TranscribeFile', { FilePath: filePath, Title: title }) }
  retranscribeSession(sessionId: string)         { return call<{ Segments: number }>('RetranscribeSession', { SessionID: sessionId }) }
  renameSession(sessionId: string, title: string) { return call<{ AudioPath: string }>('RenameSession', { SessionID: sessionId, Title: title }) }
  deleteSession(sessionId: string) { return call<{ Deleted: boolean }>('DeleteSession', { SessionID: sessionId }) }

  // Projects
  createProject(name: string, description = '')  { return call<{ ProjectID: string }>('CreateProject', { Name: name, Description: description }) }
  listProjects()                                  { return call<{ Projects: ProjectRow[] }>('ListProjects') }
  getProject(id: string)                          { return call<{ Project: ProjectDetail }>('GetProject', { ID: id }) }
  updateProject(id: string, name: string, description: string) { return call<void>('UpdateProject', { ID: id, Name: name, Description: description }) }
  deleteProject(id: string)                       { return call<void>('DeleteProject', { ID: id }) }
  assignSession(sessionId: string, projectId: string | null) { return call<void>('AssignSession', { SessionID: sessionId, ProjectID: projectId }) }
  setMeetingType(sessionId: string, meetingType: string | null, regenerate = false) { return call<void>('SetMeetingType', { SessionID: sessionId, MeetingType: meetingType, Regenerate: regenerate }) }
  listUnassignedSessions()                                    { return call<{ Sessions: SessionRow[]; Count: number }>('ListUnassignedSessions') }

  // Notes
  generateNotes(sessionId: string, noteType = 'meeting-notes') { return call<{ Note: NoteView }>('GenerateNotes', { SessionID: sessionId, NoteType: noteType }) }
  getNotes(sessionId: string)                     { return call<{ Notes: NoteView[] }>('GetNotes', { SessionID: sessionId }) }
  updateNote(id: string, content: string)         { return call<void>('UpdateNote', { ID: id, Content: content }) }
  deleteNote(id: string)                          { return call<void>('DeleteNote', { ID: id }) }
  listNoteTemplates(includeContent = false)           { return call<{ Templates: { Key: string; Name: string; Description: string; Template?: string }[] }>('ListNoteTemplates', { IncludeContent: includeContent }) }
  editNote(noteId: string, selection: string, instruction: string) {
    return call<{ Changes: { Original: string; Proposed: string; StartOffset: number; EndOffset: number }[] }>('EditNote', { NoteID: noteId, Selection: selection, Instruction: instruction })
  }

  // Template CRUD
  createNoteTemplate(key: string, name: string, description: string, template: string) {
    return call<{ Key: string }>('CreateNoteTemplate', { Key: key, Name: name, Description: description, Template: template })
  }
  updateNoteTemplate(key: string, name: string, description: string, template: string) {
    return call<void>('UpdateNoteTemplate', { Key: key, Name: name, Description: description, Template: template })
  }
  deleteNoteTemplate(key: string) { return call<void>('DeleteNoteTemplate', { Key: key }) }
}
