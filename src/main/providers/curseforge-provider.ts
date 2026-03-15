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
 * WoW game ID: 1 (all flavors). gameVersionTypeId is used for expansion-specific filtering.
 */
import axios, { AxiosInstance } from 'axios'
import { AddonSearchResult, AddonCategory, AddonVersionInfo, InstalledAddon, ReleaseChannel, WowFlavor, BrowseSortField } from '../../shared/types'
import { BaseProvider, UpdateInfo } from './base-provider'

const CF_BASE = 'https://api.curseforge.com/v1'
const WOW_GAME_ID = 1  // All WoW flavors share game ID 1 on CurseForge

// gameVersionTypeId values for each WoW flavour.
// Source: CF2WowGameVersionType enum in the curseforge-v2 library.
const GAME_VERSION_TYPE_MAP: Partial<Record<WowFlavor, number>> = {
  retail:            517,  // CF2WowGameVersionType.Retail
  classic_era:     67408,  // CF2WowGameVersionType.Classic
  burning_crusade: 73246,  // CF2WowGameVersionType.BurningCrusade
  wrath:           73713,  // CF2WowGameVersionType.WOTLK
  classic:         77522,  // CF2WowGameVersionType.Cata  (app's "classic" = Cata Classic)
  cataclysm:       77522,  // CF2WowGameVersionType.Cata
}

// Major interface version prefixes that belong to non-Retail Classic flavors.
// Used as a client-side safety filter when the API's gameVersionTypeId filtering
// lets through files for the wrong flavor (e.g. Pandaria Classic leaking into Retail).
// CurseForge gameVersions use strings like "12.0.1" (MoP Classic) vs "11.0.7" (Retail).
const CLASSIC_ONLY_MAJOR_VERSIONS = ['1.', '2.', '3.', '4.', '5.', '12.']

/** Returns true if the file looks compatible with the requested flavor */
function isFileCompatibleWithFlavor(file: CFFile, flavor?: WowFlavor): boolean {
  if (!flavor || flavor !== 'retail') return true  // Only filter for Retail
  if (!file.gameVersions || file.gameVersions.length === 0) return true

  // Check if ANY of the file's game versions are Retail-compatible.
  // Retail versions are currently 10.x, 11.x (and future major versions above 12).
  // Classic flavors use 1.x-5.x (Era/TBC/Wrath/Cata/MoP) and 12.x (MoP Classic interface).
  const hasRetailVersion = file.gameVersions.some(v => {
    // Skip non-version strings (e.g. "Retail", "Classic", flavor labels)
    if (!/^\d/.test(v)) return true
    return !CLASSIC_ONLY_MAJOR_VERSIONS.some(prefix => v.startsWith(prefix))
  })
  return hasRetailVersion
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
  categories?: { id: number; name: string }[]
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

interface CFFileDetailsResponse {
  data?: CFFile
}

interface CFSearchResponse {
  data: CFMod[]
  pagination?: { totalCount: number; resultCount: number; index: number; pageSize: number }
}

interface CFCategory {
  id: number
  gameId: number
  name: string
  slug: string
  url: string
  iconUrl?: string
  parentCategoryId?: number
  isClass?: boolean
  classId?: number
}

// CurseForge sortField values: 1=Featured, 2=Popularity, 3=LastUpdated, 4=Name, 5=Author, 6=TotalDownloads
const CF_SORT_MAP: Record<BrowseSortField, number> = {
  popularity: 2,
  name: 4,
  downloads: 6,
  updated: 3,
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
        'User-Agent': 'WoWWarden/1.0',
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

  private async resolveDownloadUrl(modId: string, file: CFFile): Promise<string> {
    if (file.downloadUrl) return file.downloadUrl

    try {
      const fileRes = await this.client.get<CFFileDetailsResponse>(`/mods/${modId}/files/${file.id}`)
      const detailUrl = fileRes.data?.data?.downloadUrl
      if (detailUrl) return detailUrl
    } catch {
      // fall through to download-url endpoint
    }

    try {
      const urlRes = await this.client.get<{ data: string }>(`/mods/${modId}/files/${file.id}/download-url`)
      return urlRes.data.data ?? ''
    } catch {
      return ''
    }
  }

  // ── Category cache ──────────────────────────────────────────────────────
  private categoryCache: AddonCategory[] | null = null
  private categoryCacheTime = 0
  private readonly CATEGORY_TTL = 60 * 60 * 1000 // 1 hour

  async getCategories(): Promise<AddonCategory[]> {
    if (!this.apiKey) return []

    const now = Date.now()
    if (this.categoryCache && now - this.categoryCacheTime < this.CATEGORY_TTL) {
      return this.categoryCache
    }

    try {
      const res = await this.client.get<{ data: CFCategory[] }>('/categories', {
        params: { gameId: WOW_GAME_ID },
      })

      // Filter to top-level addon categories (parentCategoryId === 0 or isClass)
      // and exclude non-addon classes
      const categories: AddonCategory[] = (res.data.data ?? [])
        .filter(c => !c.isClass && c.parentCategoryId && c.parentCategoryId > 0)
        .map(c => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          iconUrl: c.iconUrl,
          parentId: c.parentCategoryId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      this.categoryCache = categories
      this.categoryCacheTime = now
      return categories
    } catch (err) {
      console.error('Failed to fetch CurseForge categories:', err)
      return this.categoryCache ?? []
    }
  }

  private mapMod(mod: CFMod, channel: ReleaseChannel = 'stable'): AddonSearchResult {
    const allowedTypes = CHANNEL_TYPE[channel]
    const latestFile = (mod.latestFiles ?? [])
      .filter(f => allowedTypes.includes(f.releaseType))
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
      categories: mod.categories?.map(c => c.name),
    }
  }

  async search(
    query: string,
    flavor: WowFlavor,
    page = 1,
    pageSize = 20,
    categoryId?: number,
    sortBy?: BrowseSortField
  ): Promise<AddonSearchResult[]> {
    if (!this.apiKey) return []

    const gameVersionTypeId = GAME_VERSION_TYPE_MAP[flavor]
    const cfSortField = sortBy ? CF_SORT_MAP[sortBy] : 2
    const sortOrder = sortBy === 'name' ? 'asc' : 'desc'
    const params = {
      gameId: WOW_GAME_ID,
      // Do NOT pass classId – the WoW class ID is not 6 (that is Minecraft mods).
      // gameId=1 already scopes results to WoW addons exclusively.
      searchFilter: query.trim() || undefined,
      ...(gameVersionTypeId ? { gameVersionTypeId } : {}),
      ...(categoryId ? { categoryId } : {}),
      index: (page - 1) * pageSize,
      pageSize,
      sortField: cfSortField,
      sortOrder,
    }

    const res = await this.client.get<CFSearchResponse>('/mods/search', { params })
    return (res.data.data ?? []).map(m => this.mapMod(m))
  }

  async checkUpdate(addon: InstalledAddon, channel: ReleaseChannel, flavor?: WowFlavor): Promise<UpdateInfo | null> {
    if (!this.apiKey || !addon.sourceId) return null
    try {
      const allowedTypes = CHANNEL_TYPE[channel]
      const gameVersionTypeId = flavor ? GAME_VERSION_TYPE_MAP[flavor] : undefined
      const res = await this.client.get<{ data: CFFile[] }>(
        `/mods/${addon.sourceId}/files`,
        { params: { pageSize: 10, ...(gameVersionTypeId ? { gameVersionTypeId } : {}) } }
      )

      const latestFile = res.data.data
        .filter(f => allowedTypes.includes(f.releaseType))
        .filter(f => isFileCompatibleWithFlavor(f, flavor))
        .sort((a, b) => new Date(b.fileDate).getTime() - new Date(a.fileDate).getTime())[0]

      if (!latestFile) return null

      // Resolve download URL (CF may omit it on list endpoints)
      const downloadUrl = await this.resolveDownloadUrl(addon.sourceId, latestFile)

      if (!downloadUrl) return null

      return {
        latestVersion: latestFile.displayName || latestFile.fileName,
        downloadUrl,
        releaseDate: latestFile.fileDate,
      }
    } catch {
      return null
    }
  }

  private cfReleaseType(type: number): ReleaseChannel {
    if (type === 3) return 'alpha'
    if (type === 2) return 'beta'
    return 'stable'
  }

  async getVersions(sourceId: string, channel: ReleaseChannel, flavor?: WowFlavor): Promise<AddonVersionInfo[]> {
    if (!this.apiKey || !sourceId) return []
    try {
      const allowedTypes = CHANNEL_TYPE[channel]
      const gameVersionTypeId = flavor ? GAME_VERSION_TYPE_MAP[flavor] : undefined
      const res = await this.client.get<{ data: CFFile[] }>(
        `/mods/${sourceId}/files`,
        { params: { pageSize: 50, ...(gameVersionTypeId ? { gameVersionTypeId } : {}) } }
      )

      const files = (res.data.data ?? [])
        .filter(f => allowedTypes.includes(f.releaseType))
        .filter(f => isFileCompatibleWithFlavor(f, flavor))
        .sort((a, b) => new Date(b.fileDate).getTime() - new Date(a.fileDate).getTime())

      const versions: AddonVersionInfo[] = []
      for (const f of files) {
        const downloadUrl = await this.resolveDownloadUrl(sourceId, f)
        if (!downloadUrl) continue
        versions.push({
          version: f.displayName || f.fileName,
          displayName: f.displayName || f.fileName,
          downloadUrl,
          releaseDate: f.fileDate,
          releaseType: this.cfReleaseType(f.releaseType),
          gameVersions: f.gameVersions,
        })
      }
      return versions
    } catch {
      return []
    }
  }
}
