import React, { useState, useCallback, useEffect, useRef } from 'react'
import { AddonSearchResult, InstalledAddon } from '../types'
import { useApp } from '../context/AppContext'

interface Props {
  addon: InstalledAddon
  onClose: () => void
}

const PROVIDER_LABEL: Record<string, string> = {
  wago:        'Wago',
  curseforge:  'CurseForge',
  wowinterface:'WoWInterface',
  github:      'GitHub',
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

export default function LinkAddonDialog({ addon, onClose }: Props) {
  const { linkAddonToProvider, settings } = useApp()
  const [query, setQuery] = useState(addon.name)
  const [results, setResults] = useState<AddonSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [linking, setLinking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    try {
      const found = await window.api.searchAddons({
        query: q.trim(),
        flavor: settings?.wowInstallations?.[0]?.flavor ?? 'retail',
        pageSize: 10,
      })
      setResults(found)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [settings])

  // Auto-search on open using the addon name
  useEffect(() => {
    search(addon.name)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLink = async (result: AddonSearchResult) => {
    setLinking(true)
    await linkAddonToProvider(addon.id, result)
    setLinking(false)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter') search(query)
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="card w-full max-w-lg mx-4 p-5 flex flex-col gap-4 max-h-[80vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-100 text-sm">
              {addon.provider === 'unknown' ? 'Link to Provider' : 'Change Provider'}
            </h2>
            <p className="text-gray-500 text-xs mt-0.5">
              {addon.provider === 'unknown'
                ? <>Search for <span className="text-gray-300">{addon.name}</span> and select the matching result to enable update tracking.</>
                : <>Search for <span className="text-gray-300">{addon.name}</span> and select a result to switch which provider is used for updates.</>
              }
            </p>
          </div>
          <button className="btn-ghost text-xs py-1 px-2 shrink-0" onClick={onClose}>✕</button>
        </div>

        {/* Search bar */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            className="input flex-1 text-sm"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search addon name…"
          />
          <button
            className="btn-primary text-xs py-1 px-3 shrink-0"
            onClick={() => search(query)}
            disabled={loading}
          >
            {loading ? '…' : 'Search'}
          </button>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex flex-col gap-2 min-h-0">
          {loading && (
            <p className="text-gray-500 text-xs text-center py-4">Searching…</p>
          )}
          {!loading && results.length === 0 && query.trim() && (
            <p className="text-gray-500 text-xs text-center py-4">No results found.</p>
          )}
          {results.map(result => (
            <div
              key={`${result.provider}:${result.externalId}`}
              className="card px-3 py-2 flex items-center gap-3 hover:border-gray-600 transition-colors"
            >
              {/* Thumbnail */}
              <div className="w-9 h-9 rounded bg-gray-800 shrink-0 overflow-hidden flex items-center justify-center text-lg">
                {result.thumbnailUrl
                  ? <img src={result.thumbnailUrl} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  : '🧩'}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-gray-100 text-xs font-medium truncate">{result.name}</span>
                  <span className={PROVIDER_COLORS[result.provider] ?? 'badge-unknown'}>
                    {PROVIDER_LABEL[result.provider] ?? result.provider}
                  </span>
                </div>
                <p className="text-gray-500 text-xs">
                  by {result.author}
                  {result.downloadCount > 0 && <> · {fmtNumber(result.downloadCount)} dl</>}
                  {result.latestVersion && <> · v{result.latestVersion}</>}
                </p>
              </div>

              {/* Link button */}
              <button
                className="btn-primary text-xs py-1 px-3 shrink-0"
                onClick={() => handleLink(result)}
                disabled={linking}
              >
                Link
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
