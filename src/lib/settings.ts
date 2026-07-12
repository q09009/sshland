import { create } from "zustand";
import { loadSettings, saveSettings } from "../api";

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

/**
 * User-facing app settings. Persisted as a JSON blob on disk (see the Rust
 * `settings` module). To add a setting: add a field here, a default below, and
 * a control in the settings panel — no backend change needed.
 */
export interface AppSettings {
  /** Show the bottom command-log bar (file ops as CLI commands). */
  commandLogEnabled: boolean;
  /** Render matching terminal command output as GUI widgets (off = raw only). */
  commandGuiEnabled: boolean;
  /** Show seconds (HH:MM:SS) in the status-bar clock. */
  clockShowSeconds: boolean;
  /** Last successful connection, for pre-filling the connect form. */
  lastConnection: LastConnection | null;
}

const DEFAULTS: AppSettings = {
  commandLogEnabled: true,
  commandGuiEnabled: true,
  clockShowSeconds: false,
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

export const useSettings = create<SettingsState>((setState, get) => ({
  settings: DEFAULTS,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await loadSettings();
      // Merge over defaults so missing/older keys fall back gracefully.
      setState({ settings: { ...DEFAULTS, ...(raw as Partial<AppSettings>) } });
    } catch {
      // Keep defaults if the file can't be read.
    } finally {
      setState({ loaded: true });
    }
  },
  set: (key, value) => {
    const next = { ...get().settings, [key]: value };
    setState({ settings: next });
    void saveSettings(next as unknown as Record<string, unknown>).catch(() => {
      // Persistence is best-effort; the in-memory value still applies.
    });
  },
}));
