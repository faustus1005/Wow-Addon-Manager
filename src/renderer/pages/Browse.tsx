import React, { useState, useCallback, useRef, useEffect } from 'react'
import { AddonSearchResult, AddonCategory, AddonProvider, WowFlavor, BrowseSortField } from '../types'
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

const SORT_OPTIONS: { value: BrowseSortField; label: string }[] = [
  { value: 'popularity', label: 'Popularity' },
  { value: 'downloads',  label: 'Most Downloads' },
  { value: 'name',       label: 'Name (A-Z)' },
  { value: 'updated',    label: 'Recently Updated' },
]

// Category icons keyed by common WoW addon category names
const CATEGORY_ICONS: Record<string, string> = {
  'Action Bars':      '\u2694\uFE0F',
  'Auction & Economy':'💰',
  'Bags & Inventory': '🎒',
  'Boss Encounters':  '💀',
  'Buffs & Debuffs':  '✨',
  'Chat & Communication': '💬',
  'Class':            '🛡️',
  'Combat':           '⚔️',
  'Companions':       '🐾',
  'Data Broker':      '📊',
  'Data Export':       '📤',
  'Development Tools': '🔧',
  'Garrison':         '🏰',
  'Guild':            '👥',
  'HUDs':             '🖥️',
  'Libraries':        '📚',
  'Mail':             '📧',
  'Map & Minimap':    '🗺️',
  'Miscellaneous':    '📦',
  'Plugins':          '🔌',
  'Professions':      '⚒️',
  'PvP':              '⚔️',
  'Quests & Leveling':'📜',
  'Raid Frames':      '🏥',
  'Roleplay':         '🎭',
  'Tooltip':          '💡',
  'Transmogrification':'👗',
  'Unit Frames':      '❤️',
}

function getCategoryIcon(name: string): string {
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return icon
  }
  return '📁'
}

type BrowseMode = 'home' | 'search' | 'category'

export default function Browse() {
  const { installedAddons, activeInstallationId, installations, settings } = useApp()

  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<AddonSearchResult[]>([])
  const [loading, setLoading]   = useState(false)
  const [provider, setProvider] = useState<AddonProvider | 'all'>('all')
  const [page, setPage]         = useState(1)
  const [hasMore, setHasMore]   = useState(false)
  const [ghQuery, setGhQuery]   = useState('')
  const [sortBy, setSortBy]     = useState<BrowseSortField>('popularity')

  // Category state
  const [categories, setCategories] = useState<AddonCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<AddonCategory | null>(null)
  const [mode, setMode] = useState<BrowseMode>('home')

  // Detect current WoW flavor for the active installation
  const activeInstall = installations.find(i => i.id === activeInstallationId)
  const defaultFlavor: WowFlavor = activeInstall?.flavor ?? 'retail'
  const [flavor, setFlavor] = useState<WowFlavor>(defaultFlavor)

  const PAGE_SIZE = 20
  const inputRef = useRef<HTMLInputElement>(null)

  // Load categories on mount
  useEffect(() => {
    loadCategories()
  }, [])

  const loadCategories = async () => {
    setCategoriesLoading(true)
    try {
      const cats = await window.api.getCategories()
      setCategories(cats)
    } catch (err: any) {
      console.error('Failed to load categories:', err)
    } finally {
      setCategoriesLoading(false)
    }
  }

  const doSearch = useCallback(async (
    newQuery: string,
    newPage: number,
    append = false,
    categoryId?: number,
    sort?: BrowseSortField
  ) => {
    setLoading(true)
    try {
      const res = await window.api.searchAddons({
        query: newQuery,
        provider: categoryId ? 'curseforge' : provider === 'all' ? undefined : provider,
        flavor,
        page: newPage,
        pageSize: PAGE_SIZE,
        categoryId,
        sortBy: sort ?? sortBy,
      })
      setResults(prev => append ? [...prev, ...res] : res)
      setHasMore(res.length >= PAGE_SIZE)
      setPage(newPage)
    } catch (err: any) {
      toast.error(`Search failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [provider, flavor, sortBy])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setMode('search')
    setSelectedCategory(null)
    setPage(1)
    doSearch(query, 1, false)
  }

  const handleLoadMore = () => {
    if (mode === 'category' && selectedCategory) {
      doSearch('', page + 1, true, selectedCategory.id)
    } else {
      doSearch(query, page + 1, true)
    }
  }

  const handleCategoryClick = (cat: AddonCategory) => {
    setSelectedCategory(cat)
    setMode('category')
    setResults([])
    setPage(1)
    doSearch('', 1, false, cat.id, sortBy)
  }

  const handleSortChange = (newSort: BrowseSortField) => {
    setSortBy(newSort)
    if (mode === 'category' && selectedCategory) {
      setResults([])
      setPage(1)
      doSearch('', 1, false, selectedCategory.id, newSort)
    } else if (mode === 'search' && query) {
      setResults([])
      setPage(1)
      doSearch(query, 1, false, undefined, newSort)
    }
  }

  const handleBackToCategories = () => {
    setMode('home')
    setSelectedCategory(null)
    setResults([])
    setQuery('')
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
        setMode('search')
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
      <div className="px-6 py-4 border-b border-gray-800 shrink-0 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {mode !== 'home' && (
              <button
                className="btn-ghost text-xs py-1 px-2"
                onClick={handleBackToCategories}
                title="Back to categories"
              >
                ← Categories
              </button>
            )}
            <h2 className="text-sm font-semibold text-gray-200">
              {mode === 'category' && selectedCategory
                ? selectedCategory.name
                : 'Browse Addons'}
            </h2>
          </div>

          {/* Sort control (visible in category and search modes) */}
          {(mode === 'category' || mode === 'search') && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Sort:</span>
              <select
                className="input text-xs py-1"
                value={sortBy}
                onChange={e => handleSortChange(e.target.value as BrowseSortField)}
              >
                {SORT_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <form onSubmit={handleSearch} className="flex gap-3">
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
            {loading && mode === 'search' ? '⟳' : 'Search'}
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
        <form onSubmit={handleGitHubLookup} className="flex gap-3">
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

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {mode === 'home' ? (
          /* ── Category Grid ─────────────────────────────────────────── */
          <div>
            {!settings?.curseForgApiKey && (
              <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-3 py-2 mb-4">
                Category browsing requires a CurseForge API key. Add yours in{' '}
                <span className="font-semibold">Settings → API Keys</span> to browse addons by category.
              </div>
            )}

            <h3 className="section-header mb-3">Browse by Category</h3>

            {categoriesLoading ? (
              <div className="flex justify-center pt-10">
                <LoadingSpinner message="Loading categories…" />
              </div>
            ) : categories.length === 0 ? (
              <EmptyState
                icon="📁"
                title="No categories available"
                description={
                  settings?.curseForgApiKey
                    ? 'Could not load categories. Try again later.'
                    : 'Add a CurseForge API key in Settings to browse addons by category.'
                }
              />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    className="card p-4 text-left hover:border-wow-gold/50 hover:bg-wow-dark-2/80 transition-all group cursor-pointer"
                    onClick={() => handleCategoryClick(cat)}
                  >
                    <div className="flex items-center gap-3">
                      {cat.iconUrl ? (
                        <img
                          src={cat.iconUrl}
                          alt=""
                          className="w-6 h-6 rounded"
                          onError={e => {
                            (e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <span className="text-lg">{getCategoryIcon(cat.name)}</span>
                      )}
                      <span className="text-sm text-gray-200 group-hover:text-wow-gold transition-colors truncate">
                        {cat.name}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Search / Category Results ──────────────────────────────── */
          <>
            {loading && results.length === 0 ? (
              <div className="flex justify-center pt-20">
                <LoadingSpinner message={
                  mode === 'category' ? `Loading ${selectedCategory?.name ?? 'category'}…` : 'Searching…'
                } />
              </div>
            ) : results.length === 0 ? (
              <EmptyState
                icon={mode === 'category' ? '📁' : '🔍'}
                title={mode === 'category' ? 'No addons found' : 'Search for addons'}
                description={
                  mode === 'category'
                    ? `No addons found in ${selectedCategory?.name ?? 'this category'}.`
                    : 'Enter an addon name above to search across all configured sources.'
                }
              />
            ) : (
              <>
                <p className="text-xs text-gray-600 pb-1">
                  {results.length} result{results.length !== 1 ? 's' : ''}
                  {mode === 'category' && selectedCategory && (
                    <> in <span className="text-gray-400">{selectedCategory.name}</span></>
                  )}
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
          </>
        )}
      </div>
    </div>
  )
}
