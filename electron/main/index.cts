import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
  dialog,
} from 'electron'
import path from 'path'
import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import { DaemonClient } from './daemon.cjs'

const isDev = !app.isPackaged

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let daemon: ChildProcess | null = null
let daemonClient: DaemonClient
let isQuitting = false

// -- App bootstrap --

app.whenReady().then(async () => {
  await startDaemon()
  daemonClient = new DaemonClient()

  createTray()
  createMainWindow()
  mainWindow?.show()
  setupIpcHandlers()
})

app.on('window-all-closed', () => {
  // keep running for tray + daemon
})

app.on('before-quit', () => {
  isQuitting = true
  daemon?.kill()
})

// -- Daemon lifecycle --

function findUv(): string {
  // Common uv locations on macOS
  const candidates = [
    path.join(os.homedir(), '.local/bin/uv'),
    '/opt/homebrew/bin/uv',
    '/usr/local/bin/uv',
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return 'uv'
}

async function startDaemon() {
  // Python backend via uv
  const backendDir = isDev
    ? path.join(__dirname, '../../../backend')
    : path.join(process.resourcesPath!, 'backend')

  const uvBin = findUv()

  if (!fs.existsSync(backendDir)) {
    console.warn('[waves] backend directory not found at', backendDir)
    return
  }

  daemon = spawn(uvBin, ['run', 'python', '-m', 'waves', '-v'], {
    cwd: backendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })

  daemon.stdout?.on('data', (d: Buffer) => console.log('[waves-py]', d.toString().trim()))
  daemon.stderr?.on('data', (d: Buffer) => console.error('[waves-py]', d.toString().trim()))

  daemon.on('exit', (code: number | null) => {
    console.log(`[waves-py] exited with code ${code}`)
    if (!isQuitting) {
      setTimeout(() => startDaemon(), 2000)
    }
  })

  await waitForDaemon(5000)
}

async function waitForDaemon(timeoutMs: number) {
  const sock = path.join(os.homedir(), 'Library', 'Application Support', 'Waves', 'daemon.sock')
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(sock)) return
    await new Promise((r) => setTimeout(r, 200))
  }
}

// -- Tray --

function createTray() {
  const icon = buildTrayIcon(false)
  tray = new Tray(icon)
  tray.setToolTip('Waves')
  updateTrayMenu(false)
  tray.on('click', () => toggleMainWindow())
}

function buildTrayIcon(recording: boolean): Electron.NativeImage {
  const iconName = recording ? 'tray-recording.png' : 'tray-idle.png'
  const iconPath = isDev
    ? path.join(__dirname, '../../assets', iconName)
    : path.join(process.resourcesPath!, 'assets', iconName)
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    if (!recording) img.setTemplateImage(true)
    return img
  }
  return nativeImage.createEmpty()
}

function updateTrayMenu(isRecording: boolean) {
  const menu = Menu.buildFromTemplate([
    { label: isRecording ? '● Recording...' : 'Waves', enabled: false },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => toggleMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Start Recording',
      enabled: !isRecording,
      click: () => {
        daemonClient.startRecording('').then(() => {
          mainWindow?.webContents.send('recording:started')
          updateTrayMenu(true)
        })
      },
    },
    {
      label: 'Stop Recording',
      enabled: isRecording,
      click: () => {
        daemonClient.stopRecording().then(() => {
          mainWindow?.webContents.send('recording:stopped')
          updateTrayMenu(false)
        })
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray?.setContextMenu(menu)
}

// -- Main window --

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 500,
    show: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#ffffff00',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

function toggleMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isVisible()) {
    mainWindow.hide()
  } else {
    mainWindow.show()
    app.focus({ steal: true })
  }
}

// -- IPC handlers --

function setupIpcHandlers() {
  ipcMain.handle('daemon:status', () => daemonClient.getStatus())

  ipcMain.handle('recording:start', (_, title: string) =>
    daemonClient.startRecording(title).then((res) => {
      updateTrayMenu(true)
      mainWindow?.webContents.send('recording:started', res)
      return res
    })
  )

  ipcMain.handle('recording:stop', () =>
    daemonClient.stopRecording().then((res) => {
      updateTrayMenu(false)
      mainWindow?.webContents.send('recording:stopped', res)
      return res
    })
  )

  ipcMain.handle('sessions:list', (_, limit: number) => daemonClient.listSessions(limit))
  ipcMain.handle('sessions:get', (_, id: string, summarize: boolean) => daemonClient.getSession(id, summarize))
  ipcMain.handle('sessions:summarize', (_, id: string, workflow: string) => daemonClient.summarize(id, workflow))
  ipcMain.handle('models:list', () => daemonClient.listModels())
  ipcMain.handle('models:pull', (_, repo: string) => daemonClient.pullModel(repo))
  ipcMain.handle('models:set', (_, name: string) => daemonClient.setModel(name))
  ipcMain.handle('devices:list', () => daemonClient.listDevices())
  ipcMain.handle('config:get', () => daemonClient.getConfig())

  ipcMain.handle('upload:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Upload Recording',
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'mp3', 'mp4', 'm4a', 'ogg', 'flac', 'webm'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('upload:transcribe', (_, filePath: string, title: string) =>
    daemonClient.transcribeFile(filePath, title)
  )

  ipcMain.handle('shell:openDataDir', () => {
    shell.openPath(path.join(os.homedir(), 'Library', 'Application Support', 'Waves'))
  })

  ipcMain.handle('shell:openUrl', (_, url: string) => shell.openExternal(url))
}
