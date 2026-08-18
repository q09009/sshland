import { useEffect, useState } from "react";
import { useAppStore, ConnectionStatus } from "../store";
import { useSettings } from "../lib/settings";
import { formatClock, formatElapsed } from "../lib/format";
import { usePaneMenuStore } from "../lib/paneMenus";
import Menu from "./Menu";

/**
 * App-wide top bar. Contextual menus on the left target the focused pane, the
 * connection stays geometrically centered, and local time/settings sit right.
 */
export default function StatusBar() {
  const connection = useAppStore((s) => s.connection);
  const status = useAppStore((s) => s.connectionStatus);
  const openSettings = useAppStore((s) => s.openSettings);

  return (
    <header className="grid h-8 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-ink-700/70 bg-ink-800 px-2 text-xs text-slate-300 select-none">
      <GlobalPaneMenus />

      <div className="flex min-w-0 items-center gap-3 justify-self-center px-3">
        {connection && (
          <span className="max-w-56 truncate font-medium text-slate-200">
            {connection.username}@{connection.host}
          </span>
        )}
        <StatusIndicator status={status} />
      </div>

      <div className="flex items-center gap-3 justify-self-end">
        <StatusTime />
        <button
          onClick={openSettings}
          title="설정"
          aria-label="설정"
          className="rounded p-1 text-slate-400 hover:bg-ink-700 hover:text-slate-100"
        >
          <GearIcon />
        </button>
      </div>
    </header>
  );
}

const EMPTY_MENUS: never[] = [];

function GlobalPaneMenus() {
  const focusedPaneId = useAppStore((state) => state.focusedPaneId);
  const menus = usePaneMenuStore(
    (state) => state.byPane[focusedPaneId] ?? EMPTY_MENUS
  );

  return (
    <nav className="flex min-w-0 items-center gap-0.5 justify-self-start">
      {menus.map((menu) => (
        <Menu key={menu.label} label={menu.label} items={menu.items} />
      ))}
    </nav>
  );
}

/** Isolated so its one-second tick does not re-render the global menus. */
function StatusTime() {
  const connectedAt = useAppStore(
    (state) => state.connection?.connectedAt ?? null
  );
  const showSeconds = useSettings((state) => state.settings.clockShowSeconds);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {connectedAt !== null && (
        <span className="text-slate-400" title="세션 경과 시간">
          ⏱ {formatElapsed(now - connectedAt)}
        </span>
      )}
      <span className="tabular-nums text-slate-300" title="로컬 시각">
        {formatClock(new Date(now), showSeconds)}
      </span>
    </>
  );
}

const STATUS_META: Record<
  ConnectionStatus,
  { label: string; dot: string; pulse?: boolean }
> = {
  connected: { label: "연결됨", dot: "bg-emerald-500" },
  reconnecting: { label: "재연결 중", dot: "bg-amber-400", pulse: true },
  disconnected: { label: "끊김", dot: "bg-red-500" },
};

function StatusIndicator({ status }: { status: ConnectionStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="flex items-center gap-1.5 text-slate-400">
      <span
        className={`h-2 w-2 rounded-full ${meta.dot} ${
          meta.pulse ? "animate-pulse" : ""
        }`}
      />
      {meta.label}
    </span>
  );
}

function GearIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
