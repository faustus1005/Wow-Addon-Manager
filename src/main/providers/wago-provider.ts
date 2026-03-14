/**
 * Wago Addons provider  – https://addons.wago.io
 *
 * External API base: https://addons.wago.io/api/external/
 *
 * Key endpoints:
 *   GET /external/addons/{projectId}?game_version={flavor}
 *       – fetch metadata + latest release info for a single addon
 *
 * Notes:
 *   • An API key (Bearer token) is REQUIRED for all external API calls.
 *   • Wago does NOT expose a public addon search/browse endpoint.
 *     Search always returns an empty list; update-checking works fine.
 *   • The API key can be obtained at https://addons.wago.io/patreon
 */
import axios, { AxiosInstance } from 'axios'
import { AddonSearchResult, AddonVersionInfo, InstalledAddon, ReleaseChannel, WowFlavor } from '../../shared/types'
import { BaseProvider, UpdateInfo } from './base-provider'

const WAGO_BASE = 'https://addons.wago.io/api'

/** Wago game_version strings expected by the external API */
const FLAVOR_MAP: Record<WowFlavor, string> = {
  retail:          'retail',
  classic:         'cata',
  cataclysm:       'cata',
  classic_era:     'classic',
  burning_crusade: 'tbc',
  wrath:           'wrath',
}

/** Actual shape returned by GET /external/addons/{id} */
interface WagoAddon {
  slug: string
  display_name: string
  authors?: string | string[]
  website_url?: string
  thumbnail?: string
  downloads?: number
  tags?: string[]
  /** Keyed by channel name: "stable" | "beta" | "alpha" */
  recent_release: Record<string, WagoRelease>
}

interface WagoRelease {
  label: string
  created_at: string
  /** Primary download URL (may require auth header) */
  download_link?: string
  /** Fallback download URL */
  link?: string
  supported_patches?: string[]
}

export class WagoProvider extends BaseProvider {
  readonly name = 'wago'
  private client: AxiosInstance
  private apiKey: string
  /** Active WoW flavour – set before each update-check loop via setActiveFlavor() */
  private activeFlavor: WowFlavor = 'retail'

  constructor(apiKey = '') {
    super()
    this.apiKey = apiKey
    this.client = axios.create({
      baseURL: WAGO_BASE,
      timeout: 15000,
      headers: {
        'User-Agent': 'WoWWarden/1.0',
        'Accept': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    })
  }

  setApiKey(key: string) {
    this.apiKey = key
    this.client.defaults.headers['Authorization'] = key ? `Bearer ${key}` : undefined
  }

  /** Call this before running checkUpdate() so the correct game_version is sent. */
  setActiveFlavor(flavor: WowFlavor) {
    this.activeFlavor = flavor
  }

  hasKey(): boolean { return !!this.apiKey }

  private pickRelease(releases: Record<string, WagoRelease>, channel: ReleaseChannel): WagoRelease | undefined {
    if (channel === 'alpha') return releases.alpha ?? releases.beta ?? releases.stable
    if (channel === 'beta')  return releases.beta  ?? releases.stable
    return releases.stable
  }

  private mapAddon(wa: WagoAddon, channel: ReleaseChannel = 'stable'): AddonSearchResult {
    const release = this.pickRelease(wa.recent_release ?? {}, channel)
    const authors = Array.isArray(wa.authors)
      ? wa.authors.join(', ')
      : (wa.authors ?? 'Unknown')

    return {
      externalId: wa.slug,
      provider: 'wago',
      name: wa.display_name,
      summary: '',
      author: authors,
      downloadCount: wa.downloads ?? 0,
      thumbnailUrl: wa.thumbnail,
      latestVersion: release?.label ?? '0',
      websiteUrl: wa.website_url ?? `https://addons.wago.io/addons/${wa.slug}`,
      releaseDate: release?.created_at,
      categories: wa.tags,
      downloadUrl: release?.download_link ?? release?.link,
    }
  }

  /**
   * Wago does not provide a public addon search/browse API.
   * Always returns an empty list.
   */
  async search(
    _query: string,
    _flavor: WowFlavor,
    _page?: number,
    _pageSize?: number,
  ): Promise<AddonSearchResult[]> {
    return []
  }

  async checkUpdate(addon: InstalledAddon, channel: ReleaseChannel, _flavor?: WowFlavor): Promise<UpdateInfo | null> {
    if (!addon.sourceId || !this.apiKey) return null
    try {
      const gameVersion = FLAVOR_MAP[this.activeFlavor] ?? 'retail'
      const res = await this.client.get<WagoAddon>(
        `/external/addons/${addon.sourceId}`,
        { params: { game_version: gameVersion } },
      )
      const releases = res.data.recent_release ?? {}
      const release = this.pickRelease(releases, channel)
      if (!release) return null

      return {
        latestVersion: release.label,
        downloadUrl: release.download_link ?? release.link ?? '',
        releaseDate: release.created_at,
      }
    } catch {
      return null
    }
  }

  async getVersions(sourceId: string, channel: ReleaseChannel): Promise<AddonVersionInfo[]> {
    // Wago only provides latest per channel, not a full version history
    if (!sourceId || !this.apiKey) return []
    try {
      const gameVersion = FLAVOR_MAP[this.activeFlavor] ?? 'retail'
      const res = await this.client.get<WagoAddon>(
        `/external/addons/${sourceId}`,
        { params: { game_version: gameVersion } },
      )
      const releases = res.data.recent_release ?? {}
      const versions: AddonVersionInfo[] = []
      for (const [ch, release] of Object.entries(releases)) {
        if (!release) continue
        const url = release.download_link ?? release.link
        if (!url) continue
        versions.push({
          version: release.label,
          displayName: `${release.label} (${ch})`,
          downloadUrl: url,
          releaseDate: release.created_at,
          releaseType: ch as ReleaseChannel,
        })
      }
      return versions
    } catch {
      return []
    }
  }

  async getDetails(externalId: string, flavor: WowFlavor): Promise<Partial<AddonSearchResult>> {
    if (!this.apiKey) return { externalId }
    try {
      const gameVersion = FLAVOR_MAP[flavor] ?? 'retail'
      const res = await this.client.get<WagoAddon>(
        `/external/addons/${externalId}`,
        { params: { game_version: gameVersion } },
      )
      return this.mapAddon(res.data)
    } catch {
      return { externalId }
    }
  }
}
