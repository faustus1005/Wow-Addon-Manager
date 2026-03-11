/**
 * Background update checker and auto-installer.
 * Runs entirely in the main process so it works whether or not the window is visible.
 */
import { BrowserWindow, Notification } from 'electron'
import { getSettings, getInstalledAddons, saveInstalledAddons } from './store'
import { installAddon } from './addon-installer'
import { WagoProvider }          from './providers/wago-provider'
import { CurseForgeProvider }    from './providers/curseforge-provider'
import { WoWInterfaceProvider }  from './providers/wowinterface-provider'
import { GitHubProvider }        from './providers/github-provider'
import { AddonSearchResult, normalizeVersion } from '../shared/types'

const wago        = new WagoProvider()
const curseforge  = new CurseForgeProvider()
const wowinterface = new WoWInterfaceProvider()
const github      = new GitHubProvider()

function syncProviderKeys() {
  const { wagoApiKey, curseForgApiKey } = getSettings()
  if (wagoApiKey)       wago.setApiKey(wagoApiKey)
  if (curseForgApiKey)  curseforge.setApiKey(curseForgApiKey)
}

/**
 * Check for updates across all WoW installations.
 * Addons with autoUpdate=true are installed automatically.
 * A system notification is shown if any updates were found or applied.
 */
export async function runBackgroundUpdateCheck(win: BrowserWindow | null): Promise<void> {
  syncProviderKeys()
  const settings = getSettings()

  let totalAutoUpdated = 0
  let totalPendingUpdates = 0

  for (const installation of settings.wowInstallations) {
    wago.setActiveFlavor(installation.flavor)

    const allAddons = getInstalledAddons(installation.id)
    const checkable = allAddons.filter(a => !a.isIgnored && a.provider !== 'unknown')

    for (const addon of checkable) {
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
          const hasUpdate = normalizeVersion(info.latestVersion) !== normalizeVersion(addon.version)
          addon.latestVersion = info.latestVersion
          addon.downloadUrl   = info.downloadUrl
          addon.updateAvailable = hasUpdate

          if (hasUpdate && addon.autoUpdate && !addon.pinnedVersion && info.downloadUrl) {
            const result: AddonSearchResult = {
              externalId:    addon.sourceId ?? addon.id,
              provider:      addon.provider,
              name:          addon.name,
              summary:       addon.notes,
              author:        addon.author,
              downloadCount: 0,
              latestVersion: info.latestVersion,
              downloadUrl:   info.downloadUrl,
              websiteUrl:    addon.websiteUrl,
              thumbnailUrl:  addon.thumbnailUrl,
            }
            await installAddon(result, installation, addon.channelPreference, win ?? undefined)
            addon.updateAvailable = false
            addon.version = info.latestVersion
            totalAutoUpdated++
          } else if (hasUpdate) {
            totalPendingUpdates++
          }
        } else {
          addon.updateAvailable = false
        }
      } catch (err) {
        console.error(`Background update check failed for ${addon.name}:`, err)
      }
    }

    saveInstalledAddons(installation.id, allAddons)

    // Notify renderer (if open) to refresh its addon list
    win?.webContents.send('addon:background-updated', installation.id)
  }

  // System tray notification
  if ((totalAutoUpdated > 0 || totalPendingUpdates > 0) && Notification.isSupported()) {
    const parts: string[] = []
    if (totalAutoUpdated > 0)    parts.push(`${totalAutoUpdated} addon${totalAutoUpdated > 1 ? 's' : ''} auto-updated`)
    if (totalPendingUpdates > 0) parts.push(`${totalPendingUpdates} update${totalPendingUpdates > 1 ? 's' : ''} available`)
    new Notification({
      title: 'WoW Warden',
      body:  parts.join(' · '),
    }).show()
  }
}
