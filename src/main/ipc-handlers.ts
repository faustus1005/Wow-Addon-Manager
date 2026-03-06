/**
 * Registers all IPC handlers for the main process.
 * The renderer communicates exclusively through these typed channels.
 */
import { ipcMain, BrowserWindow, shell, dialog } from 'electron'
import { findWowInstallations, validateWowPath } from './wow-scanner'
import { scanAddons } from './addon-scanner'
import { installAddon, uninstallAddon } from './addon-installer'
import { getSettings, patchSettings, getInstalledAddons, saveInstalledAddons } from './store'
import { WagoProvider }          from './providers/wago-provider'
import { CurseForgeProvider }    from './providers/curseforge-provider'
import { WoWInterfaceProvider }  from './providers/wowinterface-provider'
import { GitHubProvider }        from './providers/github-provider'
import {
  AppSettings,
  InstalledAddon,
  SearchPayload,
  InstallPayload,
  UpdatePayload,
  UninstallPayload,
  WowFlavor,
  AddonSearchResult,
} from '../shared/types'

// ─── Provider Singletons ───────────────────────────────────────────────────

const wago       = new WagoProvider()
const curseforge = new CurseForgeProvider()
const wowinterface = new WoWInterfaceProvider()
const github     = new GitHubProvider()

function syncProvidersWithSettings(settings: AppSettings) {
  if (settings.wagoApiKey)       wago.setApiKey(settings.wagoApiKey)
  if (settings.curseForgApiKey)  curseforge.setApiKey(settings.curseForgApiKey)
}

export function registerIpcHandlers(win: BrowserWindow) {
  // Sync providers with stored settings immediately
  syncProvidersWithSettings(getSettings())

  // ── Settings ────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:patch', (_e, patch: Partial<AppSettings>) => {
    patchSettings(patch)
    syncProvidersWithSettings(getSettings())
    return getSettings()
  })

  // ── WoW Detection ───────────────────────────────────────────────────────

  ipcMain.handle('wow:find', () => {
    return findWowInstallations()
  })

  ipcMain.handle('wow:validate-path', (_e, suppliedPath: string) => {
    return validateWowPath(suppliedPath)
  })

  ipcMain.handle('wow:browse-path', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select World of Warcraft Folder',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  // ── Addon Scanning ───────────────────────────────────────────────────────

  ipcMain.handle('addon:scan', (_e, installationId: string) => {
    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (!installation) throw new Error(`Installation not found: ${installationId}`)

    const addons = scanAddons(installation)
    saveInstalledAddons(installationId, addons)
    return addons
  })

  ipcMain.handle('addon:get-installed', (_e, installationId: string) => {
    return getInstalledAddons(installationId)
  })

  // ── Searching ────────────────────────────────────────────────────────────

  ipcMain.handle('addon:search', async (_e, payload: SearchPayload) => {
    const { query, provider, flavor = 'retail', page = 1, pageSize = 20 } = payload
    const results: AddonSearchResult[] = []

    const providers = provider
      ? [provider]
      : ['wago', 'curseforge', 'wowinterface'] as const

    const searches = providers.map(async p => {
      try {
        switch (p) {
          case 'wago':        return await wago.search(query, flavor, page, pageSize)
          case 'curseforge':  return await curseforge.search(query, flavor, page, pageSize)
          case 'wowinterface':return await wowinterface.search(query, flavor, page, pageSize)
        }
      } catch (err) {
        console.error(`Search failed on ${p}:`, err)
        return []
      }
      return []
    })

    const batches = await Promise.allSettled(searches)
    for (const batch of batches) {
      if (batch.status === 'fulfilled' && batch.value) results.push(...batch.value)
    }

    // Sort by downloads desc
    return results.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0))
  })

  // GitHub repo lookup (direct URL / "owner/repo")
  ipcMain.handle('addon:github-lookup', async (_e, ownerRepo: string) => {
    return github.getRepoInfo(ownerRepo)
  })

  // ── Install ──────────────────────────────────────────────────────────────

  ipcMain.handle('addon:install', async (_e, payload: InstallPayload) => {
    const { result, installationId, channel } = payload
    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (!installation) throw new Error(`Installation not found: ${installationId}`)

    return installAddon(result, installation, channel ?? settings.defaultChannel, win)
  })

  // ── Update (single addon) ────────────────────────────────────────────────

  ipcMain.handle('addon:update', async (_e, payload: UpdatePayload) => {
    const { addonId, installationId } = payload
    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (!installation) throw new Error(`Installation not found: ${installationId}`)

    const addons = getInstalledAddons(installationId)
    const addon = addons.find(a => a.id === addonId)
    if (!addon) throw new Error(`Addon not found: ${addonId}`)

    if (!addon.downloadUrl) throw new Error('No download URL; run update check first.')

    const result: AddonSearchResult = {
      externalId: addon.sourceId ?? addonId,
      provider: addon.provider,
      name: addon.name,
      summary: addon.notes,
      author: addon.author,
      downloadCount: 0,
      latestVersion: addon.latestVersion ?? addon.version,
      downloadUrl: addon.downloadUrl,
      websiteUrl: addon.websiteUrl,
      thumbnailUrl: addon.thumbnailUrl,
    }
    return installAddon(result, installation, addon.channelPreference, win)
  })

  // ── Check for Updates ─────────────────────────────────────────────────────

  ipcMain.handle('addon:check-updates', async (_e, installationId: string) => {
    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (!installation) throw new Error(`Installation not found: ${installationId}`)

    const addons = getInstalledAddons(installationId).filter(
      a => !a.isIgnored && a.provider !== 'unknown'
    )

    const results: InstalledAddon[] = []

    for (const addon of addons) {
      try {
        const channel = addon.channelPreference ?? settings.defaultChannel
        let info = null

        switch (addon.provider) {
          case 'wago':         info = await wago.checkUpdate(addon, channel);         break
          case 'curseforge':   info = await curseforge.checkUpdate(addon, channel);   break
          case 'wowinterface': info = await wowinterface.checkUpdate(addon, channel); break
          case 'github':       info = await github.checkUpdate(addon, channel);       break
        }

        if (info) {
          const hasUpdate = info.latestVersion !== addon.version
          addon.latestVersion = info.latestVersion
          addon.downloadUrl   = info.downloadUrl
          addon.updateAvailable = hasUpdate
        }
      } catch (err) {
        console.error(`Update check failed for ${addon.name}:`, err)
      }

      results.push(addon)
    }

    saveInstalledAddons(installationId, results)
    return results
  })

  // ── Uninstall ────────────────────────────────────────────────────────────

  ipcMain.handle('addon:uninstall', (_e, payload: UninstallPayload) => {
    const { addonId, installationId } = payload
    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (!installation) throw new Error(`Installation not found: ${installationId}`)

    const addons = getInstalledAddons(installationId)
    const addon = addons.find(a => a.id === addonId)
    if (!addon) throw new Error(`Addon not found: ${addonId}`)

    uninstallAddon(addon, installation)
    return { success: true }
  })

  // ── Ignore / Auto-Update Toggle ──────────────────────────────────────────

  ipcMain.handle('addon:set-ignored', (_e, { installationId, addonId, ignored }: {
    installationId: string; addonId: string; ignored: boolean
  }) => {
    const addons = getInstalledAddons(installationId)
    const addon = addons.find(a => a.id === addonId)
    if (!addon) return
    addon.isIgnored = ignored
    saveInstalledAddons(installationId, addons)
    return addon
  })

  ipcMain.handle('addon:set-auto-update', (_e, { installationId, addonId, enabled }: {
    installationId: string; addonId: string; enabled: boolean
  }) => {
    const addons = getInstalledAddons(installationId)
    const addon = addons.find(a => a.id === addonId)
    if (!addon) return
    addon.autoUpdate = enabled
    saveInstalledAddons(installationId, addons)
    return addon
  })

  // ── Shell helpers ────────────────────────────────────────────────────────

  ipcMain.handle('shell:open-url', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('shell:open-path', (_e, p: string) => shell.openPath(p))

  // ── Update All (convenience) ─────────────────────────────────────────────

  ipcMain.handle('addon:update-all', async (_e, installationId: string) => {
    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (!installation) throw new Error(`Installation not found: ${installationId}`)

    const addons = getInstalledAddons(installationId).filter(
      a => a.updateAvailable && !a.isIgnored
    )
    const updated: InstalledAddon[] = []

    for (const addon of addons) {
      try {
        const result: AddonSearchResult = {
          externalId: addon.sourceId ?? addon.id,
          provider: addon.provider,
          name: addon.name,
          summary: addon.notes,
          author: addon.author,
          downloadCount: 0,
          latestVersion: addon.latestVersion ?? addon.version,
          downloadUrl: addon.downloadUrl!,
          websiteUrl: addon.websiteUrl,
          thumbnailUrl: addon.thumbnailUrl,
        }
        const installed = await installAddon(result, installation, addon.channelPreference, win)
        updated.push(installed)
      } catch (err) {
        console.error(`Failed to update ${addon.name}:`, err)
      }
    }

    return updated
  })
}
