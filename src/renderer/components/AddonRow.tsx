import React, { useState } from 'react'
import { InstalledAddon } from '../types'
import { useApp } from '../context/AppContext'

interface Props {
  addon: InstalledAddon
}

const PROVIDER_LABEL: Record<string, string> = {
  wago:        'Wago',
  curseforge:  'CurseForge',
  wowinterface:'WoWInterface',
  github:      'GitHub',
  unknown:     'Local',
}

export default function AddonRow({ addon }: Props) {
  const { updateAddon, uninstallAddon } = useApp()
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handleUpdate = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await updateAddon(addon.id)
  }

  const handleUninstall = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirming) { setConfirming(true); return }
    await uninstallAddon(addon.id)
  }

  const openWebsite = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (addon.websiteUrl) window.api.openUrl(addon.websiteUrl)
  }

  return (
    <div
      className={`card px-4 py-3 cursor-pointer transition-all
                  ${expanded ? 'border-gray-700' : 'hover:border-gray-700'}`}
      onClick={() => { setExpanded(e => !e); setConfirming(false) }}
    >
      {/* Main row */}
      <div className="flex items-center gap-3">
        {/* Thumbnail / placeholder */}
        <div className="w-10 h-10 rounded-lg bg-gray-800 shrink-0 overflow-hidden flex items-center justify-center text-xl">
          {addon.thumbnailUrl
            ? <img src={addon.thumbnailUrl} alt="" className="w-full h-full object-cover" />
            : '🧩'}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-100 truncate">{addon.name}</span>
            {addon.updateAvailable && !addon.isIgnored && (
              <span className="badge-update">Update</span>
            )}
            {addon.isIgnored && (
              <span className="badge-ignored">Ignored</span>
            )}
            <span className={`badge-${addon.provider}`}>
              {PROVIDER_LABEL[addon.provider]}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
            <span>v{addon.version}</span>
            {addon.author && <span>by {addon.author}</span>}
            {addon.updateAvailable && addon.latestVersion && (
              <span className="text-amber-400">→ v{addon.latestVersion}</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 no-drag shrink-0" onClick={e => e.stopPropagation()}>
          {addon.updateAvailable && !addon.isIgnored && (
            <button className="btn-success text-xs py-1 px-3" onClick={handleUpdate}>
              Update
            </button>
          )}
          {addon.websiteUrl && (
            <button className="btn-ghost text-xs py-1 px-2" onClick={openWebsite} title="Open website">
              ↗
            </button>
          )}
        </div>

        {/* Expand chevron */}
        <span className={`text-gray-600 text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-800 space-y-3">
          {addon.notes && (
            <p className="text-gray-400 text-xs leading-relaxed">{addon.notes}</p>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <Detail label="Version" value={`v${addon.version}`} />
            {addon.latestVersion && addon.latestVersion !== addon.version && (
              <Detail label="Latest" value={`v${addon.latestVersion}`} className="text-amber-400" />
            )}
            <Detail label="Source" value={PROVIDER_LABEL[addon.provider]} />
            {addon.gameVersion && <Detail label="Interface" value={addon.gameVersion} />}
            <Detail label="Directories" value={addon.directories.join(', ')} />
          </div>

          <div className="flex gap-2 flex-wrap">
            <AutoUpdateToggle addon={addon} />
            <IgnoreToggle addon={addon} />
            <button
              className={confirming ? 'btn-danger text-xs py-1 px-3' : 'btn-ghost text-xs py-1 px-3 text-red-400'}
              onClick={handleUninstall}
            >
              {confirming ? 'Confirm Remove' : 'Uninstall'}
            </button>
            {confirming && (
              <button className="btn-ghost text-xs py-1 px-3" onClick={e => { e.stopPropagation(); setConfirming(false) }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value, className = 'text-gray-300' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <span className="text-gray-600">{label}: </span>
      <span className={className}>{value}</span>
    </div>
  )
}

function AutoUpdateToggle({ addon }: { addon: InstalledAddon }) {
  const { activeInstallationId } = useApp()
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!activeInstallationId) return
    await window.api.setAutoUpdate(activeInstallationId, addon.id, !addon.autoUpdate)
  }
  return (
    <button
      className={`btn-ghost text-xs py-1 px-3 ${addon.autoUpdate ? 'text-green-400' : 'text-gray-500'}`}
      onClick={toggle}
    >
      {addon.autoUpdate ? '✓ Auto-update' : '○ Auto-update'}
    </button>
  )
}

function IgnoreToggle({ addon }: { addon: InstalledAddon }) {
  const { activeInstallationId } = useApp()
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!activeInstallationId) return
    await window.api.setIgnored(activeInstallationId, addon.id, !addon.isIgnored)
  }
  return (
    <button
      className={`btn-ghost text-xs py-1 px-3 ${addon.isIgnored ? 'text-amber-400' : 'text-gray-500'}`}
      onClick={toggle}
    >
      {addon.isIgnored ? '⊘ Ignored' : '○ Ignore'}
    </button>
  )
}
