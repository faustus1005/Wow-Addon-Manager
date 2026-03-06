// ─── WoW Installation ──────────────────────────────────────────────────────

export type WowFlavor =
  | 'retail'
  | 'classic'
  | 'classic_era'
  | 'burning_crusade'
  | 'wrath'
  | 'cataclysm'

export interface WowInstallation {
  id: string
  displayName: string
  path: string           // e.g. C:\Program Files (x86)\World of Warcraft
  flavor: WowFlavor
  addonsPath: string     // e.g. ...\Interface\AddOns
  clientVersion?: string
}

// ─── Addon Source Providers ────────────────────────────────────────────────

export type AddonProvider = 'wago' | 'curseforge' | 'wowinterface' | 'github' | 'unknown'

// ─── Installed Addon (parsed from TOC + our tracking data) ─────────────────

export interface InstalledAddon {
  /** Stable key: "{provider}:{sourceId}" or "local:{directories[0]}" */
  id: string
  name: string
  version: string
  author: string
  notes: string
  /** All directories this addon occupies (some have multiple) */
  directories: string[]
  /** Primary TOC file path */
  tocPath: string
  provider: AddonProvider
  sourceId?: string      // Provider-specific ID
  wowInstallationId: string
  installedAt: number    // unix ms
  updatedAt: number      // unix ms
  /** Populated after update-check */
  latestVersion?: string
  downloadUrl?: string
  updateAvailable?: boolean
  channelPreference: ReleaseChannel
  gameVersion?: string   // Interface: header value
  websiteUrl?: string
  thumbnailUrl?: string
  autoUpdate: boolean
  isIgnored: boolean
}

// ─── Search / Browse Results ────────────────────────────────────────────────

export type ReleaseChannel = 'stable' | 'beta' | 'alpha'

export interface AddonSearchResult {
  externalId: string
  provider: AddonProvider
  name: string
  summary: string
  author: string
  downloadCount: number
  thumbnailUrl?: string
  latestVersion: string
  websiteUrl?: string
  releaseDate?: string
  categories?: string[]
  compatibleFlavors?: WowFlavor[]
  downloadUrl?: string
}

// ─── IPC payloads ──────────────────────────────────────────────────────────

export interface ScanResult {
  installation: WowInstallation
  addons: InstalledAddon[]
}

export interface InstallPayload {
  result: AddonSearchResult
  installationId: string
  channel?: ReleaseChannel
}

export interface UpdatePayload {
  addonId: string
  installationId: string
}

export interface UninstallPayload {
  addonId: string
  installationId: string
}

export interface CheckUpdatesPayload {
  installationId: string
}

export interface SearchPayload {
  query: string
  provider?: AddonProvider
  flavor?: WowFlavor
  page?: number
  pageSize?: number
}

export interface DownloadProgress {
  addonId: string
  percent: number
  bytesDownloaded: number
  totalBytes: number
}

// ─── App Settings ──────────────────────────────────────────────────────────

export interface AppSettings {
  wowInstallations: WowInstallation[]
  activeInstallationId: string | null
  curseForgApiKey: string
  wagoApiKey: string
  defaultChannel: ReleaseChannel
  autoCheckUpdates: boolean
  autoCheckInterval: number  // minutes
  minimizeToTray: boolean
  theme: 'dark' | 'light'
}

export const DEFAULT_SETTINGS: AppSettings = {
  wowInstallations: [],
  activeInstallationId: null,
  curseForgApiKey: '',
  wagoApiKey: '',
  defaultChannel: 'stable',
  autoCheckUpdates: true,
  autoCheckInterval: 60,
  minimizeToTray: true,
  theme: 'dark',
}
