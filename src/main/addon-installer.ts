/**
 * Downloads and installs (or updates) an addon ZIP into the WoW AddOns directory.
 * Emits progress events via the provided callback.
 */
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { pipeline } from 'stream/promises'
import AdmZip from 'adm-zip'
import { InstalledAddon, WowInstallation, AddonSearchResult, ReleaseChannel } from '../shared/types'
import { upsertAddon, removeAddon, getInstalledAddons } from './store'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'

export type ProgressCallback = (percent: number, bytesDownloaded: number, totalBytes: number) => void

const TMP_DIR = path.join(process.env.TEMP ?? '/tmp', 'wow-addon-manager')

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
}

/** Follow redirects and download a URL to a temp file. Returns the temp file path. */
async function downloadFile(
  url: string,
  onProgress?: ProgressCallback,
  headers?: Record<string, string>
): Promise<string> {
  ensureTmpDir()
  const tmpFile = path.join(TMP_DIR, `${randomUUID()}.zip`)

  return new Promise((resolve, reject) => {
    const makeRequest = (reqUrl: string, redirectCount = 0) => {
      if (redirectCount > 10) { reject(new Error('Too many redirects')); return }

      const protocol = reqUrl.startsWith('https') ? https : http
      const opts = { headers: { 'User-Agent': 'WoWAddonManager/1.0', ...headers } }

      protocol.get(reqUrl, opts, res => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          makeRequest(res.headers.location, redirectCount + 1)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} downloading ${reqUrl}`))
          return
        }

        const total = parseInt(res.headers['content-length'] ?? '0', 10)
        let downloaded = 0
        const out = fs.createWriteStream(tmpFile)

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          if (onProgress && total > 0) {
            onProgress(Math.round((downloaded / total) * 100), downloaded, total)
          }
        })

        pipeline(res, out)
          .then(() => resolve(tmpFile))
          .catch(reject)
      }).on('error', reject)
    }

    makeRequest(url)
  })
}

/** Extract a ZIP archive into the addons directory. Returns list of extracted top-level dirs. */
function extractZip(zipPath: string, addonsPath: string): string[] {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()

  // Collect top-level directory names inside the ZIP
  const topLevelDirs = new Set<string>()
  for (const entry of entries) {
    const parts = entry.entryName.replace(/\\/g, '/').split('/')
    if (parts[0]) topLevelDirs.add(parts[0])
  }

  // Remove existing directories before extracting (for clean update)
  for (const dir of topLevelDirs) {
    const target = path.join(addonsPath, dir)
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true })
    }
  }

  zip.extractAllTo(addonsPath, true)

  return Array.from(topLevelDirs)
}

/** Clean up a temp file */
function cleanTmp(filePath: string) {
  try { fs.unlinkSync(filePath) } catch { /* ignore */ }
}

export async function installAddon(
  searchResult: AddonSearchResult,
  installation: WowInstallation,
  channel: ReleaseChannel = 'stable',
  win?: BrowserWindow,
  onProgress?: ProgressCallback
): Promise<InstalledAddon> {
  const { addonsPath, id: installationId } = installation

  if (!searchResult.downloadUrl) {
    throw new Error('No download URL available for this addon.')
  }

  const progressCb: ProgressCallback = (pct, bytes, total) => {
    if (win) {
      win.webContents.send('addon:download-progress', {
        addonId: searchResult.externalId,
        percent: pct,
        bytesDownloaded: bytes,
        totalBytes: total,
      })
    }
    onProgress?.(pct, bytes, total)
  }

  const tmpZip = await downloadFile(searchResult.downloadUrl, progressCb)
  try {
    const extractedDirs = extractZip(tmpZip, addonsPath)

    const now = Date.now()
    const existing = getInstalledAddons(installationId).find(
      a => a.sourceId === searchResult.externalId && a.provider === searchResult.provider
    )

    const addon: InstalledAddon = {
      id: `${searchResult.provider}:${searchResult.externalId}`,
      name: searchResult.name,
      version: searchResult.latestVersion,
      author: searchResult.author,
      notes: searchResult.summary,
      directories: extractedDirs,
      tocPath: path.join(addonsPath, extractedDirs[0], `${extractedDirs[0]}.toc`),
      provider: searchResult.provider,
      sourceId: searchResult.externalId,
      wowInstallationId: installationId,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      latestVersion: searchResult.latestVersion,
      downloadUrl: searchResult.downloadUrl,
      updateAvailable: false,
      channelPreference: channel,
      websiteUrl: searchResult.websiteUrl,
      thumbnailUrl: searchResult.thumbnailUrl,
      autoUpdate: existing?.autoUpdate ?? false,
      isIgnored: false,
    }

    upsertAddon(installationId, addon)
    return addon
  } finally {
    cleanTmp(tmpZip)
  }
}

export function uninstallAddon(addon: InstalledAddon, installation: WowInstallation): void {
  const { addonsPath } = installation
  for (const dir of addon.directories) {
    const target = path.join(addonsPath, dir)
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true })
    }
  }
  removeAddon(installation.id, addon.id)
}
