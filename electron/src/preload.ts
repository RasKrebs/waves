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

  // Banner actions
  bannerRecord:   ()                                => ipcRenderer.invoke('banner:record'),
  bannerDismiss:  ()                                => ipcRenderer.invoke('banner:dismiss'),

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

export {}
declare global {
  interface Window {
    waves: {
      getStatus(): Promise<any>
      startRecording(title: string): Promise<any>
      stopRecording(): Promise<any>
      listSessions(limit?: number): Promise<any>
      getSession(id: string, summarize?: boolean): Promise<any>
      summarize(id: string, workflow?: string): Promise<any>
      listModels(): Promise<any>
      pullModel(repo: string): Promise<any>
      setModel(name: string): Promise<any>
      listDevices(): Promise<any>
      getConfig(): Promise<any>
      bannerRecord(): Promise<void>
      bannerDismiss(): Promise<void>
      openDataDir(): Promise<void>
      openUrl(url: string): Promise<void>
      on(channel: string, cb: (...args: any[]) => void): void
      off(channel: string, cb: (...args: any[]) => void): void
    }
  }
}
