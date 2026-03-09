import React, { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import AddonRow from '../components/AddonRow'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'

type FilterMode = 'all' | 'updates' | 'ignored'
type SortMode   = 'name' | 'status' | 'author'

export default function MyAddons() {
  const {
    installedAddons, isScanning, isCheckingUpdates, updateCount,
    scanAddons, checkUpdates, updateAllAddons, activeInstallationId, installations,
  } = useApp()

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [sort, setSort]     = useState<SortMode>('name')

  const filtered = useMemo(() => {
    let list = [...installedAddons]

    // text search
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.author.toLowerCase().includes(q)
    )

    // filter mode
    if (filter === 'updates') list = list.filter(a => a.updateAvailable && !a.isIgnored)
    if (filter === 'ignored') list = list.filter(a => a.isIgnored)

    // sort
    if (sort === 'name')   list.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'author') list.sort((a, b) => a.author.localeCompare(b.author))
    if (sort === 'status') list.sort((a, b) =>
      Number(b.updateAvailable) - Number(a.updateAvailable) || a.name.localeCompare(b.name)
    )

    return list
  }, [installedAddons, search, filter, sort])

  const noInstallation = !activeInstallationId || installations.length === 0

  if (noInstallation) {
    return (
      <EmptyState
        icon="🗂️"
        title="No WoW installation configured"
        description="Go to Settings and add your World of Warcraft installation path."
      />
    )
  }

  return (
    <div className="flex flex-col h-full page-enter">
      {/* Header toolbar */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-800 shrink-0">
        <h2 className="text-base font-semibold text-gray-200 w-32 shrink-0">My Addons</h2>

        {/* Search */}
        <input
          className="input flex-1 max-w-sm"
          placeholder="Search addons…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Filter tabs */}
        <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
          {(['all', 'updates', 'ignored'] as FilterMode[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize
                ${filter === f ? 'bg-wow-gold text-gray-900' : 'text-gray-400 hover:text-gray-200'}`}
            >
              {f}{f === 'updates' && updateCount > 0 ? ` (${updateCount})` : ''}
            </button>
          ))}
        </div>

        {/* Sort */}
        <select
          className="input text-xs"
          value={sort}
          onChange={e => setSort(e.target.value as SortMode)}
        >
          <option value="name">Sort: Name</option>
          <option value="status">Sort: Status</option>
          <option value="author">Sort: Author</option>
        </select>

        {/* Actions */}
        <button
          className="btn-secondary text-xs py-1.5 px-3"
          onClick={scanAddons}
          disabled={isScanning}
          title="Rescan AddOns directory"
        >
          {isScanning ? '⟳ Scanning…' : '⟳ Scan'}
        </button>

        <button
          className="btn-secondary text-xs py-1.5 px-3"
          onClick={checkUpdates}
          disabled={isCheckingUpdates || isScanning}
          title="Check all addons for updates"
        >
          {isCheckingUpdates ? '⟳ Checking…' : '↻ Check Updates'}
        </button>

        {updateCount > 0 && (
          <button className="btn-primary text-xs py-1.5 px-3" onClick={updateAllAddons}>
            Update All ({updateCount})
          </button>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-5 px-6 py-2.5 border-b border-gray-800/50 shrink-0 text-xs text-gray-500">
        <span>{installedAddons.length} addon{installedAddons.length !== 1 ? 's' : ''} installed</span>
        {updateCount > 0 && (
          <span className="text-amber-400">{updateCount} update{updateCount !== 1 ? 's' : ''} available</span>
        )}
        {filtered.length !== installedAddons.length && (
          <span>Showing {filtered.length}</span>
        )}
      </div>

      {/* Addon list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {isScanning && installedAddons.length === 0 ? (
          <div className="flex justify-center pt-20">
            <LoadingSpinner message="Scanning AddOns directory…" />
          </div>
        ) : filtered.length === 0 ? (
          installedAddons.length === 0 ? (
            <EmptyState
              icon="📭"
              title="No addons found"
              description="Click Scan to detect addons from your WoW AddOns folder."
              action={
                <button className="btn-primary" onClick={scanAddons} disabled={isScanning}>
                  ⟳ Scan Addons
                </button>
              }
            />
          ) : (
            <EmptyState
              icon="🔍"
              title="No addons match your search"
              description="Try a different search term or filter."
            />
          )
        ) : (
          filtered.map(addon => <AddonRow key={addon.id} addon={addon} />)
        )}
      </div>
    </div>
  )
}
