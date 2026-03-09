import React, { useState, useEffect } from 'react'
import { InstalledAddon, AddonVersionInfo } from '../types'
import { normalizeVersion } from '../../shared/types'
import { useApp } from '../context/AppContext'
import toast from 'react-hot-toast'

interface Props {
  addon: InstalledAddon
  onClose: () => void
  onPinned: (updated: InstalledAddon) => void
}

const CHANNEL_COLORS: Record<string, string> = {
  stable: 'text-green-400',
  beta:   'text-amber-400',
  alpha:  'text-red-400',
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export default function VersionPickerDialog({ addon, onClose, onPinned }: Props) {
  const { activeInstallationId } = useApp()
  const [versions, setVersions] = useState<AddonVersionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)

  useEffect(() => {
    loadVersions()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadVersions = async () => {
    if (!activeInstallationId) return
    setLoading(true)
    try {
      const v = await window.api.getAddonVersions({
        addonId: addon.id,
        installationId: activeInstallationId,
      })
      setVersions(v)
    } catch (err: any) {
      toast.error(`Failed to load versions: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handlePinVersion = async (ver: AddonVersionInfo) => {
    if (!activeInstallationId) return
    setInstalling(ver.version)
    const t = toast.loading(`Installing ${addon.name} v${normalizeVersion(ver.version)}…`)
    try {
      const updated = await window.api.pinVersion({
        addonId: addon.id,
        installationId: activeInstallationId,
        version: ver.version,
        downloadUrl: ver.downloadUrl,
      })
      toast.success(`Pinned to v${normalizeVersion(ver.version)}`, { id: t })
      onPinned(updated)
      onClose()
    } catch (err: any) {
      toast.error(err.message ?? 'Install failed', { id: t })
    } finally {
      setInstalling(null)
    }
  }

  const currentNorm = normalizeVersion(addon.version)
  const pinnedNorm = addon.pinnedVersion ? normalizeVersion(addon.pinnedVersion) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="card w-full max-w-lg mx-4 p-5 flex flex-col gap-4 max-h-[80vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-100 text-sm">Choose Version</h2>
            <p className="text-gray-500 text-xs mt-0.5">
              Select a specific version of <span className="text-gray-300">{addon.name}</span> to install.
              {' '}The addon will be pinned to that version and won't auto-update.
            </p>
          </div>
          <button className="btn-ghost text-xs py-1 px-2 shrink-0" onClick={onClose}>✕</button>
        </div>

        {/* Current version info */}
        <div className="text-xs text-gray-500 bg-gray-800/50 rounded-lg px-3 py-2">
          Currently installed: <span className="text-gray-300">v{addon.version}</span>
          {pinnedNorm && (
            <span className="text-amber-400 ml-2">(pinned)</span>
          )}
        </div>

        {/* Version list */}
        <div className="overflow-y-auto flex flex-col gap-1.5 min-h-0">
          {loading && (
            <p className="text-gray-500 text-xs text-center py-8">Loading versions…</p>
          )}
          {!loading && versions.length === 0 && (
            <p className="text-gray-500 text-xs text-center py-8">
              No versions available from this provider.
            </p>
          )}
          {versions.map(ver => {
            const verNorm = normalizeVersion(ver.version)
            const isCurrent = verNorm === currentNorm
            const isPinned = pinnedNorm && verNorm === pinnedNorm

            return (
              <div
                key={`${ver.version}-${ver.releaseDate}`}
                className={`card px-3 py-2 flex items-center gap-3 transition-colors
                  ${isCurrent ? 'border-wow-gold/30 bg-wow-gold/5' : 'hover:border-gray-600'}`}
              >
                {/* Version info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-gray-100 text-xs font-medium truncate">
                      v{normalizeVersion(ver.version)}
                    </span>
                    {ver.releaseType !== 'stable' && (
                      <span className={`text-xs ${CHANNEL_COLORS[ver.releaseType]}`}>
                        {ver.releaseType}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="badge bg-wow-gold/20 text-wow-gold text-xs">Current</span>
                    )}
                    {isPinned && (
                      <span className="badge bg-amber-600/20 text-amber-400 text-xs">Pinned</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    {ver.displayName && ver.displayName !== ver.version && (
                      <span className="truncate">{ver.displayName}</span>
                    )}
                    {ver.releaseDate && (
                      <span>{formatDate(ver.releaseDate)}</span>
                    )}
                    {ver.gameVersions && ver.gameVersions.length > 0 && (
                      <span className="truncate">{ver.gameVersions.slice(0, 3).join(', ')}</span>
                    )}
                  </div>
                </div>

                {/* Install/Pin button */}
                <button
                  className={`text-xs py-1 px-3 shrink-0 ${
                    isPinned ? 'btn-secondary' : 'btn-primary'
                  }`}
                  onClick={() => handlePinVersion(ver)}
                  disabled={installing !== null || isPinned === true}
                >
                  {installing === ver.version
                    ? 'Installing…'
                    : isPinned
                      ? 'Pinned'
                      : 'Install & Pin'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
