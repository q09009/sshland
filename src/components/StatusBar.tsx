import { useEffect, useState } from "react";
import { useAppStore, ConnectionStatus } from "../store";
import { useSettings } from "../lib/settings";
import { formatClock, formatElapsed } from "../lib/format";

/**
 * Thin GNOME-style top bar, a fixed layer above (and separate from) the pane
 * tiling area. Everything here is derived locally — connection identity,
 * a local session timer, and the OS clock. Nothing here contacts the server.
 *
 * Future server-resource widgets (CPU/memory) will slot into the CENTER region
 * marked below; the three-region layout leaves room for them without reflow.
 */
export default function StatusBar() {
  const connection = useAppStore((s) => s.connection);
  const status = useAppStore((s) => s.connectionStatus);
  const openSettings = useAppStore((s) => s.openSettings);
  const showSeconds = useSettings((s) => s.settings.clockShowSeconds);

  // One local ticker drives both the session timer and the wall clock. No
  // server round-trips — purely Date-based.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = connection ? formatElapsed(now - connection.connectedAt) : "";

  return (
    <header className="flex h-8 shrink-0 items-center gap-3 border-b border-ink-700/70 bg-ink-800 px-3 text-xs text-slate-300 select-none">
      {/* LEFT: connection identity + health */}
      <div className="flex items-center gap-3">
        {connection && (
          <span className="font-medium text-slate-200">
            {connection.username}@{connection.host}
          </span>
        )}
        <StatusIndicator status={status} />
      </div>

      {/* CENTER: reserved for future server-resource widgets (CPU/mem). */}
      <div className="flex-1" />

      {/* RIGHT: local session timer, OS clock, settings */}
      <div className="flex items-center gap-3">
        {connection && (
          <span className="text-slate-400" title="세션 경과 시간">
            ⏱ {elapsed}
          </span>
        )}
        <span className="tabular-nums text-slate-300" title="로컬 시각">
          {formatClock(new Date(now), showSeconds)}
        </span>
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
