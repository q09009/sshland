import { useEffect, useState } from "react";
import { getName, getVersion, getTauriVersion } from "@tauri-apps/api/app";
import { useAppStore } from "../store";
import { useSettings } from "../lib/settings";
import { useCommandConfigs } from "../lib/commandConfigs";
import { useDashboardWidgetConfigs } from "../lib/dashboardWidgetConfigs";
import { MIN_REFRESH_SECONDS, clampInterval } from "../lib/dashboardTypes";
import { commandsDirPath, openCommandsDir } from "../api";

/**
 * Full settings surface: a modal overlay covering the pane tiling, with a
 * category sidebar and a content area. Adding a section later ("명령어 로그",
 * "단축키", "테마", …) is just one more entry in SECTIONS — the sidebar and
 * routing are data-driven.
 */
interface Section {
  id: string;
  label: string;
  render: () => React.ReactNode;
}

const SECTIONS: Section[] = [
  { id: "command-log", label: "명령어 로그", render: () => <CommandLogSection /> },
  { id: "command-gui", label: "명령어 GUI", render: () => <CommandGuiSection /> },
  { id: "dashboard", label: "대시보드", render: () => <DashboardSection /> },
  { id: "general", label: "일반", render: () => <GeneralSection /> },
  { id: "about", label: "정보", render: () => <AboutSection /> },
  // Future: { id: "shortcuts", label: "단축키", ... },
  //         { id: "theme", label: "테마", ... }
];

export default function SettingsPanel() {
  const open = useAppStore((s) => s.settingsOpen);
  const close = useAppStore((s) => s.closeSettings);
  const [active, setActive] = useState(SECTIONS[0].id);

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
            설정
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
              {s.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="relative flex-1 overflow-y-auto p-6">
          <button
            onClick={close}
            title="닫기"
            aria-label="닫기"
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
  return (
    <div>
      <SectionTitle>명령어 로그</SectionTitle>
      <SettingRow
        label="파일 조작 시 명령어 로그 표시"
        description="파일 조작을 실제 터미널 명령어(scp/rm/mv 등)로 화면 아래 바에 보여줍니다."
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
      <SectionTitle>명령어 GUI</SectionTitle>
      <SettingRow
        label="명령어 결과를 GUI 위젯으로 표시"
        description="터미널 명령 출력이 등록된 규칙과 맞으면 표·카드·목록으로 보여줍니다. 끄면 항상 원본 텍스트만."
      >
        <Toggle
          checked={enabled}
          onChange={(v) => set("commandGuiEnabled", v)}
        />
      </SettingRow>

      <div className="mt-4 rounded-lg border border-ink-700/60 bg-ink-800/50 px-4 py-3">
        <div className="text-sm text-slate-200">사용자 설정 폴더</div>
        <div className="mt-1 break-all font-mono text-2xs text-slate-500">
          {dir ?? "…"}
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => openCommandsDir().catch(() => {})}
            className="rounded-lg bg-sky-500/15 px-3 py-1 text-xs text-sky-200 hover:bg-sky-500/25"
          >
            폴더 열기
          </button>
          <button
            onClick={doReload}
            disabled={reloading}
            className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-slate-300 hover:bg-ink-700 disabled:opacity-50"
          >
            {reloading ? "불러오는 중…" : "다시 불러오기"}
          </button>
        </div>
        <p className="mt-2 text-2xs leading-relaxed text-slate-500">
          이 폴더에 TOML 파일을 추가·수정한 뒤 "다시 불러오기"를 누르세요. 같은
          파일명은 기본 제공 설정을 덮어씁니다.
        </p>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-slate-400">
          등록된 명령어 ({configs.length})
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
                {c.source === "user" ? "사용자" : "기본"}
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
      <SectionTitle>대시보드</SectionTitle>
      <SettingRow
        label="대시보드 pane 사용"
        description="pane 헤더의 📊 버튼으로 서버 상태 위젯 대시보드를 열 수 있게 합니다. 끄면 버튼이 숨겨집니다."
      >
        <Toggle
          checked={enabled}
          onChange={(v) => set("dashboardEnabled", v)}
        />
      </SettingRow>

      <SettingRow
        label="새 위젯 기본 새로고침 주기"
        description="위젯을 추가할 때 쓰는 기본 주기(초)예요. 위젯이 자체 주기를 지정하면 그 값이 우선합니다. 주기가 짧을수록 서버에 명령이 더 자주 실행돼요."
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
          <span className="text-slate-500">초</span>
        </span>
      </SettingRow>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-slate-400">
          사용 가능한 위젯 ({configs.length})
        </div>
        <ul className="flex flex-col gap-1">
          {configs.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-md border border-ink-700/50 bg-ink-900/40 px-3 py-1.5 text-xs"
            >
              <span className="select-none">{c.icon ?? "📊"}</span>
              <span className="text-slate-200">{c.label}</span>
              <span className="text-slate-500">{c.render}</span>
              <span
                className={`ml-auto rounded px-1.5 py-0.5 text-2xs ${
                  c.source === "user"
                    ? "bg-sky-500/15 text-sky-200"
                    : "bg-ink-700 text-slate-400"
                }`}
              >
                {c.source === "user" ? "사용자" : "기본"}
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
  const set = useSettings((s) => s.set);
  return (
    <div>
      <SectionTitle>일반</SectionTitle>
      <SettingRow
        label="시계에 초 표시"
        description="상단 상태바 시계를 HH:MM:SS 로 표시합니다."
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
      <SectionTitle>정보</SectionTitle>
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-2xl">
          🌐
        </div>
        <div>
          <div className="text-base font-semibold text-slate-100">
            {info?.name ?? "SSHland"}
          </div>
          <div className="text-sm text-slate-400">
            버전 {info?.version ?? "…"}
          </div>
        </div>
      </div>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
        초보자를 위한 SSH/SFTP GUI 클라이언트. 파일 관리, 터미널, 타일링 pane을
        가볍게 제공합니다.
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
