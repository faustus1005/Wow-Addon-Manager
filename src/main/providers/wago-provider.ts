/**
 * Wago Addons provider  – https://addons.wago.io
 *
 * API base: https://addons.wago.io/api/
 *
 * Key endpoints:
 *   GET /addons                – list/search addons
 *   GET /addons/{id}           – addon detail
 *   GET /addons/{id}/files     – file list
 *
 * Authentication: Bearer token (optional for read, required for higher rate limits)
 */
import axios, { AxiosInstance } from 'axios'
import { AddonSearchResult, InstalledAddon, ReleaseChannel, WowFlavor } from '../../shared/types'
import { BaseProvider, UpdateInfo } from './base-provider'

const WAGO_BASE = 'https://addons.wago.io/api'

/** Wago flavor identifiers */
const FLAVOR_MAP: Record<WowFlavor, string> = {
  retail: 'retail',
  classic: 'cata',
  cataclysm: 'cata',
  classic_era: 'classic',
  burning_crusade: 'tbc',
  wrath: 'wrath',
}

interface WagoAddon {
  id: string
  slug: string
  name: string
  description?: string
  summary?: string
  author?: string
  downloads?: number
  thumbnail?: string
  website_url?: string
  recent_release?: WagoRelease
  tags?: string[]
  game_versions?: string[]
}

interface WagoRelease {
  id: string
  label: string
  stability: string  // stable, beta, alpha
  download_url?: string
  published_at?: string
}

interface WagoSearchResponse {
  data: WagoAddon[]
  total?: number
}

export class WagoProvider extends BaseProvider {
  readonly name = 'wago'
  private client: AxiosInstance
  private apiKey: string

  constructor(apiKey = '') {
    super()
    this.apiKey = apiKey
    this.client = axios.create({
      baseURL: WAGO_BASE,
      timeout: 15000,
      headers: {
        'User-Agent': 'WoWAddonManager/1.0',
        'Accept': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    })
  }

  setApiKey(key: string) {
    this.apiKey = key
    this.client.defaults.headers['Authorization'] = key ? `Bearer ${key}` : undefined
  }

  private mapAddon(wa: WagoAddon): AddonSearchResult {
    const release = wa.recent_release
    return {
      externalId: wa.id,
      provider: 'wago',
      name: wa.name,
      summary: wa.summary ?? wa.description ?? '',
      author: wa.author ?? 'Unknown',
      downloadCount: wa.downloads ?? 0,
      thumbnailUrl: wa.thumbnail,
      latestVersion: release?.label ?? '0',
      websiteUrl: wa.website_url ?? `https://addons.wago.io/addons/${wa.slug}`,
      releaseDate: release?.published_at,
      categories: wa.tags,
      downloadUrl: release?.download_url,
    }
  }

  async search(
    query: string,
    flavor: WowFlavor,
    page = 1,
    pageSize = 20
  ): Promise<AddonSearchResult[]> {
    const gameVersion = FLAVOR_MAP[flavor] ?? 'retail'
    const params: Record<string, string | number> = {
      game_version: gameVersion,
      per_page: pageSize,
      page,
    }
    if (query.trim()) params.query = query.trim()

    const res = await this.client.get<WagoSearchResponse | WagoAddon[]>('/addons', { params })
    const list: WagoAddon[] = Array.isArray(res.data)
      ? res.data
      : ((res.data as WagoSearchResponse).data ?? [])
    return list.map(a => this.mapAddon(a))
  }

  async checkUpdate(addon: InstalledAddon, channel: ReleaseChannel): Promise<UpdateInfo | null> {
    if (!addon.sourceId) return null
    try {
      const res = await this.client.get(`/addons/${addon.sourceId}`)
      // The detail endpoint may return { data: WagoAddon } or a bare WagoAddon.
      const raw = res.data as any
      const wa: WagoAddon = raw?.data ?? raw
      const release = wa.recent_release
      if (!release) return null

      // Channel filter
      const stability = release.stability ?? 'stable'
      if (channel === 'stable' && stability !== 'stable') return null
      if (channel === 'beta' && stability === 'alpha') return null

      return {
        latestVersion: release.label,
        downloadUrl: release.download_url ?? addon.downloadUrl ?? '',
        releaseDate: release.published_at,
      }
    } catch {
      return null
    }
  }

  async getDetails(externalId: string, _flavor: WowFlavor): Promise<Partial<AddonSearchResult>> {
    try {
      const res = await this.client.get(`/addons/${externalId}`)
      const raw = res.data as any
      const wa: WagoAddon = raw?.data ?? raw
      return this.mapAddon(wa)
    } catch {
      return { externalId }
    }
  }
}
