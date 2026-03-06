/**
 * CurseForge provider (API v2)
 * Docs: https://docs.curseforge.com/
 *
 * Requires an API key from https://console.curseforge.com/
 *
 * Key endpoints:
 *   GET  /mods/search          – search mods
 *   GET  /mods/{modId}         – mod detail
 *   GET  /mods/{modId}/files   – file list
 *   GET  /mods/{modId}/files/{fileId}/download-url – presigned download URL
 *
 * WoW game IDs: 1 (retail), 73713 (classic era), 67408 (Wrath), 77522 (Cata)
 */
import axios, { AxiosInstance } from 'axios'
import { AddonSearchResult, InstalledAddon, ReleaseChannel, WowFlavor } from '../../shared/types'
import { BaseProvider, UpdateInfo } from './base-provider'

const CF_BASE = 'https://api.curseforge.com/v1'
const WOW_ADDON_CLASS_ID = 6  // "Addons" category on CurseForge

const GAME_ID_MAP: Record<WowFlavor, number> = {
  retail:        1,
  classic:       77522,   // Cataclysm Classic
  cataclysm:     77522,
  classic_era:   73713,
  burning_crusade: 67408,
  wrath:         67408,
}

// CurseForge release type: 1=release, 2=beta, 3=alpha
const CHANNEL_TYPE: Record<ReleaseChannel, number[]> = {
  stable: [1],
  beta:   [1, 2],
  alpha:  [1, 2, 3],
}

interface CFMod {
  id: number
  name: string
  summary: string
  authors: { name: string }[]
  downloadCount: number
  logo?: { thumbnailUrl: string }
  links?: { websiteUrl: string }
  latestFilesIndexes?: { gameVersion: string; fileId: number; filename: string; releaseType: number }[]
  latestFiles?: CFFile[]
}

interface CFFile {
  id: number
  displayName: string
  fileName: string
  fileDate: string
  downloadUrl: string | null
  releaseType: number  // 1=release, 2=beta, 3=alpha
  gameVersions: string[]
}

interface CFSearchResponse {
  data: CFMod[]
  pagination?: { totalCount: number; resultCount: number; index: number; pageSize: number }
}

export class CurseForgeProvider extends BaseProvider {
  readonly name = 'curseforge'
  private client: AxiosInstance
  private apiKey: string

  constructor(apiKey = '') {
    super()
    this.apiKey = apiKey
    this.client = this.buildClient(apiKey)
  }

  private buildClient(apiKey: string): AxiosInstance {
    return axios.create({
      baseURL: CF_BASE,
      timeout: 15000,
      headers: {
        'User-Agent': 'WoWAddonManager/1.0',
        'Accept': 'application/json',
        'x-api-key': apiKey,
      },
    })
  }

  setApiKey(key: string) {
    this.apiKey = key
    this.client = this.buildClient(key)
  }

  hasKey(): boolean { return !!this.apiKey }

  private mapMod(mod: CFMod, channel: ReleaseChannel = 'stable'): AddonSearchResult {
    const allowedTypes = CHANNEL_TYPE[channel]
    const latestFile = mod.latestFiles
      ?.filter(f => allowedTypes.includes(f.releaseType))
      .sort((a, b) => new Date(b.fileDate).getTime() - new Date(a.fileDate).getTime())[0]

    return {
      externalId: String(mod.id),
      provider: 'curseforge',
      name: mod.name,
      summary: mod.summary,
      author: mod.authors.map(a => a.name).join(', ') || 'Unknown',
      downloadCount: mod.downloadCount,
      thumbnailUrl: mod.logo?.thumbnailUrl,
      websiteUrl: mod.links?.websiteUrl,
      latestVersion: latestFile?.displayName ?? latestFile?.fileName ?? '0',
      downloadUrl: latestFile?.downloadUrl ?? undefined,
      releaseDate: latestFile?.fileDate,
    }
  }

  async search(
    query: string,
    flavor: WowFlavor,
    page = 1,
    pageSize = 20
  ): Promise<AddonSearchResult[]> {
    if (!this.apiKey) return []

    const params = {
      gameId: GAME_ID_MAP[flavor] ?? 1,
      classId: WOW_ADDON_CLASS_ID,
      searchFilter: query.trim() || undefined,
      index: (page - 1) * pageSize,
      pageSize,
      sortField: 2,    // 2 = TotalDownloads
      sortOrder: 'desc',
    }

    const res = await this.client.get<CFSearchResponse>('/mods/search', { params })
    return (res.data.data ?? []).map(m => this.mapMod(m))
  }

  async checkUpdate(addon: InstalledAddon, channel: ReleaseChannel): Promise<UpdateInfo | null> {
    if (!this.apiKey || !addon.sourceId) return null
    try {
      const allowedTypes = CHANNEL_TYPE[channel]
      const res = await this.client.get<{ data: CFFile[] }>(
        `/mods/${addon.sourceId}/files`,
        { params: { pageSize: 10 } }
      )

      const latestFile = res.data.data
        .filter(f => allowedTypes.includes(f.releaseType))
        .sort((a, b) => new Date(b.fileDate).getTime() - new Date(a.fileDate).getTime())[0]

      if (!latestFile) return null

      // Resolve download URL (may be null for some mods)
      let downloadUrl = latestFile.downloadUrl ?? ''
      if (!downloadUrl) {
        try {
          const urlRes = await this.client.get<{ data: string }>(
            `/mods/${addon.sourceId}/files/${latestFile.id}/download-url`
          )
          downloadUrl = urlRes.data.data ?? ''
        } catch { /* ignore */ }
      }

      return {
        latestVersion: latestFile.displayName || latestFile.fileName,
        downloadUrl,
        releaseDate: latestFile.fileDate,
      }
    } catch {
      return null
    }
  }
}
