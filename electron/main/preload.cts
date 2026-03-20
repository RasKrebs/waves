import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('waves', {
  // Daemon
  getStatus:      ()                                => ipcRenderer.invoke('daemon:status'),
  startRecording: (title: string, opts?: { PID?: number; Device?: string; IncludeMic?: boolean; ProjectID?: string }) =>
                    ipcRenderer.invoke('recording:start', title, opts ?? {}),
  stopRecording:  ()                                => ipcRenderer.invoke('recording:stop'),

  // Sessions
  listSessions:   (limit?: number)                  => ipcRenderer.invoke('sessions:list', limit ?? 30),
  getSession:     (id: string, summarize?: boolean)  => ipcRenderer.invoke('sessions:get', id, summarize ?? false),
  summarize:      (id: string, workflow?: string)    => ipcRenderer.invoke('sessions:summarize', id, workflow ?? 'default'),
  retranscribe:   (id: string)                     => ipcRenderer.invoke('sessions:retranscribe', id),
  renameSession:  (id: string, title: string)      => ipcRenderer.invoke('sessions:rename', id, title),
  deleteSession:  (id: string)                     => ipcRenderer.invoke('sessions:delete', id),

  // Projects
  createProject:  (name: string, description?: string) => ipcRenderer.invoke('projects:create', name, description ?? ''),
  listProjects:   ()                                => ipcRenderer.invoke('projects:list'),
  getProject:     (id: string)                      => ipcRenderer.invoke('projects:get', id),
  updateProject:  (id: string, name: string, description: string) => ipcRenderer.invoke('projects:update', id, name, description),
  deleteProject:  (id: string)                      => ipcRenderer.invoke('projects:delete', id),
  assignSession:  (sessionId: string, projectId: string | null) => ipcRenderer.invoke('projects:assign', sessionId, projectId),
  setMeetingType: (sessionId: string, meetingType: string | null, regenerate?: boolean) => ipcRenderer.invoke('sessions:setMeetingType', sessionId, meetingType, regenerate ?? false),
  listUnassignedSessions: () => ipcRenderer.invoke('sessions:listUnassigned'),

  // Notes
  generateNotes:  (sessionId: string, noteType?: string) => ipcRenderer.invoke('notes:generate', sessionId, noteType ?? 'meeting-notes'),
  getNotes:       (sessionId: string)               => ipcRenderer.invoke('notes:list', sessionId),
  updateNote:     (id: string, content: string)     => ipcRenderer.invoke('notes:update', id, content),
  deleteNote:     (id: string)                      => ipcRenderer.invoke('notes:delete', id),
  listNoteTemplates: (includeContent?: boolean)      => ipcRenderer.invoke('notes:templates', includeContent ?? false),
  editNote:       (noteId: string, selection: string, instruction: string) => ipcRenderer.invoke('notes:edit', noteId, selection, instruction),

  // Template CRUD
  createNoteTemplate: (key: string, name: string, description: string, template: string) => ipcRenderer.invoke('templates:create', key, name, description, template),
  updateNoteTemplate: (key: string, name: string, description: string, template: string) => ipcRenderer.invoke('templates:update', key, name, description, template),
  deleteNoteTemplate: (key: string)                 => ipcRenderer.invoke('templates:delete', key),

  // Models
  listModels:     ()                                => ipcRenderer.invoke('models:list'),
  pullModel:      (repo: string)                    => ipcRenderer.invoke('models:pull', repo),
  setModel:       (name: string)                    => ipcRenderer.invoke('models:set', name),

  // Devices & Processes
  listDevices:    ()                                => ipcRenderer.invoke('devices:list'),
  listProcesses:  ()                                => ipcRenderer.invoke('processes:list'),

  // Config
  getConfig:      ()                                => ipcRenderer.invoke('config:get'),
  setConfig:      (config: Record<string, unknown>) => ipcRenderer.invoke('config:set', config),

  // Meeting detection
  dismissMeeting: (pid: number)                     => ipcRenderer.invoke('meeting:dismiss', pid),
  getActiveMeeting: ()                              => ipcRenderer.invoke('meeting:active'),

  // Upload
  uploadPick:     ()                                => ipcRenderer.invoke('upload:pick'),
  uploadTranscribe: (filePath: string, title: string) => ipcRenderer.invoke('upload:transcribe', filePath, title),

  // Audio playback
  getAudioUrl:    (audioPath: string)               => ipcRenderer.invoke('audio:url', audioPath),

  // Daemon management
  getDaemonState: ()                                => ipcRenderer.invoke('daemon:state'),
  getDaemonLogs:  ()                                => ipcRenderer.invoke('daemon:logs'),
  restartDaemon:  ()                                => ipcRenderer.invoke('daemon:restart'),

  // Shell
  openDataDir:    ()                                => ipcRenderer.invoke('shell:openDataDir'),
  openUrl:        (url: string)                     => ipcRenderer.invoke('shell:openUrl', url),

  // Events from main -> renderer
  // We wrap callbacks so we can properly remove them later
  on: (channel: string, cb: (...args: any[]) => void) => {
    const allowed = [
      'recording:started', 'recording:stopped',
      'meeting:detected', 'meeting:ended',
      'transcript:segment', 'model:progress',
      'daemon:state', 'notes:ready',
    ]
    if (allowed.includes(channel)) {
      const wrapper = (_event: any, ...args: any[]) => cb(...args)
      ;(cb as any).__ipcWrapper = wrapper
      ipcRenderer.on(channel, wrapper)
    }
  },
  off: (channel: string, cb: (...args: any[]) => void) => {
    const wrapper = (cb as any).__ipcWrapper ?? cb
    ipcRenderer.removeListener(channel, wrapper)
  },
})
