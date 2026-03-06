/**
 * Preload script – exposes a typed API surface (window.api) to the renderer
 * via contextBridge.  The renderer NEVER gets direct access to Node or ipcMain.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  InstalledAddon,
  WowInstallation,
  AddonSearchResult,
  SearchPayload,
  InstallPayload,
  UpdatePayload,
  UninstallPayload,
  DownloadProgress,
} from '../shared/types'

// ─── Typed IPC wrapper ─────────────────────────────────────────────────────

const api = {
  // Settings
  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:get'),
  patchSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:patch', patch),

  // WoW Detection
  findWowInstallations: (): Promise<WowInstallation[]> =>
    ipcRenderer.invoke('wow:find'),
  validateWowPath: (p: string): Promise<{ installations: WowInstallation[]; error?: string }> =>
    ipcRenderer.invoke('wow:validate-path', p),
  browseWowPath: (): Promise<string | null> =>
    ipcRenderer.invoke('wow:browse-path'),

  // Addon Scanning
  scanAddons: (installationId: string): Promise<InstalledAddon[]> =>
    ipcRenderer.invoke('addon:scan', installationId),
  getInstalledAddons: (installationId: string): Promise<InstalledAddon[]> =>
    ipcRenderer.invoke('addon:get-installed', installationId),

  // Searching
  searchAddons: (payload: SearchPayload): Promise<AddonSearchResult[]> =>
    ipcRenderer.invoke('addon:search', payload),
  githubLookup: (ownerRepo: string): Promise<AddonSearchResult | null> =>
    ipcRenderer.invoke('addon:github-lookup', ownerRepo),

  // Install / Update / Uninstall
  installAddon: (payload: InstallPayload): Promise<InstalledAddon> =>
    ipcRenderer.invoke('addon:install', payload),
  updateAddon: (payload: UpdatePayload): Promise<InstalledAddon> =>
    ipcRenderer.invoke('addon:update', payload),
  uninstallAddon: (payload: UninstallPayload): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('addon:uninstall', payload),
  updateAllAddons: (installationId: string): Promise<InstalledAddon[]> =>
    ipcRenderer.invoke('addon:update-all', installationId),

  // Update Checking
  checkUpdates: (installationId: string): Promise<InstalledAddon[]> =>
    ipcRenderer.invoke('addon:check-updates', installationId),

  // Addon flags
  setIgnored: (installationId: string, addonId: string, ignored: boolean): Promise<InstalledAddon> =>
    ipcRenderer.invoke('addon:set-ignored', { installationId, addonId, ignored }),
  setAutoUpdate: (installationId: string, addonId: string, enabled: boolean): Promise<InstalledAddon> =>
    ipcRenderer.invoke('addon:set-auto-update', { installationId, addonId, enabled }),

  // Shell
  openUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:open-url', url),
  openPath: (p: string): Promise<void> =>
    ipcRenderer.invoke('shell:open-path', p),

  // ── Push events from main → renderer ────────────────────────────────────

  onWowDetected: (cb: (installations: WowInstallation[]) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, installations: WowInstallation[]) => cb(installations)
    ipcRenderer.on('wow:detected', handler)
    return () => ipcRenderer.removeListener('wow:detected', handler)
  },

  onDownloadProgress: (cb: (progress: DownloadProgress) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: DownloadProgress) => cb(progress)
    ipcRenderer.on('addon:download-progress', handler)
    return () => ipcRenderer.removeListener('addon:download-progress', handler)
  },

  onTriggerUpdateCheck: (cb: (installationId: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, id: string) => cb(id)
    ipcRenderer.on('addon:trigger-update-check', handler)
    return () => ipcRenderer.removeListener('addon:trigger-update-check', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type WowApi = typeof api
