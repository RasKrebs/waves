import net from 'net'
import os from 'os'
import path from 'path'

function socketPath(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Waves', 'daemon.sock')
}

let requestId = 0

function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
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

// -- Client --

export class DaemonClient {
  getStatus()                                 { return call<DaemonStatus>('Status') }
  startRecording(title: string)               { return call<StartResult>('StartRecording', { Title: title }) }
  stopRecording()                             { return call<StopResult>('StopRecording') }
  listSessions(limit = 30)                    { return call<{ Sessions: SessionRow[] }>('ListSessions', { Limit: limit }) }
  getSession(id: string, summarize = false)   { return call<{ Session: SessionDetail }>('GetSession', { ID: id, Summarize: summarize }) }
  summarize(id: string, workflow = 'default') { return call<{ Summary: string }>('Summarize', { SessionID: id, Workflow: workflow }) }
  listModels()                                { return call<{ Models: ModelRow[] }>('ListModels') }
  pullModel(repo: string)                     { return call<{ Name: string; Size: string }>('PullModel', { Repo: repo }) }
  setModel(name: string)                      { return call<void>('SetModel', { Name: name }) }
  listDevices()                               { return call<{ Devices: Device[] }>('ListDevices') }
  getConfig()                                 { return call<ConfigInfo>('GetConfig') }
  transcribeFile(filePath: string, title: string) { return call<{ SessionID: string }>('TranscribeFile', { FilePath: filePath, Title: title }) }
}
