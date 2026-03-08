import React, { useState, useCallback, useRef } from 'react'
import { AddonSearchResult, AddonProvider, WowFlavor } from '../types'
import { useApp } from '../context/AppContext'
import SearchResultCard from '../components/SearchResultCard'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import toast from 'react-hot-toast'

const PROVIDERS: { value: AddonProvider | 'all'; label: string }[] = [
  { value: 'all',         label: 'All Sources' },
  { value: 'curseforge',  label: 'CurseForge' },
  { value: 'wowinterface',label: 'WoWInterface' },
]

const FLAVOR_LABELS: Record<WowFlavor, string> = {
  retail:         'Retail',
  classic:        'Classic (Cata)',
  cataclysm:      'Cataclysm Classic',
  classic_era:    'Classic Era',
  burning_crusade:'Burning Crusade',
  wrath:          'Wrath Classic',
}

export default function Browse() {
  const { installedAddons, activeInstallationId, installations, settings } = useApp()

  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<AddonSearchResult[]>([])
  const [loading, setLoading]   = useState(false)
  const [provider, setProvider] = useState<AddonProvider | 'all'>('all')
  const [page, setPage]         = useState(1)
  const [hasMore, setHasMore]   = useState(false)
  const [ghQuery, setGhQuery]   = useState('')

  // Detect current WoW flavor for the active installation
  const activeInstall = installations.find(i => i.id === activeInstallationId)
  const defaultFlavor: WowFlavor = activeInstall?.flavor ?? 'retail'
  const [flavor, setFlavor] = useState<WowFlavor>(defaultFlavor)

  const PAGE_SIZE = 20
  const inputRef = useRef<HTMLInputElement>(null)

  const doSearch = useCallback(async (newQuery: string, newPage: number, append = false) => {
    setLoading(true)
    try {
      const res = await window.api.searchAddons({
        query: newQuery,
        provider: provider === 'all' ? undefined : provider,
        flavor,
        page: newPage,
        pageSize: PAGE_SIZE,
      })
      setResults(prev => append ? [...prev, ...res] : res)
      setHasMore(res.length >= PAGE_SIZE)
      setPage(newPage)
    } catch (err: any) {
      toast.error(`Search failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [provider, flavor])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    doSearch(query, 1, false)
  }

  const handleLoadMore = () => {
    doSearch(query, page + 1, true)
  }

  const handleGitHubLookup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ghQuery.trim()) return
    const t = toast.loading('Looking up GitHub repo…')
    try {
      // Accept full GitHub URLs too
      const ownerRepo = ghQuery
        .replace(/^https?:\/\/github\.com\//, '')
        .replace(/\.git$/, '')
        .trim()

      const result = await window.api.githubLookup(ownerRepo)
      if (result) {
        setResults([result, ...results.filter(r => r.externalId !== result.externalId)])
        toast.success('Found GitHub release!', { id: t })
      } else {
        toast.error('No releases found for that repo.', { id: t })
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Lookup failed', { id: t })
    }
  }

  if (!activeInstallationId || installations.length === 0) {
    return (
      <EmptyState
        icon="🔍"
        title="No WoW installation configured"
        description="Go to Settings and add your World of Warcraft installation path."
      />
    )
  }

  return (
    <div className="flex flex-col h-full page-enter">
      {/* Search bar */}
      <div className="px-5 py-3 border-b border-gray-800 shrink-0 space-y-3">
        <h2 className="text-sm font-semibold text-gray-200">Browse Addons</h2>

        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            ref={inputRef}
            className="input flex-1"
            placeholder="Search addons by name…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />

          {/* Provider filter */}
          <select
            className="input text-xs"
            value={provider}
            onChange={e => setProvider(e.target.value as AddonProvider | 'all')}
          >
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          {/* Flavor filter */}
          <select
            className="input text-xs"
            value={flavor}
            onChange={e => setFlavor(e.target.value as WowFlavor)}
          >
            {Object.entries(FLAVOR_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          <button type="submit" className="btn-primary px-5" disabled={loading}>
            {loading ? '⟳' : '🔍 Search'}
          </button>
        </form>

        {/* Provider-specific notices */}
        {provider === 'curseforge' && !settings?.curseForgApiKey && (
          <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-3 py-1.5">
            CurseForge requires an API key. Add yours in{' '}
            <span className="font-semibold">Settings → API Keys</span>.
          </div>
        )}

        {/* GitHub lookup */}
        <form onSubmit={handleGitHubLookup} className="flex gap-2">
          <input
            className="input flex-1 text-xs"
            placeholder="GitHub repo: owner/repo or full URL"
            value={ghQuery}
            onChange={e => setGhQuery(e.target.value)}
          />
          <button type="submit" className="btn-secondary text-xs px-3">
            GitHub Lookup
          </button>
        </form>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        {loading && results.length === 0 ? (
          <div className="flex justify-center pt-20">
            <LoadingSpinner message="Searching…" />
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="Search for addons"
            description="Enter an addon name above to search across all configured sources."
          />
        ) : (
          <>
            <p className="text-xs text-gray-600 pb-1">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </p>
            {results.map(r => (
              <SearchResultCard
                key={`${r.provider}:${r.externalId}`}
                result={r}
                installedAddons={installedAddons}
              />
            ))}
            {hasMore && (
              <div className="flex justify-center pt-4 pb-8">
                <button
                  className="btn-secondary"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  {loading ? 'Loading…' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
