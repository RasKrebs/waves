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

  // Models
  listModels:     ()                                => ipcRenderer.invoke('models:list'),
  pullModel:      (repo: string)                    => ipcRenderer.invoke('models:pull', repo),
  setModel:       (name: string)                    => ipcRenderer.invoke('models:set', name),

  // Devices
  listDevices:    ()                                => ipcRenderer.invoke('devices:list'),

  // Config
  getConfig:      ()                                => ipcRenderer.invoke('config:get'),

  // Upload
  uploadPick:     ()                                => ipcRenderer.invoke('upload:pick'),
  uploadTranscribe: (filePath: string, title: string) => ipcRenderer.invoke('upload:transcribe', filePath, title),

  // Shell
  openDataDir:    ()                                => ipcRenderer.invoke('shell:openDataDir'),
  openUrl:        (url: string)                     => ipcRenderer.invoke('shell:openUrl', url),

  // Events from main -> renderer
  on: (channel: string, cb: (...args: any[]) => void) => {
    const allowed = [
      'recording:started', 'recording:stopped',
      'meeting:detected', 'meeting:ended',
      'transcript:segment', 'model:progress',
    ]
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => cb(...args))
    }
  },
  off: (channel: string, cb: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, cb)
  },
})
