/**
 * Persistent JSON store backed by electron's userData directory.
 * Avoids the ESM-incompatibility issues of electron-store v9+.
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { AppSettings, DEFAULT_SETTINGS, InstalledAddon } from '../shared/types'

const DATA_DIR = app.getPath('userData')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const ADDONS_FILE = path.join(DATA_DIR, 'installed-addons.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
    }
  } catch {
    // corrupt file – fall back to default
  }
  return fallback
}

function writeJson(filePath: string, data: unknown) {
  ensureDir()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Settings ──────────────────────────────────────────────────────────────

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<AppSettings>>(SETTINGS_FILE, {}) }
}

export function saveSettings(settings: AppSettings) {
  writeJson(SETTINGS_FILE, settings)
}

export function patchSettings(patch: Partial<AppSettings>) {
  writeJson(SETTINGS_FILE, { ...getSettings(), ...patch })
}

// ─── Installed Addons ──────────────────────────────────────────────────────

type AddonStore = Record<string, InstalledAddon[]>  // key = installationId

export function getInstalledAddons(installationId: string): InstalledAddon[] {
  const store = readJson<AddonStore>(ADDONS_FILE, {})
  return store[installationId] ?? []
}

export function saveInstalledAddons(installationId: string, addons: InstalledAddon[]) {
  const store = readJson<AddonStore>(ADDONS_FILE, {})
  store[installationId] = addons
  writeJson(ADDONS_FILE, store)
}

export function upsertAddon(installationId: string, addon: InstalledAddon) {
  const list = getInstalledAddons(installationId)
  const idx = list.findIndex(a => a.id === addon.id)
  if (idx >= 0) list[idx] = addon
  else list.push(addon)
  saveInstalledAddons(installationId, list)
}

export function removeAddon(installationId: string, addonId: string) {
  const list = getInstalledAddons(installationId).filter(a => a.id !== addonId)
  saveInstalledAddons(installationId, list)
}
