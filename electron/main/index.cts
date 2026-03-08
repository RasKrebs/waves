import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
  dialog,
  protocol,
  net,
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

// -- Daemon health tracking --
type DaemonState = 'running' | 'stopped' | 'starting'
let daemonState: DaemonState = 'stopped'
const daemonLogs: string[] = []
const MAX_LOG_LINES = 500

function pushLog(line: string) {
  const ts = new Date().toISOString().slice(11, 19)
  daemonLogs.push(`[${ts}] ${line}`)
  if (daemonLogs.length > MAX_LOG_LINES) daemonLogs.splice(0, daemonLogs.length - MAX_LOG_LINES)
}

function setDaemonState(state: DaemonState) {
  daemonState = state
  pushLog(`State → ${state}`)
  mainWindow?.webContents.send('daemon:state', state)
}

// -- Custom protocol for serving local audio files --
// Register before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'waves-audio', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } },
])

// -- App bootstrap --

app.whenReady().then(async () => {
  // Handle waves-audio:// URLs → local file access for the renderer
  protocol.handle('waves-audio', (request) => {
    const filePath = decodeURIComponent(request.url.replace('waves-audio://file/', '/'))
    const stat = fs.statSync(filePath)
    const fileSize = stat.size
    const rangeHeader = request.headers.get('range')

    if (rangeHeader) {
      // Range request — required for audio seeking/duration
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
      const start = match ? parseInt(match[1], 10) : 0
      const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1
      const chunk = fs.readFileSync(filePath).subarray(start, end + 1)

      return new Response(chunk, {
        status: 206,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
        },
      })
    }

    // Full file request
    const data = fs.readFileSync(filePath)
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
      },
    })
  })
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
  setDaemonState('starting')

  // Python backend via uv
  const backendDir = isDev
    ? path.join(__dirname, '../../../backend')
    : path.join(process.resourcesPath!, 'backend')

  const uvBin = findUv()

  if (!fs.existsSync(backendDir)) {
    const msg = `backend directory not found at ${backendDir}`
    console.warn('[waves]', msg)
    pushLog(msg)
    setDaemonState('stopped')
    return
  }

  daemon = spawn(uvBin, ['run', 'python', '-m', 'waves', '-v'], {
    cwd: backendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })

  daemon.stdout?.on('data', (d: Buffer) => {
    const line = d.toString().trim()
    console.log('[waves-py]', line)
    pushLog(line)
  })
  daemon.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim()
    console.error('[waves-py]', line)
    pushLog(line)
  })

  daemon.on('exit', (code: number | null) => {
    const msg = `exited with code ${code}`
    console.log(`[waves-py] ${msg}`)
    pushLog(msg)
    setDaemonState('stopped')
    if (!isQuitting) {
      setTimeout(() => startDaemon(), 2000)
    }
  })

  await waitForDaemon(5000)
  if (daemonState !== 'stopped') setDaemonState('running')
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
  ipcMain.handle('config:set', (_, config: Record<string, unknown>) => daemonClient.setConfig(config))
  ipcMain.handle('sessions:retranscribe', (_, id: string) => daemonClient.retranscribeSession(id))
  ipcMain.handle('sessions:rename', (_, id: string, title: string) => daemonClient.renameSession(id, title))

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

  ipcMain.handle('audio:url', (_, audioPath: string) => {
    if (!audioPath || !fs.existsSync(audioPath)) return null
    // Return a waves-audio:// URL the renderer can use in <audio src>
    return `waves-audio://file${audioPath}`
  })

  ipcMain.handle('shell:openDataDir', () => {
    shell.openPath(path.join(os.homedir(), 'Library', 'Application Support', 'Waves'))
  })

  ipcMain.handle('shell:openUrl', (_, url: string) => shell.openExternal(url))

  // -- Daemon management --
  ipcMain.handle('daemon:state', () => daemonState)
  ipcMain.handle('daemon:logs', () => [...daemonLogs])
  ipcMain.handle('daemon:restart', async () => {
    pushLog('Manual restart requested')
    daemon?.kill()
    // Wait a tick for cleanup, then start fresh
    await new Promise((r) => setTimeout(r, 500))
    await startDaemon()
    return daemonState
  })
}
