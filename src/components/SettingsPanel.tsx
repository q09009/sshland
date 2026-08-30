import { useEffect, useState } from "react";
import { getName, getVersion, getTauriVersion } from "@tauri-apps/api/app";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import {
  DEFAULT_THEME_SETTINGS,
  getCachedMonitoringTools,
  useSettings,
  type MotionPreference,
  type FileSearchEngine,
  type TerminalFontPreference,
  type ThemeSettings,
  type UiFontPreference,
} from "../lib/settings";
import {
  resolveMonitoringEngine,
  type MonitoringEngine,
  type SysstatToolStatus,
} from "../lib/monitoring";
import { useCommandConfigs } from "../lib/commandConfigs";
import { useDashboardWidgetConfigs } from "../lib/dashboardWidgetConfigs";
import { MIN_REFRESH_SECONDS, clampInterval } from "../lib/dashboardTypes";
import {
  checkSearchTool,
  checkSysstat,
  clearThemeBackground,
  commandsDirPath,
  exportThemePreset,
  importThemeBackground,
  importThemePreset,
  loadThemePresets,
  openCommandsDir,
  openThemesDir,
  themesDirPath,
  type ThemePreset,
} from "../api";
import { useI18n } from "../i18n";
import type { AppLanguage } from "../lib/settings";
import type { TranslationKey } from "../i18n/ko";
import { dashboardWidgetLabel } from "../lib/dashboardWidgetText";
import { collectThemeTokens } from "../lib/theme";
import {
  ACCENT_THEME_TOKENS,
  MOTION_THEME_TOKENS,
  withoutThemeTokenGroups,
} from "../lib/themeTokens";
import { resolveFileSearchEngine } from "../lib/fileSearch";

/**
 * Full settings surface: a modal overlay covering the pane tiling, with a
 * category sidebar and a content area. Adding a section later ("단축키",
 * "테마", …) is just one more entry in SECTIONS — the sidebar and
 * routing are data-driven.
 */
interface Section {
  id: string;
  label: TranslationKey;
  render: () => React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "file-manager",
    label: "settings.section.fileManager",
    render: () => <FileManagerSection />,
  },
  {
    id: "terminal-command-gui",
    label: "settings.section.commandGui",
    render: () => <TerminalCommandGuiSection />,
  },
  { id: "dashboard", label: "settings.section.dashboard", render: () => <DashboardSection /> },
  { id: "theme", label: "settings.section.theme", render: () => <ThemeSection /> },
  { id: "general", label: "settings.section.general", render: () => <GeneralSection /> },
  { id: "about", label: "settings.section.about", render: () => <AboutSection /> },
  // Future: { id: "shortcuts", label: "단축키", ... }
];

export default function SettingsPanel() {
  const open = useAppStore((s) => s.settingsOpen);
  const close = useAppStore((s) => s.closeSettings);
  const [active, setActive] = useState(SECTIONS[0].id);
  const { t } = useI18n();

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open) return null;

  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 backdrop-blur-sm"
      onMouseDown={close}
    >
      <div
        className="flex h-[70%] max-h-[560px] w-[80%] max-w-3xl overflow-hidden rounded-2xl border border-ink-700 bg-surface-dialog shadow-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Category sidebar */}
        <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-ink-700/70 bg-ink-800 p-2">
          <div className="mb-1 px-2 py-2 text-sm font-semibold text-slate-200">
            {t("settings.title")}
          </div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`rounded-lg px-3 py-2 text-left text-sm ${
                s.id === active
                  ? "bg-sky-500/15 text-sky-200"
                  : "text-slate-400 hover:bg-ink-700 hover:text-slate-200"
              }`}
            >
              {t(s.label)}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="relative flex-1 overflow-y-auto p-6">
          <button
            onClick={close}
            title={t("common.close")}
            aria-label={t("common.close")}
            className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-ink-700 hover:text-slate-100"
          >
            ✕
          </button>
          {section.render()}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <header className="mb-5">
      <h2 className="text-lg font-semibold text-slate-100">{children}</h2>
      <div className="mt-3 h-px bg-ink-700/70" />
    </header>
  );
}

function SettingsStack({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

function SubsectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-400">
      {children}
    </h3>
  );
}

function TerminalCommandGuiSection() {
  const enabled = useSettings((s) => s.settings.commandGuiEnabled);
  const set = useSettings((s) => s.set);
  const configs = useCommandConfigs((s) => s.configs);
  const reload = useCommandConfigs((s) => s.load);
  const [dir, setDir] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    commandsDirPath()
      .then(setDir)
      .catch(() => {});
  }, []);

  const doReload = async () => {
    setReloading(true);
    await reload();
    setReloading(false);
  };

  return (
    <div>
      <SectionTitle>{t("settings.section.commandGui")}</SectionTitle>
      <SettingsStack>
        <SettingRow
          label={t("settings.commandGui.label")}
          description={t("settings.commandGui.description")}
        >
          <Toggle
            checked={enabled}
            onChange={(v) => set("commandGuiEnabled", v)}
          />
        </SettingRow>
      </SettingsStack>

      <div className="mt-5 rounded-xl border border-ink-700/60 bg-ink-800/50 px-4 py-3">
        <div className="text-sm text-slate-200">{t("settings.commandGui.folder")}</div>
        <div className="mt-1 break-all font-mono text-2xs text-slate-500">
          {dir ?? "…"}
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => openCommandsDir().catch(() => {})}
            className="rounded-lg bg-sky-500/15 px-3 py-1 text-xs text-sky-200 hover:bg-sky-500/25"
          >
            {t("common.openFolder")}
          </button>
          <button
            onClick={doReload}
            disabled={reloading}
            className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-slate-300 hover:bg-ink-700 disabled:opacity-50"
          >
            {reloading ? t("common.reloading") : t("common.reload")}
          </button>
        </div>
        <p className="mt-2 text-2xs leading-relaxed text-slate-500">
          {t("settings.commandGui.folderHelp")}
        </p>
      </div>

      <div className="mt-5">
        <SubsectionTitle>
          {t("settings.commandGui.registered", { count: configs.length })}
        </SubsectionTitle>
        <ul className="flex flex-col gap-2">
          {configs.map((c) => (
            <li
              key={c.name}
              className="flex min-h-10 items-center gap-3 rounded-lg border border-ink-700/50 bg-ink-800/40 px-3 py-2 text-xs"
            >
              <span className="font-mono text-slate-200">{c.name}</span>
              <span className="text-slate-500">
                {c.parser} → {c.render}
              </span>
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-2xs ${
                  c.source === "user"
                    ? "bg-sky-500/15 text-sky-200"
                    : "bg-ink-700 text-slate-400"
                }`}
              >
                {c.source === "user" ? t("common.user") : t("common.builtIn")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DashboardSection() {
  const enabled = useSettings((s) => s.settings.dashboardEnabled);
  const defaultInterval = useSettings((s) => s.settings.dashboardDefaultInterval);
  const preferredMonitoringEngine = useSettings((s) => s.settings.monitoringEngine);
  const monitoringToolCache = useSettings((s) => s.settings.monitoringToolCache);
  const saveMonitoringToolCheck = useSettings((s) => s.saveMonitoringToolCheck);
  const set = useSettings((s) => s.set);
  const connection = useAppStore((s) => s.connection);
  const configs = useDashboardWidgetConfigs((s) => s.configs);
  const reload = useDashboardWidgetConfigs((s) => s.load);
  const [intervalText, setIntervalText] = useState(String(defaultInterval));
  const [checkingSysstat, setCheckingSysstat] = useState(false);
  const [monitoringCheckError, setMonitoringCheckError] = useState<string | null>(null);
  const { t } = useI18n();
  const sysstat = connection
    ? getCachedMonitoringTools(monitoringToolCache, connection)
    : { checked: false, available: false, version: null, missing: [] };
  const effectiveMonitoringEngine = resolveMonitoringEngine(
    preferredMonitoringEngine,
    sysstat,
  );

  useEffect(() => setIntervalText(String(defaultInterval)), [defaultInterval]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const commitInterval = () => {
    const n = Number.parseInt(intervalText, 10);
    const clamped = Number.isNaN(n) ? defaultInterval : clampInterval(n);
    set("dashboardDefaultInterval", clamped);
    setIntervalText(String(clamped));
  };

  const selectMonitoringEngine = async (engine: MonitoringEngine) => {
    setMonitoringCheckError(null);
    if (engine === "builtin") {
      set("monitoringEngine", engine);
      return;
    }
    if (!connection || checkingSysstat) {
      if (!connection) {
        setMonitoringCheckError(t("settings.dashboard.monitoring.noConnection"));
      }
      return;
    }
    setCheckingSysstat(true);
    try {
      const status = await checkSysstat();
      saveMonitoringToolCheck(connection, status);
      if (status.available) set("monitoringEngine", "sysstat");
    } catch {
      setMonitoringCheckError(t("settings.dashboard.monitoring.checkFailed"));
    } finally {
      setCheckingSysstat(false);
    }
  };

  return (
    <div>
      <SectionTitle>{t("settings.section.dashboard")}</SectionTitle>
      <SettingsStack>
        <SettingRow
          label={t("settings.dashboard.enabled")}
          description={t("settings.dashboard.enabledDescription")}
        >
          <Toggle
            checked={enabled}
            onChange={(v) => set("dashboardEnabled", v)}
          />
        </SettingRow>

        <MonitoringEnginePicker
          preferred={preferredMonitoringEngine}
          effective={effectiveMonitoringEngine}
          sysstat={sysstat}
          checking={checkingSysstat}
          error={monitoringCheckError}
          onSelect={selectMonitoringEngine}
        />

        <SettingRow
          label={t("settings.dashboard.interval")}
          description={t("settings.dashboard.intervalDescription")}
        >
          <span className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="number"
              min={MIN_REFRESH_SECONDS}
              value={intervalText}
              onChange={(e) => setIntervalText(e.target.value)}
              onBlur={commitInterval}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-16 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-right text-slate-100 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40"
            />
            <span className="text-slate-500">{t("common.seconds")}</span>
          </span>
        </SettingRow>
      </SettingsStack>

      <div className="mt-5">
        <SubsectionTitle>
          {t("settings.dashboard.available", { count: configs.length })}
        </SubsectionTitle>
        <ul className="flex flex-col gap-2">
          {configs.map((c) => (
            <li
              key={c.id}
              className="flex min-h-11 items-center gap-3 rounded-lg border border-ink-700/50 bg-ink-800/40 px-3 py-2 text-xs"
            >
              <span className="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-md bg-ink-700/70 text-sm">
                {c.icon ?? "📊"}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-200">
                {dashboardWidgetLabel(c, t)}
              </span>
              <span className="shrink-0 font-mono text-2xs text-slate-500">
                {c.render}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-2xs ${
                  c.source === "user"
                    ? "bg-sky-500/15 text-sky-200"
                    : "bg-ink-700 text-slate-400"
                }`}
              >
                {c.source === "user" ? t("common.user") : t("common.builtIn")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MonitoringEnginePicker({
  preferred,
  effective,
  sysstat,
  checking,
  error,
  onSelect,
}: {
  preferred: MonitoringEngine;
  effective: MonitoringEngine;
  sysstat: SysstatToolStatus;
  checking: boolean;
  error: string | null;
  onSelect: (engine: MonitoringEngine) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-ink-700/60 bg-ink-800/50 px-4 py-3">
      <div className="text-sm text-slate-200">
        {t("settings.dashboard.monitoring.title")}
      </div>
      <div className="mt-1 text-xs leading-relaxed text-slate-500">
        {t("settings.dashboard.monitoring.description")}
      </div>
      <div role="radiogroup" className="mt-3 grid gap-2 sm:grid-cols-2">
        {(["builtin", "sysstat"] as const).map((engine) => {
          const selected = preferred === engine;
          const isChecking = engine === "sysstat" && checking;
          const status =
            engine === "builtin"
              ? t("settings.dashboard.monitoring.builtInStatus")
              : isChecking
                ? t("settings.dashboard.monitoring.checking")
                : !sysstat.checked
                  ? t("settings.dashboard.monitoring.notChecked")
                  : sysstat.available
                    ? sysstat.version ?? t("settings.dashboard.monitoring.available")
                    : t("settings.dashboard.monitoring.unavailable");
          return (
            <button
              key={engine}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-busy={isChecking}
              disabled={checking}
              onClick={() => void onSelect(engine)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-sky-500/60 bg-sky-500/10"
                  : "border-ink-700/60 bg-ink-900/30 hover:bg-ink-700/50"
              } disabled:cursor-wait disabled:opacity-70`}
            >
              <span className="flex items-center gap-2 text-xs text-slate-200">
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                    selected ? "border-sky-400" : "border-slate-600"
                  }`}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-sky-400" />}
                </span>
                {t(`settings.dashboard.monitoring.${engine}` as TranslationKey)}
              </span>
              <span className="mt-1 block truncate text-2xs text-slate-500" title={status}>
                {status}
              </span>
            </button>
          );
        })}
      </div>
      {preferred === "sysstat" && effective === "builtin" && (
        <p className="mt-2 text-xs text-amber-400">
          {sysstat.checked && sysstat.missing.length > 0
            ? t("settings.dashboard.monitoring.missing", {
                commands: sysstat.missing.join(", "),
              })
            : t("settings.dashboard.monitoring.fallback")}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function FileManagerSection() {
  const preferred = useSettings((s) => s.settings.fileSearchEngine);
  const set = useSettings((s) => s.set);
  const saveSearchToolCheck = useSettings((s) => s.saveSearchToolCheck);
  const connection = useAppStore((s) => s.connection);
  const setSearchToolCheck = useAppStore((s) => s.setSearchToolCheck);
  const [checking, setChecking] = useState<FileSearchEngine | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const { t } = useI18n();
  const tools = connection?.searchTools ?? {
    find: null,
    fdCommand: null,
    fdChecked: false,
  };

  const effective = resolveFileSearchEngine(preferred, tools);
  const options: Array<{
    id: FileSearchEngine;
    label: TranslationKey;
    description: TranslationKey;
  }> = [
    {
      id: "filter",
      label: "settings.fileSearch.filter",
      description: "settings.fileSearch.filterDescription",
    },
    {
      id: "fd",
      label: "settings.fileSearch.fd",
      description: "settings.fileSearch.fdDescription",
    },
    {
      id: "find",
      label: "settings.fileSearch.find",
      description: "settings.fileSearch.findDescription",
    },
  ];

  type Availability = "available" | "unavailable" | "unchecked" | "checking";

  const availabilityState = (engine: FileSearchEngine): Availability => {
    if (checking === engine) return "checking";
    if (engine === "filter") return "available";
    if (engine === "fd") {
      if (!tools.fdChecked) return "unchecked";
      return tools.fdCommand ? "available" : "unavailable";
    }
    if (tools.find === null) return "unchecked";
    return tools.find ? "available" : "unavailable";
  };

  const availability = (engine: FileSearchEngine, status: Availability) => {
    if (engine === "filter") return t("settings.fileSearch.builtIn");
    if (status === "checking") return t("settings.fileSearch.checking");
    if (status === "unchecked") return t("settings.fileSearch.notChecked");
    if (engine === "fd") {
      return tools.fdCommand
        ? t("settings.fileSearch.availableAs", { command: tools.fdCommand })
        : t("settings.fileSearch.unavailable");
    }
    return tools.find
      ? t("settings.fileSearch.available")
      : t("settings.fileSearch.unavailable");
  };

  const selectEngine = async (engine: FileSearchEngine) => {
    setCheckError(null);
    if (engine === "filter") {
      set("fileSearchEngine", engine);
      return;
    }
    if (!connection || checking) return;

    setChecking(engine);
    try {
      const result = await checkSearchTool(engine);
      setSearchToolCheck(engine, result.available, result.command);
      saveSearchToolCheck(
        {
          host: connection.host,
          port: connection.port,
          username: connection.username,
        },
        engine,
        result.available,
        result.command,
      );
      // Missing optional commands do not replace the user's current choice.
      if (result.available) set("fileSearchEngine", engine);
    } catch (error) {
      setCheckError(typeof error === "string" ? error : String(error));
    } finally {
      setChecking(null);
    }
  };

  const preferredChecked =
    preferred === "filter" ||
    (preferred === "fd" ? tools.fdChecked : tools.find !== null);
  const fallbackKey: TranslationKey = preferredChecked
    ? "settings.fileSearch.fallback"
    : "settings.fileSearch.fallbackUnchecked";

  return (
    <div>
      <SectionTitle>{t("settings.section.fileManager")}</SectionTitle>
      <p className="mb-4 text-sm leading-relaxed text-slate-400">
        {t("settings.fileSearch.description")}
      </p>
      <div role="radiogroup" className="space-y-3">
        {options.map((option) => {
          const selected = preferred === option.id;
          const status = availabilityState(option.id);
          return (
            <button
              key={option.id}
              role="radio"
              aria-checked={selected}
              aria-busy={status === "checking"}
              disabled={checking !== null}
              onClick={() => void selectEngine(option.id)}
              className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                selected
                  ? "border-sky-500/60 bg-sky-500/10"
                  : "border-ink-700/60 bg-ink-800/50 hover:bg-ink-700/60"
              } disabled:cursor-wait disabled:opacity-70`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  selected ? "border-sky-400" : "border-slate-600"
                }`}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-sky-400" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm text-slate-200">
                  {t(option.label)}
                  <span
                    className={`rounded-full px-2 py-0.5 text-2xs ${
                      status === "available"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : status === "checking"
                          ? "bg-sky-500/10 text-sky-300"
                          : status === "unchecked"
                            ? "bg-ink-700 text-slate-400"
                            : "bg-amber-500/10 text-amber-400"
                    }`}
                  >
                    {availability(option.id, status)}
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                  {t(option.description)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {checkError && (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs leading-relaxed text-rose-200">
          {t("settings.fileSearch.checkFailed", { error: checkError })}
        </div>
      )}

      {effective !== preferred && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
          {t(fallbackKey, {
            preferred: t(`settings.fileSearch.${preferred}` as TranslationKey),
            effective: t(`settings.fileSearch.${effective}` as TranslationKey),
          })}
        </div>
      )}
    </div>
  );
}

function ThemeSection() {
  const theme = useSettings((state) => state.settings.theme);
  const set = useSettings((state) => state.set);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [presets, setPresets] = useState<ThemePreset[]>([]);
  const [presetsPath, setPresetsPath] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetMessage, setPresetMessage] = useState<string | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    void Promise.all([loadThemePresets(), themesDirPath()])
      .then(([loaded, path]) => {
        setPresets(loaded);
        setPresetsPath(path);
      })
      .catch(() => {});
  }, []);

  const update = (patch: Partial<ThemeSettings>) => {
    setSelectedPresetId("");
    setPresetMessage(null);
    let tokens = theme.tokens;
    if (patch.accentColor !== undefined) {
      tokens = withoutThemeTokenGroups(tokens, ACCENT_THEME_TOKENS);
    }
    if (patch.motion !== undefined) {
      tokens = withoutThemeTokenGroups(tokens, MOTION_THEME_TOKENS);
    }
    if (patch.uiFont !== undefined) {
      tokens = withoutThemeTokenGroups(tokens, ["font-sans"]);
    }
    if (patch.terminalFont !== undefined) {
      tokens = withoutThemeTokenGroups(tokens, ["font-terminal"]);
    }
    set("theme", { ...theme, ...patch, tokens });
  };

  const refreshPresets = async () => {
    const loaded = await loadThemePresets();
    setPresets(loaded);
    return loaded;
  };

  const applyPreset = async (preset: ThemePreset) => {
    setPresetBusy(true);
    setPresetError(null);
    setPresetMessage(null);
    try {
      const backgroundImagePath = preset.backgroundImagePath
        ? await importThemeBackground(preset.backgroundImagePath)
        : null;
      if (!preset.backgroundImagePath) await clearThemeBackground();
      set("theme", {
        backgroundColor: preset.backgroundColor,
        backgroundImagePath,
        backgroundOverlay: preset.backgroundOverlay,
        accentColor: preset.accentColor,
        motion: preset.motion,
        uiFont: preset.uiFont,
        terminalFont: preset.terminalFont,
        tokens: preset.tokens ?? {},
      });
      setSelectedPresetId(preset.id);
      setPresetMessage(t("settings.theme.presets.applied", { name: preset.name }));
      setImageError(null);
    } catch (error) {
      setPresetError(
        typeof error === "string" ? error : t("settings.theme.presets.error"),
      );
    } finally {
      setPresetBusy(false);
    }
  };

  const importPreset = async () => {
    setPresetError(null);
    setPresetMessage(null);
    try {
      const selected = await open({
        title: t("settings.theme.presets.import"),
        multiple: false,
        directory: false,
        filters: [
          { name: t("settings.theme.presets.tomlFiles"), extensions: ["toml"] },
        ],
      });
      if (!selected || Array.isArray(selected)) return;

      setPresetBusy(true);
      const imported = await importThemePreset(selected);
      await refreshPresets();
      await applyPreset(imported);
    } catch (error) {
      setPresetError(
        typeof error === "string" ? error : t("settings.theme.presets.error"),
      );
    } finally {
      setPresetBusy(false);
    }
  };

  const exportPreset = async () => {
    setPresetError(null);
    setPresetMessage(null);
    try {
      const target = await save({
        title: t("settings.theme.presets.export"),
        defaultPath: "sshland-theme.toml",
        filters: [
          { name: t("settings.theme.presets.tomlFiles"), extensions: ["toml"] },
        ],
      });
      if (!target) return;

      setPresetBusy(true);
      const path = await exportThemePreset(target, {
        ...theme,
        tokens: collectThemeTokens(),
      });
      setPresetMessage(t("settings.theme.presets.exported", { path }));
    } catch (error) {
      setPresetError(
        typeof error === "string" ? error : t("settings.theme.presets.error"),
      );
    } finally {
      setPresetBusy(false);
    }
  };

  const reloadPresets = async () => {
    setPresetBusy(true);
    setPresetError(null);
    setPresetMessage(null);
    try {
      const loaded = await refreshPresets();
      if (selectedPresetId) {
        const selected = loaded.find((preset) => preset.id === selectedPresetId);
        if (selected) await applyPreset(selected);
        else setSelectedPresetId("");
      }
    } catch (error) {
      setPresetError(
        typeof error === "string" ? error : t("settings.theme.presets.error"),
      );
    } finally {
      setPresetBusy(false);
    }
  };

  const chooseBackground = async () => {
    setImageError(null);
    setImageBusy(true);
    try {
      const selected = await open({
        title: t("settings.theme.background.choose"),
        multiple: false,
        directory: false,
        filters: [
          {
            name: t("settings.theme.background.imageFiles"),
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;
      const importedPath = await importThemeBackground(selected);
      update({ backgroundImagePath: importedPath });
    } catch (error) {
      setImageError(typeof error === "string" ? error : t("settings.theme.background.error"));
    } finally {
      setImageBusy(false);
    }
  };

  const removeBackground = async () => {
    setImageBusy(true);
    setImageError(null);
    try {
      await clearThemeBackground();
      update({ backgroundImagePath: null });
    } catch (error) {
      setImageError(typeof error === "string" ? error : t("settings.theme.background.error"));
    } finally {
      setImageBusy(false);
    }
  };

  const resetTheme = () => {
    void clearThemeBackground().catch(() => {});
    set("theme", { ...DEFAULT_THEME_SETTINGS });
    setSelectedPresetId("");
    setPresetMessage(null);
    setImageError(null);
  };

  return (
    <div>
      <SectionTitle>{t("settings.section.theme")}</SectionTitle>
      <p className="mb-4 text-sm leading-relaxed text-slate-400">
        {t("settings.theme.description")}
      </p>

      <div className="mb-5 rounded-xl border border-ink-700/60 bg-ink-800/50 px-4 py-3">
        <div className="text-sm font-medium text-slate-200">
          {t("settings.theme.presets.title")}
        </div>
        <p className="mt-1 text-2xs leading-relaxed text-slate-500">
          {t("settings.theme.presets.description")}
        </p>

        <select
          value={selectedPresetId}
          disabled={presetBusy}
          onChange={(event) => {
            const id = event.target.value;
            if (!id) {
              setSelectedPresetId("");
              return;
            }
            const preset = presets.find((item) => item.id === id);
            if (preset) void applyPreset(preset);
          }}
          className="mt-3 w-full rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-slate-200 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40 disabled:opacity-50"
        >
          <option value="">{t("settings.theme.presets.custom")}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.author ? `${preset.name} — ${preset.author}` : preset.name}
            </option>
          ))}
        </select>

        {presets.length === 0 && (
          <p className="mt-2 text-2xs text-slate-500">
            {t("settings.theme.presets.empty")}
          </p>
        )}
        {selectedPresetId && presets.find((item) => item.id === selectedPresetId)?.description && (
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            {presets.find((item) => item.id === selectedPresetId)?.description}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={presetBusy}
            onClick={() => void importPreset()}
            className="rounded-lg bg-sky-500/15 px-3 py-1 text-xs text-sky-200 hover:bg-sky-500/25 disabled:opacity-50"
          >
            {t("settings.theme.presets.import")}
          </button>
          <button
            type="button"
            disabled={presetBusy}
            onClick={() => void exportPreset()}
            className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-slate-300 hover:bg-ink-700 disabled:opacity-50"
          >
            {t("settings.theme.presets.export")}
          </button>
          <button
            type="button"
            disabled={presetBusy}
            onClick={() => void openThemesDir().catch(() => {})}
            className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-slate-300 hover:bg-ink-700 disabled:opacity-50"
          >
            {t("common.openFolder")}
          </button>
          <button
            type="button"
            disabled={presetBusy}
            onClick={() => void reloadPresets()}
            className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-slate-300 hover:bg-ink-700 disabled:opacity-50"
          >
            {presetBusy ? t("common.reloading") : t("common.reload")}
          </button>
        </div>

        <div className="mt-2 break-all font-mono text-2xs text-slate-600">
          {presetsPath ?? "…"}
        </div>
        {presetMessage && <p className="mt-2 text-xs text-emerald-300">{presetMessage}</p>}
        {presetError && <p className="mt-2 text-xs text-red-300">{presetError}</p>}
      </div>

      <div className="theme-settings-preview mb-5 overflow-hidden rounded-xl border border-ink-700/60">
        <div className="theme-settings-preview-image" />
        <div className="theme-settings-preview-overlay" />
        <div className="relative flex h-full items-end justify-between p-3">
          <span className="text-sm font-medium text-slate-100">
            {t("settings.theme.preview")}
          </span>
          <span className="h-4 w-12 rounded-full bg-sky-500 shadow-control" />
        </div>
      </div>

      <SettingsStack>
        <SettingRow
          label={t("settings.theme.background.color")}
          description={t("settings.theme.background.colorDescription")}
        >
          <ColorControl
            value={theme.backgroundColor}
            label={t("settings.theme.background.color")}
            onChange={(backgroundColor) => update({ backgroundColor })}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.theme.background.image")}
          description={
            theme.backgroundImagePath
              ? t("settings.theme.background.selected")
              : t("settings.theme.background.none")
          }
        >
          <div className="flex shrink-0 gap-2">
            {theme.backgroundImagePath && (
              <button
                type="button"
                disabled={imageBusy}
                onClick={() => void removeBackground()}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-ink-700 disabled:opacity-50"
              >
                {t("common.delete")}
              </button>
            )}
            <button
              type="button"
              disabled={imageBusy}
              onClick={() => void chooseBackground()}
              className="rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/25 disabled:opacity-50"
            >
              {imageBusy
                ? t("settings.theme.background.importing")
                : t("settings.theme.background.choose")}
            </button>
          </div>
        </SettingRow>

        {theme.backgroundImagePath && (
          <SettingRow
            label={t("settings.theme.background.overlay")}
            description={t("settings.theme.background.overlayDescription")}
          >
            <label className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
              <input
                type="range"
                min="0"
                max="90"
                step="5"
                value={theme.backgroundOverlay}
                onChange={(event) =>
                  update({ backgroundOverlay: Number(event.target.value) })
                }
                className="accent-sky-500"
              />
              <span className="w-8 text-right tabular-nums">
                {theme.backgroundOverlay}%
              </span>
            </label>
          </SettingRow>
        )}

        <SettingRow
          label={t("settings.theme.accent")}
          description={t("settings.theme.accentDescription")}
        >
          <ColorControl
            value={theme.accentColor}
            label={t("settings.theme.accent")}
            onChange={(accentColor) => update({ accentColor })}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.theme.motion")}
          description={t("settings.theme.motionDescription")}
        >
          <select
            value={theme.motion}
            onChange={(event) =>
              update({ motion: event.target.value as MotionPreference })
            }
            className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-slate-200 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40"
          >
            <option value="normal">{t("settings.theme.motion.normal")}</option>
            <option value="reduced">{t("settings.theme.motion.reduced")}</option>
            <option value="none">{t("settings.theme.motion.none")}</option>
          </select>
        </SettingRow>

        <SettingRow label={t("settings.theme.uiFont")}>
          <select
            value={theme.uiFont}
            onChange={(event) =>
              update({ uiFont: event.target.value as UiFontPreference })
            }
            className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-slate-200 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40"
          >
            <option value="default">{t("settings.theme.font.default")}</option>
            <option value="system">{t("settings.theme.font.system")}</option>
            <option value="segoe">Segoe UI</option>
          </select>
        </SettingRow>

        <SettingRow label={t("settings.theme.terminalFont")}>
          <select
            value={theme.terminalFont}
            onChange={(event) =>
              update({ terminalFont: event.target.value as TerminalFontPreference })
            }
            className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-sm text-slate-200 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40"
          >
            <option value="default">{t("settings.theme.font.default")}</option>
            <option value="cascadia">Cascadia Code</option>
            <option value="d2coding">D2Coding</option>
            <option value="consolas">Consolas</option>
            <option value="system">{t("settings.theme.font.systemMono")}</option>
          </select>
        </SettingRow>
      </SettingsStack>

      {imageError && <p className="mt-3 text-xs text-red-300">{imageError}</p>}

      <button
        type="button"
        onClick={resetTheme}
        className="mt-4 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-ink-700"
      >
        {t("settings.theme.reset")}
      </button>
    </div>
  );
}

function ColorControl({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex shrink-0 items-center gap-2">
      <input
        type="color"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-10 cursor-pointer rounded border border-ink-700 bg-transparent p-0.5"
      />
      <span className="w-16 font-mono text-xs text-slate-400">{value}</span>
    </label>
  );
}

function GeneralSection() {
  const showSeconds = useSettings((s) => s.settings.clockShowSeconds);
  const commandLogEnabled = useSettings((s) => s.settings.commandLogEnabled);
  const language = useSettings((s) => s.settings.language);
  const set = useSettings((s) => s.set);
  const { t } = useI18n();
  return (
    <div>
      <SectionTitle>{t("settings.section.general")}</SectionTitle>
      <SettingsStack>
        <SettingRow
          label={t("settings.language.label")}
          description={t("settings.language.description")}
        >
          <select
            value={language}
            onChange={(event) =>
              set("language", event.target.value as AppLanguage)
            }
            className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-slate-200 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40"
          >
            <option value="system">{t("language.system")}</option>
            <option value="ko">{t("language.ko")}</option>
            <option value="en">{t("language.en")}</option>
          </select>
        </SettingRow>
        <SettingRow
          label={t("settings.clock.label")}
          description={t("settings.clock.description")}
        >
          <Toggle
            checked={showSeconds}
            onChange={(v) => set("clockShowSeconds", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("settings.commandLog.label")}
          description={t("settings.commandLog.description")}
        >
          <Toggle
            checked={commandLogEnabled}
            onChange={(value) => set("commandLogEnabled", value)}
          />
        </SettingRow>
      </SettingsStack>
    </div>
  );
}

function AboutSection() {
  const [info, setInfo] = useState<{
    name: string;
    version: string;
    tauri: string;
  } | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    let alive = true;
    Promise.all([getName(), getVersion(), getTauriVersion()])
      .then(([name, version, tauri]) => {
        if (alive) setInfo({ name, version, tauri });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <SectionTitle>{t("settings.section.about")}</SectionTitle>
      <div className="rounded-xl border border-ink-700/60 bg-ink-800/50 p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-2xl">
            🌐
          </div>
          <div>
            <div className="text-base font-semibold text-slate-100">
              sshland
            </div>
            <div className="text-sm text-slate-400">
              {t("settings.about.version", { version: info?.version ?? "…" })}
            </div>
          </div>
        </div>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
          {t("settings.about.description")}
        </p>
        <dl className="mt-4 border-t border-ink-700/60 pt-3 text-sm text-slate-500">
          <div className="flex gap-2">
            <dt className="w-24 text-slate-600">Tauri</dt>
            <dd>{info?.tauri ?? "…"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[68px] items-center justify-between gap-4 rounded-xl border border-ink-700/60 bg-ink-800/50 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        {description && (
          <div className="mt-1 text-xs leading-relaxed text-slate-500">
            {description}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  // Flex child + symmetric p-0.5 so the knob's travel is exactly the track's
  // inner width minus the knob (40px - 20px = translate-x-5). Avoids the
  // absolute-position + static-origin quirk that let the knob drift past the
  // track edge.
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
        checked ? "bg-sky-500" : "bg-ink-600"
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-control-knob shadow-control transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
