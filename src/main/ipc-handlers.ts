/**
 * Registers all IPC handlers for the main process.
 * The renderer communicates exclusively through these typed channels.
 */
import { ipcMain, BrowserWindow, shell, dialog } from 'electron'
import fs from 'fs'
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
  LinkAddonPayload,
  GetVersionsPayload,
  PinVersionPayload,
  UnpinVersionPayload,
  SetChannelPayload,
  BrowseCategoriesPayload,
  WowFlavor,
  AddonSearchResult,
  AddonCategory,
  AddonVersionInfo,
  ExportedAddonList,
  ExportedAddon,
  normalizeVersion,
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
    const updated = getSettings()
    syncProvidersWithSettings(updated)
    // Notify index.ts to reschedule timer and re-apply login item settings
    ipcMain.emit('settings:updated')
    return updated
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
    const { query, provider, flavor = 'retail', page = 1, pageSize = 20, categoryId, sortBy } = payload
    const results: AddonSearchResult[] = []

    // If browsing by category, only use CurseForge (only provider with category support)
    const providers = categoryId
      ? ['curseforge'] as const
      : provider
        ? [provider]
        : ['wago', 'curseforge', 'wowinterface'] as const

    const searches = providers.map(async p => {
      try {
        switch (p) {
          case 'wago':        return await wago.search(query, flavor, page, pageSize)
          case 'curseforge':  return await curseforge.search(query, flavor, page, pageSize, categoryId, sortBy)
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

    // If not using server-side sorting, sort by downloads desc
    if (!sortBy || !categoryId) {
      return results.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0))
    }
    return results
  })

  // ── Categories ──────────────────────────────────────────────────────────

  ipcMain.handle('addon:get-categories', async () => {
    return curseforge.getCategories()
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

    if (!addon.downloadUrl) {
      const channel = addon.channelPreference ?? settings.defaultChannel
      let info = null

      wago.setActiveFlavor(installation.flavor)
      switch (addon.provider) {
        case 'wago':         info = await wago.checkUpdate(addon, channel, installation.flavor);         break
        case 'curseforge':   info = await curseforge.checkUpdate(addon, channel, installation.flavor);   break
        case 'wowinterface': info = await wowinterface.checkUpdate(addon, channel, installation.flavor); break
        case 'github':       info = await github.checkUpdate(addon, channel, installation.flavor);       break
      }

      if (!info?.downloadUrl) {
        throw new Error('No download URL available; provider did not return one.')
      }

      addon.downloadUrl = info.downloadUrl
      addon.latestVersion = info.latestVersion
      saveInstalledAddons(installationId, addons)
    }

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

    const allAddons = getInstalledAddons(installationId)
    const checkable = allAddons.filter(
      a => !a.isIgnored && a.provider !== 'unknown'
    )

    // Wago's external API requires a game_version param tied to the WoW flavour.
    wago.setActiveFlavor(installation.flavor)

    for (const addon of checkable) {
      try {
        const channel = addon.channelPreference ?? settings.defaultChannel
        let info = null

        switch (addon.provider) {
          case 'wago':         info = await wago.checkUpdate(addon, channel, installation.flavor);         break
          case 'curseforge':   info = await curseforge.checkUpdate(addon, channel, installation.flavor);   break
          case 'wowinterface': info = await wowinterface.checkUpdate(addon, channel, installation.flavor); break
          case 'github':       info = await github.checkUpdate(addon, channel, installation.flavor);       break
        }

        if (info) {
          const hasUpdate = normalizeVersion(info.latestVersion) !== normalizeVersion(addon.version)
          addon.latestVersion = info.latestVersion
          addon.downloadUrl = info.downloadUrl
          addon.updateAvailable = hasUpdate
        } else {
          addon.updateAvailable = false
        }
      } catch (err) {
        console.error(`Update check failed for ${addon.name}:`, err)
      }
    }

    saveInstalledAddons(installationId, allAddons)
    return allAddons
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

  // ── Manual Provider Correlation ──────────────────────────────────────────

  ipcMain.handle('addon:link-to-provider', (_e, payload: LinkAddonPayload) => {
    const { addonId, installationId, result } = payload
    const addons = getInstalledAddons(installationId)
    const addonIndex = addons.findIndex(a => a.id === addonId)
    if (addonIndex < 0) throw new Error(`Addon not found: ${addonId}`)

    const addon = addons[addonIndex]
    const newId = `${result.provider}:${result.externalId}`

    // Remove any pre-existing entry for the same provider+id to avoid duplicates
    const withoutDupe = addons.filter((a, i) => i === addonIndex || a.id !== newId)
    const target = withoutDupe.find(a => a.id === addonId)!

    target.id = newId
    target.provider = result.provider
    target.sourceId = result.externalId
    target.websiteUrl = result.websiteUrl ?? target.websiteUrl
    target.thumbnailUrl = result.thumbnailUrl ?? target.thumbnailUrl
    target.updateAvailable = false
    target.latestVersion = undefined
    target.downloadUrl = undefined

    saveInstalledAddons(installationId, withoutDupe)
    return target
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

  // ── Version Picker / Pinning ────────────────────────────────────────────

  ipcMain.handle('addon:get-versions', async (_e, payload: GetVersionsPayload) => {
    const { addonId, installationId } = payload
    const addons = getInstalledAddons(installationId)
    const addon = addons.find(a => a.id === addonId)
    if (!addon || !addon.sourceId) return []

    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (installation) wago.setActiveFlavor(installation.flavor)

    const channel = addon.channelPreference ?? settings.defaultChannel
    const flavor = installation?.flavor

    switch (addon.provider) {
      case 'curseforge':   return curseforge.getVersions(addon.sourceId, channel, flavor)
      case 'github':       return github.getVersions(addon.sourceId, channel, flavor)
      case 'wowinterface': return wowinterface.getVersions(addon.sourceId, channel, flavor)
      case 'wago':         return wago.getVersions(addon.sourceId, channel, flavor)
      default:             return []
    }
  })

  ipcMain.handle('addon:pin-version', async (_e, payload: PinVersionPayload) => {
    const { addonId, installationId, version, downloadUrl } = payload
    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (!installation) throw new Error(`Installation not found: ${installationId}`)

    const addons = getInstalledAddons(installationId)
    const addon = addons.find(a => a.id === addonId)
    if (!addon) throw new Error(`Addon not found: ${addonId}`)

    // Install the pinned version
    const result: AddonSearchResult = {
      externalId: addon.sourceId ?? addonId,
      provider: addon.provider,
      name: addon.name,
      summary: addon.notes,
      author: addon.author,
      downloadCount: 0,
      latestVersion: version,
      downloadUrl,
      websiteUrl: addon.websiteUrl,
      thumbnailUrl: addon.thumbnailUrl,
    }
    const installed = await installAddon(result, installation, addon.channelPreference, win)

    // Mark as pinned in the stored addon list
    const updatedAddons = getInstalledAddons(installationId)
    const updatedAddon = updatedAddons.find(a => a.id === addonId)
    if (updatedAddon) {
      updatedAddon.pinnedVersion = version
      updatedAddon.pinnedDownloadUrl = downloadUrl
      updatedAddon.autoUpdate = false
      saveInstalledAddons(installationId, updatedAddons)
      return updatedAddon
    }
    return installed
  })

  ipcMain.handle('addon:unpin-version', (_e, payload: UnpinVersionPayload) => {
    const { addonId, installationId } = payload
    const addons = getInstalledAddons(installationId)
    const addon = addons.find(a => a.id === addonId)
    if (!addon) throw new Error(`Addon not found: ${addonId}`)

    addon.pinnedVersion = undefined
    addon.pinnedDownloadUrl = undefined
    saveInstalledAddons(installationId, addons)
    return addon
  })

  // ── Per-Addon Release Channel ───────────────────────────────────────────

  ipcMain.handle('addon:set-channel', (_e, payload: SetChannelPayload) => {
    const { addonId, installationId, channel } = payload
    const addons = getInstalledAddons(installationId)
    const addon = addons.find(a => a.id === addonId)
    if (!addon) return
    addon.channelPreference = channel
    saveInstalledAddons(installationId, addons)
    return addon
  })

  // ── Export / Import Addon List ─────────────────────────────────────────

  ipcMain.handle('addon:export', async (_e, installationId: string) => {
    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (!installation) throw new Error(`Installation not found: ${installationId}`)

    const addons = getInstalledAddons(installationId)
    const exportData: ExportedAddonList = {
      version: 1,
      exportedAt: new Date().toISOString(),
      installationName: installation.displayName,
      flavor: installation.flavor,
      addons: addons
        .filter(a => a.provider !== 'unknown')
        .map(a => ({
          name: a.name,
          provider: a.provider,
          sourceId: a.sourceId,
          version: a.version,
          channelPreference: a.channelPreference,
          autoUpdate: a.autoUpdate,
          pinnedVersion: a.pinnedVersion,
        })),
    }

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Addon List',
      defaultPath: `wow-addons-${installation.flavor}-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    })

    if (result.canceled || !result.filePath) return null

    fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8')
    return { path: result.filePath, count: exportData.addons.length }
  })

  ipcMain.handle('addon:import', async (_e, installationId: string) => {
    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (!installation) throw new Error(`Installation not found: ${installationId}`)

    const result = await dialog.showOpenDialog(win, {
      title: 'Import Addon List',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile'],
    })

    if (result.canceled || !result.filePaths.length) return null

    const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
    const data = JSON.parse(raw) as ExportedAddonList
    if (!data.version || !Array.isArray(data.addons)) {
      throw new Error('Invalid addon list file format.')
    }

    return data
  })

  // ── Shell helpers ────────────────────────────────────────────────────────

  ipcMain.handle('shell:open-url', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('shell:open-path', (_e, p: string) => shell.openPath(p))

  // ── Window Title ─────────────────────────────────────────────────────────

  ipcMain.handle('window:set-title', (_e, title: string) => {
    win.setTitle(title)
  })

  // ── Update All (convenience) ─────────────────────────────────────────────

  ipcMain.handle('addon:update-all', async (_e, installationId: string) => {
    const settings = getSettings()
    const installation = settings.wowInstallations.find(i => i.id === installationId)
    if (!installation) throw new Error(`Installation not found: ${installationId}`)

    const addons = getInstalledAddons(installationId).filter(
      a => a.updateAvailable && !a.isIgnored && !a.pinnedVersion
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
