"use strict";
const electron = require("electron");
const path = require("path");
const child_process = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const promises = require("stream/promises");
const AdmZip = require("adm-zip");
const axios = require("axios");
const FLAVOR_DEFS = [
  { dir: "_retail_", flavor: "retail", displayName: "WoW Retail", executableName: "Wow.exe" },
  { dir: "_classic_", flavor: "cataclysm", displayName: "WoW Classic (Cata)", executableName: "WowClassic.exe" },
  { dir: "_classic_era_", flavor: "classic_era", displayName: "WoW Classic Era", executableName: "WowClassic.exe" },
  { dir: "_wrath_", flavor: "wrath", displayName: "WoW Wrath Classic", executableName: "WowClassic.exe" },
  { dir: "_classic_ptr_", flavor: "classic_era", displayName: "WoW Classic PTR", executableName: "WowClassic.exe" },
  { dir: "_ptr_", flavor: "retail", displayName: "WoW Retail PTR", executableName: "WowT.exe" },
  { dir: "_xptr_", flavor: "retail", displayName: "WoW Retail XPTR", executableName: "WowT.exe" }
];
const COMMON_WINDOWS_PATHS = [
  "C:\\Program Files (x86)\\World of Warcraft",
  "C:\\Program Files\\World of Warcraft",
  "D:\\World of Warcraft",
  "D:\\Games\\World of Warcraft",
  "C:\\Games\\World of Warcraft"
];
const COMMON_MAC_PATHS = [
  "/Applications/World of Warcraft",
  `${process.env.HOME}/Applications/World of Warcraft`
];
const COMMON_LINUX_PATHS = [
  `${process.env.HOME}/Games/World of Warcraft`,
  "/opt/World of Warcraft"
];
function getWowPathFromRegistry() {
  if (process.platform !== "win32") return null;
  try {
    const regKeys = [
      "HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft",
      "HKLM\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft"
    ];
    for (const key of regKeys) {
      try {
        const result = child_process.execSync(
          `reg query "${key}" /v InstallPath 2>nul`,
          { encoding: "utf-8", timeout: 5e3 }
        );
        const match = result.match(/InstallPath\s+REG_SZ\s+(.+)/i);
        if (match) return match[1].trim();
      } catch {
      }
    }
  } catch {
  }
  return null;
}
function isWowRoot(dir) {
  try {
    const entries = fs.readdirSync(dir);
    return FLAVOR_DEFS.some((f) => entries.includes(f.dir));
  } catch {
    return false;
  }
}
function readClientVersion(flavorPath) {
  try {
    const buildInfo = path.join(flavorPath, ".build.info");
    if (fs.existsSync(buildInfo)) {
      const content = fs.readFileSync(buildInfo, "utf-8");
      const lines = content.split("\n");
      if (lines.length >= 2) {
        const headers = lines[0].split("|");
        const values = lines[1].split("|");
        const versionIdx = headers.findIndex((h) => h.trim() === "Version!STRING:0");
        if (versionIdx >= 0) return values[versionIdx]?.trim();
      }
    }
  } catch {
  }
  return void 0;
}
function buildInstallation(rootPath, flavor) {
  const flavorPath = path.join(rootPath, flavor.dir);
  const exePath = path.join(flavorPath, flavor.executableName);
  const addonsPath = path.join(flavorPath, "Interface", "AddOns");
  if (!fs.existsSync(flavorPath)) return null;
  if (!fs.existsSync(exePath) && !fs.existsSync(addonsPath)) return null;
  if (!fs.existsSync(addonsPath)) {
    try {
      fs.mkdirSync(addonsPath, { recursive: true });
    } catch {
      return null;
    }
  }
  return {
    id: crypto.randomUUID(),
    displayName: flavor.displayName,
    path: rootPath,
    flavor: flavor.flavor,
    addonsPath,
    clientVersion: readClientVersion(flavorPath)
  };
}
function findWowInstallations() {
  const rootPaths = /* @__PURE__ */ new Set();
  const regPath = getWowPathFromRegistry();
  if (regPath) rootPaths.add(regPath);
  const platformPaths = process.platform === "win32" ? COMMON_WINDOWS_PATHS : process.platform === "darwin" ? COMMON_MAC_PATHS : COMMON_LINUX_PATHS;
  for (const p of platformPaths) {
    if (fs.existsSync(p)) rootPaths.add(p);
  }
  const installations = [];
  for (const root of rootPaths) {
    if (!isWowRoot(root)) continue;
    for (const flavor of FLAVOR_DEFS) {
      const inst = buildInstallation(root, flavor);
      if (inst) installations.push(inst);
    }
  }
  const seen = /* @__PURE__ */ new Set();
  return installations.filter((i) => {
    if (seen.has(i.addonsPath)) return false;
    seen.add(i.addonsPath);
    return true;
  });
}
function validateWowPath(suppliedPath) {
  if (!fs.existsSync(suppliedPath)) {
    return { installations: [], error: "Path does not exist." };
  }
  if (isWowRoot(suppliedPath)) {
    const found = [];
    for (const flavor of FLAVOR_DEFS) {
      const inst = buildInstallation(suppliedPath, flavor);
      if (inst) found.push(inst);
    }
    return found.length ? { installations: found } : { installations: [], error: "No WoW flavor directories found at path." };
  }
  const exeExists = FLAVOR_DEFS.some(
    (f) => fs.existsSync(path.join(suppliedPath, f.executableName))
  );
  const addonsExists = fs.existsSync(path.join(suppliedPath, "Interface", "AddOns"));
  if (exeExists || addonsExists) {
    const parent = path.dirname(suppliedPath);
    const dirName = path.basename(suppliedPath);
    const flavor = FLAVOR_DEFS.find((f) => f.dir === dirName);
    if (flavor) {
      const inst = buildInstallation(parent, flavor);
      if (inst) return { installations: [inst] };
    }
  }
  return { installations: [], error: "Could not identify a WoW installation at this path." };
}
const DEFAULT_SETTINGS = {
  wowInstallations: [],
  activeInstallationId: null,
  curseForgApiKey: "",
  wagoApiKey: "",
  defaultChannel: "stable",
  autoCheckUpdates: true,
  autoCheckInterval: 60,
  minimizeToTray: true,
  launchAtLogin: false,
  theme: "dark"
};
function normalizeVersion(v) {
  if (!v) return "";
  let s = v.trim();
  const uIdx = s.lastIndexOf("_");
  if (uIdx >= 0) s = s.slice(uIdx + 1);
  s = s.replace(/^[^\d.]+/, "");
  return s || v;
}
const DATA_DIR = electron.app.getPath("userData");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const ADDONS_FILE = path.join(DATA_DIR, "installed-addons.json");
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
  }
  return fallback;
}
function writeJson(filePath, data) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}
function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}
function patchSettings(patch) {
  writeJson(SETTINGS_FILE, { ...getSettings(), ...patch });
}
function getInstalledAddons(installationId) {
  const store = readJson(ADDONS_FILE, {});
  return store[installationId] ?? [];
}
function saveInstalledAddons(installationId, addons) {
  const store = readJson(ADDONS_FILE, {});
  store[installationId] = addons;
  writeJson(ADDONS_FILE, store);
}
function upsertAddon(installationId, addon) {
  const list = getInstalledAddons(installationId);
  const idx = list.findIndex((a) => a.id === addon.id);
  if (idx >= 0) list[idx] = addon;
  else list.push(addon);
  saveInstalledAddons(installationId, list);
}
function removeAddon(installationId, addonId) {
  const list = getInstalledAddons(installationId).filter((a) => a.id !== addonId);
  saveInstalledAddons(installationId, list);
}
function stripColorCodes(s) {
  return s.replace(/\|c[0-9a-fA-F]{8}|\|r/g, "").trim();
}
function parseToc(filePath) {
  const toc = {
    title: "",
    notes: "",
    version: "",
    author: "",
    files: []
  };
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return toc;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("##")) {
      const rest = trimmed.slice(2).trim();
      const colonIdx = rest.indexOf(":");
      if (colonIdx < 0) continue;
      const key = rest.slice(0, colonIdx).trim().toLowerCase();
      const val = rest.slice(colonIdx + 1).trim();
      switch (key) {
        case "title":
          toc.title = stripColorCodes(val);
          break;
        case "notes":
          toc.notes = stripColorCodes(val);
          break;
        case "version":
          toc.version = val;
          break;
        case "author":
          toc.author = val;
          break;
        case "interface":
          toc.gameVersion = val;
          break;
        case "x-curse-project-id":
          toc.curseId = val;
          break;
        case "x-wowi-id":
          toc.wowiId = val;
          break;
        case "x-wago-id":
          toc.wagoId = val;
          break;
        case "dependencies":
        case "requiredeps": {
          const items = val.split(",").map((s) => s.trim()).filter(Boolean);
          toc.deps = [...toc.deps ?? [], ...items];
          toc.requiredDeps = [...toc.requiredDeps ?? [], ...items];
          break;
        }
        case "optionaldeps":
        case "loaddeps": {
          const items = val.split(",").map((s) => s.trim()).filter(Boolean);
          toc.deps = [...toc.deps ?? [], ...items];
          break;
        }
      }
    } else if (trimmed && !trimmed.startsWith("#")) {
      toc.files.push(trimmed);
    }
  }
  return toc;
}
function findTocFile(dir) {
  try {
    const entries = fs.readdirSync(dir);
    const dirName = path.basename(dir);
    const canonical = entries.find(
      (e) => e.toLowerCase() === `${dirName.toLowerCase()}.toc`
    );
    if (canonical) return path.join(dir, canonical);
    const any = entries.find((e) => e.toLowerCase().endsWith(".toc"));
    if (any) return path.join(dir, any);
  } catch {
  }
  return null;
}
function determineProvider(toc) {
  if (toc.wagoId) return { provider: "wago", sourceId: toc.wagoId };
  if (toc.curseId) return { provider: "curseforge", sourceId: toc.curseId };
  if (toc.wowiId) return { provider: "wowinterface", sourceId: toc.wowiId };
  return { provider: "unknown" };
}
function buildAddonId(provider, sourceId, dirName) {
  if (provider !== "unknown" && sourceId) return `${provider}:${sourceId}`;
  return `local:${dirName}`;
}
function scanAddons(installation) {
  const { addonsPath, id: installationId } = installation;
  if (!fs.existsSync(addonsPath)) return [];
  const existingById = new Map(
    getInstalledAddons(installationId).map((a) => [a.id, a])
  );
  const existingByDir = /* @__PURE__ */ new Map();
  for (const addon of existingById.values()) {
    if (addon.directories.length > 0) {
      existingByDir.set(addon.directories[0], addon);
    }
  }
  let dirs;
  try {
    dirs = fs.readdirSync(addonsPath, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const tocByDir = /* @__PURE__ */ new Map();
  for (const dir of dirs) {
    const tocFile = findTocFile(path.join(addonsPath, dir));
    if (tocFile) {
      tocByDir.set(dir, parseToc(tocFile));
    }
  }
  const subDirs = /* @__PURE__ */ new Set();
  const globalDepCount = /* @__PURE__ */ new Map();
  for (const [, toc] of tocByDir) {
    for (const dep of toc.deps ?? []) {
      globalDepCount.set(dep, (globalDepCount.get(dep) ?? 0) + 1);
    }
  }
  const dirsByProvKey = /* @__PURE__ */ new Map();
  for (const [dir, toc] of tocByDir) {
    if (subDirs.has(dir)) continue;
    const { provider, sourceId } = determineProvider(toc);
    if (provider === "unknown" || !sourceId) continue;
    const key = `${provider}:${sourceId}`;
    const bucket = dirsByProvKey.get(key) ?? [];
    bucket.push(dir);
    dirsByProvKey.set(key, bucket);
  }
  for (const [, dirs2] of dirsByProvKey) {
    if (dirs2.length <= 1) continue;
    const sorted = [...dirs2].sort((a, b) => {
      const diff = (globalDepCount.get(b) ?? 0) - (globalDepCount.get(a) ?? 0);
      if (diff !== 0) return diff;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });
    const master = sorted[0];
    for (const dir of dirs2) {
      if (dir !== master) subDirs.add(dir);
    }
  }
  const suppressedByMaster = /* @__PURE__ */ new Map();
  for (const [dirA, tocA] of tocByDir) {
    if (subDirs.has(dirA)) continue;
    for (const depB of tocA.requiredDeps ?? []) {
      if (!tocByDir.has(depB) || subDirs.has(depB)) continue;
      const { provider: provB } = determineProvider(tocByDir.get(depB));
      if (provB === "unknown") continue;
      const prefixFull = depB.toLowerCase();
      const prefixBase = depB.replace(/[-_]?(Core|Main|Base|Primary)$/i, "").toLowerCase();
      const nameA = dirA.toLowerCase();
      if (nameA !== prefixFull && (nameA.startsWith(prefixFull) || prefixBase.length > 2 && nameA.startsWith(prefixBase))) {
        subDirs.add(dirA);
        suppressedByMaster.set(dirA, depB);
        break;
      }
    }
  }
  const dirsByRoot = /* @__PURE__ */ new Map();
  for (const [dir] of tocByDir) {
    if (subDirs.has(dir)) continue;
    const sepIdx = dir.search(/[-_]/);
    if (sepIdx < 3) continue;
    const root = dir.slice(0, sepIdx).toLowerCase();
    const bucket = dirsByRoot.get(root) ?? [];
    bucket.push(dir);
    dirsByRoot.set(root, bucket);
  }
  for (const [dir] of tocByDir) {
    if (subDirs.has(dir)) continue;
    if (dir.search(/[-_]/) >= 0) continue;
    const key = dir.toLowerCase();
    if (dirsByRoot.has(key)) dirsByRoot.get(key).push(dir);
  }
  for (const [, rootDirs] of dirsByRoot) {
    if (rootDirs.length <= 1) continue;
    const sorted = [...rootDirs].sort((a, b) => {
      const diff = (globalDepCount.get(b) ?? 0) - (globalDepCount.get(a) ?? 0);
      if (diff !== 0) return diff;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });
    const master = sorted[0];
    for (const dir of sorted.slice(1)) {
      subDirs.add(dir);
      suppressedByMaster.set(dir, master);
    }
  }
  const result = [];
  const now = Date.now();
  for (const [dirName, toc] of tocByDir) {
    if (subDirs.has(dirName)) continue;
    const tocPath = findTocFile(path.join(addonsPath, dirName));
    let { provider, sourceId } = determineProvider(toc);
    const prev = existingByDir.get(dirName);
    if (prev && prev.provider !== "unknown" && prev.sourceId) {
      provider = prev.provider;
      sourceId = prev.sourceId;
    }
    const id = buildAddonId(provider, sourceId, dirName);
    const relatedDirsSet = /* @__PURE__ */ new Set([dirName]);
    for (const dep of toc.deps ?? []) {
      if (tocByDir.has(dep)) relatedDirsSet.add(dep);
    }
    if (provider !== "unknown" && sourceId) {
      for (const d of dirsByProvKey.get(`${provider}:${sourceId}`) ?? []) {
        relatedDirsSet.add(d);
      }
    }
    for (const [companion, master] of suppressedByMaster) {
      if (master === dirName) relatedDirsSet.add(companion);
    }
    const prevAddon = existingByDir.get(dirName);
    if (prevAddon) {
      for (const d of prevAddon.directories) {
        if (tocByDir.has(d)) relatedDirsSet.add(d);
      }
    }
    const relatedDirs = Array.from(relatedDirsSet);
    const existing = existingById.get(id);
    const name = toc.title || dirName;
    result.push({
      id,
      name,
      version: toc.version || "unknown",
      author: toc.author,
      notes: toc.notes,
      directories: relatedDirs,
      tocPath,
      provider,
      sourceId,
      wowInstallationId: installationId,
      installedAt: existing?.installedAt ?? now,
      updatedAt: existing?.updatedAt ?? now,
      latestVersion: existing?.latestVersion,
      downloadUrl: existing?.downloadUrl,
      updateAvailable: existing?.updateAvailable,
      channelPreference: existing?.channelPreference ?? "stable",
      gameVersion: toc.gameVersion,
      websiteUrl: existing?.websiteUrl,
      thumbnailUrl: existing?.thumbnailUrl,
      autoUpdate: existing?.autoUpdate ?? false,
      isIgnored: existing?.isIgnored ?? false
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
const TMP_DIR = path.join(process.env.TEMP ?? "/tmp", "wow-addon-manager");
function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}
async function downloadFile(url, onProgress, headers) {
  ensureTmpDir();
  const tmpFile = path.join(TMP_DIR, `${crypto.randomUUID()}.zip`);
  return new Promise((resolve, reject) => {
    const makeRequest = (reqUrl, redirectCount = 0) => {
      if (redirectCount > 10) {
        reject(new Error("Too many redirects"));
        return;
      }
      const protocol = reqUrl.startsWith("https") ? https : http;
      const opts = { headers: { "User-Agent": "WoWAddonManager/1.0", ...headers } };
      protocol.get(reqUrl, opts, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          makeRequest(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} downloading ${reqUrl}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] ?? "0", 10);
        let downloaded = 0;
        const out = fs.createWriteStream(tmpFile);
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (onProgress && total > 0) {
            onProgress(Math.round(downloaded / total * 100), downloaded, total);
          }
        });
        promises.pipeline(res, out).then(() => resolve(tmpFile)).catch(reject);
      }).on("error", reject);
    };
    makeRequest(url);
  });
}
function extractZip(zipPath, addonsPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const topLevelDirs = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const parts = entry.entryName.replace(/\\/g, "/").split("/");
    if (parts[0]) topLevelDirs.add(parts[0]);
  }
  for (const dir of topLevelDirs) {
    const target = path.join(addonsPath, dir);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  zip.extractAllTo(addonsPath, true);
  return Array.from(topLevelDirs);
}
function cleanTmp(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
  }
}
async function installAddon(searchResult, installation, channel = "stable", win, onProgress) {
  const { addonsPath, id: installationId } = installation;
  if (!searchResult.downloadUrl) {
    throw new Error("No download URL available for this addon.");
  }
  const progressCb = (pct, bytes, total) => {
    if (win) {
      win.webContents.send("addon:download-progress", {
        addonId: searchResult.externalId,
        percent: pct,
        bytesDownloaded: bytes,
        totalBytes: total
      });
    }
  };
  const tmpZip = await downloadFile(searchResult.downloadUrl, progressCb);
  try {
    const extractedDirs = extractZip(tmpZip, addonsPath);
    const now = Date.now();
    const existing = getInstalledAddons(installationId).find(
      (a) => a.sourceId === searchResult.externalId && a.provider === searchResult.provider
    );
    const addon = {
      id: `${searchResult.provider}:${searchResult.externalId}`,
      name: searchResult.name,
      version: searchResult.latestVersion,
      author: searchResult.author,
      notes: searchResult.summary,
      directories: extractedDirs,
      tocPath: path.join(addonsPath, extractedDirs[0], `${extractedDirs[0]}.toc`),
      provider: searchResult.provider,
      sourceId: searchResult.externalId,
      wowInstallationId: installationId,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      latestVersion: searchResult.latestVersion,
      downloadUrl: searchResult.downloadUrl,
      updateAvailable: false,
      channelPreference: channel,
      websiteUrl: searchResult.websiteUrl,
      thumbnailUrl: searchResult.thumbnailUrl,
      autoUpdate: existing?.autoUpdate ?? false,
      isIgnored: false
    };
    upsertAddon(installationId, addon);
    return addon;
  } finally {
    cleanTmp(tmpZip);
  }
}
function uninstallAddon(addon, installation) {
  const { addonsPath } = installation;
  for (const dir of addon.directories) {
    const target = path.join(addonsPath, dir);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  removeAddon(installation.id, addon.id);
}
class BaseProvider {
  /** Fetch full details for a single result (optional, enriches thumbnails etc.) */
  async getDetails(externalId, _flavor) {
    return { externalId };
  }
  /** Get available versions for an addon (for version picker). Override in subclasses. */
  async getVersions(_sourceId, _channel) {
    return [];
  }
}
const WAGO_BASE = "https://addons.wago.io/api";
const FLAVOR_MAP = {
  retail: "retail",
  classic: "cata",
  cataclysm: "cata",
  classic_era: "classic",
  burning_crusade: "tbc",
  wrath: "wrath"
};
class WagoProvider extends BaseProvider {
  name = "wago";
  client;
  apiKey;
  /** Active WoW flavour – set before each update-check loop via setActiveFlavor() */
  activeFlavor = "retail";
  constructor(apiKey = "") {
    super();
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: WAGO_BASE,
      timeout: 15e3,
      headers: {
        "User-Agent": "WoWAddonManager/1.0",
        "Accept": "application/json",
        ...apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
      }
    });
  }
  setApiKey(key) {
    this.apiKey = key;
    this.client.defaults.headers["Authorization"] = key ? `Bearer ${key}` : void 0;
  }
  /** Call this before running checkUpdate() so the correct game_version is sent. */
  setActiveFlavor(flavor) {
    this.activeFlavor = flavor;
  }
  hasKey() {
    return !!this.apiKey;
  }
  pickRelease(releases, channel) {
    if (channel === "alpha") return releases.alpha ?? releases.beta ?? releases.stable;
    if (channel === "beta") return releases.beta ?? releases.stable;
    return releases.stable;
  }
  mapAddon(wa, channel = "stable") {
    const release = this.pickRelease(wa.recent_release ?? {}, channel);
    const authors = Array.isArray(wa.authors) ? wa.authors.join(", ") : wa.authors ?? "Unknown";
    return {
      externalId: wa.slug,
      provider: "wago",
      name: wa.display_name,
      summary: "",
      author: authors,
      downloadCount: wa.downloads ?? 0,
      thumbnailUrl: wa.thumbnail,
      latestVersion: release?.label ?? "0",
      websiteUrl: wa.website_url ?? `https://addons.wago.io/addons/${wa.slug}`,
      releaseDate: release?.created_at,
      categories: wa.tags,
      downloadUrl: release?.download_link ?? release?.link
    };
  }
  /**
   * Wago does not provide a public addon search/browse API.
   * Always returns an empty list.
   */
  async search(_query, _flavor, _page, _pageSize) {
    return [];
  }
  async checkUpdate(addon, channel) {
    if (!addon.sourceId || !this.apiKey) return null;
    try {
      const gameVersion = FLAVOR_MAP[this.activeFlavor] ?? "retail";
      const res = await this.client.get(
        `/external/addons/${addon.sourceId}`,
        { params: { game_version: gameVersion } }
      );
      const releases = res.data.recent_release ?? {};
      const release = this.pickRelease(releases, channel);
      if (!release) return null;
      return {
        latestVersion: release.label,
        downloadUrl: release.download_link ?? release.link ?? "",
        releaseDate: release.created_at
      };
    } catch {
      return null;
    }
  }
  async getVersions(sourceId, channel) {
    if (!sourceId || !this.apiKey) return [];
    try {
      const gameVersion = FLAVOR_MAP[this.activeFlavor] ?? "retail";
      const res = await this.client.get(
        `/external/addons/${sourceId}`,
        { params: { game_version: gameVersion } }
      );
      const releases = res.data.recent_release ?? {};
      const versions = [];
      for (const [ch, release] of Object.entries(releases)) {
        if (!release) continue;
        const url = release.download_link ?? release.link;
        if (!url) continue;
        versions.push({
          version: release.label,
          displayName: `${release.label} (${ch})`,
          downloadUrl: url,
          releaseDate: release.created_at,
          releaseType: ch
        });
      }
      return versions;
    } catch {
      return [];
    }
  }
  async getDetails(externalId, flavor) {
    if (!this.apiKey) return { externalId };
    try {
      const gameVersion = FLAVOR_MAP[flavor] ?? "retail";
      const res = await this.client.get(
        `/external/addons/${externalId}`,
        { params: { game_version: gameVersion } }
      );
      return this.mapAddon(res.data);
    } catch {
      return { externalId };
    }
  }
}
const CF_BASE = "https://api.curseforge.com/v1";
const WOW_GAME_ID = 1;
const GAME_VERSION_TYPE_MAP = {
  classic_era: 67408,
  // CF2WowGameVersionType.Classic
  burning_crusade: 73246,
  // CF2WowGameVersionType.BurningCrusade
  wrath: 73713,
  // CF2WowGameVersionType.WOTLK
  classic: 77522,
  // CF2WowGameVersionType.Cata  (app's "classic" = Cata Classic)
  cataclysm: 77522
  // CF2WowGameVersionType.Cata
};
const CHANNEL_TYPE = {
  stable: [1],
  beta: [1, 2],
  alpha: [1, 2, 3]
};
const CF_SORT_MAP = {
  popularity: 2,
  name: 4,
  downloads: 6,
  updated: 3
};
class CurseForgeProvider extends BaseProvider {
  name = "curseforge";
  client;
  apiKey;
  constructor(apiKey = "") {
    super();
    this.apiKey = apiKey;
    this.client = this.buildClient(apiKey);
  }
  buildClient(apiKey) {
    return axios.create({
      baseURL: CF_BASE,
      timeout: 15e3,
      headers: {
        "User-Agent": "WoWAddonManager/1.0",
        "Accept": "application/json",
        "x-api-key": apiKey
      }
    });
  }
  setApiKey(key) {
    this.apiKey = key;
    this.client = this.buildClient(key);
  }
  hasKey() {
    return !!this.apiKey;
  }
  async resolveDownloadUrl(modId, file) {
    if (file.downloadUrl) return file.downloadUrl;
    try {
      const fileRes = await this.client.get(`/mods/${modId}/files/${file.id}`);
      const detailUrl = fileRes.data?.data?.downloadUrl;
      if (detailUrl) return detailUrl;
    } catch {
    }
    try {
      const urlRes = await this.client.get(`/mods/${modId}/files/${file.id}/download-url`);
      return urlRes.data.data ?? "";
    } catch {
      return "";
    }
  }
  // ── Category cache ──────────────────────────────────────────────────────
  categoryCache = null;
  categoryCacheTime = 0;
  CATEGORY_TTL = 60 * 60 * 1e3;
  // 1 hour
  async getCategories() {
    if (!this.apiKey) return [];
    const now = Date.now();
    if (this.categoryCache && now - this.categoryCacheTime < this.CATEGORY_TTL) {
      return this.categoryCache;
    }
    try {
      const res = await this.client.get("/categories", {
        params: { gameId: WOW_GAME_ID }
      });
      const categories = (res.data.data ?? []).filter((c) => !c.isClass && c.parentCategoryId && c.parentCategoryId > 0).map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        iconUrl: c.iconUrl,
        parentId: c.parentCategoryId
      })).sort((a, b) => a.name.localeCompare(b.name));
      this.categoryCache = categories;
      this.categoryCacheTime = now;
      return categories;
    } catch (err) {
      console.error("Failed to fetch CurseForge categories:", err);
      return this.categoryCache ?? [];
    }
  }
  mapMod(mod, channel = "stable") {
    const allowedTypes = CHANNEL_TYPE[channel];
    const latestFile = (mod.latestFiles ?? []).filter((f) => allowedTypes.includes(f.releaseType)).sort((a, b) => new Date(b.fileDate).getTime() - new Date(a.fileDate).getTime())[0];
    return {
      externalId: String(mod.id),
      provider: "curseforge",
      name: mod.name,
      summary: mod.summary,
      author: mod.authors.map((a) => a.name).join(", ") || "Unknown",
      downloadCount: mod.downloadCount,
      thumbnailUrl: mod.logo?.thumbnailUrl,
      websiteUrl: mod.links?.websiteUrl,
      latestVersion: latestFile?.displayName ?? latestFile?.fileName ?? "0",
      downloadUrl: latestFile?.downloadUrl ?? void 0,
      releaseDate: latestFile?.fileDate,
      categories: mod.categories?.map((c) => c.name)
    };
  }
  async search(query, flavor, page = 1, pageSize = 20, categoryId, sortBy) {
    if (!this.apiKey) return [];
    const gameVersionTypeId = GAME_VERSION_TYPE_MAP[flavor];
    const cfSortField = sortBy ? CF_SORT_MAP[sortBy] : 2;
    const sortOrder = sortBy === "name" ? "asc" : "desc";
    const params = {
      gameId: WOW_GAME_ID,
      // Do NOT pass classId – the WoW class ID is not 6 (that is Minecraft mods).
      // gameId=1 already scopes results to WoW addons exclusively.
      searchFilter: query.trim() || void 0,
      ...gameVersionTypeId ? { gameVersionTypeId } : {},
      ...categoryId ? { categoryId } : {},
      index: (page - 1) * pageSize,
      pageSize,
      sortField: cfSortField,
      sortOrder
    };
    const res = await this.client.get("/mods/search", { params });
    return (res.data.data ?? []).map((m) => this.mapMod(m));
  }
  async checkUpdate(addon, channel) {
    if (!this.apiKey || !addon.sourceId) return null;
    try {
      const allowedTypes = CHANNEL_TYPE[channel];
      const res = await this.client.get(
        `/mods/${addon.sourceId}/files`,
        { params: { pageSize: 10 } }
      );
      const latestFile = res.data.data.filter((f) => allowedTypes.includes(f.releaseType)).sort((a, b) => new Date(b.fileDate).getTime() - new Date(a.fileDate).getTime())[0];
      if (!latestFile) return null;
      const downloadUrl = await this.resolveDownloadUrl(addon.sourceId, latestFile);
      if (!downloadUrl) return null;
      return {
        latestVersion: latestFile.displayName || latestFile.fileName,
        downloadUrl,
        releaseDate: latestFile.fileDate
      };
    } catch {
      return null;
    }
  }
  cfReleaseType(type) {
    if (type === 3) return "alpha";
    if (type === 2) return "beta";
    return "stable";
  }
  async getVersions(sourceId, channel) {
    if (!this.apiKey || !sourceId) return [];
    try {
      const allowedTypes = CHANNEL_TYPE[channel];
      const res = await this.client.get(
        `/mods/${sourceId}/files`,
        { params: { pageSize: 50 } }
      );
      const files = (res.data.data ?? []).filter((f) => allowedTypes.includes(f.releaseType)).sort((a, b) => new Date(b.fileDate).getTime() - new Date(a.fileDate).getTime());
      const versions = [];
      for (const f of files) {
        const downloadUrl = await this.resolveDownloadUrl(sourceId, f);
        if (!downloadUrl) continue;
        versions.push({
          version: f.displayName || f.fileName,
          displayName: f.displayName || f.fileName,
          downloadUrl,
          releaseDate: f.fileDate,
          releaseType: this.cfReleaseType(f.releaseType),
          gameVersions: f.gameVersions
        });
      }
      return versions;
    } catch {
      return [];
    }
  }
}
const WOWI_BASE = "https://api.mmoui.com/v3/game/WOW";
class WoWInterfaceProvider extends BaseProvider {
  name = "wowinterface";
  client;
  // Cache the full file list to avoid re-fetching on every search
  fileListCache = null;
  fileListCacheTime = 0;
  FILE_LIST_TTL = 15 * 60 * 1e3;
  // 15 minutes
  constructor() {
    super();
    this.client = axios.create({
      baseURL: WOWI_BASE,
      timeout: 15e3,
      headers: {
        "User-Agent": "WoWAddonManager/1.0",
        Accept: "application/json"
      }
    });
  }
  getThumbnail(thumbs) {
    if (!thumbs) return void 0;
    const url = Array.isArray(thumbs) ? thumbs[0] : thumbs;
    if (!url) return void 0;
    return url.startsWith("http") ? url : `https:${url}`;
  }
  mapFile(f) {
    const id = String(f.UID);
    const details = f;
    const downloadUrl = details.UIDownload ?? `https://cdn.wowinterface.com/downloads/getfile.php?id=${id}`;
    return {
      externalId: id,
      provider: "wowinterface",
      name: f.UIName,
      summary: details.UIDescription ?? "",
      author: f.UIAuthorName ?? "Unknown",
      downloadCount: details.UIHitCount ?? f.UIDownloadTotal ?? 0,
      thumbnailUrl: this.getThumbnail(f.UIIMG_Thumbs),
      websiteUrl: f.UIFileInfoURL ?? `https://www.wowinterface.com/downloads/info${id}`,
      latestVersion: f.UIVersion,
      releaseDate: f.UIDate ? new Date(f.UIDate).toISOString() : void 0,
      downloadUrl
    };
  }
  async getFileList() {
    const now = Date.now();
    if (this.fileListCache && now - this.fileListCacheTime < this.FILE_LIST_TTL) {
      return this.fileListCache;
    }
    try {
      const res = await this.client.get("/filelist.json");
      if (Array.isArray(res.data)) {
        this.fileListCache = res.data;
        this.fileListCacheTime = now;
        return res.data;
      }
    } catch {
    }
    return this.fileListCache ?? [];
  }
  async search(query, _flavor, page = 1, pageSize = 20) {
    if (!query.trim()) return [];
    const list = await this.getFileList();
    const lower = query.toLowerCase();
    const matches = list.filter((f) => f.UIName?.toLowerCase().includes(lower));
    const start = (page - 1) * pageSize;
    return matches.slice(start, start + pageSize).map((f) => this.mapFile(f));
  }
  async checkUpdate(addon, _channel) {
    if (!addon.sourceId) return null;
    try {
      const res = await this.client.get(`/filedetails/${addon.sourceId}.json`);
      const details = Array.isArray(res.data) ? res.data[0] : null;
      if (!details) return null;
      return {
        latestVersion: details.UIVersion,
        downloadUrl: details.UIDownload,
        releaseDate: details.UIDate ? new Date(details.UIDate).toISOString() : void 0
      };
    } catch {
      return null;
    }
  }
  async getVersions(sourceId, _channel) {
    if (!sourceId) return [];
    try {
      const res = await this.client.get(`/filedetails/${sourceId}.json`);
      const d = Array.isArray(res.data) ? res.data[0] : null;
      if (!d) return [];
      return [{
        version: d.UIVersion,
        displayName: d.UIVersion,
        downloadUrl: d.UIDownload,
        releaseDate: d.UIDate ? new Date(d.UIDate).toISOString() : void 0,
        releaseType: "stable"
      }];
    } catch {
      return [];
    }
  }
  async getDetails(externalId, _flavor) {
    try {
      const res = await this.client.get(`/filedetails/${externalId}.json`);
      const d = Array.isArray(res.data) ? res.data[0] : null;
      if (!d) return { externalId };
      return this.mapFile(d);
    } catch {
      return { externalId };
    }
  }
}
const GH_BASE = "https://api.github.com";
class GitHubProvider extends BaseProvider {
  name = "github";
  client;
  constructor(token) {
    super();
    this.client = axios.create({
      baseURL: GH_BASE,
      timeout: 15e3,
      headers: {
        "User-Agent": "WoWAddonManager/1.0",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...token ? { Authorization: `Bearer ${token}` } : {}
      }
    });
  }
  /** Pick the best ZIP/release asset from a release */
  pickAsset(assets) {
    const zipAssets = assets.filter(
      (a) => a.content_type === "application/zip" || a.name.endsWith(".zip")
    );
    if (!zipAssets.length) return null;
    const filtered = zipAssets.filter(
      (a) => !a.name.includes("Source") && !a.name.includes("source")
    );
    return filtered[0] ?? zipAssets[0];
  }
  async search() {
    return [];
  }
  /** Resolve a GitHub "owner/repo" sourceId to the latest release */
  async checkUpdate(addon, channel) {
    if (!addon.sourceId || !addon.sourceId.includes("/")) return null;
    try {
      const res = await this.client.get(
        `/repos/${addon.sourceId}/releases`,
        { params: { per_page: 10 } }
      );
      const releases = res.data.filter((r) => !r.draft).filter((r) => channel !== "stable" || !r.prerelease);
      const latest = releases[0];
      if (!latest) return null;
      const asset = this.pickAsset(latest.assets);
      if (!asset) return null;
      return {
        latestVersion: latest.tag_name.replace(/^v/, ""),
        downloadUrl: asset.browser_download_url,
        changelog: latest.body,
        releaseDate: latest.published_at
      };
    } catch {
      return null;
    }
  }
  async getVersions(sourceId, channel) {
    if (!sourceId || !sourceId.includes("/")) return [];
    try {
      const res = await this.client.get(
        `/repos/${sourceId}/releases`,
        { params: { per_page: 30 } }
      );
      const versions = [];
      for (const r of res.data) {
        if (r.draft) continue;
        if (channel === "stable" && r.prerelease) continue;
        const asset = this.pickAsset(r.assets);
        if (!asset) continue;
        versions.push({
          version: r.tag_name.replace(/^v/, ""),
          displayName: r.name || r.tag_name,
          downloadUrl: asset.browser_download_url,
          releaseDate: r.published_at,
          releaseType: r.prerelease ? "beta" : "stable"
        });
      }
      return versions;
    } catch {
      return [];
    }
  }
  /** Convert a GitHub repo "owner/repo" to a search result card */
  async getRepoInfo(ownerRepo) {
    try {
      const [repoRes, releasesRes] = await Promise.all([
        this.client.get(`/repos/${ownerRepo}`),
        this.client.get(`/repos/${ownerRepo}/releases`, { params: { per_page: 5 } })
      ]);
      const repo = repoRes.data;
      const latest = releasesRes.data.find((r) => !r.draft && !r.prerelease);
      const asset = latest ? this.pickAsset(latest.assets) : null;
      return {
        externalId: ownerRepo,
        provider: "github",
        name: ownerRepo.split("/")[1],
        summary: repo.description ?? "",
        author: ownerRepo.split("/")[0],
        downloadCount: asset?.download_count ?? 0,
        thumbnailUrl: repo.owner.avatar_url,
        websiteUrl: repo.html_url,
        latestVersion: latest?.tag_name.replace(/^v/, "") ?? "0",
        downloadUrl: asset?.browser_download_url,
        releaseDate: latest?.published_at
      };
    } catch {
      return null;
    }
  }
}
const wago$1 = new WagoProvider();
const curseforge$1 = new CurseForgeProvider();
const wowinterface$1 = new WoWInterfaceProvider();
const github$1 = new GitHubProvider();
function syncProvidersWithSettings(settings) {
  if (settings.wagoApiKey) wago$1.setApiKey(settings.wagoApiKey);
  if (settings.curseForgApiKey) curseforge$1.setApiKey(settings.curseForgApiKey);
}
function registerIpcHandlers(win) {
  syncProvidersWithSettings(getSettings());
  electron.ipcMain.handle("settings:get", () => getSettings());
  electron.ipcMain.handle("settings:patch", (_e, patch) => {
    patchSettings(patch);
    const updated = getSettings();
    syncProvidersWithSettings(updated);
    electron.ipcMain.emit("settings:updated");
    return updated;
  });
  electron.ipcMain.handle("wow:find", () => {
    return findWowInstallations();
  });
  electron.ipcMain.handle("wow:validate-path", (_e, suppliedPath) => {
    return validateWowPath(suppliedPath);
  });
  electron.ipcMain.handle("wow:browse-path", async () => {
    const result = await electron.dialog.showOpenDialog(win, {
      title: "Select World of Warcraft Folder",
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
  electron.ipcMain.handle("addon:scan", (_e, installationId) => {
    const settings = getSettings();
    const installation = settings.wowInstallations.find((i) => i.id === installationId);
    if (!installation) throw new Error(`Installation not found: ${installationId}`);
    const addons = scanAddons(installation);
    saveInstalledAddons(installationId, addons);
    return addons;
  });
  electron.ipcMain.handle("addon:get-installed", (_e, installationId) => {
    return getInstalledAddons(installationId);
  });
  electron.ipcMain.handle("addon:search", async (_e, payload) => {
    const { query, provider, flavor = "retail", page = 1, pageSize = 20, categoryId, sortBy } = payload;
    const results = [];
    const providers = categoryId ? ["curseforge"] : provider ? [provider] : ["wago", "curseforge", "wowinterface"];
    const searches = providers.map(async (p) => {
      try {
        switch (p) {
          case "wago":
            return await wago$1.search(query, flavor, page, pageSize);
          case "curseforge":
            return await curseforge$1.search(query, flavor, page, pageSize, categoryId, sortBy);
          case "wowinterface":
            return await wowinterface$1.search(query, flavor, page, pageSize);
        }
      } catch (err) {
        console.error(`Search failed on ${p}:`, err);
        return [];
      }
      return [];
    });
    const batches = await Promise.allSettled(searches);
    for (const batch of batches) {
      if (batch.status === "fulfilled" && batch.value) results.push(...batch.value);
    }
    if (!sortBy || !categoryId) {
      return results.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0));
    }
    return results;
  });
  electron.ipcMain.handle("addon:get-categories", async () => {
    return curseforge$1.getCategories();
  });
  electron.ipcMain.handle("addon:github-lookup", async (_e, ownerRepo) => {
    return github$1.getRepoInfo(ownerRepo);
  });
  electron.ipcMain.handle("addon:install", async (_e, payload) => {
    const { result, installationId, channel } = payload;
    const settings = getSettings();
    const installation = settings.wowInstallations.find((i) => i.id === installationId);
    if (!installation) throw new Error(`Installation not found: ${installationId}`);
    return installAddon(result, installation, channel ?? settings.defaultChannel, win);
  });
  electron.ipcMain.handle("addon:update", async (_e, payload) => {
    const { addonId, installationId } = payload;
    const settings = getSettings();
    const installation = settings.wowInstallations.find((i) => i.id === installationId);
    if (!installation) throw new Error(`Installation not found: ${installationId}`);
    const addons = getInstalledAddons(installationId);
    const addon = addons.find((a) => a.id === addonId);
    if (!addon) throw new Error(`Addon not found: ${addonId}`);
    if (!addon.downloadUrl) {
      const channel = addon.channelPreference ?? settings.defaultChannel;
      let info = null;
      wago$1.setActiveFlavor(installation.flavor);
      switch (addon.provider) {
        case "wago":
          info = await wago$1.checkUpdate(addon, channel);
          break;
        case "curseforge":
          info = await curseforge$1.checkUpdate(addon, channel);
          break;
        case "wowinterface":
          info = await wowinterface$1.checkUpdate(addon, channel);
          break;
        case "github":
          info = await github$1.checkUpdate(addon, channel);
          break;
      }
      if (!info?.downloadUrl) {
        throw new Error("No download URL available; provider did not return one.");
      }
      addon.downloadUrl = info.downloadUrl;
      addon.latestVersion = info.latestVersion;
      saveInstalledAddons(installationId, addons);
    }
    const result = {
      externalId: addon.sourceId ?? addonId,
      provider: addon.provider,
      name: addon.name,
      summary: addon.notes,
      author: addon.author,
      downloadCount: 0,
      latestVersion: addon.latestVersion ?? addon.version,
      downloadUrl: addon.downloadUrl,
      websiteUrl: addon.websiteUrl,
      thumbnailUrl: addon.thumbnailUrl
    };
    return installAddon(result, installation, addon.channelPreference, win);
  });
  electron.ipcMain.handle("addon:check-updates", async (_e, installationId) => {
    const settings = getSettings();
    const installation = settings.wowInstallations.find((i) => i.id === installationId);
    if (!installation) throw new Error(`Installation not found: ${installationId}`);
    const allAddons = getInstalledAddons(installationId);
    const checkable = allAddons.filter(
      (a) => !a.isIgnored && a.provider !== "unknown"
    );
    wago$1.setActiveFlavor(installation.flavor);
    for (const addon of checkable) {
      try {
        const channel = addon.channelPreference ?? settings.defaultChannel;
        let info = null;
        switch (addon.provider) {
          case "wago":
            info = await wago$1.checkUpdate(addon, channel);
            break;
          case "curseforge":
            info = await curseforge$1.checkUpdate(addon, channel);
            break;
          case "wowinterface":
            info = await wowinterface$1.checkUpdate(addon, channel);
            break;
          case "github":
            info = await github$1.checkUpdate(addon, channel);
            break;
        }
        if (info) {
          const hasUpdate = normalizeVersion(info.latestVersion) !== normalizeVersion(addon.version);
          addon.latestVersion = info.latestVersion;
          addon.downloadUrl = info.downloadUrl;
          addon.updateAvailable = hasUpdate;
        } else {
          addon.updateAvailable = false;
        }
      } catch (err) {
        console.error(`Update check failed for ${addon.name}:`, err);
      }
    }
    saveInstalledAddons(installationId, allAddons);
    return allAddons;
  });
  electron.ipcMain.handle("addon:uninstall", (_e, payload) => {
    const { addonId, installationId } = payload;
    const settings = getSettings();
    const installation = settings.wowInstallations.find((i) => i.id === installationId);
    if (!installation) throw new Error(`Installation not found: ${installationId}`);
    const addons = getInstalledAddons(installationId);
    const addon = addons.find((a) => a.id === addonId);
    if (!addon) throw new Error(`Addon not found: ${addonId}`);
    uninstallAddon(addon, installation);
    return { success: true };
  });
  electron.ipcMain.handle("addon:link-to-provider", (_e, payload) => {
    const { addonId, installationId, result } = payload;
    const addons = getInstalledAddons(installationId);
    const addonIndex = addons.findIndex((a) => a.id === addonId);
    if (addonIndex < 0) throw new Error(`Addon not found: ${addonId}`);
    addons[addonIndex];
    const newId = `${result.provider}:${result.externalId}`;
    const withoutDupe = addons.filter((a, i) => i === addonIndex || a.id !== newId);
    const target = withoutDupe.find((a) => a.id === addonId);
    target.id = newId;
    target.provider = result.provider;
    target.sourceId = result.externalId;
    target.websiteUrl = result.websiteUrl ?? target.websiteUrl;
    target.thumbnailUrl = result.thumbnailUrl ?? target.thumbnailUrl;
    target.updateAvailable = false;
    target.latestVersion = void 0;
    target.downloadUrl = void 0;
    saveInstalledAddons(installationId, withoutDupe);
    return target;
  });
  electron.ipcMain.handle("addon:set-ignored", (_e, { installationId, addonId, ignored }) => {
    const addons = getInstalledAddons(installationId);
    const addon = addons.find((a) => a.id === addonId);
    if (!addon) return;
    addon.isIgnored = ignored;
    saveInstalledAddons(installationId, addons);
    return addon;
  });
  electron.ipcMain.handle("addon:set-auto-update", (_e, { installationId, addonId, enabled }) => {
    const addons = getInstalledAddons(installationId);
    const addon = addons.find((a) => a.id === addonId);
    if (!addon) return;
    addon.autoUpdate = enabled;
    saveInstalledAddons(installationId, addons);
    return addon;
  });
  electron.ipcMain.handle("addon:get-versions", async (_e, payload) => {
    const { addonId, installationId } = payload;
    const addons = getInstalledAddons(installationId);
    const addon = addons.find((a) => a.id === addonId);
    if (!addon || !addon.sourceId) return [];
    const settings = getSettings();
    const installation = settings.wowInstallations.find((i) => i.id === installationId);
    if (installation) wago$1.setActiveFlavor(installation.flavor);
    const channel = addon.channelPreference ?? settings.defaultChannel;
    switch (addon.provider) {
      case "curseforge":
        return curseforge$1.getVersions(addon.sourceId, channel);
      case "github":
        return github$1.getVersions(addon.sourceId, channel);
      case "wowinterface":
        return wowinterface$1.getVersions(addon.sourceId, channel);
      case "wago":
        return wago$1.getVersions(addon.sourceId, channel);
      default:
        return [];
    }
  });
  electron.ipcMain.handle("addon:pin-version", async (_e, payload) => {
    const { addonId, installationId, version, downloadUrl } = payload;
    const settings = getSettings();
    const installation = settings.wowInstallations.find((i) => i.id === installationId);
    if (!installation) throw new Error(`Installation not found: ${installationId}`);
    const addons = getInstalledAddons(installationId);
    const addon = addons.find((a) => a.id === addonId);
    if (!addon) throw new Error(`Addon not found: ${addonId}`);
    const result = {
      externalId: addon.sourceId ?? addonId,
      provider: addon.provider,
      name: addon.name,
      summary: addon.notes,
      author: addon.author,
      downloadCount: 0,
      latestVersion: version,
      downloadUrl,
      websiteUrl: addon.websiteUrl,
      thumbnailUrl: addon.thumbnailUrl
    };
    const installed = await installAddon(result, installation, addon.channelPreference, win);
    const updatedAddons = getInstalledAddons(installationId);
    const updatedAddon = updatedAddons.find((a) => a.id === addonId);
    if (updatedAddon) {
      updatedAddon.pinnedVersion = version;
      updatedAddon.pinnedDownloadUrl = downloadUrl;
      updatedAddon.autoUpdate = false;
      saveInstalledAddons(installationId, updatedAddons);
      return updatedAddon;
    }
    return installed;
  });
  electron.ipcMain.handle("addon:unpin-version", (_e, payload) => {
    const { addonId, installationId } = payload;
    const addons = getInstalledAddons(installationId);
    const addon = addons.find((a) => a.id === addonId);
    if (!addon) throw new Error(`Addon not found: ${addonId}`);
    addon.pinnedVersion = void 0;
    addon.pinnedDownloadUrl = void 0;
    saveInstalledAddons(installationId, addons);
    return addon;
  });
  electron.ipcMain.handle("shell:open-url", (_e, url) => electron.shell.openExternal(url));
  electron.ipcMain.handle("shell:open-path", (_e, p) => electron.shell.openPath(p));
  electron.ipcMain.handle("addon:update-all", async (_e, installationId) => {
    const settings = getSettings();
    const installation = settings.wowInstallations.find((i) => i.id === installationId);
    if (!installation) throw new Error(`Installation not found: ${installationId}`);
    const addons = getInstalledAddons(installationId).filter(
      (a) => a.updateAvailable && !a.isIgnored && !a.pinnedVersion
    );
    const updated = [];
    for (const addon of addons) {
      try {
        const result = {
          externalId: addon.sourceId ?? addon.id,
          provider: addon.provider,
          name: addon.name,
          summary: addon.notes,
          author: addon.author,
          downloadCount: 0,
          latestVersion: addon.latestVersion ?? addon.version,
          downloadUrl: addon.downloadUrl,
          websiteUrl: addon.websiteUrl,
          thumbnailUrl: addon.thumbnailUrl
        };
        const installed = await installAddon(result, installation, addon.channelPreference, win);
        updated.push(installed);
      } catch (err) {
        console.error(`Failed to update ${addon.name}:`, err);
      }
    }
    return updated;
  });
}
const wago = new WagoProvider();
const curseforge = new CurseForgeProvider();
const wowinterface = new WoWInterfaceProvider();
const github = new GitHubProvider();
function syncProviderKeys() {
  const { wagoApiKey, curseForgApiKey } = getSettings();
  if (wagoApiKey) wago.setApiKey(wagoApiKey);
  if (curseForgApiKey) curseforge.setApiKey(curseForgApiKey);
}
async function runBackgroundUpdateCheck(win) {
  syncProviderKeys();
  const settings = getSettings();
  let totalAutoUpdated = 0;
  let totalPendingUpdates = 0;
  for (const installation of settings.wowInstallations) {
    wago.setActiveFlavor(installation.flavor);
    const allAddons = getInstalledAddons(installation.id);
    const checkable = allAddons.filter((a) => !a.isIgnored && a.provider !== "unknown");
    for (const addon of checkable) {
      try {
        const channel = addon.channelPreference ?? settings.defaultChannel;
        let info = null;
        switch (addon.provider) {
          case "wago":
            info = await wago.checkUpdate(addon, channel);
            break;
          case "curseforge":
            info = await curseforge.checkUpdate(addon, channel);
            break;
          case "wowinterface":
            info = await wowinterface.checkUpdate(addon, channel);
            break;
          case "github":
            info = await github.checkUpdate(addon, channel);
            break;
        }
        if (info) {
          const hasUpdate = normalizeVersion(info.latestVersion) !== normalizeVersion(addon.version);
          addon.latestVersion = info.latestVersion;
          addon.downloadUrl = info.downloadUrl;
          addon.updateAvailable = hasUpdate;
          if (hasUpdate && addon.autoUpdate && !addon.pinnedVersion && info.downloadUrl) {
            const result = {
              externalId: addon.sourceId ?? addon.id,
              provider: addon.provider,
              name: addon.name,
              summary: addon.notes,
              author: addon.author,
              downloadCount: 0,
              latestVersion: info.latestVersion,
              downloadUrl: info.downloadUrl,
              websiteUrl: addon.websiteUrl,
              thumbnailUrl: addon.thumbnailUrl
            };
            await installAddon(result, installation, addon.channelPreference, win ?? void 0);
            addon.updateAvailable = false;
            addon.version = info.latestVersion;
            totalAutoUpdated++;
          } else if (hasUpdate) {
            totalPendingUpdates++;
          }
        } else {
          addon.updateAvailable = false;
        }
      } catch (err) {
        console.error(`Background update check failed for ${addon.name}:`, err);
      }
    }
    saveInstalledAddons(installation.id, allAddons);
    win?.webContents.send("addon:background-updated", installation.id);
  }
  if ((totalAutoUpdated > 0 || totalPendingUpdates > 0) && electron.Notification.isSupported()) {
    const parts = [];
    if (totalAutoUpdated > 0) parts.push(`${totalAutoUpdated} addon${totalAutoUpdated > 1 ? "s" : ""} auto-updated`);
    if (totalPendingUpdates > 0) parts.push(`${totalPendingUpdates} update${totalPendingUpdates > 1 ? "s" : ""} available`);
    new electron.Notification({
      title: "WoW Addon Manager",
      body: parts.join(" · ")
    }).show();
  }
}
const IS_DEV = process.env.NODE_ENV === "development" || !electron.app.isPackaged;
function getIconPath() {
  if (electron.app.isPackaged) {
    return path.join(process.resourcesPath, "icon.png");
  }
  return path.join(__dirname, "../../resources/icon.png");
}
let mainWindow = null;
let tray = null;
let updateTimer = null;
function createWindow(startHidden = false) {
  const ICON = getIconPath();
  mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#1a1a2e",
    titleBarStyle: "hiddenInset",
    frame: process.platform !== "darwin",
    show: false,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (IS_DEV) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  mainWindow.once("ready-to-show", () => {
    if (!startHidden) {
      mainWindow.show();
    }
    autoDetectWow();
  });
  mainWindow.on("close", (e) => {
    const { minimizeToTray } = getSettings();
    if (minimizeToTray && !electron.app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}
function createTray() {
  const ICON = getIconPath();
  let trayIcon = electron.nativeImage.createFromPath(ICON);
  if (!trayIcon.isEmpty()) {
    const size = process.platform === "darwin" ? 18 : 16;
    trayIcon = trayIcon.resize({ width: size, height: size });
  } else {
    trayIcon = electron.nativeImage.createEmpty();
  }
  tray = new electron.Tray(trayIcon);
  tray.setToolTip("WoW Addon Manager");
  tray.setContextMenu(
    electron.Menu.buildFromTemplate([
      { label: "Open", click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      } },
      { type: "separator" },
      { label: "Check for Updates", click: () => triggerBackgroundCheck() },
      { type: "separator" },
      { label: "Quit", click: () => {
        electron.app.isQuitting = true;
        electron.app.quit();
      } }
    ])
  );
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}
async function autoDetectWow() {
  const settings = getSettings();
  if (settings.wowInstallations.length > 0) return;
  const found = findWowInstallations();
  if (found.length) {
    patchSettings({
      wowInstallations: found,
      activeInstallationId: found[0].id
    });
    mainWindow?.webContents.send("wow:detected", found);
  }
}
async function triggerBackgroundCheck() {
  const { autoCheckUpdates } = getSettings();
  if (!autoCheckUpdates) return;
  try {
    await runBackgroundUpdateCheck(mainWindow);
  } catch (err) {
    console.error("Background update check error:", err);
  }
}
function scheduleUpdateCheck() {
  if (updateTimer) clearInterval(updateTimer);
  const { autoCheckUpdates, autoCheckInterval } = getSettings();
  if (!autoCheckUpdates) return;
  const ms = (autoCheckInterval ?? 60) * 60 * 1e3;
  updateTimer = setInterval(triggerBackgroundCheck, ms);
}
electron.ipcMain.on("settings:updated", () => {
  scheduleUpdateCheck();
  applyLoginItemSetting();
});
function applyLoginItemSetting() {
  const { launchAtLogin } = getSettings();
  electron.app.setLoginItemSettings({
    openAtLogin: launchAtLogin,
    // On Windows, pass the --autostart flag so we can start minimised
    args: launchAtLogin ? ["--autostart"] : []
  });
}
electron.app.whenReady().then(() => {
  const startHidden = process.argv.includes("--autostart");
  createWindow(startHidden);
  createTray();
  registerIpcHandlers(mainWindow);
  applyLoginItemSetting();
  scheduleUpdateCheck();
  setTimeout(triggerBackgroundCheck, 3e4);
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
    else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", () => {
  electron.app.isQuitting = true;
});
