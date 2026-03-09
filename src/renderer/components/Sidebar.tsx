import React from 'react'
import { NavLink } from 'react-router-dom'
import { useApp } from '../context/AppContext'

interface NavItem {
  to: string
  icon: string
  label: string
  badge?: number
}

export default function Sidebar() {
  const { updateCount, installations, activeInstallationId, switchInstallation, isScanning, isCheckingUpdates } = useApp()

  const navItems: NavItem[] = [
    { to: '/',        icon: '📦', label: 'My Addons',  badge: updateCount || undefined },
    { to: '/browse',  icon: '🔍', label: 'Browse'  },
    { to: '/settings',icon: '⚙️', label: 'Settings' },
  ]

  const activeInstall = installations.find(i => i.id === activeInstallationId)

  return (
    <aside className="w-60 shrink-0 flex flex-col bg-wow-dark-2 border-r border-gray-800 h-full">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-gray-800">
        <h1 className="text-wow-gold font-bold text-lg leading-tight">WoW Addon<br/>Manager</h1>
        <p className="text-gray-500 text-xs mt-1.5">v1.0.0</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1.5">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors
               ${isActive
                 ? 'bg-wow-gold/20 text-wow-gold'
                 : 'text-gray-400 hover:text-gray-100 hover:bg-gray-700/50'}`
            }
          >
            <span>{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.badge ? (
              <span className="badge bg-amber-500 text-gray-900 font-bold">{item.badge}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      {/* WoW Installation Selector */}
      {installations.length > 0 && (
        <div className="p-4 border-t border-gray-800">
          <p className="section-header">Installation</p>
          <select
            value={activeInstallationId ?? ''}
            onChange={e => switchInstallation(e.target.value)}
            className="input w-full text-xs"
          >
            {installations.map(inst => (
              <option key={inst.id} value={inst.id}>{inst.displayName}</option>
            ))}
          </select>
          {activeInstall && (
            <p className="text-gray-600 text-xs mt-1 truncate" title={activeInstall.addonsPath}>
              {activeInstall.addonsPath}
            </p>
          )}
        </div>
      )}

      {/* Status bar */}
      {(isScanning || isCheckingUpdates) && (
        <div className="px-5 py-3 text-xs text-wow-gold animate-pulse border-t border-gray-800">
          {isScanning ? '⟳ Scanning addons…' : '⟳ Checking updates…'}
        </div>
      )}
    </aside>
  )
}
