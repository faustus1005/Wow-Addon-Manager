import React, { useState } from 'react'
import { AddonSearchResult, InstalledAddon } from '../types'
import { useApp } from '../context/AppContext'
import toast from 'react-hot-toast'

interface Props {
  result: AddonSearchResult
  installedAddons: InstalledAddon[]
}

const PROVIDER_COLORS: Record<string, string> = {
  wago:         'badge-wago',
  curseforge:   'badge-curseforge',
  wowinterface: 'badge-wowinterface',
  github:       'badge-github',
}

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export default function SearchResultCard({ result, installedAddons }: Props) {
  const { activeInstallationId, settings } = useApp()
  const [installing, setInstalling] = useState(false)

  const installed = installedAddons.find(
    a => a.provider === result.provider && a.sourceId === result.externalId
  )

  const handleInstall = async () => {
    if (!activeInstallationId || !result.downloadUrl) {
      toast.error('No download URL available for this addon.')
      return
    }
    setInstalling(true)
    const t = toast.loading(`Installing ${result.name}…`)
    try {
      await window.api.installAddon({
        result,
        installationId: activeInstallationId,
        channel: settings?.defaultChannel ?? 'stable',
      })
      toast.success(`${result.name} installed!`, { id: t })
    } catch (err: any) {
      toast.error(err.message ?? 'Install failed', { id: t })
    } finally {
      setInstalling(false)
    }
  }

  const openWebsite = () => {
    if (result.websiteUrl) window.api.openUrl(result.websiteUrl)
  }

  return (
    <div className="card p-5 flex gap-5 hover:border-gray-700 transition-colors">
      {/* Thumbnail */}
      <div className="w-18 h-18 rounded-lg bg-gray-800 shrink-0 overflow-hidden flex items-center justify-center text-3xl" style={{ width: '4.5rem', height: '4.5rem' }}>
        {result.thumbnailUrl
          ? <img src={result.thumbnailUrl} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          : '🧩'}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-100 text-sm truncate">{result.name}</h3>
              <span className={PROVIDER_COLORS[result.provider] ?? 'badge-unknown'}>
                {result.provider}
              </span>
              {installed && <span className="badge-installed">Installed</span>}
            </div>
            <p className="text-gray-500 text-xs mt-0.5">
              by {result.author}
              {result.downloadCount > 0 && (
                <> · {fmtNumber(result.downloadCount)} downloads</>
              )}
              {result.latestVersion && <> · v{result.latestVersion}</>}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {result.websiteUrl && (
              <button className="btn-ghost text-xs py-1 px-2" onClick={openWebsite} title="Open website">
                ↗
              </button>
            )}
            {installed ? (
              <button className="btn-secondary text-xs py-1 px-3" disabled>
                Installed
              </button>
            ) : (
              <button
                className="btn-primary text-xs py-1 px-3"
                onClick={handleInstall}
                disabled={installing || !result.downloadUrl}
                title={!result.downloadUrl ? 'No download URL available' : undefined}
              >
                {installing ? 'Installing…' : 'Install'}
              </button>
            )}
          </div>
        </div>

        {result.summary && (
          <p className="text-gray-400 text-sm mt-2 line-clamp-2 leading-relaxed">{result.summary}</p>
        )}

        {result.categories && result.categories.length > 0 && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {result.categories.slice(0, 4).map(cat => (
              <span key={cat} className="badge bg-gray-800 text-gray-400 text-xs">{cat}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
