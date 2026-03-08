/**
 * Detects WoW installations on the host machine.
 * On Windows: checks registry + common install paths.
 * On other OSes: checks common paths only.
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { WowFlavor, WowInstallation } from '../shared/types'
import { randomUUID } from 'crypto'

interface FlavorDef {
  dir: string       // subdirectory inside WoW root
  flavor: WowFlavor
  displayName: string
  executableName: string
}

const FLAVOR_DEFS: FlavorDef[] = [
  { dir: '_retail_',       flavor: 'retail',        displayName: 'WoW Retail',             executableName: 'Wow.exe' },
  { dir: '_classic_',      flavor: 'cataclysm',     displayName: 'WoW Classic (Cata)',      executableName: 'WowClassic.exe' },
  { dir: '_classic_era_',  flavor: 'classic_era',   displayName: 'WoW Classic Era',         executableName: 'WowClassic.exe' },
  { dir: '_wrath_',        flavor: 'wrath',          displayName: 'WoW Wrath Classic',       executableName: 'WowClassic.exe' },
  { dir: '_classic_ptr_',  flavor: 'classic_era',   displayName: 'WoW Classic PTR',         executableName: 'WowClassic.exe' },
  { dir: '_ptr_',          flavor: 'retail',        displayName: 'WoW Retail PTR',          executableName: 'WowT.exe' },
  { dir: '_xptr_',         flavor: 'retail',        displayName: 'WoW Retail XPTR',         executableName: 'WowT.exe' },
]

const COMMON_WINDOWS_PATHS = [
  'C:\\Program Files (x86)\\World of Warcraft',
  'C:\\Program Files\\World of Warcraft',
  'D:\\World of Warcraft',
  'D:\\Games\\World of Warcraft',
  'C:\\Games\\World of Warcraft',
]

const COMMON_MAC_PATHS = [
  '/Applications/World of Warcraft',
  `${process.env.HOME}/Applications/World of Warcraft`,
]

const COMMON_LINUX_PATHS = [
  `${process.env.HOME}/Games/World of Warcraft`,
  '/opt/World of Warcraft',
]

/** Read the WoW root path from the Windows registry */
function getWowPathFromRegistry(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const regKeys = [
      'HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft',
      'HKLM\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft',
    ]
    for (const key of regKeys) {
      try {
        const result = execSync(
          `reg query "${key}" /v InstallPath 2>nul`,
          { encoding: 'utf-8', timeout: 5000 }
        )
        const match = result.match(/InstallPath\s+REG_SZ\s+(.+)/i)
        if (match) return match[1].trim()
      } catch {
        // key not found – try next
      }
    }
  } catch {
    // registry access failed
  }
  return null
}

/** Check if a directory is a WoW root (contains at least one flavor subdir) */
function isWowRoot(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir)
    return FLAVOR_DEFS.some(f => entries.includes(f.dir))
  } catch {
    return false
  }
}

/** Read the Interface version from the exe or WTF directory */
function readClientVersion(flavorPath: string): string | undefined {
  try {
    // Try reading from a .build.info or WTF/Config.wtf
    const buildInfo = path.join(flavorPath, '.build.info')
    if (fs.existsSync(buildInfo)) {
      const content = fs.readFileSync(buildInfo, 'utf-8')
      const lines = content.split('\n')
      if (lines.length >= 2) {
        const headers = lines[0].split('|')
        const values = lines[1].split('|')
        const versionIdx = headers.findIndex(h => h.trim() === 'Version!STRING:0')
        if (versionIdx >= 0) return values[versionIdx]?.trim()
      }
    }
  } catch {
    // ignore
  }
  return undefined
}

function buildInstallation(rootPath: string, flavor: FlavorDef): WowInstallation | null {
  const flavorPath = path.join(rootPath, flavor.dir)
  const exePath = path.join(flavorPath, flavor.executableName)
  const addonsPath = path.join(flavorPath, 'Interface', 'AddOns')

  if (!fs.existsSync(flavorPath)) return null
  if (!fs.existsSync(exePath) && !fs.existsSync(addonsPath)) return null

  // Ensure the addons directory exists (create if not)
  if (!fs.existsSync(addonsPath)) {
    try {
      fs.mkdirSync(addonsPath, { recursive: true })
    } catch {
      return null
    }
  }

  return {
    id: randomUUID(),
    displayName: flavor.displayName,
    path: rootPath,
    flavor: flavor.flavor,
    addonsPath,
    clientVersion: readClientVersion(flavorPath),
  }
}

export function findWowInstallations(): WowInstallation[] {
  const rootPaths = new Set<string>()

  // 1. Try Windows registry first
  const regPath = getWowPathFromRegistry()
  if (regPath) rootPaths.add(regPath)

  // 2. Check common install paths for the current platform
  const platformPaths =
    process.platform === 'win32' ? COMMON_WINDOWS_PATHS
    : process.platform === 'darwin' ? COMMON_MAC_PATHS
    : COMMON_LINUX_PATHS

  for (const p of platformPaths) {
    if (fs.existsSync(p)) rootPaths.add(p)
  }

  const installations: WowInstallation[] = []

  for (const root of rootPaths) {
    if (!isWowRoot(root)) continue
    for (const flavor of FLAVOR_DEFS) {
      const inst = buildInstallation(root, flavor)
      if (inst) installations.push(inst)
    }
  }

  // Deduplicate by addonsPath
  const seen = new Set<string>()
  return installations.filter(i => {
    if (seen.has(i.addonsPath)) return false
    seen.add(i.addonsPath)
    return true
  })
}

/** Validate and normalise a user-supplied WoW root path */
export function validateWowPath(
  suppliedPath: string
): { installations: WowInstallation[]; error?: string } {
  if (!fs.existsSync(suppliedPath)) {
    return { installations: [], error: 'Path does not exist.' }
  }

  // Could be the root or a specific flavor subdir
  if (isWowRoot(suppliedPath)) {
    const found: WowInstallation[] = []
    for (const flavor of FLAVOR_DEFS) {
      const inst = buildInstallation(suppliedPath, flavor)
      if (inst) found.push(inst)
    }
    return found.length
      ? { installations: found }
      : { installations: [], error: 'No WoW flavor directories found at path.' }
  }

  // Maybe they pointed directly at a flavor dir (e.g. _retail_)
  const exeExists = FLAVOR_DEFS.some(f =>
    fs.existsSync(path.join(suppliedPath, f.executableName))
  )
  const addonsExists = fs.existsSync(path.join(suppliedPath, 'Interface', 'AddOns'))

  if (exeExists || addonsExists) {
    // Treat the parent as root and this dir as a flavor
    const parent = path.dirname(suppliedPath)
    const dirName = path.basename(suppliedPath)
    const flavor = FLAVOR_DEFS.find(f => f.dir === dirName)
    if (flavor) {
      const inst = buildInstallation(parent, flavor)
      if (inst) return { installations: [inst] }
    }
  }

  return { installations: [], error: 'Could not identify a WoW installation at this path.' }
}
