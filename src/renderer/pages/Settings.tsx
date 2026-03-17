import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import { WowInstallation } from '../types'
import toast from 'react-hot-toast'

export default function Settings() {
  const {
    settings, patchSettings,
    installations, addInstallation, removeInstallation,
    scanAddons, activeInstallationId,
  } = useApp()

  const [cfKey, setCfKey]     = useState(settings?.curseForgApiKey ?? '')
  const [wagoKey, setWagoKey] = useState(settings?.wagoApiKey ?? '')
  const [pathInput, setPathInput] = useState('')
  const [validating, setValidating] = useState(false)

  if (!settings) return null

  const saveKeys = async () => {
    await patchSettings({ curseForgApiKey: cfKey, wagoApiKey: wagoKey })
    toast.success('API keys saved')
  }

  const browseWow = async () => {
    const p = await window.api.browseWowPath()
    if (p) setPathInput(p)
  }

  const addPath = async () => {
    if (!pathInput.trim()) return
    setValidating(true)
    try {
      const { installations: found, error } = await window.api.validateWowPath(pathInput.trim())
      if (error || found.length === 0) {
        toast.error(error ?? 'No WoW installation found at that path.')
        return
      }
      for (const inst of found) await addInstallation(inst)
      toast.success(`Added ${found.length} installation(s)`)
      setPathInput('')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setValidating(false)
    }
  }

  const autoDetect = async () => {
    const found = await window.api.findWowInstallations()
    if (!found.length) { toast.error('No WoW installations auto-detected'); return }
    for (const inst of found) await addInstallation(inst)
    toast.success(`Found ${found.length} installation(s)`)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto page-enter">
      <div className="px-6 py-4 border-b border-gray-800 shrink-0">
        <h2 className="text-sm font-semibold text-gray-200">Settings</h2>
      </div>

      <div className="flex-1 px-6 py-5 space-y-8 max-w-2xl">

        {/* ── WoW Installations ── */}
        <Section title="WoW Installations">
          <div className="space-y-2">
            {installations.length === 0 ? (
              <p className="text-gray-500 text-sm">No installations configured.</p>
            ) : (
              installations.map(inst => (
                <InstallationCard
                  key={inst.id}
                  installation={inst}
                  isActive={inst.id === activeInstallationId}
                  onRemove={() => removeInstallation(inst.id)}
                  onOpenPath={() => window.api.openPath(inst.addonsPath)}
                />
              ))
            )}
          </div>

          <div className="flex gap-2 mt-3">
            <input
              className="input flex-1 text-sm"
              placeholder="C:\Program Files (x86)\World of Warcraft"
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
            />
            <button className="btn-secondary text-sm" onClick={browseWow}>Browse…</button>
            <button
              className="btn-primary text-sm"
              onClick={addPath}
              disabled={validating || !pathInput.trim()}
            >
              {validating ? 'Validating…' : 'Add'}
            </button>
          </div>

          <button className="btn-ghost text-sm mt-2" onClick={autoDetect}>
            ⟳ Auto-Detect Installations
          </button>
        </Section>

        {/* ── API Keys ── */}
        <Section title="Provider API Keys">
          <p className="text-gray-500 text-xs mb-3">
            API keys are stored locally. CurseForge requires a key from{' '}
            <button
              className="text-wow-gold underline"
              onClick={() => window.api.openUrl('https://console.curseforge.com/')}
            >
              console.curseforge.com
            </button>
            .
          </p>

          <label className="block mb-3">
            <span className="section-header">CurseForge API Key</span>
            <input
              type="password"
              className="input w-full mt-1"
              placeholder="$2a$10$…"
              value={cfKey}
              onChange={e => setCfKey(e.target.value)}
            />
          </label>

          <label className="block mb-4">
            <span className="section-header">Wago API Key (optional)</span>
            <input
              type="password"
              className="input w-full mt-1"
              placeholder="Leave empty for public access"
              value={wagoKey}
              onChange={e => setWagoKey(e.target.value)}
            />
          </label>

          <button className="btn-primary text-sm" onClick={saveKeys}>Save Keys</button>
        </Section>

        {/* ── Update Preferences ── */}
        <Section title="Update Preferences">
          <div className="space-y-3">
            <CheckboxRow
              label="Auto-check for updates"
              checked={settings.autoCheckUpdates}
              onChange={v => patchSettings({ autoCheckUpdates: v })}
            />

            {settings.autoCheckUpdates && (
              <>
                <label className="flex items-center gap-3 text-sm text-gray-300">
                  <span>Check interval</span>
                  <select
                    className="input text-sm"
                    value={settings.autoCheckInterval}
                    onChange={e => patchSettings({ autoCheckInterval: Number(e.target.value) })}
                  >
                    <option value={15}>Every 15 minutes</option>
                    <option value={30}>Every 30 minutes</option>
                    <option value={60}>Every hour</option>
                    <option value={180}>Every 3 hours</option>
                    <option value={360}>Every 6 hours</option>
                  </select>
                </label>

                <CheckboxRow
                  label="Automatically install updates"
                  checked={settings.autoInstallUpdates ?? true}
                  onChange={v => patchSettings({ autoInstallUpdates: v })}
                />
                {settings.autoInstallUpdates !== false && (
                  <p className="text-gray-600 text-xs ml-12">
                    Updates will be downloaded and installed automatically. Per-addon auto-update can still be toggled individually.
                  </p>
                )}
              </>
            )}

            <label className="flex items-center gap-3 text-sm text-gray-300">
              <span>Default release channel</span>
              <select
                className="input text-sm"
                value={settings.defaultChannel}
                onChange={e => patchSettings({ defaultChannel: e.target.value as 'stable' | 'beta' | 'alpha' })}
              >
                <option value="stable">Stable only</option>
                <option value="beta">Stable + Beta</option>
                <option value="alpha">All (including Alpha)</option>
              </select>
            </label>
          </div>
        </Section>

        {/* ── App Behavior ── */}
        <Section title="App Behavior">
          <div className="space-y-3">
            <CheckboxRow
              label="Minimize to system tray on close"
              checked={settings.minimizeToTray}
              onChange={v => patchSettings({ minimizeToTray: v })}
            />
            <CheckboxRow
              label="Launch at login (start with OS)"
              checked={settings.launchAtLogin ?? false}
              onChange={v => patchSettings({ launchAtLogin: v })}
            />
          </div>
        </Section>

        {/* ── Data ── */}
        <Section title="Data">
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-secondary text-sm"
              onClick={scanAddons}
            >
              ⟳ Rescan AddOns Directory
            </button>
            <button
              className="btn-secondary text-sm"
              onClick={async () => {
                if (!activeInstallationId) { toast.error('No active installation'); return }
                try {
                  const result = await window.api.exportAddonList(activeInstallationId)
                  if (result) toast.success(`Exported ${result.count} addons`)
                } catch (err: any) {
                  toast.error(`Export failed: ${err.message}`)
                }
              }}
              disabled={!activeInstallationId}
            >
              ↓ Export Addon List
            </button>
            <button
              className="btn-secondary text-sm"
              onClick={async () => {
                if (!activeInstallationId) { toast.error('No active installation'); return }
                try {
                  const data = await window.api.importAddonList(activeInstallationId)
                  if (!data) return
                  const tracked = data.addons.filter(a => a.sourceId)
                  toast.success(
                    `Loaded ${tracked.length} addon(s) from "${data.installationName}" (${data.flavor}). ` +
                    `Use Browse to reinstall them from their original sources.`
                  , { duration: 8000 })
                  // Re-install all tracked addons
                  let installed = 0
                  for (const addon of tracked) {
                    try {
                      const results = await window.api.searchAddons({
                        query: addon.name,
                        provider: addon.provider === 'unknown' ? undefined : addon.provider,
                      })
                      const match = results.find(r =>
                        r.externalId === addon.sourceId && r.provider === addon.provider
                      ) ?? results.find(r =>
                        r.provider === addon.provider && r.name.toLowerCase() === addon.name.toLowerCase()
                      )
                      if (match) {
                        await window.api.installAddon({
                          result: match,
                          installationId: activeInstallationId,
                          channel: addon.channelPreference,
                        })
                        installed++
                      }
                    } catch { /* skip individual failures */ }
                  }
                  toast.success(`Installed ${installed} of ${tracked.length} addons`)
                  scanAddons()
                } catch (err: any) {
                  toast.error(`Import failed: ${err.message}`)
                }
              }}
              disabled={!activeInstallationId}
            >
              ↑ Import Addon List
            </button>
            <button
              className="btn-ghost text-sm"
              onClick={() => window.api.openUrl('https://github.com/faustus1005/Wow-Addon-Manager')}
            >
              ↗ View Source
            </button>
          </div>
        </Section>

      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-semibold text-gray-200 text-sm mb-3 pb-2 border-b border-gray-800">
        {title}
      </h3>
      {children}
    </section>
  )
}

function CheckboxRow({
  label, checked, onChange
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <div
        className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer
          ${checked ? 'bg-wow-gold' : 'bg-gray-700'}`}
        onClick={() => onChange(!checked)}
      >
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
          ${checked ? 'left-4' : 'left-0.5'}`} />
      </div>
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  )
}

function InstallationCard({
  installation, isActive, onRemove, onOpenPath
}: {
  installation: WowInstallation
  isActive: boolean
  onRemove: () => void
  onOpenPath: () => void
}) {
  const FLAVOR_ICONS: Record<string, string> = {
    retail:        '⚔️',
    classic:       '🛡️',
    cataclysm:     '🌋',
    classic_era:   '📜',
    burning_crusade:'👹',
    wrath:         '❄️',
  }

  return (
    <div className={`card px-4 py-3 flex items-center gap-3
      ${isActive ? 'border-wow-gold/40' : ''}`}>
      <span className="text-xl">{FLAVOR_ICONS[installation.flavor] ?? '🎮'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">{installation.displayName}</span>
          {isActive && <span className="badge bg-wow-gold/20 text-wow-gold text-xs">Active</span>}
        </div>
        <p
          className="text-gray-600 text-xs truncate cursor-pointer hover:text-gray-400"
          title={installation.addonsPath}
          onClick={onOpenPath}
        >
          {installation.addonsPath}
        </p>
        {installation.clientVersion && (
          <p className="text-gray-700 text-xs">{installation.clientVersion}</p>
        )}
      </div>
      <button
        className="btn-ghost text-xs py-1 px-2 text-red-400"
        onClick={onRemove}
        title="Remove installation"
      >
        ✕
      </button>
    </div>
  )
}
