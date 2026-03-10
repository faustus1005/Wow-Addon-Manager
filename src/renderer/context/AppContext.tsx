import React, { createContext, useContext, useEffect, useReducer, useCallback } from 'react'
import { AppSettings, AddonSearchResult, InstalledAddon, WowInstallation } from '../types'
import toast from 'react-hot-toast'

// ─── State ──────────────────────────────────────────────────────────────────

interface AppState {
  settings: AppSettings | null
  installations: WowInstallation[]
  activeInstallationId: string | null
  installedAddons: InstalledAddon[]
  isScanning: boolean
  isCheckingUpdates: boolean
  updateCount: number
}

type Action =
  | { type: 'SET_SETTINGS'; settings: AppSettings }
  | { type: 'SET_INSTALLATIONS'; installations: WowInstallation[] }
  | { type: 'SET_ACTIVE_INSTALLATION'; id: string }
  | { type: 'SET_INSTALLED_ADDONS'; addons: InstalledAddon[] }
  | { type: 'UPSERT_ADDON'; addon: InstalledAddon }
  | { type: 'REMOVE_ADDON'; addonId: string }
  | { type: 'SET_SCANNING'; value: boolean }
  | { type: 'SET_CHECKING_UPDATES'; value: boolean }

const initialState: AppState = {
  settings: null,
  installations: [],
  activeInstallationId: null,
  installedAddons: [],
  isScanning: false,
  isCheckingUpdates: false,
  updateCount: 0,
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SETTINGS':
      return {
        ...state,
        settings: action.settings,
        installations: action.settings.wowInstallations,
        activeInstallationId: action.settings.activeInstallationId,
      }
    case 'SET_INSTALLATIONS':
      return { ...state, installations: action.installations }
    case 'SET_ACTIVE_INSTALLATION':
      return { ...state, activeInstallationId: action.id }
    case 'SET_INSTALLED_ADDONS': {
      const updateCount = action.addons.filter(a => a.updateAvailable && !a.isIgnored).length
      return { ...state, installedAddons: action.addons, updateCount }
    }
    case 'UPSERT_ADDON': {
      const list = state.installedAddons.filter(a => a.id !== action.addon.id)
      const addons = [...list, action.addon].sort((a, b) => a.name.localeCompare(b.name))
      const updateCount = addons.filter(a => a.updateAvailable && !a.isIgnored).length
      return { ...state, installedAddons: addons, updateCount }
    }
    case 'REMOVE_ADDON': {
      const addons = state.installedAddons.filter(a => a.id !== action.addonId)
      const updateCount = addons.filter(a => a.updateAvailable && !a.isIgnored).length
      return { ...state, installedAddons: addons, updateCount }
    }
    case 'SET_SCANNING':
      return { ...state, isScanning: action.value }
    case 'SET_CHECKING_UPDATES':
      return { ...state, isCheckingUpdates: action.value }
    default:
      return state
  }
}

// ─── Context ────────────────────────────────────────────────────────────────

interface AppContextValue extends AppState {
  loadSettings: () => Promise<void>
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>
  switchInstallation: (id: string) => Promise<void>
  scanAddons: () => Promise<void>
  checkUpdates: () => Promise<void>
  updateAddon: (addonId: string) => Promise<void>
  updateAllAddons: () => Promise<void>
  uninstallAddon: (addonId: string) => Promise<void>
  linkAddonToProvider: (addonId: string, result: AddonSearchResult) => Promise<void>
  addInstallation: (installation: WowInstallation) => Promise<void>
  removeInstallation: (id: string) => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const api = window.api

  // ── Load settings ──────────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    const settings = await api.getSettings()
    dispatch({ type: 'SET_SETTINGS', settings })
    if (settings.activeInstallationId) {
      const addons = await api.getInstalledAddons(settings.activeInstallationId)
      dispatch({ type: 'SET_INSTALLED_ADDONS', addons })
    }
  }, [api])

  const patchSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const updated = await api.patchSettings(patch)
    dispatch({ type: 'SET_SETTINGS', settings: updated })
  }, [api])

  // ── Installation switching ─────────────────────────────────────────────

  const switchInstallation = useCallback(async (id: string) => {
    dispatch({ type: 'SET_ACTIVE_INSTALLATION', id })
    await api.patchSettings({ activeInstallationId: id })
    const addons = await api.getInstalledAddons(id)
    dispatch({ type: 'SET_INSTALLED_ADDONS', addons })
  }, [api])

  // ── Scanning ───────────────────────────────────────────────────────────

  const scanAddons = useCallback(async () => {
    const id = state.activeInstallationId
    if (!id) return
    dispatch({ type: 'SET_SCANNING', value: true })
    try {
      const addons = await api.scanAddons(id)
      dispatch({ type: 'SET_INSTALLED_ADDONS', addons })
      toast.success(`Found ${addons.length} addons`)
    } catch (err: any) {
      toast.error(`Scan failed: ${err.message}`)
    } finally {
      dispatch({ type: 'SET_SCANNING', value: false })
    }
  }, [api, state.activeInstallationId])

  // ── Update checking ────────────────────────────────────────────────────

  const checkUpdates = useCallback(async () => {
    const id = state.activeInstallationId
    if (!id) return
    dispatch({ type: 'SET_CHECKING_UPDATES', value: true })
    try {
      const addons = await api.checkUpdates(id)
      dispatch({ type: 'SET_INSTALLED_ADDONS', addons })
      const count = addons.filter(a => a.updateAvailable && !a.isIgnored).length
      if (count > 0) toast.success(`${count} update${count > 1 ? 's' : ''} available`)
      else toast.success('All addons are up to date')
    } catch (err: any) {
      toast.error(`Update check failed: ${err.message}`)
    } finally {
      dispatch({ type: 'SET_CHECKING_UPDATES', value: false })
    }
  }, [api, state.activeInstallationId])

  // ── Update single addon ────────────────────────────────────────────────

  const updateAddon = useCallback(async (addonId: string) => {
    const id = state.activeInstallationId
    if (!id) return
    const t = toast.loading('Updating…')
    try {
      const updated = await api.updateAddon({ addonId, installationId: id })
      dispatch({ type: 'UPSERT_ADDON', addon: updated })
      toast.success(`${updated.name} updated`, { id: t })
    } catch (err: any) {
      toast.error(`Update failed: ${err.message}`, { id: t })
    }
  }, [api, state.activeInstallationId])

  // ── Update all addons ──────────────────────────────────────────────────

  const updateAllAddons = useCallback(async () => {
    const id = state.activeInstallationId
    if (!id) return
    const t = toast.loading('Updating all addons…')
    try {
      const updated = await api.updateAllAddons(id)
      for (const addon of updated) dispatch({ type: 'UPSERT_ADDON', addon })
      toast.success(`Updated ${updated.length} addon${updated.length !== 1 ? 's' : ''}`, { id: t })
    } catch (err: any) {
      toast.error(`Update failed: ${err.message}`, { id: t })
    }
  }, [api, state.activeInstallationId])

  // ── Uninstall ──────────────────────────────────────────────────────────

  const uninstallAddon = useCallback(async (addonId: string) => {
    const id = state.activeInstallationId
    if (!id) return
    const addon = state.installedAddons.find(a => a.id === addonId)
    const t = toast.loading(`Removing ${addon?.name ?? addonId}…`)
    try {
      await api.uninstallAddon({ addonId, installationId: id })
      dispatch({ type: 'REMOVE_ADDON', addonId })
      toast.success('Addon removed', { id: t })
    } catch (err: any) {
      toast.error(`Uninstall failed: ${err.message}`, { id: t })
    }
  }, [api, state.activeInstallationId, state.installedAddons])

  // ── Manual provider correlation ────────────────────────────────────────

  const linkAddonToProvider = useCallback(async (addonId: string, result: AddonSearchResult) => {
    const id = state.activeInstallationId
    if (!id) return
    const t = toast.loading('Linking addon…')
    try {
      const updated = await api.linkAddonToProvider({ addonId, installationId: id, result })
      // The old local: ID is gone; replace it and add the new record
      dispatch({ type: 'REMOVE_ADDON', addonId })
      dispatch({ type: 'UPSERT_ADDON', addon: updated })
      toast.success(`Linked to ${result.name}`, { id: t })
    } catch (err: any) {
      toast.error(`Link failed: ${err.message}`, { id: t })
    }
  }, [api, state.activeInstallationId])

  // ── Installation management ────────────────────────────────────────────

  const addInstallation = useCallback(async (installation: WowInstallation) => {
    const current = state.settings?.wowInstallations ?? []
    if (current.some(i => i.addonsPath === installation.addonsPath)) return
    const updated = [...current, installation]
    await patchSettings({ wowInstallations: updated, activeInstallationId: installation.id })
  }, [state.settings, patchSettings])

  const removeInstallation = useCallback(async (id: string) => {
    const current = state.settings?.wowInstallations ?? []
    const updated = current.filter(i => i.id !== id)
    const activeId = state.activeInstallationId === id
      ? (updated[0]?.id ?? null)
      : state.activeInstallationId
    await patchSettings({ wowInstallations: updated, activeInstallationId: activeId })
    if (activeId && activeId !== id) {
      const addons = await api.getInstalledAddons(activeId)
      dispatch({ type: 'SET_INSTALLED_ADDONS', addons })
    } else {
      dispatch({ type: 'SET_INSTALLED_ADDONS', addons: [] })
    }
  }, [state.settings, state.activeInstallationId, patchSettings, api])

  // ── Window title with update count ──────────────────────────────────────

  useEffect(() => {
    const base = 'WoW Addon Manager'
    const title = state.updateCount > 0
      ? `${base} (${state.updateCount} update${state.updateCount !== 1 ? 's' : ''})`
      : base
    window.api.setWindowTitle(title)
  }, [state.updateCount])

  // ── Bootstrap ──────────────────────────────────────────────────────────

  useEffect(() => {
    loadSettings()

    // Listen for background events from main
    const unWow = api.onWowDetected(async (installations) => {
      await patchSettings({
        wowInstallations: installations,
        activeInstallationId: installations[0]?.id,
      })
      toast.success(`Detected ${installations.length} WoW installation(s)`)
    })

    const unCheck = api.onTriggerUpdateCheck(async (id) => {
      if (id === state.activeInstallationId) await checkUpdates()
    })

    const unBg = api.onBackgroundUpdated(async (id) => {
      if (id === state.activeInstallationId) {
        const addons = await api.getInstalledAddons(id)
        dispatch({ type: 'SET_INSTALLED_ADDONS', addons })
      }
    })

    return () => { unWow(); unCheck(); unBg() }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppContext.Provider value={{
      ...state,
      loadSettings,
      patchSettings,
      switchInstallation,
      scanAddons,
      checkUpdates,
      updateAddon,
      updateAllAddons,
      uninstallAddon,
      linkAddonToProvider,
      addInstallation,
      removeInstallation,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
