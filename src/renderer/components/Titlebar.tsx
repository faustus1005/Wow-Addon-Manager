import React from 'react'

/** Custom drag-region titlebar for Windows frameless window */
export default function Titlebar() {
  return (
    <div className="drag-region flex items-center h-9 bg-wow-dark border-b border-amber-900/30 px-4 shrink-0">
      {/* App icon + name */}
      <div className="no-drag flex items-center gap-2 select-none pointer-events-none">
        <span className="text-wow-gold text-sm font-bold tracking-wide">🐺 WoW Warden</span>
      </div>
    </div>
  )
}
