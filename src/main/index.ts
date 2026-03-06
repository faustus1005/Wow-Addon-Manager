import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } from 'electron'
import path from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { getSettings, patchSettings } from './store'
import { findWowInstallations } from './wow-scanner'

// ── App setup ──────────────────────────────────────────────────────────────

const IS_DEV  = process.env.NODE_ENV === 'development' || !app.isPackaged
const ICON    = path.join(__dirname, '../../resources/icon.png')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let updateTimer: ReturnType<typeof setInterval> | null = null

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hiddenInset',
    frame: process.platform !== 'darwin',
    show: false,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (IS_DEV) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
    autoDetectWow()
  })

  mainWindow.on('close', e => {
    const { minimizeToTray } = getSettings()
    if (minimizeToTray && !app.isQuitting) {
      e.preventDefault()
      mainWindow!.hide()
    }
  })
}

// ── System tray ─────────────────────────────────────────────────────────────

function createTray() {
  const icon = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('WoW Addon Manager')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open',   click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Quit',   click: () => { app.isQuitting = true; app.quit() } },
    ])
  )
  tray.on('double-click', () => mainWindow?.show())
}

// ── Auto-detect WoW on first launch ─────────────────────────────────────────

async function autoDetectWow() {
  const settings = getSettings()
  if (settings.wowInstallations.length > 0) return

  const found = findWowInstallations()
  if (found.length) {
    patchSettings({
      wowInstallations: found,
      activeInstallationId: found[0].id,
    })
    mainWindow?.webContents.send('wow:detected', found)
  }
}

// ── Background update check ──────────────────────────────────────────────────

function scheduleUpdateCheck() {
  if (updateTimer) clearInterval(updateTimer)
  const { autoCheckUpdates, autoCheckInterval } = getSettings()
  if (!autoCheckUpdates) return

  const ms = (autoCheckInterval ?? 60) * 60 * 1000
  updateTimer = setInterval(() => {
    const s = getSettings()
    if (!s.activeInstallationId) return
    mainWindow?.webContents.send('addon:trigger-update-check', s.activeInstallationId)
  }, ms)
}

ipcMain.on('settings:updated', () => scheduleUpdateCheck())

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow()
  createTray()
  registerIpcHandlers(mainWindow!)
  scheduleUpdateCheck()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
})

// Extend Electron's app type to carry our flag
declare module 'electron' {
  interface App { isQuitting?: boolean }
}
