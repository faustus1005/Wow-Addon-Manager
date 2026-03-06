/**
 * GitHub Releases provider.
 * Used for addons distributed as GitHub releases (e.g. many popular addons).
 *
 * Source ID format: "owner/repo"  (e.g. "WeakAuras/WeakAuras2")
 *
 * Uses the public GitHub API – no key required for public repos
 * (60 req/hr unauthenticated, 5000/hr with token).
 */
import axios, { AxiosInstance } from 'axios'
import { AddonSearchResult, InstalledAddon, ReleaseChannel } from '../../shared/types'
import { BaseProvider, UpdateInfo } from './base-provider'

const GH_BASE = 'https://api.github.com'

interface GHRelease {
  tag_name: string
  name: string
  prerelease: boolean
  draft: boolean
  published_at: string
  body?: string
  assets: GHAsset[]
}

interface GHAsset {
  name: string
  browser_download_url: string
  content_type: string
  size: number
  download_count: number
}

interface GHRepo {
  full_name: string
  description?: string
  stargazers_count: number
  open_issues_count: number
  html_url: string
  owner: { avatar_url?: string }
}

export class GitHubProvider extends BaseProvider {
  readonly name = 'github'
  private client: AxiosInstance

  constructor(token?: string) {
    super()
    this.client = axios.create({
      baseURL: GH_BASE,
      timeout: 15000,
      headers: {
        'User-Agent': 'WoWAddonManager/1.0',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }

  /** Pick the best ZIP/release asset from a release */
  private pickAsset(assets: GHAsset[]): GHAsset | null {
    // Prefer assets with "addon" or no suffix pattern, and .zip
    const zipAssets = assets.filter(
      a => a.content_type === 'application/zip' || a.name.endsWith('.zip')
    )
    if (!zipAssets.length) return null
    // Avoid source archives
    const filtered = zipAssets.filter(
      a => !a.name.includes('Source') && !a.name.includes('source')
    )
    return filtered[0] ?? zipAssets[0]
  }

  async search(): Promise<AddonSearchResult[]> {
    // GitHub search is usually triggered via a direct repo URL, not a general search.
    return []
  }

  /** Resolve a GitHub "owner/repo" sourceId to the latest release */
  async checkUpdate(addon: InstalledAddon, channel: ReleaseChannel): Promise<UpdateInfo | null> {
    if (!addon.sourceId || !addon.sourceId.includes('/')) return null
    try {
      const res = await this.client.get<GHRelease[]>(
        `/repos/${addon.sourceId}/releases`,
        { params: { per_page: 10 } }
      )
      const releases = res.data
        .filter(r => !r.draft)
        .filter(r => channel !== 'stable' || !r.prerelease)

      const latest = releases[0]
      if (!latest) return null

      const asset = this.pickAsset(latest.assets)
      if (!asset) return null

      return {
        latestVersion: latest.tag_name.replace(/^v/, ''),
        downloadUrl: asset.browser_download_url,
        changelog: latest.body,
        releaseDate: latest.published_at,
      }
    } catch {
      return null
    }
  }

  /** Convert a GitHub repo "owner/repo" to a search result card */
  async getRepoInfo(ownerRepo: string): Promise<AddonSearchResult | null> {
    try {
      const [repoRes, releasesRes] = await Promise.all([
        this.client.get<GHRepo>(`/repos/${ownerRepo}`),
        this.client.get<GHRelease[]>(`/repos/${ownerRepo}/releases`, { params: { per_page: 5 } }),
      ])
      const repo = repoRes.data
      const latest = releasesRes.data.find(r => !r.draft && !r.prerelease)
      const asset = latest ? this.pickAsset(latest.assets) : null

      return {
        externalId: ownerRepo,
        provider: 'github',
        name: ownerRepo.split('/')[1],
        summary: repo.description ?? '',
        author: ownerRepo.split('/')[0],
        downloadCount: asset?.download_count ?? 0,
        thumbnailUrl: repo.owner.avatar_url,
        websiteUrl: repo.html_url,
        latestVersion: latest?.tag_name.replace(/^v/, '') ?? '0',
        downloadUrl: asset?.browser_download_url,
        releaseDate: latest?.published_at,
      }
    } catch {
      return null
    }
  }
}
