/**
 * WoWInterface provider  –  https://www.wowinterface.com
 *
 * Public API: https://api.wowinterface.com/
 *
 * Key endpoints:
 *   GET /userdetails.json             – user info (requires login)
 *   GET /filelist.json                – full file list (very large, cached locally)
 *   GET /filedetails/{id}.json        – single addon details
 *   GET /search/name:{query}.json     – search
 *
 * WoWInterface does NOT require an API key for read-only access.
 */
import axios, { AxiosInstance } from 'axios'
import { AddonSearchResult, InstalledAddon, ReleaseChannel, WowFlavor } from '../../shared/types'
import { BaseProvider, UpdateInfo } from './base-provider'

const WOWI_BASE = 'https://api.wowinterface.com/addons'

interface WowiFile {
  id: string | number
  title: string
  version: string
  description?: string
  author?: string
  downloads?: number
  thumbUrl?: string
  UIVersion?: string
  updated?: string
}

interface WowiDetails extends WowiFile {
  /* same fields as list, plus: */
  categoryid?: string
  categoryPath?: string
  authorname?: string
  pendingUpdate?: string
  UILink?: string
}

export class WoWInterfaceProvider extends BaseProvider {
  readonly name = 'wowinterface'
  private client: AxiosInstance

  constructor() {
    super()
    this.client = axios.create({
      baseURL: WOWI_BASE,
      timeout: 15000,
      headers: {
        'User-Agent': 'WoWAddonManager/1.0',
        Accept: 'application/json',
      },
    })
  }

  private mapFile(f: WowiDetails | WowiFile): AddonSearchResult {
    return {
      externalId: String(f.id),
      provider: 'wowinterface',
      name: f.title,
      summary: f.description ?? '',
      author: (f as WowiDetails).authorname ?? f.author ?? 'Unknown',
      downloadCount: f.downloads ?? 0,
      thumbnailUrl: f.thumbUrl ? `https:${f.thumbUrl}` : undefined,
      websiteUrl: `https://www.wowinterface.com/downloads/info${f.id}`,
      latestVersion: f.version,
      releaseDate: f.updated,
      // WoWInterface serves files at a known URL pattern
      downloadUrl: `https://cdn.wowinterface.com/downloads/file${f.id}/${f.title.replace(/\s/g, '')}.zip`,
    }
  }

  private async fetchSearchResults(query: string): Promise<WowiFile[]> {
    const encoded = encodeURIComponent(query)
    const candidates = [
      `/search/name:${encoded}.json`,
      `/search/${encoded}.json`,
    ]

    for (const endpoint of candidates) {
      try {
        const res = await this.client.get<WowiFile[]>(endpoint)
        if (Array.isArray(res.data)) return res.data
      } catch {
        // Try the next known endpoint variant.
      }
    }

    return []
  }

  async search(
    query: string,
    _flavor: WowFlavor,
    page = 1,
    pageSize = 20
  ): Promise<AddonSearchResult[]> {
    if (!query.trim()) return []
    const all = await this.fetchSearchResults(query)
    const start = (page - 1) * pageSize
    return all.slice(start, start + pageSize).map(f => this.mapFile(f))
  }

  async checkUpdate(addon: InstalledAddon, _channel: ReleaseChannel): Promise<UpdateInfo | null> {
    if (!addon.sourceId) return null
    try {
      const res = await this.client.get<WowiDetails[]>(`/filedetails/${addon.sourceId}.json`)
      const details = Array.isArray(res.data) ? res.data[0] : null
      if (!details) return null

      return {
        latestVersion: details.version,
        downloadUrl: `https://cdn.wowinterface.com/downloads/file${details.id}/${details.title.replace(/\s/g, '')}.zip`,
        releaseDate: details.updated,
      }
    } catch {
      return null
    }
  }

  async getDetails(externalId: string, _flavor: WowFlavor): Promise<Partial<AddonSearchResult>> {
    try {
      const res = await this.client.get<WowiDetails[]>(`/filedetails/${externalId}.json`)
      const d = Array.isArray(res.data) ? res.data[0] : null
      if (!d) return { externalId }
      return this.mapFile(d)
    } catch {
      return { externalId }
    }
  }
}
