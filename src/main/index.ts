import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } from 'electron'
import path from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { getSettings, patchSettings } from './store'
import { findWowInstallations } from './wow-scanner'
import { runBackgroundUpdateCheck } from './background-updater'

// ── App setup ──────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === 'development' || !app.isPackaged

/**
 * Runtime icon path.
 * In packaged builds the file is placed in resources/ via extraResources.
 * In dev it lives at the project root resources/ folder.
 */
function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png')
  }
  return path.join(__dirname, '../../resources/icon.png')
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let updateTimer: ReturnType<typeof setInterval> | null = null

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow(startHidden = false) {
  const ICON = getIconPath()
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
    if (!startHidden) {
      mainWindow!.show()
    }
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
  const ICON = getIconPath()
  let trayIcon = nativeImage.createFromPath(ICON)

  // Provide a sensibly-sized tray icon for each platform:
  //   Windows/Linux: 16×16 is the conventional tray size
  //   macOS:         Template images are preferred; 18×18 @ 1x is typical
  if (!trayIcon.isEmpty()) {
    const size = process.platform === 'darwin' ? 18 : 16
    trayIcon = trayIcon.resize({ width: size, height: size })
  } else {
    // Fallback: create a simple coloured square so the tray entry is visible
    trayIcon = nativeImage.createEmpty()
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('WoW Addon Manager')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open',  click: () => { mainWindow?.show(); mainWindow?.focus() } },
      { type: 'separator' },
      { label: 'Check for Updates', click: () => triggerBackgroundCheck() },
      { type: 'separator' },
      { label: 'Quit',  click: () => { app.isQuitting = true; app.quit() } },
    ])
  )
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
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

async function triggerBackgroundCheck() {
  const { autoCheckUpdates } = getSettings()
  if (!autoCheckUpdates) return
  try {
    await runBackgroundUpdateCheck(mainWindow)
  } catch (err) {
    console.error('Background update check error:', err)
  }
}

function scheduleUpdateCheck() {
  if (updateTimer) clearInterval(updateTimer)
  const { autoCheckUpdates, autoCheckInterval } = getSettings()
  if (!autoCheckUpdates) return

  const ms = (autoCheckInterval ?? 60) * 60 * 1000
  updateTimer = setInterval(triggerBackgroundCheck, ms)
}

ipcMain.on('settings:updated', () => {
  scheduleUpdateCheck()
  applyLoginItemSetting()
})

// ── OS login item (launch at startup) ────────────────────────────────────────

function applyLoginItemSetting() {
  // setLoginItemSettings is a no-op on Linux (most desktop environments need
  // a .desktop file in ~/.config/autostart instead), but works on Win/macOS.
  const { launchAtLogin } = getSettings()
  app.setLoginItemSettings({
    openAtLogin: launchAtLogin,
    // On Windows, pass the --autostart flag so we can start minimised
    args: launchAtLogin ? ['--autostart'] : [],
  })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // If launched by the OS at login, start hidden in the tray
  const startHidden = process.argv.includes('--autostart')

  createWindow(startHidden)
  createTray()
  registerIpcHandlers(mainWindow!)
  applyLoginItemSetting()
  scheduleUpdateCheck()

  // Run an initial update check shortly after startup (non-blocking)
  setTimeout(triggerBackgroundCheck, 30_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else { mainWindow?.show(); mainWindow?.focus() }
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
