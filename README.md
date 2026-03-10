<img width="1024" height="1024" alt="WoWAddonManagerLogo" src="https://github.com/user-attachments/assets/28fb62ed-f561-42a4-a458-5589c5321867" />
A Windows desktop application for managing World of Warcraft addons.

## Features

### Addon Management
| Feature | Details |
|---|---|
| **Install addons** | Download and extract addon ZIPs directly to your AddOns folder |
| **Uninstall addons** | Safely remove addon directories with a two-step confirmation |
| **Update checking** | Check installed addons against provider APIs for new versions |
| **Bulk update** | Update all out-of-date addons in one click |
| **Version pinning** | Lock an addon to a specific version to prevent updates |
| **Version picker** | Browse and install any available version of an addon |
| **Release channels** | Choose Stable, Beta, or Alpha globally or per individual addon |
| **Ignore / Auto-update** | Ignore specific addons from update checks or enable fully automatic updating |
| **Provider linking** | Manually link local addons to a provider source to enable update tracking |
| **Export / Import** | Export your addon list to a JSON file and import it on another machine to reinstall everything |

### Discovery & Browsing
| Feature | Details |
|---|---|
| **Multi-source search** | Search Wago.io, CurseForge, and WoWInterface simultaneously |
| **Category browsing** | Browse addons by category (Action Bars, Boss Encounters, Map & Minimap, etc.) |
| **GitHub addon support** | Install addons distributed as GitHub Releases via `owner/repo` or full URL |
| **Sorting options** | Sort results by popularity, download count, name, or recently updated |
| **Flavor filtering** | Filter search results by WoW flavor (Retail, Classic Era, Cataclysm, etc.) |
| **Pagination** | Load more results with paginated browsing |

### WoW Installation
| Feature | Details |
|---|---|
| **Auto-detect WoW** | Scans Windows registry and common install paths for all WoW flavors |
| **Multi-flavor support** | Retail, Classic Era, Cataclysm Classic, Wrath Classic, Burning Crusade |
| **Multiple installations** | Manage addons across multiple WoW installations simultaneously |
| **Manual path entry** | Add WoW installations by browsing or entering a path manually |

### Smart Addon Detection
| Feature | Details |
|---|---|
| **TOC parsing** | Reads `.toc` files to extract name, version, author, description, and provider IDs |
| **Multi-directory grouping** | Automatically groups related addon directories (e.g. DBM-Core, DBM-Challenges → DBM) |
| **Companion suppression** | Hides companion addons (e.g. WeakAurasCompanion) under their parent |
| **Provider auto-detection** | Identifies CurseForge, Wago, and WoWInterface IDs from TOC metadata |

### Application
| Feature | Details |
|---|---|
| **Background updates** | Auto-check for updates at a configurable interval (15 min – 6 hours) |
| **System notifications** | Desktop notifications when updates are found or auto-applied |
| **System tray** | Minimize to tray and keep running in the background |
| **Launch at login** | Optionally start with your OS |
| **Update count in title** | Window title shows the number of pending addon updates |
| **Dark theme** | WoW-inspired dark UI with gold accents |
| **Download progress** | Real-time download progress reporting during addon installation |
| **Open in Explorer** | Quickly open any addon's folder or the AddOns directory |

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

### Export / Import

You can export your installed addon list from **Settings → Data → Export Addon List**. This saves a JSON file containing all addon metadata and provider links. To restore on a new machine, use **Import Addon List** and the manager will reinstall all tracked addons from their original sources.

## Architecture

```
src/
├── main/                    # Electron main process (Node.js)
│   ├── index.ts             # App entry, window, tray, lifecycle
│   ├── wow-scanner.ts       # WoW installation detection
│   ├── addon-scanner.ts     # TOC file parser & multi-directory grouping
│   ├── addon-installer.ts   # Download, extract, track addons
│   ├── background-updater.ts # Background update checker & auto-installer
│   ├── ipc-handlers.ts      # All IPC channel handlers
│   ├── store.ts             # Persistent JSON settings/addon store
│   └── providers/           # API provider integrations
│       ├── base-provider.ts # Abstract base class
│       ├── wago-provider.ts
│       ├── curseforge-provider.ts
│       ├── wowinterface-provider.ts
│       └── github-provider.ts
├── preload/
│   └── index.ts             # contextBridge API bridge
├── renderer/                # React frontend
│   ├── App.tsx
│   ├── context/AppContext.tsx  # Global state & reducer
│   ├── pages/
│   │   ├── MyAddons.tsx     # Installed addons management
│   │   ├── Browse.tsx       # Search, categories & install
│   │   └── Settings.tsx     # Configuration & data management
│   └── components/
│       ├── Sidebar.tsx
│       ├── AddonRow.tsx     # Expandable addon card with actions
│       ├── SearchResultCard.tsx
│       ├── LinkAddonDialog.tsx
│       ├── VersionPickerDialog.tsx
│       └── ...
└── shared/
    └── types.ts             # Shared TypeScript types & utilities
```

## License

MIT
