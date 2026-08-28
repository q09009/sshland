import { create } from "zustand";
import { loadSettings, saveSettings } from "../api";
// Imported from the leaf types module (no store/component imports) so there is
// no cycle with the dashboard layout store, which imports this module to persist.
import type { DashboardWidgetInstance } from "./dashboardTypes";
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
  /** Show the bottom command-log bar (file ops as CLI commands). */
  commandLogEnabled: boolean;
  /** Render matching terminal command output as GUI widgets (off = raw only). */
  commandGuiEnabled: boolean;
  /** Show seconds (HH:MM:SS) in the status-bar clock. */
  clockShowSeconds: boolean;
  /** Enable the dashboard pane type (its 📊 entry point + polling). */
  dashboardEnabled: boolean;
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
  commandGuiEnabled: true,
  clockShowSeconds: false,
  dashboardEnabled: true,
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
      setState({
        settings: {
          ...DEFAULTS,
          ...persisted,
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
}));
