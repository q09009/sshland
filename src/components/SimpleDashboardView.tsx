import { useMemo, useState } from "react";
import type { DashboardWidgetConfig } from "../api";
import { useI18n } from "../i18n";
import { cpuCounters, cpuUsageBetween, sysstatCpuUsage } from "../lib/cpuUsage";
import { leadingNumber, parseColumns, type ColumnsData } from "../lib/parsers";
import { pidstatProcessRows } from "../lib/processUsage";
import { toProcessRows } from "./ProcessTable";

const DISK_LIMIT = 5;
const NETWORK_LIMIT = 5;
const PROCESS_LIMIT = 8;
const DOCKER_LIMIT = 8;

export interface PreviousDashboardSample {
  output: string;
  elapsedSeconds: number;
}

export default function SimpleDashboardView({
  kind,
  output,
  previousSample,
  onKill,
}: {
  kind: NonNullable<DashboardWidgetConfig["simpleView"]>;
  output: string;
  previousSample?: PreviousDashboardSample | null;
  onKill?: (pid: string, name: string) => void;
}): React.ReactElement | null {
  switch (kind) {
    case "cpu":
      return <SimpleCpuView output={output} previousSample={previousSample} />;
    case "disk":
      return <SimpleDiskView output={output} />;
    case "network":
      return <SimpleNetworkView output={output} previousSample={previousSample} />;
    case "process":
      return <SimpleProcessView output={output} onKill={onKill} />;
    case "docker":
      return <SimpleDockerView output={output} />;
  }
}

function columnIndex(data: ColumnsData, ...names: string[]): number {
  const wanted = names.map((name) => name.toLowerCase());
  return data.headers.findIndex((header) => wanted.includes(header.toLowerCase()));
}

/** Parse the IEC-ish values emitted by `df -h` (e.g. 512M, 1.5T). */
export function parseHumanBytes(value: string): number | null {
  const match = value.trim().replace(",", ".").match(/^([0-9.]+)\s*([kmgtpe]?)(?:i?b)?$/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  const suffix = match[2].toLowerCase();
  const exponent = suffix === "" ? 0 : "kmgtpe".indexOf(suffix) + 1;
  return amount * 1024 ** Math.max(0, exponent);
}

function formatBytes(bytes: number, perSecond = false): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return perSecond ? "0 B/s" : "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  const digits = value >= 100 || exponent === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[exponent]}${perSecond ? "/s" : ""}`;
}

function usageTone(percent: number) {
  return percent >= 90
    ? { fill: "bg-red-500", text: "text-red-400" }
    : percent >= 70
      ? { fill: "bg-amber-500", text: "text-amber-400" }
      : { fill: "bg-emerald-500", text: "text-emerald-400" };
}

function ProgressBar({ percent, compact = false }: { percent: number; compact?: boolean }) {
  const pct = Math.max(0, Math.min(100, percent));
  const tone = usageTone(pct);
  return (
    <div className={`${compact ? "h-1.5" : "h-2.5"} w-full overflow-hidden rounded-full bg-ink-700`}>
      <div
        className={`h-full rounded-full transition-[width] duration-normal ease-spatial ${tone.fill}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function SimpleCpuView({
  output,
  previousSample,
}: {
  output: string;
  previousSample?: PreviousDashboardSample | null;
}) {
  const [showCores, setShowCores] = useState(false);
  const sysstatRows = useMemo(() => sysstatCpuUsage(output), [output]);
  const current = useMemo(() => cpuCounters(output), [output]);
  const previous = useMemo(
    () => previousSample ? cpuCounters(previousSample.output) : null,
    [previousSample],
  );
  const { t } = useI18n();
  if (sysstatRows) {
    const total = sysstatRows.find((row) => row.cpu === "all");
    if (!total) {
      return <FriendlyMessage>{t("dashboard.simple.unavailable")}</FriendlyMessage>;
    }
    const cores = sysstatRows
      .filter((row) => row.cpu !== "all")
      .sort((left, right) => Number(left.cpu) - Number(right.cpu));
    const tone = usageTone(total.usage);
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-2xs uppercase tracking-wide text-slate-500">
                {t("dashboard.simple.cpu.total")}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className={`text-3xl font-semibold tabular-nums ${tone.text}`}>
                  {total.usage.toFixed(1)}
                </span>
                <span className="text-sm text-slate-400">%</span>
              </div>
            </div>
            {cores.length > 0 && (
              <button
                type="button"
                aria-pressed={showCores}
                aria-expanded={showCores}
                onClick={() => setShowCores((value) => !value)}
                className={`rounded-md px-2 py-1 text-2xs transition-colors ${
                  showCores
                    ? "bg-sky-500/20 text-sky-200"
                    : "bg-ink-900/60 text-slate-400 hover:text-slate-200"
                }`}
              >
                {t("dashboard.simple.cpu.cores")} {showCores ? "▴" : "▾"}
              </button>
            )}
          </div>
          <div className="mt-2"><ProgressBar percent={total.usage} /></div>
        </div>

        {showCores && cores.length > 0 && (
          <div className="border-t border-ink-700/60 pt-2">
            <div className="mb-1.5 text-2xs font-medium text-slate-500">
              {t("dashboard.simple.cpu.coreCount", { count: cores.length })}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {cores.map((core) => {
                const coreTone = usageTone(core.usage);
                return (
                  <div key={core.cpu} className="rounded-md bg-ink-900/35 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2 text-2xs">
                      <span className="font-mono text-slate-300">CPU {core.cpu}</span>
                      <span className={`tabular-nums ${coreTone.text}`}>
                        {core.usage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1"><ProgressBar percent={core.usage} compact /></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
  if (!current) return <FriendlyMessage>{t("dashboard.simple.unavailable")}</FriendlyMessage>;
  if (!previous) {
    return (
      <div className="flex h-full min-h-24 items-center justify-center text-center text-xs text-slate-500">
        {t("dashboard.simple.cpu.measuring")}
      </div>
    );
  }
  const percent = cpuUsageBetween(previous, current);
  if (percent == null) {
    return <FriendlyMessage>{t("dashboard.simple.unavailable")}</FriendlyMessage>;
  }
  const tone = usageTone(percent);
  return (
    <div className="flex h-full w-full flex-col justify-center gap-3">
      <div>
        <div className="text-2xs uppercase tracking-wide text-slate-500">
          {t("dashboard.simple.cpu.total")}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className={`text-3xl font-semibold tabular-nums ${tone.text}`}>
            {percent.toFixed(1)}
          </span>
          <span className="text-sm text-slate-400">%</span>
        </div>
      </div>
      <ProgressBar percent={percent} />
    </div>
  );
}

interface DiskRow {
  filesystem: string;
  size: number;
  used: number;
  percent: number;
  mount: string;
}

export function diskSummary(output: string): { total: number; used: number; rows: DiskRow[] } | null {
  const data = parseColumns(output);
  if (!data) return null;
  const fsI = columnIndex(data, "Filesystem");
  const sizeI = columnIndex(data, "Size");
  const usedI = columnIndex(data, "Used");
  const pctI = columnIndex(data, "Use%", "Capacity");
  const mountI = columnIndex(data, "Mounted on", "Mounted");
  if ([fsI, sizeI, usedI, pctI, mountI].some((index) => index < 0)) return null;

  const parsed = data.rows
    .map((row): DiskRow | null => {
      const size = parseHumanBytes(row[sizeI] ?? "");
      const used = parseHumanBytes(row[usedI] ?? "");
      const percent = leadingNumber(row[pctI] ?? "");
      if (size == null || used == null || percent == null || size <= 0) return null;
      return {
        filesystem: row[fsI] ?? "",
        size,
        used,
        percent,
        mount: row[mountI] ?? "",
      };
    })
    .filter((row): row is DiskRow => row != null);
  if (parsed.length === 0) return null;

  const pseudo = /^(tmpfs|devtmpfs|udev|overlay|shm|none)$/i;
  const physical = parsed.filter(
    (row) =>
      !pseudo.test(row.filesystem) &&
      !row.filesystem.toLowerCase().includes("squashfs") &&
      !row.filesystem.startsWith("/dev/loop") &&
      !row.mount.startsWith("/snap/"),
  );
  const source = physical.length > 0 ? physical : parsed;
  const unique = [...new Map(source.map((row) => [row.filesystem, row])).values()];
  return {
    total: unique.reduce((sum, row) => sum + row.size, 0),
    used: unique.reduce((sum, row) => sum + row.used, 0),
    rows: [...unique].sort((a, b) => b.percent - a.percent),
  };
}

function SimpleDiskView({ output }: { output: string }) {
  const summary = useMemo(() => diskSummary(output), [output]);
  const { t } = useI18n();
  if (!summary || summary.total <= 0) {
    return <FriendlyMessage>{t("dashboard.simple.unavailable")}</FriendlyMessage>;
  }
  const percent = (summary.used / summary.total) * 100;
  const tone = usageTone(percent);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-2xs uppercase tracking-wide text-slate-500">
              {t("dashboard.simple.disk.total")}
            </div>
            <div className="mt-0.5 text-sm text-slate-200">
              {t("dashboard.simple.usedOf", {
                used: formatBytes(summary.used),
                total: formatBytes(summary.total),
              })}
            </div>
          </div>
          <span className={`text-xl font-semibold tabular-nums ${tone.text}`}>
            {percent.toFixed(1)}%
          </span>
        </div>
        <div className="mt-2"><ProgressBar percent={percent} /></div>
      </div>

      <RankedSection title={t("dashboard.simple.disk.top", { count: DISK_LIMIT })}>
        {summary.rows.slice(0, DISK_LIMIT).map((row) => (
          <div key={`${row.filesystem}-${row.mount}`} className="rounded-md bg-ink-900/35 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="min-w-0 truncate text-slate-300" title={row.mount}>{row.mount}</span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {formatBytes(row.used)} / {formatBytes(row.size)} · {row.percent.toFixed(0)}%
              </span>
            </div>
            <div className="mt-1"><ProgressBar percent={row.percent} compact /></div>
          </div>
        ))}
      </RankedSection>
    </div>
  );
}

interface NetworkCounter {
  name: string;
  rx: number;
  tx: number;
}

export function networkCounters(output: string): NetworkCounter[] | null {
  const data = parseColumns(output);
  if (!data) return null;
  const nameI = columnIndex(data, "IFACE");
  const rxI = columnIndex(data, "RX_BYTES");
  const txI = columnIndex(data, "TX_BYTES");
  if ([nameI, rxI, txI].some((index) => index < 0)) return null;
  const rows = data.rows
    .map((row) => ({
      name: row[nameI] ?? "",
      rx: Number.parseFloat(row[rxI] ?? ""),
      tx: Number.parseFloat(row[txI] ?? ""),
    }))
    .filter((row) => row.name !== "" && Number.isFinite(row.rx) && Number.isFinite(row.tx));
  return rows.length > 0 ? rows : null;
}

function SimpleNetworkView({
  output,
  previousSample,
}: {
  output: string;
  previousSample?: PreviousDashboardSample | null;
}) {
  const current = useMemo(() => networkCounters(output), [output]);
  const previous = useMemo(
    () => previousSample ? networkCounters(previousSample.output) : null,
    [previousSample],
  );
  const { t } = useI18n();
  if (!current) return <FriendlyMessage>{t("dashboard.simple.unavailable")}</FriendlyMessage>;
  if (!previous || !previousSample || previousSample.elapsedSeconds <= 0) {
    return (
      <div className="flex h-full min-h-24 items-center justify-center text-center text-xs text-slate-500">
        {t("dashboard.simple.network.measuring")}
      </div>
    );
  }

  const previousByName = new Map(previous.map((row) => [row.name, row]));
  let rates = current.map((row) => {
    const before = previousByName.get(row.name);
    return {
      name: row.name,
      rx: before ? Math.max(0, row.rx - before.rx) / previousSample.elapsedSeconds : 0,
      tx: before ? Math.max(0, row.tx - before.tx) / previousSample.elapsedSeconds : 0,
    };
  });
  const withoutLoopback = rates.filter((row) => row.name !== "lo");
  if (withoutLoopback.length > 0) rates = withoutLoopback;
  rates.sort((a, b) => b.rx + b.tx - (a.rx + a.tx));
  const totalRx = rates.reduce((sum, row) => sum + row.rx, 0);
  const totalTx = rates.reduce((sum, row) => sum + row.tx, 0);
  const maxRate = Math.max(1, ...rates.map((row) => row.rx + row.tx));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label={t("dashboard.simple.network.receiving")} value={`↓ ${formatBytes(totalRx, true)}`} tone="emerald" />
        <MetricCard label={t("dashboard.simple.network.sending")} value={`↑ ${formatBytes(totalTx, true)}`} tone="sky" />
      </div>
      <RankedSection title={t("dashboard.simple.network.top", { count: NETWORK_LIMIT })}>
        {rates.slice(0, NETWORK_LIMIT).map((row) => (
          <div key={row.name} className="rounded-md bg-ink-900/35 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="font-mono text-slate-300">{row.name}</span>
              <span className="tabular-nums text-slate-400">
                ↓ {formatBytes(row.rx, true)} · ↑ {formatBytes(row.tx, true)}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700">
              <div className="flex h-full" style={{ width: `${Math.max(2, ((row.rx + row.tx) / maxRate) * 100)}%` }}>
                <span className="h-full bg-emerald-500" style={{ width: `${row.rx + row.tx > 0 ? (row.rx / (row.rx + row.tx)) * 100 : 50}%` }} />
                <span className="h-full flex-1 bg-sky-500" />
              </div>
            </div>
          </div>
        ))}
      </RankedSection>
    </div>
  );
}

function SimpleProcessView({
  output,
  onKill,
}: {
  output: string;
  onKill?: (pid: string, name: string) => void;
}) {
  const data = useMemo(() => parseColumns(output), [output]);
  const sampledRows = useMemo(() => pidstatProcessRows(output), [output]);
  const rows = useMemo(
    () => sampledRows ?? (data ? toProcessRows(data) : null),
    [data, sampledRows],
  );
  const [sortBy, setSortBy] = useState<"cpu" | "mem">("cpu");
  const { t } = useI18n();
  if (!rows) return <FriendlyMessage>{t("dashboard.simple.unavailable")}</FriendlyMessage>;
  const top = [...rows]
    .sort((a, b) => (leadingNumber(b[sortBy]) ?? 0) - (leadingNumber(a[sortBy]) ?? 0))
    .slice(0, PROCESS_LIMIT);
  const max = Math.max(1, ...top.map((row) => leadingNumber(row[sortBy]) ?? 0));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-slate-500">
          {t("dashboard.simple.process.top", { count: PROCESS_LIMIT })}
        </span>
        <div className="flex rounded-md bg-ink-900/60 p-0.5 text-2xs">
          {(["cpu", "mem"] as const).map((metric) => (
            <button
              key={metric}
              type="button"
              onClick={() => setSortBy(metric)}
              className={`rounded px-2 py-0.5 ${sortBy === metric ? "bg-sky-500/20 text-sky-200" : "text-slate-500 hover:text-slate-300"}`}
            >
              {metric === "cpu" ? t("dashboard.simple.process.cpu") : t("dashboard.simple.process.memory")}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {top.map((row) => {
          const metric = leadingNumber(row[sortBy]) ?? 0;
          return (
            <div key={row.pid} className="rounded-md bg-ink-900/35 px-2 py-1.5">
              <div className="flex items-center gap-2 text-2xs">
                <span className="min-w-0 flex-1 truncate font-mono text-slate-300" title={row.command}>{processLabel(row.command)}</span>
                <span className="shrink-0 tabular-nums text-slate-500">PID {row.pid}</span>
                <span className="w-28 shrink-0 text-right tabular-nums text-slate-300">
                  CPU {row.cpu}% · MEM {row.mem}%
                </span>
                {onKill && (
                  <button type="button" onClick={() => onKill(row.pid, row.command)} title={t("dashboard.process.kill")} className="rounded px-1 text-slate-500 hover:bg-red-500/20 hover:text-red-300">✕</button>
                )}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div className="h-full rounded-full bg-sky-500" style={{ width: `${(metric / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function processLabel(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? command;
  if (first.startsWith("[") && first.endsWith("]")) return first;
  return first.split("/").filter(Boolean).pop() ?? first;
}

interface DockerRow {
  name: string;
  image: string;
  state: string;
  status: string;
}

function dockerRows(output: string): DockerRow[] | null {
  const data = parseColumns(output);
  if (!data) return null;
  const nameI = columnIndex(data, "NAMES", "NAME");
  const imageI = columnIndex(data, "IMAGE");
  const stateI = columnIndex(data, "STATE");
  const statusI = columnIndex(data, "STATUS");
  if ([nameI, imageI, stateI, statusI].some((index) => index < 0)) return null;
  return data.rows.map((row) => ({
    name: row[nameI] ?? "",
    image: row[imageI] ?? "",
    state: row[stateI] ?? "",
    status: row[statusI] ?? "",
  })).filter((row) => row.name !== "");
}

function SimpleDockerView({ output }: { output: string }) {
  const { t } = useI18n();
  const sentinel = output.trim();
  if (sentinel === "__SSHLAND_DOCKER__:missing") {
    return <FriendlyMessage>{t("dashboard.simple.docker.missing")}</FriendlyMessage>;
  }
  if (sentinel === "__SSHLAND_DOCKER__:unavailable") {
    return <FriendlyMessage tone="warning">{t("dashboard.simple.docker.unavailable")}</FriendlyMessage>;
  }
  const rows = dockerRows(output);
  if (!rows) return <FriendlyMessage>{t("dashboard.simple.unavailable")}</FriendlyMessage>;
  if (rows.length === 0) return <FriendlyMessage>{t("dashboard.simple.docker.empty")}</FriendlyMessage>;

  const isRunning = (row: DockerRow) => row.state.toLowerCase() === "running";
  const isUnhealthy = (row: DockerRow) => /unhealthy/i.test(row.status);
  const running = rows.filter(isRunning).length;
  const unhealthy = rows.filter(isUnhealthy).length;
  const sorted = [...rows].sort((a, b) => dockerPriority(a) - dockerPriority(b));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-1.5">
        <SmallStat label={t("dashboard.simple.docker.total")} value={rows.length} />
        <SmallStat label={t("dashboard.simple.docker.running")} value={running} tone="emerald" />
        <SmallStat label={t("dashboard.simple.docker.stopped")} value={rows.length - running} />
        <SmallStat label={t("dashboard.simple.docker.unhealthy")} value={unhealthy} tone={unhealthy > 0 ? "red" : "muted"} />
      </div>
      <div className="flex flex-col gap-1">
        {sorted.slice(0, DOCKER_LIMIT).map((row) => {
          const unhealthyRow = isUnhealthy(row);
          const runningRow = isRunning(row);
          const dot = unhealthyRow ? "bg-red-500" : runningRow ? "bg-emerald-500" : /restarting/i.test(row.state) ? "bg-amber-500" : "bg-slate-600";
          return (
            <div key={row.name} className="flex items-center gap-2 rounded-md bg-ink-900/35 px-2 py-1.5 text-2xs">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-200" title={row.name}>{row.name}</span>
              <span className="max-w-[35%] truncate font-mono text-slate-500" title={row.image}>{row.image}</span>
              <span className="max-w-[40%] truncate text-right text-slate-400" title={row.status}>{row.status}</span>
            </div>
          );
        })}
        {rows.length > DOCKER_LIMIT && (
          <div className="pt-1 text-center text-2xs text-slate-500">
            {t("dashboard.simple.more", { count: rows.length - DOCKER_LIMIT })}
          </div>
        )}
      </div>
    </div>
  );
}

function dockerPriority(row: DockerRow): number {
  if (/unhealthy|dead/i.test(`${row.state} ${row.status}`)) return 0;
  if (/restarting/i.test(row.state)) return 1;
  if (row.state.toLowerCase() === "running") return 2;
  return 3;
}

function RankedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 text-2xs font-medium text-slate-500">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: "emerald" | "sky" }) {
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-900/35 px-3 py-2">
      <div className="text-2xs text-slate-500">{label}</div>
      <div className={`mt-1 text-base font-semibold tabular-nums ${tone === "emerald" ? "text-emerald-400" : "text-sky-400"}`}>{value}</div>
    </div>
  );
}

function SmallStat({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "emerald" | "red" }) {
  const color = tone === "emerald" ? "text-emerald-400" : tone === "red" ? "text-red-400" : "text-slate-200";
  return (
    <div className="rounded-md bg-ink-900/45 px-2 py-1.5 text-center">
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="truncate text-2xs text-slate-500" title={label}>{label}</div>
    </div>
  );
}

function FriendlyMessage({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warning" }) {
  return (
    <div className={`flex h-full min-h-24 items-center justify-center rounded-lg border px-4 text-center text-xs ${tone === "warning" ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-ink-700/60 bg-ink-900/35 text-slate-400"}`}>
      {children}
    </div>
  );
}
