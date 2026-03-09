import { AddonSearchResult, AddonVersionInfo, InstalledAddon, ReleaseChannel, WowFlavor } from '../../shared/types'

export interface UpdateInfo {
  latestVersion: string
  downloadUrl: string
  changelog?: string
  releaseDate?: string
}

export abstract class BaseProvider {
  abstract readonly name: string

  /** Search the provider's catalog */
  abstract search(
    query: string,
    flavor: WowFlavor,
    page: number,
    pageSize: number
  ): Promise<AddonSearchResult[]>

  /** Resolve the latest file info for an installed addon */
  abstract checkUpdate(
    addon: InstalledAddon,
    channel: ReleaseChannel
  ): Promise<UpdateInfo | null>

  /** Fetch full details for a single result (optional, enriches thumbnails etc.) */
  async getDetails(externalId: string, _flavor: WowFlavor): Promise<Partial<AddonSearchResult>> {
    return { externalId }
  }

  /** Get available versions for an addon (for version picker). Override in subclasses. */
  async getVersions(_sourceId: string, _channel: ReleaseChannel): Promise<AddonVersionInfo[]> {
    return []
  }
}
