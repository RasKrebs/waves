import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('waves', {
  // Daemon
  getStatus:      ()                                => ipcRenderer.invoke('daemon:status'),
  startRecording: (title: string)                   => ipcRenderer.invoke('recording:start', title),
  stopRecording:  ()                                => ipcRenderer.invoke('recording:stop'),

  // Sessions
  listSessions:   (limit?: number)                  => ipcRenderer.invoke('sessions:list', limit ?? 30),
  getSession:     (id: string, summarize?: boolean)  => ipcRenderer.invoke('sessions:get', id, summarize ?? false),
  summarize:      (id: string, workflow?: string)    => ipcRenderer.invoke('sessions:summarize', id, workflow ?? 'default'),
  retranscribe:   (id: string)                     => ipcRenderer.invoke('sessions:retranscribe', id),
  renameSession:  (id: string, title: string)      => ipcRenderer.invoke('sessions:rename', id, title),

  // Models
  listModels:     ()                                => ipcRenderer.invoke('models:list'),
  pullModel:      (repo: string)                    => ipcRenderer.invoke('models:pull', repo),
  setModel:       (name: string)                    => ipcRenderer.invoke('models:set', name),

  // Devices
  listDevices:    ()                                => ipcRenderer.invoke('devices:list'),

  // Config
  getConfig:      ()                                => ipcRenderer.invoke('config:get'),
  setConfig:      (config: Record<string, unknown>) => ipcRenderer.invoke('config:set', config),

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
      'daemon:state',
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
