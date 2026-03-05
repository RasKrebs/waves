import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
  screen,
} from 'electron'
import path from 'path'
import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import { DaemonClient } from './daemon'
import { MeetingDetector } from './meeting-detector'

const isDev = process.env.NODE_ENV === 'development'

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let bannerWindow: BrowserWindow | null = null
let daemon: ChildProcess | null = null
let daemonClient: DaemonClient
let meetingDetector: MeetingDetector

// -- App bootstrap --

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock.hide()

  await startDaemon()
  daemonClient = new DaemonClient()

  createTray()
  createMainWindow()
  setupMeetingDetector()
  setupIpcHandlers()
})

app.on('window-all-closed', () => {
  // prevent default quit - app lives in tray
})

app.on('before-quit', () => {
  meetingDetector?.stop()
  daemon?.kill()
})

// -- Daemon lifecycle --

async function startDaemon() {
  const daemonBin = isDev
    ? path.join(__dirname, '../../build/wavesd')
    : path.join(process.resourcesPath, 'wavesd')

  if (!fs.existsSync(daemonBin)) {
    console.warn('wavesd binary not found at', daemonBin)
    console.warn('Run `make daemon` from the project root first.')
    return
  }

  daemon = spawn(daemonBin, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  daemon.stdout?.on('data', (d) => console.log('[wavesd]', d.toString().trim()))
  daemon.stderr?.on('data', (d) => console.error('[wavesd]', d.toString().trim()))

  daemon.on('exit', (code) => {
    console.log(`[wavesd] exited with code ${code}`)
    setTimeout(() => {
      if (!app.isQuitting) startDaemon()
    }, 2000)
  })

  await waitForDaemon(5000)
}

async function waitForDaemon(timeoutMs: number) {
  const sock = daemonSocketPath()
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(sock)) return
    await sleep(200)
  }
}

function daemonSocketPath(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Waves', 'daemon.sock')
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
  const iconPath = path.join(__dirname, '../../assets', iconName)
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  }
  return nativeImage.createEmpty()
}

function updateTrayMenu(isRecording: boolean) {
  const menu = Menu.buildFromTemplate([
    { label: isRecording ? '● Recording...' : 'Waves', enabled: false },
    { type: 'separator' },
    {
      label: 'Show Window',
      accelerator: 'CmdOrCtrl+M',
      click: () => toggleMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Start Recording',
      accelerator: 'CmdOrCtrl+R',
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
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        app.isQuitting = true
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
    backgroundColor: '#0000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
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

// -- Meeting banner --

function showMeetingBanner(appName: string) {
  if (bannerWindow) return

  const { width } = screen.getPrimaryDisplay().workAreaSize

  bannerWindow = new BrowserWindow({
    width: 380,
    height: 80,
    x: Math.round(width / 2 - 190),
    y: 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  const bannerUrl = isDev
    ? `http://localhost:5173/banner.html?app=${encodeURIComponent(appName)}`
    : `file://${path.join(__dirname, '../dist/banner.html')}?app=${encodeURIComponent(appName)}`

  bannerWindow.loadURL(bannerUrl)
  bannerWindow.setAlwaysOnTop(true, 'screen-saver')

  setTimeout(() => dismissBanner(), 12000)
}

function dismissBanner() {
  bannerWindow?.close()
  bannerWindow = null
}

// -- Meeting detector --

function setupMeetingDetector() {
  meetingDetector = new MeetingDetector(
    (appName) => {
      showMeetingBanner(appName)
      mainWindow?.webContents.send('meeting:detected', { app: appName })
    },
    () => {
      dismissBanner()
      mainWindow?.webContents.send('meeting:ended')
    }
  )
  meetingDetector.start()
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

  ipcMain.handle('banner:record', () => {
    dismissBanner()
    daemonClient.startRecording('').then(() => {
      updateTrayMenu(true)
      mainWindow?.webContents.send('recording:started')
      mainWindow?.show()
    })
  })
  ipcMain.handle('banner:dismiss', () => dismissBanner())

  ipcMain.handle('shell:openDataDir', () => {
    shell.openPath(path.join(os.homedir(), 'Library', 'Application Support', 'Waves'))
  })
  ipcMain.handle('shell:openUrl', (_, url: string) => shell.openExternal(url))
}

// -- Utils --

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

app.isQuitting = false
