"use strict";
const electron = require("electron");
const api = {
  // Settings
  getSettings: () => electron.ipcRenderer.invoke("settings:get"),
  patchSettings: (patch) => electron.ipcRenderer.invoke("settings:patch", patch),
  // WoW Detection
  findWowInstallations: () => electron.ipcRenderer.invoke("wow:find"),
  validateWowPath: (p) => electron.ipcRenderer.invoke("wow:validate-path", p),
  browseWowPath: () => electron.ipcRenderer.invoke("wow:browse-path"),
  // Addon Scanning
  scanAddons: (installationId) => electron.ipcRenderer.invoke("addon:scan", installationId),
  getInstalledAddons: (installationId) => electron.ipcRenderer.invoke("addon:get-installed", installationId),
  // Searching
  searchAddons: (payload) => electron.ipcRenderer.invoke("addon:search", payload),
  githubLookup: (ownerRepo) => electron.ipcRenderer.invoke("addon:github-lookup", ownerRepo),
  getCategories: () => electron.ipcRenderer.invoke("addon:get-categories"),
  // Install / Update / Uninstall
  installAddon: (payload) => electron.ipcRenderer.invoke("addon:install", payload),
  updateAddon: (payload) => electron.ipcRenderer.invoke("addon:update", payload),
  uninstallAddon: (payload) => electron.ipcRenderer.invoke("addon:uninstall", payload),
  updateAllAddons: (installationId) => electron.ipcRenderer.invoke("addon:update-all", installationId),
  // Update Checking
  checkUpdates: (installationId) => electron.ipcRenderer.invoke("addon:check-updates", installationId),
  // Manual provider correlation
  linkAddonToProvider: (payload) => electron.ipcRenderer.invoke("addon:link-to-provider", payload),
  // Addon flags
  setIgnored: (installationId, addonId, ignored) => electron.ipcRenderer.invoke("addon:set-ignored", { installationId, addonId, ignored }),
  setAutoUpdate: (installationId, addonId, enabled) => electron.ipcRenderer.invoke("addon:set-auto-update", { installationId, addonId, enabled }),
  // Version picker / pinning
  getAddonVersions: (payload) => electron.ipcRenderer.invoke("addon:get-versions", payload),
  pinVersion: (payload) => electron.ipcRenderer.invoke("addon:pin-version", payload),
  unpinVersion: (payload) => electron.ipcRenderer.invoke("addon:unpin-version", payload),
  // Per-addon release channel
  setChannel: (payload) => electron.ipcRenderer.invoke("addon:set-channel", payload),
  // Export / Import
  exportAddonList: (installationId) => electron.ipcRenderer.invoke("addon:export", installationId),
  importAddonList: (installationId) => electron.ipcRenderer.invoke("addon:import", installationId),
  // Window
  setWindowTitle: (title) => electron.ipcRenderer.invoke("window:set-title", title),
  // Shell
  openUrl: (url) => electron.ipcRenderer.invoke("shell:open-url", url),
  openPath: (p) => electron.ipcRenderer.invoke("shell:open-path", p),
  // ── Push events from main → renderer ────────────────────────────────────
  onWowDetected: (cb) => {
    const handler = (_e, installations) => cb(installations);
    electron.ipcRenderer.on("wow:detected", handler);
    return () => electron.ipcRenderer.removeListener("wow:detected", handler);
  },
  onDownloadProgress: (cb) => {
    const handler = (_e, progress) => cb(progress);
    electron.ipcRenderer.on("addon:download-progress", handler);
    return () => electron.ipcRenderer.removeListener("addon:download-progress", handler);
  },
  onTriggerUpdateCheck: (cb) => {
    const handler = (_e, id) => cb(id);
    electron.ipcRenderer.on("addon:trigger-update-check", handler);
    return () => electron.ipcRenderer.removeListener("addon:trigger-update-check", handler);
  },
  onBackgroundUpdated: (cb) => {
    const handler = (_e, id) => cb(id);
    electron.ipcRenderer.on("addon:background-updated", handler);
    return () => electron.ipcRenderer.removeListener("addon:background-updated", handler);
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
