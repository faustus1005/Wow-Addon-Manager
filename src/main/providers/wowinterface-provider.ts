/**
 * WoWInterface provider  –  https://www.wowinterface.com
 *
 * Public API: https://api.mmoui.com/v3/
 *
 * Key endpoints:
 *   GET /v3/game/WOW/filelist.json          – full addon list (for search)
 *   GET /v3/game/WOW/filedetails/{id}.json  – single addon details + download URL
 *
 * WoWInterface does NOT require an API key for read-only access.
 */
import axios, { AxiosInstance } from 'axios'
import { AddonSearchResult, InstalledAddon, ReleaseChannel, WowFlavor } from '../../shared/types'
import { BaseProvider, UpdateInfo } from './base-provider'

const WOWI_BASE = 'https://api.mmoui.com/v3/game/WOW'

/** Shape of each entry in /filelist.json */
interface WowiFile {
  UID: string | number
  UIName: string
  UIVersion: string
  UIDate?: number
  UIAuthorName?: string
  UIDownloadTotal?: number
  UIDownloadMonthly?: number
  UIFileInfoURL?: string
  UIIMG_Thumbs?: string | string[]
}

/** Shape of each entry in /filedetails/{id}.json */
interface WowiDetails extends WowiFile {
  UIDownload: string
  UIFileName?: string
  UIHitCount?: number
  UIHitCountMonthly?: number
  UIDescription?: string
  UIChangeLog?: string
  UIFavoriteTotal?: number
  UIPending?: string
  UIMD5?: string
}

export class WoWInterfaceProvider extends BaseProvider {
  readonly name = 'wowinterface'
  private client: AxiosInstance

  // Cache the full file list to avoid re-fetching on every search
  private fileListCache: WowiFile[] | null = null
  private fileListCacheTime = 0
  private readonly FILE_LIST_TTL = 15 * 60 * 1000 // 15 minutes

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

  private getThumbnail(thumbs: string | string[] | undefined): string | undefined {
    if (!thumbs) return undefined
    const url = Array.isArray(thumbs) ? thumbs[0] : thumbs
    if (!url) return undefined
    return url.startsWith('http') ? url : `https:${url}`
  }

  private mapFile(f: WowiFile | WowiDetails): AddonSearchResult {
    const id = String(f.UID)
    const details = f as WowiDetails
    // Use UIDownload from filedetails if available; otherwise construct a
    // redirect URL from the addon ID that the WoWInterface CDN accepts.
    const downloadUrl = details.UIDownload
      ?? `https://cdn.wowinterface.com/downloads/getfile.php?id=${id}`

    return {
      externalId: id,
      provider: 'wowinterface',
      name: f.UIName,
      summary: details.UIDescription ?? '',
      author: f.UIAuthorName ?? 'Unknown',
      downloadCount: details.UIHitCount ?? f.UIDownloadTotal ?? 0,
      thumbnailUrl: this.getThumbnail(f.UIIMG_Thumbs),
      websiteUrl: f.UIFileInfoURL ?? `https://www.wowinterface.com/downloads/info${id}`,
      latestVersion: f.UIVersion,
      releaseDate: f.UIDate ? new Date(f.UIDate).toISOString() : undefined,
      downloadUrl,
    }
  }

  private async getFileList(): Promise<WowiFile[]> {
    const now = Date.now()
    if (this.fileListCache && now - this.fileListCacheTime < this.FILE_LIST_TTL) {
      return this.fileListCache
    }
    try {
      const res = await this.client.get<WowiFile[]>('/filelist.json')
      if (Array.isArray(res.data)) {
        this.fileListCache = res.data
        this.fileListCacheTime = now
        return res.data
      }
    } catch {
      // Return stale cache if available, else empty
    }
    return this.fileListCache ?? []
  }

  async search(
    query: string,
    _flavor: WowFlavor,
    page = 1,
    pageSize = 20
  ): Promise<AddonSearchResult[]> {
    if (!query.trim()) return []
    const list = await this.getFileList()
    const lower = query.toLowerCase()
    const matches = list.filter(f => f.UIName?.toLowerCase().includes(lower))
    const start = (page - 1) * pageSize
    return matches.slice(start, start + pageSize).map(f => this.mapFile(f))
  }

  async checkUpdate(addon: InstalledAddon, _channel: ReleaseChannel): Promise<UpdateInfo | null> {
    if (!addon.sourceId) return null
    try {
      const res = await this.client.get<WowiDetails[]>(`/filedetails/${addon.sourceId}.json`)
      const details = Array.isArray(res.data) ? res.data[0] : null
      if (!details) return null

      return {
        latestVersion: details.UIVersion,
        downloadUrl: details.UIDownload,
        releaseDate: details.UIDate ? new Date(details.UIDate).toISOString() : undefined,
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
