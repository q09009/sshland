import { useEffect, useState } from "react";
import { getName, getVersion, getTauriVersion } from "@tauri-apps/api/app";
import { useAppStore } from "../store";
import { useSettings } from "../lib/settings";
import { useCommandConfigs } from "../lib/commandConfigs";
import { useDashboardWidgetConfigs } from "../lib/dashboardWidgetConfigs";
import { MIN_REFRESH_SECONDS, clampInterval } from "../lib/dashboardTypes";
import { commandsDirPath, openCommandsDir } from "../api";
import { useI18n } from "../i18n";
import type { AppLanguage } from "../lib/settings";
import type { TranslationKey } from "../i18n/ko";
import { dashboardWidgetLabel } from "../lib/dashboardWidgetText";

/**
 * Full settings surface: a modal overlay covering the pane tiling, with a
 * category sidebar and a content area. Adding a section later ("명령어 로그",
 * "단축키", "테마", …) is just one more entry in SECTIONS — the sidebar and
 * routing are data-driven.
 */
interface Section {
  id: string;
  label: TranslationKey;
  render: () => React.ReactNode;
}

const SECTIONS: Section[] = [
  { id: "command-log", label: "settings.section.commandLog", render: () => <CommandLogSection /> },
  { id: "command-gui", label: "settings.section.commandGui", render: () => <CommandGuiSection /> },
  { id: "dashboard", label: "settings.section.dashboard", render: () => <DashboardSection /> },
  { id: "general", label: "settings.section.general", render: () => <GeneralSection /> },
  { id: "about", label: "settings.section.about", render: () => <AboutSection /> },
  // Future: { id: "shortcuts", label: "단축키", ... },
  //         { id: "theme", label: "테마", ... }
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={close}
    >
      <div
        className="flex h-[70%] max-h-[560px] w-[80%] max-w-3xl overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Category sidebar */}
        <nav className="flex w-44 shrink-0 flex-col border-r border-ink-700/70 bg-ink-800 p-2">
          <div className="px-2 py-2 text-sm font-semibold text-slate-200">
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
    <h2 className="mb-4 text-lg font-semibold text-slate-100">{children}</h2>
  );
}

function CommandLogSection() {
  const enabled = useSettings((s) => s.settings.commandLogEnabled);
  const set = useSettings((s) => s.set);
  const { t } = useI18n();
  return (
    <div>
      <SectionTitle>{t("settings.section.commandLog")}</SectionTitle>
      <SettingRow
        label={t("settings.commandLog.label")}
        description={t("settings.commandLog.description")}
      >
        <Toggle
          checked={enabled}
          onChange={(v) => set("commandLogEnabled", v)}
        />
      </SettingRow>
    </div>
  );
}

function CommandGuiSection() {
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
      <SettingRow
        label={t("settings.commandGui.label")}
        description={t("settings.commandGui.description")}
      >
        <Toggle
          checked={enabled}
          onChange={(v) => set("commandGuiEnabled", v)}
        />
      </SettingRow>

      <div className="mt-4 rounded-lg border border-ink-700/60 bg-ink-800/50 px-4 py-3">
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

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-slate-400">
          {t("settings.commandGui.registered", { count: configs.length })}
        </div>
        <ul className="flex flex-col gap-1">
          {configs.map((c) => (
            <li
              key={c.name}
              className="flex items-center gap-2 rounded-md border border-ink-700/50 bg-ink-900/40 px-3 py-1.5 text-xs"
            >
              <span className="font-mono text-slate-200">{c.name}</span>
              <span className="text-slate-500">
                {c.parser} → {c.render}
              </span>
              <span
                className={`ml-auto rounded px-1.5 py-0.5 text-2xs ${
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
  const set = useSettings((s) => s.set);
  const configs = useDashboardWidgetConfigs((s) => s.configs);
  const reload = useDashboardWidgetConfigs((s) => s.load);
  const [intervalText, setIntervalText] = useState(String(defaultInterval));
  const { t } = useI18n();

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

  return (
    <div>
      <SectionTitle>{t("settings.section.dashboard")}</SectionTitle>
      <SettingRow
        label={t("settings.dashboard.enabled")}
        description={t("settings.dashboard.enabledDescription")}
      >
        <Toggle
          checked={enabled}
          onChange={(v) => set("dashboardEnabled", v)}
        />
      </SettingRow>

      <SettingRow
        label={t("settings.dashboard.interval")}
        description={t("settings.dashboard.intervalDescription")}
      >
        <span className="flex items-center gap-1 text-sm text-slate-300">
          <input
            type="number"
            min={MIN_REFRESH_SECONDS}
            value={intervalText}
            onChange={(e) => setIntervalText(e.target.value)}
            onBlur={commitInterval}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-16 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-right text-slate-100 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40"
          />
          <span className="text-slate-500">{t("common.seconds")}</span>
        </span>
      </SettingRow>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-slate-400">
          {t("settings.dashboard.available", { count: configs.length })}
        </div>
        <ul className="flex flex-col gap-1">
          {configs.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-md border border-ink-700/50 bg-ink-900/40 px-3 py-1.5 text-xs"
            >
              <span className="select-none">{c.icon ?? "📊"}</span>
              <span className="text-slate-200">{dashboardWidgetLabel(c, t)}</span>
              <span className="text-slate-500">{c.render}</span>
              <span
                className={`ml-auto rounded px-1.5 py-0.5 text-2xs ${
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

function GeneralSection() {
  const showSeconds = useSettings((s) => s.settings.clockShowSeconds);
  const language = useSettings((s) => s.settings.language);
  const set = useSettings((s) => s.set);
  const { t } = useI18n();
  return (
    <div>
      <SectionTitle>{t("settings.section.general")}</SectionTitle>
      <SettingRow
        label={t("settings.language.label")}
        description={t("settings.language.description")}
      >
        <select
          value={language}
          onChange={(event) => set("language", event.target.value as AppLanguage)}
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
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-2xl">
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
      <dl className="mt-4 space-y-1 text-sm text-slate-500">
        <div className="flex gap-2">
          <dt className="w-24 text-slate-600">Tauri</dt>
          <dd>{info?.tauri ?? "…"}</dd>
        </div>
      </dl>
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
    <div className="flex items-center justify-between gap-4 rounded-lg border border-ink-700/60 bg-ink-800/50 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs text-slate-500">{description}</div>
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
        className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
