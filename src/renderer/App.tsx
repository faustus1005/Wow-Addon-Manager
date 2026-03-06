import React from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AppProvider } from './context/AppContext'
import Titlebar from './components/Titlebar'
import Sidebar from './components/Sidebar'
import MyAddons from './pages/MyAddons'
import Browse from './pages/Browse'
import Settings from './pages/Settings'

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <div className="flex flex-col h-screen overflow-hidden bg-wow-dark">
          {/* Custom title bar (Windows frameless) */}
          <Titlebar />

          <div className="flex flex-1 overflow-hidden">
            <Sidebar />

            {/* Main content area */}
            <main className="flex-1 overflow-hidden bg-wow-dark">
              <Routes>
                <Route path="/"        element={<MyAddons />} />
                <Route path="/browse"  element={<Browse />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </main>
          </div>
        </div>

        {/* Toast notifications */}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#1a1a2e',
              color: '#e5e7eb',
              border: '1px solid #374151',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: '#ffd100', secondary: '#1a1a2e' } },
            error:   { iconTheme: { primary: '#f44336', secondary: '#fff' } },
          }}
        />
      </HashRouter>
    </AppProvider>
  )
}
