/**
 * Scans an AddOns directory, parses .toc files, and produces InstalledAddon records.
 * Handles multi-directory addons (e.g. TomTom + TomTom_Data).
 */
import fs from 'fs'
import path from 'path'
import { AddonProvider, InstalledAddon, WowInstallation } from '../shared/types'
import { getInstalledAddons } from './store'

interface TocData {
  title: string
  notes: string
  version: string
  author: string
  gameVersion?: string
  curseId?: string
  wowiId?: string
  wagoId?: string
  deps?: string[]
  files: string[]
}

/** Strip WoW color codes like |cFFFFFFFF...| or |r */
function stripColorCodes(s: string): string {
  return s.replace(/\|c[0-9a-fA-F]{8}|\|r/g, '').trim()
}

/** Parse a single .toc file */
function parseToc(filePath: string): TocData {
  const toc: TocData = {
    title: '',
    notes: '',
    version: '',
    author: '',
    files: [],
  }

  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return toc
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('##')) {
      const rest = trimmed.slice(2).trim()
      const colonIdx = rest.indexOf(':')
      if (colonIdx < 0) continue
      const key = rest.slice(0, colonIdx).trim().toLowerCase()
      const val = rest.slice(colonIdx + 1).trim()

      switch (key) {
        case 'title':       toc.title       = stripColorCodes(val); break
        case 'notes':       toc.notes       = stripColorCodes(val); break
        case 'version':     toc.version     = val; break
        case 'author':      toc.author      = val; break
        case 'interface':   toc.gameVersion = val; break
        case 'x-curse-project-id': toc.curseId = val; break
        case 'x-wowi-id':  toc.wowiId = val; break
        case 'x-wago-id':  toc.wagoId = val; break
        case 'dependencies':
        case 'requiredeps':
          toc.deps = val.split(',').map(s => s.trim()).filter(Boolean)
          break
      }
    } else if (trimmed && !trimmed.startsWith('#')) {
      // Lua file reference
      toc.files.push(trimmed)
    }
  }

  return toc
}

/** Find the primary .toc file in an addon directory */
function findTocFile(dir: string): string | null {
  try {
    const entries = fs.readdirSync(dir)
    // Prefer a .toc matching the directory name (standard)
    const dirName = path.basename(dir)
    const canonical = entries.find(
      e => e.toLowerCase() === `${dirName.toLowerCase()}.toc`
    )
    if (canonical) return path.join(dir, canonical)

    // Fallback: first .toc found
    const any = entries.find(e => e.toLowerCase().endsWith('.toc'))
    if (any) return path.join(dir, any)
  } catch {
    // ignore
  }
  return null
}

function determineProvider(toc: TocData): { provider: AddonProvider; sourceId?: string } {
  if (toc.wagoId)  return { provider: 'wago',        sourceId: toc.wagoId }
  if (toc.curseId) return { provider: 'curseforge',  sourceId: toc.curseId }
  if (toc.wowiId)  return { provider: 'wowinterface', sourceId: toc.wowiId }
  return { provider: 'unknown' }
}

function buildAddonId(provider: AddonProvider, sourceId: string | undefined, dirName: string): string {
  if (provider !== 'unknown' && sourceId) return `${provider}:${sourceId}`
  return `local:${dirName}`
}

/**
 * Main entry: scan an installation's AddOns folder.
 * Merges with existing tracked data so provider/update info is preserved.
 */
export function scanAddons(installation: WowInstallation): InstalledAddon[] {
  const { addonsPath, id: installationId } = installation

  if (!fs.existsSync(addonsPath)) return []

  const existingById = new Map(
    getInstalledAddons(installationId).map(a => [a.id, a])
  )

  let dirs: string[]
  try {
    dirs = fs.readdirSync(addonsPath, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
  } catch {
    return []
  }

  // Build a map: dirName -> TocData for all dirs we can parse
  const tocByDir = new Map<string, TocData>()
  for (const dir of dirs) {
    const tocFile = findTocFile(path.join(addonsPath, dir))
    if (tocFile) {
      tocByDir.set(dir, parseToc(tocFile))
    }
  }

  // Identify "lib/sub" directories – ones that appear as Dependencies of others
  // or whose name ends with _Libs / _Core etc and have no standalone title.
  // We group them under their parent.
  const subDirs = new Set<string>()
  for (const toc of tocByDir.values()) {
    for (const dep of toc.deps ?? []) subDirs.add(dep)
  }

  const result: InstalledAddon[] = []
  const now = Date.now()

  for (const [dirName, toc] of tocByDir) {
    if (subDirs.has(dirName)) continue // handled as sub-dir

    const tocPath = findTocFile(path.join(addonsPath, dirName))!
    const { provider, sourceId } = determineProvider(toc)
    const id = buildAddonId(provider, sourceId, dirName)

    // Collect all related sub-directories
    const relatedDirs = [dirName]
    for (const dep of toc.deps ?? []) {
      if (tocByDir.has(dep)) relatedDirs.push(dep)
    }

    const existing = existingById.get(id)
    const name = toc.title || dirName

    result.push({
      id,
      name,
      version: toc.version || 'unknown',
      author: toc.author,
      notes: toc.notes,
      directories: relatedDirs,
      tocPath,
      provider,
      sourceId,
      wowInstallationId: installationId,
      installedAt: existing?.installedAt ?? now,
      updatedAt: existing?.updatedAt ?? now,
      latestVersion: existing?.latestVersion,
      downloadUrl: existing?.downloadUrl,
      updateAvailable: existing?.updateAvailable,
      channelPreference: existing?.channelPreference ?? 'stable',
      gameVersion: toc.gameVersion,
      websiteUrl: existing?.websiteUrl,
      thumbnailUrl: existing?.thumbnailUrl,
      autoUpdate: existing?.autoUpdate ?? false,
      isIgnored: existing?.isIgnored ?? false,
    })
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}
