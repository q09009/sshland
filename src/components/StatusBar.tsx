import { useEffect, useRef, useState } from "react";
import { disconnect, pollWidgetCommand } from "../api";
import { useAppStore, ConnectionStatus } from "../store";
import { useSettings } from "../lib/settings";
import { formatClockAtOffset, formatElapsed } from "../lib/format";
import { usePaneMenuStore } from "../lib/paneMenus";
import Menu from "./Menu";

/**
 * App-wide top bar. Contextual menus on the left target the focused pane, the
 * connection stays geometrically centered, and transient transfer progress
 * plus settings sit right.
 */
export default function StatusBar() {
  return (
    <header className="grid h-8 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-ink-700/70 bg-ink-800 px-2 text-xs text-slate-300 select-none">
      <GlobalPaneMenus />
      <ConnectionInfo />
      <div className="flex items-center gap-3 justify-self-end">
        <TransferStatus />
        <SettingsButton />
      </div>
    </header>
  );
}

function TransferStatus() {
  const transfers = useAppStore((s) => s.transfers);
  const batches = useAppStore((s) => s.uploadBatches);
  const activeTransfers = transfers.filter(
    (transfer) => transfer.status === "active"
  );
  const activeBatches = batches.filter((batch) => batch.done < batch.total);

  if (activeTransfers.length === 0 && activeBatches.length === 0) return null;

  const knownTransfers = activeTransfers.filter(
    (transfer) => transfer.total > 0
  );
  const transferredBytes = knownTransfers.reduce(
    (sum, transfer) => sum + Math.min(transfer.transferred, transfer.total),
    0
  );
  const totalBytes = knownTransfers.reduce(
    (sum, transfer) => sum + transfer.total,
    0
  );
  const batch = activeBatches[0];

  const percent =
    totalBytes > 0
      ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100))
      : activeTransfers.length === 0 && batch && batch.total > 0
        ? Math.min(100, Math.round((batch.done / batch.total) * 100))
        : null;

  const singleTransfer =
    activeTransfers.length === 1 ? activeTransfers[0] : null;
  const label = singleTransfer
    ? `${singleTransfer.kind === "upload" ? "↑" : "↓"} ${singleTransfer.name}`
    : activeTransfers.length > 1
      ? `${activeTransfers.length}개 전송`
      : batch
        ? `업로드 ${batch.done}/${batch.total}`
        : "전송 중";

  return (
    <div
      className="flex max-w-52 items-center gap-2 text-slate-400"
      title={label}
      aria-label={`${label}${percent === null ? "" : ` ${percent}%`}`}
    >
      <span className="max-w-28 truncate">{label}</span>
      <span
        className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-ink-900"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <span
          className={`block h-full rounded-full bg-sky-500 transition-[width] duration-normal ease-spatial ${
            percent === null ? "w-1/3 animate-pulse" : ""
          }`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </span>
      <span className="w-8 shrink-0 text-right font-mono text-2xs text-slate-500">
        {percent === null ? "…" : `${percent}%`}
      </span>
    </div>
  );
}

function SettingsButton() {
  const openSettings = useAppStore((s) => s.openSettings);
  return (
    <button
      onClick={openSettings}
      title="설정"
      aria-label="설정"
      className="rounded p-1 text-slate-400 hover:bg-ink-700 hover:text-slate-100"
    >
      <GearIcon />
    </button>
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

const DOT_META: Record<ConnectionStatus, { color: string; pulse?: boolean }> = {
  connected: { color: "bg-emerald-500" },
  reconnecting: { color: "bg-amber-400", pulse: true },
  disconnected: { color: "bg-red-500" },
};

const SERVER_CLOCK_COMMAND = "date '+%s %z'";

interface ServerClockSample {
  /** Difference between the remote Unix clock and the local wall clock. */
  epochDeltaMs: number;
  /** Remote UTC offset, including daylight-saving time, at sampling time. */
  utcOffsetMinutes: number;
}

function parseServerClock(
  output: string,
  requestStartedAt: number,
  requestFinishedAt: number
): ServerClockSample | null {
  const match = output.trim().match(/(\d{9,})\s+([+-])(\d{2})(\d{2})/);
  if (!match) return null;

  const epochSeconds = Number(match[1]);
  const offsetHours = Number(match[3]);
  const offsetMinutes = Number(match[4]);
  if (
    !Number.isSafeInteger(epochSeconds) ||
    offsetHours > 23 ||
    offsetMinutes > 59
  ) {
    return null;
  }

  const sign = match[2] === "-" ? -1 : 1;
  const requestMidpoint = Math.round((requestStartedAt + requestFinishedAt) / 2);
  return {
    epochDeltaMs: epochSeconds * 1000 - requestMidpoint,
    utcOffsetMinutes: sign * (offsetHours * 60 + offsetMinutes),
  };
}

/**
 * The connected server, centered — a status dot + `user@host` in mono.
 * Isolated so its one-second clock tick does not re-render the global menus.
 * Each SSH connection samples the server clock once; clicking opens a popover
 * that advances the cached time locally alongside the elapsed session time.
 */
function ConnectionInfo() {
  const connection = useAppStore((s) => s.connection);
  const status = useAppStore((s) => s.connectionStatus);
  const returnToConnect = useAppStore((s) => s.returnToConnect);
  const showSeconds = useSettings((s) => s.settings.clockShowSeconds);

  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [serverClock, setServerClock] = useState<ServerClockSample | null>(null);
  const [serverClockFailed, setServerClockFailed] = useState(false);
  const serverClockRequestRef = useRef<{
    connectionStartedAt: number;
    request: Promise<ServerClockSample>;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(id);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!connection) {
      setServerClock(null);
      setServerClockFailed(false);
      return;
    }

    let active = true;
    setServerClock(null);
    setServerClockFailed(false);
    let cachedRequest = serverClockRequestRef.current;

    if (cachedRequest?.connectionStartedAt !== connection.connectedAt) {
      const requestStartedAt = Date.now();
      const request = pollWidgetCommand(SERVER_CLOCK_COMMAND).then((output) => {
        const sample = parseServerClock(output, requestStartedAt, Date.now());
        if (!sample) throw new Error("Invalid server clock response");
        return sample;
      });
      cachedRequest = {
        connectionStartedAt: connection.connectedAt,
        request,
      };
      serverClockRequestRef.current = cachedRequest;
    }

    void cachedRequest.request
      .then((sample) => {
        if (active) setServerClock(sample);
      })
      .catch(() => {
        if (active) setServerClockFailed(true);
      });

    return () => {
      active = false;
    };
  }, [connection]);

  async function handleDisconnect() {
    setOpen(false);
    try {
      await disconnect();
    } finally {
      returnToConnect();
    }
  }

  const dot = DOT_META[status];
  const serverTime = serverClock
    ? formatClockAtOffset(
        now + serverClock.epochDeltaMs,
        serverClock.utcOffsetMinutes,
        showSeconds
      )
    : serverClockFailed
      ? "확인할 수 없음"
      : "불러오는 중…";

  return (
    <div ref={ref} className="relative min-w-0 justify-self-center">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!connection}
        className="flex min-w-0 items-center gap-2 rounded px-2 py-0.5 hover:bg-ink-700 disabled:hover:bg-transparent"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot.color} ${
            dot.pulse ? "animate-pulse" : ""
          }`}
        />
        {connection && (
          <span className="max-w-56 truncate font-mono text-slate-200">
            {connection.username}@{connection.host}
          </span>
        )}
      </button>

      {open && connection && (
        <div className="motion-popover absolute left-1/2 top-full z-40 mt-1.5 w-56 -translate-x-1/2 rounded-lg border border-ink-700 bg-ink-800 p-3 text-xs shadow-popover">
          <Row label="서버 시각" value={serverTime} />
          <Row
            label="경과"
            value={formatElapsed(now - connection.connectedAt)}
            last
          />
          <hr className="hr my-2.5" />
          <button
            onClick={() => void handleDisconnect()}
            className="text-left text-red-400 hover:text-red-300"
          >
            연결 종료
          </button>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between text-slate-400 ${
        last ? "" : "mb-1.5"
      }`}
    >
      <span>{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
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
