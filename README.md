# WoW Addon Manager

A **Windows 64-bit** desktop application for managing World of Warcraft addons, built with Electron + React + TypeScript.

## Features

| Feature | Details |
|---|---|
| **Auto-detect WoW** | Scans Windows registry and common install paths for all WoW flavors |
| **Multi-flavor support** | Retail, Classic Era, Cataclysm Classic, Wrath Classic, and more |
| **Multi-source search** | Search Wago.io, CurseForge, and WoWInterface simultaneously |
| **GitHub addon support** | Install addons distributed as GitHub Releases via `owner/repo` |
| **Install addons** | Download and extract ZIPs directly to your AddOns folder |
| **Update checking** | Check installed addons against provider APIs for new versions |
| **Bulk update** | Update all out-of-date addons in one click |
| **TOC parsing** | Reads `.toc` files to display name, version, author, and source IDs |
| **Auto-update scheduling** | Background update checks at a configurable interval |
| **Release channels** | Stable, Beta, or Alpha per-addon or globally |
| **Ignore / Auto-update** | Ignore specific addons or enable automatic updating |
| **System tray** | Minimise to tray and keep running in the background |
| **Dark theme** | WoW-inspired dark UI with gold accents |

## Supported Addon Sources

| Provider | Search | Updates | Notes |
|---|---|---|---|
| **Wago.io** | ✅ | ✅ | Public API; optional API key for higher rate limits |
| **CurseForge** | ✅ | ✅ | **Requires a free API key** from console.curseforge.com |
| **WoWInterface** | ✅ | ✅ | Public API, no key required |
| **GitHub Releases** | Lookup | ✅ | Enter `owner/repo` or full GitHub URL |

## Getting Started (Development)

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## Building for Windows x64

```bash
# Build and package a Windows installer
npm run package:win
```

The installer will be output to `release/WoWAddonManager-<version>-Setup.exe`.

## Configuration

Settings are stored in:
- **Windows:** `%APPDATA%\wow-addon-manager\`

### API Keys

- **CurseForge:** Get a free key at https://console.curseforge.com/ → Go to API Keys
- **Wago:** Optional; increases rate limits. Available at https://addons.wago.io/

## Architecture

```
src/
├── main/                    # Electron main process (Node.js)
│   ├── index.ts             # App entry, window, tray, lifecycle
│   ├── wow-scanner.ts       # WoW installation detection
│   ├── addon-scanner.ts     # TOC file parser & addon scanner
│   ├── addon-installer.ts   # Download, extract, track addons
│   ├── ipc-handlers.ts      # All IPC channel handlers
│   ├── store.ts             # Persistent JSON settings/addon store
│   └── providers/           # API provider integrations
│       ├── wago-provider.ts
│       ├── curseforge-provider.ts
│       ├── wowinterface-provider.ts
│       └── github-provider.ts
├── preload/
│   └── index.ts             # contextBridge API bridge
├── renderer/                # React frontend
│   ├── App.tsx
│   ├── context/AppContext.tsx  # Global state & actions
│   ├── pages/
│   │   ├── MyAddons.tsx     # Installed addons management
│   │   ├── Browse.tsx       # Search & install new addons
│   │   └── Settings.tsx     # Configuration
│   └── components/
│       ├── Sidebar.tsx
│       ├── AddonRow.tsx
│       ├── SearchResultCard.tsx
│       └── ...
└── shared/
    └── types.ts             # Shared TypeScript types
```

## License

MIT
