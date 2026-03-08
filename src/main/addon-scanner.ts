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
  /** All dependencies (required + optional) – used for Phase 1 & Phase 2 counting */
  deps?: string[]
  /** Required-only dependencies – used for Phase 2.5 companion suppression */
  requiredDeps?: string[]
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
        case 'requiredeps': {
          const items = val.split(',').map(s => s.trim()).filter(Boolean)
          toc.deps = [...(toc.deps ?? []), ...items]
          toc.requiredDeps = [...(toc.requiredDeps ?? []), ...items]
          break
        }
        case 'optionaldeps':
        case 'loaddeps': {
          const items = val.split(',').map(s => s.trim()).filter(Boolean)
          toc.deps = [...(toc.deps ?? []), ...items]
          break
        }
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
 * Manual provider correlations are preserved by matching on addon directories.
 */
export function scanAddons(installation: WowInstallation): InstalledAddon[] {
  const { addonsPath, id: installationId } = installation

  if (!fs.existsSync(addonsPath)) return []

  const existingById = new Map(
    getInstalledAddons(installationId).map(a => [a.id, a])
  )

  // Build a secondary index: primary directory name → existing addon.
  // This ensures manually-correlated addons (whose IDs changed from
  // "local:X" to "provider:Y") survive subsequent rescans even though the
  // TOC still carries no provider metadata.
  const existingByDir = new Map<string, InstalledAddon>()
  for (const addon of existingById.values()) {
    if (addon.directories.length > 0) {
      existingByDir.set(addon.directories[0], addon)
    }
  }

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

  // ── Sub-directory detection ───────────────────────────────────────────────
  //
  // We intentionally do NOT have a "Phase 1" that suppresses unknown-provider
  // deps.  All top-level AddOns directories are peers; suppressing any of them
  // based purely on dep declarations can hide legitimate addons (e.g. DBM-Core,
  // which has Local/unknown provider but is referenced as a dep by all the
  // encounter packs).  Phase 2, 2.5, and 2.75 cover all real grouping needs.

  const subDirs = new Set<string>()

  // Global dep reference count (built from ALL toc entries including those that
  // will later be suppressed) so that the Phase 2 / 2.75 master elections can
  // identify the most-depended-upon directory in a family.
  const globalDepCount = new Map<string, number>()
  for (const [, toc] of tocByDir) {
    for (const dep of toc.deps ?? []) {
      globalDepCount.set(dep, (globalDepCount.get(dep) ?? 0) + 1)
    }
  }

  // Phase 2 – Provider-ID grouping.
  // Multiple directories that share the same CurseForge / Wago / WoWInterface
  // project ID are part of the same downloaded package (e.g. every DBM module
  // carries X-Curse-Project-ID: 3358).  We elect one "master" and suppress the
  // rest.  Master = whichever dir is referenced as a dependency by the most
  // other dirs globally; ties broken by shortest name, then alphabetically.
  const dirsByProvKey = new Map<string, string[]>()
  for (const [dir, toc] of tocByDir) {
    if (subDirs.has(dir)) continue
    const { provider, sourceId } = determineProvider(toc)
    if (provider === 'unknown' || !sourceId) continue
    const key = `${provider}:${sourceId}`
    const bucket = dirsByProvKey.get(key) ?? []
    bucket.push(dir)
    dirsByProvKey.set(key, bucket)
  }

  for (const [, dirs] of dirsByProvKey) {
    if (dirs.length <= 1) continue
    const sorted = [...dirs].sort((a, b) => {
      const diff = (globalDepCount.get(b) ?? 0) - (globalDepCount.get(a) ?? 0)
      if (diff !== 0) return diff
      // Tiebreak: shorter name first (core modules tend to have shorter names)
      if (a.length !== b.length) return a.length - b.length
      return a.localeCompare(b)
    })
    const master = sorted[0]
    for (const dir of dirs) {
      if (dir !== master) subDirs.add(dir)
    }
  }

  // Phase 2.5 – Companion-addon suppression.
  // Handles addons like WeakAurasCompanion (different project ID from WeakAuras
  // but declares ## RequiredDeps: WeakAuras) and DBM encounter packs that have
  // a different or absent project ID but require DBM-Core.
  // A dir is suppressed when:
  //   • It is not already suppressed
  //   • It declares a required dep on dir B that exists on disk
  //   • B has a known provider and is not suppressed
  //   • dirA's name starts with a prefix derived from dirB's name
  //     (accounts for "-Core"/"-Main" suffixes on the dep dir)
  // suppressedByMaster maps every suppressed companion dir → its master dir so
  // the master's directories[] can include it for correct uninstalls.
  const suppressedByMaster = new Map<string, string>()
  for (const [dirA, tocA] of tocByDir) {
    if (subDirs.has(dirA)) continue
    for (const depB of tocA.requiredDeps ?? []) {
      if (!tocByDir.has(depB) || subDirs.has(depB)) continue
      const { provider: provB } = determineProvider(tocByDir.get(depB)!)
      if (provB === 'unknown') continue
      // Derive a name prefix from depB by stripping common "core" suffixes
      const prefixFull = depB.toLowerCase()
      const prefixBase = depB.replace(/[-_]?(Core|Main|Base|Primary)$/i, '').toLowerCase()
      const nameA = dirA.toLowerCase()
      if (nameA !== prefixFull &&
          (nameA.startsWith(prefixFull) || (prefixBase.length > 2 && nameA.startsWith(prefixBase)))) {
        subDirs.add(dirA)
        suppressedByMaster.set(dirA, depB)
        break
      }
    }
  }

  // Phase 2.75 – Common name-root grouping.
  // Dirs that share the same first name segment (the text before the first "-"
  // or "_" separator, e.g. "DBM" for "DBM-Core", "DBM-Challenges", etc.) are
  // treated as a single addon family.  The most globally-referenced dir is
  // elected master; ties broken by shortest name, then alphabetically.
  // This catches packages like DBM whose sub-modules carry different project IDs
  // (some Wago, some CurseForge, some absent) that Phase 2 cannot group.
  // NOTE: We also pull in any unsuppressed dir whose full name exactly matches
  // a group's root (e.g. a dir literally named "DBM" alongside "DBM-Core" etc.)
  // so it participates in master election rather than being left as a stray.
  const dirsByRoot = new Map<string, string[]>()
  for (const [dir] of tocByDir) {
    if (subDirs.has(dir)) continue
    const sepIdx = dir.search(/[-_]/)
    // Require at least 3-character root to avoid spurious "AB-" matches
    if (sepIdx < 3) continue
    const root = dir.slice(0, sepIdx).toLowerCase()
    const bucket = dirsByRoot.get(root) ?? []
    bucket.push(dir)
    dirsByRoot.set(root, bucket)
  }
  // Add no-separator dirs (e.g. "BigWigs") to any group whose root matches them
  for (const [dir] of tocByDir) {
    if (subDirs.has(dir)) continue
    if (dir.search(/[-_]/) >= 0) continue  // already handled above
    const key = dir.toLowerCase()
    if (dirsByRoot.has(key)) dirsByRoot.get(key)!.push(dir)
  }

  for (const [, rootDirs] of dirsByRoot) {
    if (rootDirs.length <= 1) continue
    const sorted = [...rootDirs].sort((a, b) => {
      const diff = (globalDepCount.get(b) ?? 0) - (globalDepCount.get(a) ?? 0)
      if (diff !== 0) return diff
      if (a.length !== b.length) return a.length - b.length
      return a.localeCompare(b)
    })
    const master = sorted[0]
    for (const dir of sorted.slice(1)) {
      subDirs.add(dir)
      suppressedByMaster.set(dir, master)
    }
  }

  // Note: we intentionally do NOT have a "Phase 3" that pre-adds stored
  // addon.directories[1+] to subDirs.  Doing so causes a feedback loop:
  // if a prior scan elected the wrong master (e.g. "DBM-GUI" instead of
  // "DBM-Core"), the stale directories[] would suppress the correct master
  // on every subsequent scan, making the whole DBM family invisible.
  // Phases 2 / 2.5 / 2.75 re-derive the correct grouping on every scan.

  const result: InstalledAddon[] = []
  const now = Date.now()

  for (const [dirName, toc] of tocByDir) {
    if (subDirs.has(dirName)) continue // handled as sub-dir

    const tocPath = findTocFile(path.join(addonsPath, dirName))!
    let { provider, sourceId } = determineProvider(toc)

    // Always prefer a previously-stored manual provider override over the TOC
    // metadata.  This preserves "Change Provider" selections across rescans even
    // when the addon's TOC already carries its own provider ID (e.g. the user
    // linked a Wago addon to CurseForge instead).
    const prev = existingByDir.get(dirName)
    if (prev && prev.provider !== 'unknown' && prev.sourceId) {
      provider = prev.provider
      sourceId = prev.sourceId
    }

    const id = buildAddonId(provider, sourceId, dirName)

    // Collect all related sub-directories:
    //  • TOC-declared deps that exist on disk
    //  • All dirs from the same provider-ID group (Phase 2 companions)
    //  • Phase 2.5 / Phase 2.75 companion dirs that named this dir as master
    //  • Dirs previously tracked under this addon in the store (Phase 3)
    const relatedDirsSet = new Set<string>([dirName])
    for (const dep of toc.deps ?? []) {
      if (tocByDir.has(dep)) relatedDirsSet.add(dep)
    }
    if (provider !== 'unknown' && sourceId) {
      for (const d of dirsByProvKey.get(`${provider}:${sourceId}`) ?? []) {
        relatedDirsSet.add(d)
      }
    }
    for (const [companion, master] of suppressedByMaster) {
      if (master === dirName) relatedDirsSet.add(companion)
    }
    const prevAddon = existingByDir.get(dirName)
    if (prevAddon) {
      for (const d of prevAddon.directories) {
        if (tocByDir.has(d)) relatedDirsSet.add(d)
      }
    }
    const relatedDirs = Array.from(relatedDirsSet)

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
