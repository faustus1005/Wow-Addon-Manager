import React, { useState } from 'react'
import { InstalledAddon } from '../types'
import { normalizeVersion, ReleaseChannel } from '../../shared/types'
import { useApp } from '../context/AppContext'
import LinkAddonDialog from './LinkAddonDialog'
import VersionPickerDialog from './VersionPickerDialog'
import toast from 'react-hot-toast'

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

function formatDate(ts: number): string {
  if (!ts) return 'Unknown'
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function timeAgo(ts: number): string {
  if (!ts) return 'Unknown'
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export default function AddonRow({ addon: initialAddon }: Props) {
  const { updateAddon, uninstallAddon, installations, activeInstallationId } = useApp()
  const [addon, setAddon] = useState(initialAddon)
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [versionDialogOpen, setVersionDialogOpen] = useState(false)

  // Keep in sync with parent prop
  React.useEffect(() => { setAddon(initialAddon) }, [initialAddon])

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

  const openFolder = (e: React.MouseEvent) => {
    e.stopPropagation()
    const installation = installations.find(i => i.id === activeInstallationId)
    if (!installation || !addon.directories.length) return
    window.api.openPath(installation.addonsPath + '\\' + addon.directories[0])
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
            {addon.pinnedVersion && (
              <span className="badge bg-amber-700 text-amber-200">Pinned v{normalizeVersion(addon.pinnedVersion)}</span>
            )}
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
              <span className="text-amber-400">→ v{normalizeVersion(addon.latestVersion)}</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 no-drag shrink-0" onClick={e => e.stopPropagation()}>
          {addon.updateAvailable && !addon.isIgnored && !addon.pinnedVersion && (
            <button className="btn-success text-xs py-1 px-3" onClick={handleUpdate}>
              Update
            </button>
          )}
          {addon.updateAvailable && addon.pinnedVersion && (
            <span className="text-amber-400 text-xs" title="Update available but version is pinned">
              New version available
            </span>
          )}
          {addon.websiteUrl && (
            <button className="btn-ghost text-xs py-1 px-2" onClick={openWebsite} title="Open website">
              ↗
            </button>
          )}
          <button className="btn-ghost text-xs py-1 px-2" onClick={openFolder} title="Open addon folder in Explorer">
            📁
          </button>
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
            {addon.latestVersion && normalizeVersion(addon.latestVersion) !== normalizeVersion(addon.version) && (
              <Detail label="Latest" value={`v${normalizeVersion(addon.latestVersion)}`} className="text-amber-400" />
            )}
            <Detail label="Source" value={PROVIDER_LABEL[addon.provider]} />
            {addon.gameVersion && <Detail label="Interface" value={addon.gameVersion} />}
            <Detail label="Installed" value={formatDate(addon.installedAt)} />
            <Detail label="Updated" value={timeAgo(addon.updatedAt)} />
            <Detail label="Directories" value={addon.directories.join(', ')} />
          </div>

          {addon.pinnedVersion && addon.updateAvailable && addon.latestVersion && (
            <div className="text-xs bg-amber-400/10 border border-amber-400/20 rounded px-3 py-1.5 text-amber-300">
              Version pinned to v{normalizeVersion(addon.pinnedVersion)}.
              {' '}Latest available: v{normalizeVersion(addon.latestVersion)}.
              {' '}Unpin to allow updates.
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {addon.provider !== 'unknown' && (
              <button
                className="btn-ghost text-xs py-1 px-3 text-blue-400"
                onClick={e => { e.stopPropagation(); setVersionDialogOpen(true) }}
                title="Choose a specific version to install and pin"
              >
                ⊞ Choose Version
              </button>
            )}
            {addon.pinnedVersion && (
              <UnpinButton addon={addon} onUnpinned={setAddon} />
            )}
            {!addon.pinnedVersion && <AutoUpdateToggle addon={addon} />}
            {addon.provider !== 'unknown' && (
              <ChannelSelector addon={addon} onChanged={setAddon} />
            )}
            <IgnoreToggle addon={addon} />
            <button
              className={`btn-ghost text-xs py-1 px-3 ${addon.provider === 'unknown' ? 'text-blue-400' : 'text-gray-500'}`}
              onClick={e => { e.stopPropagation(); setLinkDialogOpen(true) }}
              title={addon.provider === 'unknown'
                ? 'Link this addon to a provider to enable update tracking'
                : 'Change which provider this addon is linked to'}
            >
              {addon.provider === 'unknown' ? '⇆ Link to Provider' : '⇆ Change Provider'}
            </button>
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

      {linkDialogOpen && (
        <LinkAddonDialog
          addon={addon}
          onClose={() => setLinkDialogOpen(false)}
        />
      )}

      {versionDialogOpen && (
        <VersionPickerDialog
          addon={addon}
          onClose={() => setVersionDialogOpen(false)}
          onPinned={(updated) => setAddon(updated)}
        />
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

function ChannelSelector({ addon, onChanged }: { addon: InstalledAddon; onChanged: (a: InstalledAddon) => void }) {
  const { activeInstallationId } = useApp()
  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation()
    if (!activeInstallationId) return
    try {
      const updated = await window.api.setChannel({
        addonId: addon.id,
        installationId: activeInstallationId,
        channel: e.target.value as ReleaseChannel,
      })
      onChanged(updated)
      toast.success(`${addon.name} set to ${e.target.value} channel`)
    } catch (err: any) {
      toast.error(`Failed to set channel: ${err.message}`)
    }
  }
  return (
    <label
      className="flex items-center gap-2 text-xs text-gray-400"
      onClick={e => e.stopPropagation()}
    >
      <span>Channel:</span>
      <select
        className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-300 focus:border-wow-gold outline-none"
        value={addon.channelPreference}
        onChange={handleChange}
      >
        <option value="stable">Stable</option>
        <option value="beta">Beta</option>
        <option value="alpha">Alpha</option>
      </select>
    </label>
  )
}

function UnpinButton({ addon, onUnpinned }: { addon: InstalledAddon; onUnpinned: (a: InstalledAddon) => void }) {
  const { activeInstallationId } = useApp()
  const handleUnpin = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!activeInstallationId) return
    try {
      const updated = await window.api.unpinVersion({
        addonId: addon.id,
        installationId: activeInstallationId,
      })
      onUnpinned(updated)
      toast.success(`${addon.name} unpinned — normal updates resumed`)
    } catch (err: any) {
      toast.error(`Unpin failed: ${err.message}`)
    }
  }
  return (
    <button
      className="btn-ghost text-xs py-1 px-3 text-amber-400"
      onClick={handleUnpin}
      title="Remove version pin and resume normal updates"
    >
      ⊘ Unpin Version
    </button>
  )
}
