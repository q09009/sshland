import { create } from "zustand";
import { loadSettings, saveSettings } from "../api";
// Imported from the leaf types module (no store/component imports) so there is
// no cycle with the dashboard layout store, which imports this module to persist.
import type { DashboardWidgetInstance } from "./dashboardTypes";
import {
  emptySysstatToolStatus,
  type MonitoringEngine,
  type SysstatToolStatus,
} from "./monitoring";
import { normalizeThemeTokens, type ThemeTokenValues } from "./themeTokens";

/**
 * The most recent SSH connection, remembered to pre-fill the connect form.
 * SECRETS ARE NEVER STORED — no password, no key passphrase (see the app's
 * "비밀번호는 메모리에만" rule). Only non-secret identifiers and the key path.
 */
export interface LastConnection {
  host: string;
  port: number;
  username: string;
  authKind: "password" | "key";
  /** Path to the private key file (not the key itself), for key auth. */
  keyPath: string;
}

export type AppLanguage = "system" | "ko" | "en";
export type MotionPreference = "normal" | "reduced" | "none";
export type UiFontPreference = "default" | "system" | "segoe";
export type TerminalFontPreference =
  | "default"
  | "cascadia"
  | "d2coding"
  | "consolas"
  | "system";
export type FileSearchEngine = "filter" | "fd" | "find";

export interface SearchToolStatus {
  /** null means this server/user combination has not checked find yet. */
  find: boolean | null;
  /** The executable exposed by the server, or null when unavailable/unchecked. */
  fdCommand: "fd" | "fdfind" | null;
  fdChecked: boolean;
}

export interface SearchServerIdentity {
  host: string;
  port: number;
  username: string;
}

export interface SearchToolCacheEntry
  extends SearchServerIdentity,
    SearchToolStatus {}

export interface MonitoringToolCacheEntry
  extends SearchServerIdentity,
    SysstatToolStatus {}

const MAX_SEARCH_TOOL_CACHE_ENTRIES = 50;
const MAX_MONITORING_TOOL_CACHE_ENTRIES = 50;

export function emptySearchToolStatus(): SearchToolStatus {
  return { find: null, fdCommand: null, fdChecked: false };
}

function normalizeServerIdentity(
  server: SearchServerIdentity,
): SearchServerIdentity {
  return {
    host: server.host.trim().toLowerCase(),
    port: server.port,
    username: server.username.trim(),
  };
}

function sameSearchServer(
  left: SearchServerIdentity,
  right: SearchServerIdentity,
): boolean {
  const normalizedLeft = normalizeServerIdentity(left);
  const normalizedRight = normalizeServerIdentity(right);
  return (
    normalizedLeft.host === normalizedRight.host &&
    normalizedLeft.port === normalizedRight.port &&
    normalizedLeft.username === normalizedRight.username
  );
}

/** Read a saved availability result for one host/port/user combination. */
export function getCachedSearchTools(
  cache: SearchToolCacheEntry[],
  server: SearchServerIdentity,
): SearchToolStatus {
  const match = cache.find((entry) => sameSearchServer(entry, server));
  return match
    ? {
        find: match.find,
        fdCommand: match.fdCommand,
        fdChecked: match.fdChecked,
      }
    : emptySearchToolStatus();
}

/** Read the saved sysstat check for one host/port/user combination. */
export function getCachedMonitoringTools(
  cache: MonitoringToolCacheEntry[],
  server: SearchServerIdentity,
): SysstatToolStatus {
  const match = cache.find((entry) => sameSearchServer(entry, server));
  return match
    ? {
        checked: match.checked,
        available: match.available,
        version: match.version,
        missing: [...match.missing],
      }
    : emptySysstatToolStatus();
}

function normalizeSearchToolCache(value: unknown): SearchToolCacheEntry[] {
  if (!Array.isArray(value)) return [];
  const normalized: SearchToolCacheEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Partial<SearchToolCacheEntry>;
    if (
      typeof entry.host !== "string" ||
      !entry.host.trim() ||
      typeof entry.username !== "string" ||
      !entry.username.trim() ||
      !Number.isInteger(entry.port) ||
      Number(entry.port) < 1 ||
      Number(entry.port) > 65535
    ) {
      continue;
    }
    const identity = normalizeServerIdentity({
      host: entry.host,
      port: Number(entry.port),
      username: entry.username,
    });
    if (normalized.some((saved) => sameSearchServer(saved, identity))) continue;
    const fdChecked = entry.fdChecked === true;
    const fdCommand =
      fdChecked && (entry.fdCommand === "fd" || entry.fdCommand === "fdfind")
        ? entry.fdCommand
        : null;
    normalized.push({
      ...identity,
      find: typeof entry.find === "boolean" ? entry.find : null,
      fdCommand,
      fdChecked,
    });
    if (normalized.length >= MAX_SEARCH_TOOL_CACHE_ENTRIES) break;
  }
  return normalized;
}

function normalizeMonitoringToolCache(value: unknown): MonitoringToolCacheEntry[] {
  if (!Array.isArray(value)) return [];
  const normalized: MonitoringToolCacheEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Partial<MonitoringToolCacheEntry>;
    if (
      typeof entry.host !== "string" ||
      !entry.host.trim() ||
      typeof entry.username !== "string" ||
      !entry.username.trim() ||
      !Number.isInteger(entry.port) ||
      Number(entry.port) < 1 ||
      Number(entry.port) > 65535 ||
      entry.checked !== true
    ) {
      continue;
    }
    const identity = normalizeServerIdentity({
      host: entry.host,
      port: Number(entry.port),
      username: entry.username,
    });
    if (normalized.some((saved) => sameSearchServer(saved, identity))) continue;
    normalized.push({
      ...identity,
      checked: true,
      available: entry.available === true,
      version: typeof entry.version === "string" ? entry.version : null,
      missing: Array.isArray(entry.missing)
        ? entry.missing.filter((tool): tool is string => typeof tool === "string")
        : [],
    });
    if (normalized.length >= MAX_MONITORING_TOOL_CACHE_ENTRIES) break;
  }
  return normalized;
}

export interface ThemeSettings {
  /** Solid color painted below the optional background image. */
  backgroundColor: string;
  /** App-owned copy of the selected image, or null for a solid background. */
  backgroundImagePath: string | null;
  /** Dark overlay over a background image, as an integer percentage. */
  backgroundOverlay: number;
  /** Base accent color; the rest of the accent ramp is derived at runtime. */
  accentColor: string;
  motion: MotionPreference;
  uiFont: UiFontPreference;
  terminalFont: TerminalFontPreference;
  /** Advanced CSS design-token overrides imported from a shareable TOML theme. */
  tokens: ThemeTokenValues;
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  backgroundColor: "#161826",
  backgroundImagePath: null,
  backgroundOverlay: 55,
  accentColor: "#9184d9",
  motion: "normal",
  uiFont: "default",
  terminalFont: "default",
  tokens: {},
};

function normalizeTheme(value: Partial<ThemeSettings> | null | undefined): ThemeSettings {
  const source = value ?? {};
  const hex = /^#[0-9a-f]{6}$/i;
  const overlay = Number(source.backgroundOverlay);
  const motion: MotionPreference[] = ["normal", "reduced", "none"];
  const uiFonts: UiFontPreference[] = ["default", "system", "segoe"];
  const terminalFonts: TerminalFontPreference[] = [
    "default",
    "cascadia",
    "d2coding",
    "consolas",
    "system",
  ];

  return {
    backgroundColor:
      typeof source.backgroundColor === "string" && hex.test(source.backgroundColor)
        ? source.backgroundColor.toLowerCase()
        : DEFAULT_THEME_SETTINGS.backgroundColor,
    backgroundImagePath:
      typeof source.backgroundImagePath === "string"
        ? source.backgroundImagePath
        : null,
    backgroundOverlay: Number.isFinite(overlay)
      ? Math.min(90, Math.max(0, Math.round(overlay)))
      : DEFAULT_THEME_SETTINGS.backgroundOverlay,
    accentColor:
      typeof source.accentColor === "string" && hex.test(source.accentColor)
        ? source.accentColor.toLowerCase()
        : DEFAULT_THEME_SETTINGS.accentColor,
    motion: motion.includes(source.motion as MotionPreference)
      ? (source.motion as MotionPreference)
      : DEFAULT_THEME_SETTINGS.motion,
    uiFont: uiFonts.includes(source.uiFont as UiFontPreference)
      ? (source.uiFont as UiFontPreference)
      : DEFAULT_THEME_SETTINGS.uiFont,
    terminalFont: terminalFonts.includes(
      source.terminalFont as TerminalFontPreference,
    )
      ? (source.terminalFont as TerminalFontPreference)
      : DEFAULT_THEME_SETTINGS.terminalFont,
    tokens: normalizeThemeTokens(source.tokens),
  };
}

/**
 * User-facing app settings. Persisted as a JSON blob on disk (see the Rust
 * `settings` module). To add a setting: add a field here, a default below, and
 * a control in the settings panel — no backend change needed.
 */
export interface AppSettings {
  /** Interface language, or the current OS language when set to system. */
  language: AppLanguage;
  /** Show the app-wide bottom activity log as terminal-style commands. */
  commandLogEnabled: boolean;
  /** How file-manager search boxes find matching remote entries. */
  fileSearchEngine: FileSearchEngine;
  /** Remembered fd/find availability, scoped to host + port + SSH user. */
  searchToolCache: SearchToolCacheEntry[];
  /** Render matching terminal command output as GUI widgets (off = raw only). */
  commandGuiEnabled: boolean;
  /** Show seconds (HH:MM:SS) in the status-bar clock. */
  clockShowSeconds: boolean;
  /** Enable the dashboard pane type (its 📊 entry point + polling). */
  dashboardEnabled: boolean;
  /** Preferred monitoring collector; unavailable sysstat falls back to built-in. */
  monitoringEngine: MonitoringEngine;
  /** Remembered sysstat availability, scoped to host + port + SSH user. */
  monitoringToolCache: MonitoringToolCacheEntry[];
  /** Default poll interval (seconds) used when adding a new dashboard widget. */
  dashboardDefaultInterval: number;
  /** The single shared dashboard layout (which widgets, order, sizes, intervals). */
  dashboardLayout: DashboardWidgetInstance[];
  /** Small, curated set of visual customization options. */
  theme: ThemeSettings;
  /** Last successful connection, for pre-filling the connect form. */
  lastConnection: LastConnection | null;
}

const DEFAULTS: AppSettings = {
  language: "system",
  commandLogEnabled: true,
  fileSearchEngine: "filter",
  searchToolCache: [],
  commandGuiEnabled: true,
  clockShowSeconds: false,
  dashboardEnabled: true,
  monitoringEngine: "builtin",
  monitoringToolCache: [],
  dashboardDefaultInterval: 5,
  dashboardLayout: [],
  theme: DEFAULT_THEME_SETTINGS,
  lastConnection: null,
};

interface SettingsState {
  settings: AppSettings;
  /** True once the on-disk settings have been loaded (or load failed). */
  loaded: boolean;
  /** Load persisted settings once at startup, merging over the defaults. */
  load: () => Promise<void>;
  /** Update one setting and persist the whole object. */
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  /** Save one fd/find check for the current server and persist it. */
  saveSearchToolCheck: (
    server: SearchServerIdentity,
    engine: "fd" | "find",
    available: boolean,
    command: string | null,
  ) => void;
  /** Save one sysstat availability check for the current server. */
  saveMonitoringToolCheck: (
    server: SearchServerIdentity,
    status: SysstatToolStatus,
  ) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(settings: AppSettings) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveSettings(settings as unknown as Record<string, unknown>).catch(() => {
      // Persistence is best-effort; the in-memory value still applies.
    });
  }, 150);
}

export const useSettings = create<SettingsState>((setState, get) => ({
  settings: DEFAULTS,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await loadSettings();
      // Merge over defaults so missing/older keys fall back gracefully.
      const persisted = raw as Partial<AppSettings>;
      const searchEngines: FileSearchEngine[] = ["filter", "fd", "find"];
      const monitoringEngines: MonitoringEngine[] = ["builtin", "sysstat"];
      setState({
        settings: {
          ...DEFAULTS,
          ...persisted,
          fileSearchEngine: searchEngines.includes(
            persisted.fileSearchEngine as FileSearchEngine,
          )
            ? (persisted.fileSearchEngine as FileSearchEngine)
            : DEFAULTS.fileSearchEngine,
          searchToolCache: normalizeSearchToolCache(persisted.searchToolCache),
          monitoringEngine: monitoringEngines.includes(
            persisted.monitoringEngine as MonitoringEngine,
          )
            ? (persisted.monitoringEngine as MonitoringEngine)
            : DEFAULTS.monitoringEngine,
          monitoringToolCache: normalizeMonitoringToolCache(
            persisted.monitoringToolCache,
          ),
          theme: normalizeTheme(persisted.theme),
        },
      });
    } catch {
      // Keep defaults if the file can't be read.
    } finally {
      setState({ loaded: true });
    }
  },
  set: (key, value) => {
    const next = { ...get().settings, [key]: value };
    setState({ settings: next });
    // Theme sliders/color pickers can emit many updates in a short burst. A
    // tiny debounce keeps only the newest complete JSON blob and avoids older
    // writes racing with newer ones.
    scheduleSave(next);
  },
  saveSearchToolCheck: (server, engine, available, command) => {
    const settings = get().settings;
    const current = getCachedSearchTools(settings.searchToolCache, server);
    const identity = normalizeServerIdentity(server);
    const updated: SearchToolCacheEntry = {
      ...identity,
      ...current,
      ...(engine === "find"
        ? { find: available }
        : {
            fdChecked: true,
            fdCommand:
              available && (command === "fd" || command === "fdfind")
                ? command
                : null,
          }),
    };
    const searchToolCache = [
      updated,
      ...settings.searchToolCache.filter(
        (entry) => !sameSearchServer(entry, identity),
      ),
    ].slice(0, MAX_SEARCH_TOOL_CACHE_ENTRIES);
    const next = { ...settings, searchToolCache };
    setState({ settings: next });
    scheduleSave(next);
  },
  saveMonitoringToolCheck: (server, status) => {
    const settings = get().settings;
    const identity = normalizeServerIdentity(server);
    const updated: MonitoringToolCacheEntry = {
      ...identity,
      checked: true,
      available: status.available,
      version: status.version,
      missing: [...status.missing],
    };
    const monitoringToolCache = [
      updated,
      ...settings.monitoringToolCache.filter(
        (entry) => !sameSearchServer(entry, identity),
      ),
    ].slice(0, MAX_MONITORING_TOOL_CACHE_ENTRIES);
    const next = { ...settings, monitoringToolCache };
    setState({ settings: next });
    scheduleSave(next);
  },
}));
