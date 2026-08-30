export interface CpuCounters {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
}

export interface CpuUsageRow {
  cpu: string;
  usage: number;
  user: number;
  system: number;
  iowait: number;
  idle: number;
}

/** Parse the cumulative aggregate CPU counters emitted from /proc/stat. */
export function cpuCounters(output: string): CpuCounters | null {
  const lines = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const headers = lines[0].split(/\s+/);
  const rawValues = lines[1].split(/\s+/);
  const valueFor = (name: string): number | null => {
    const index = headers.indexOf(name);
    if (index < 0) return null;
    const value = Number.parseFloat(rawValues[index] ?? "");
    return Number.isFinite(value) && value >= 0 ? value : null;
  };

  const values = {
    user: valueFor("USER"),
    nice: valueFor("NICE"),
    system: valueFor("SYSTEM"),
    idle: valueFor("IDLE"),
    iowait: valueFor("IOWAIT"),
    irq: valueFor("IRQ"),
    softirq: valueFor("SOFTIRQ"),
    steal: valueFor("STEAL"),
  };
  if (Object.values(values).some((value) => value == null)) return null;
  return values as CpuCounters;
}

/** Calculate busy CPU time between two Linux aggregate counter snapshots. */
export function cpuUsageBetween(
  previous: CpuCounters,
  current: CpuCounters,
): number | null {
  const idleBefore = previous.idle + previous.iowait;
  const idleNow = current.idle + current.iowait;
  const busyBefore =
    previous.user +
    previous.nice +
    previous.system +
    previous.irq +
    previous.softirq +
    previous.steal;
  const busyNow =
    current.user +
    current.nice +
    current.system +
    current.irq +
    current.softirq +
    current.steal;
  const totalDelta = idleNow + busyNow - (idleBefore + busyBefore);
  const idleDelta = idleNow - idleBefore;
  if (totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta) return null;
  return Math.max(
    0,
    Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100),
  );
}

/** Parse the most recent per-CPU sample from `mpstat -o JSON -P ALL`. */
export function sysstatCpuUsage(output: string): CpuUsageRow[] | null {
  let root: unknown;
  try {
    root = JSON.parse(output);
  } catch {
    return null;
  }
  if (!root || typeof root !== "object") return null;
  const sysstat = (root as Record<string, unknown>).sysstat;
  if (!sysstat || typeof sysstat !== "object") return null;
  const hosts = (sysstat as Record<string, unknown>).hosts;
  if (!Array.isArray(hosts)) return null;

  const samples: unknown[][] = [];
  for (const host of hosts) {
    if (!host || typeof host !== "object") continue;
    const statistics = (host as Record<string, unknown>).statistics;
    if (!Array.isArray(statistics)) continue;
    for (const sample of statistics) {
      if (!sample || typeof sample !== "object") continue;
      const load = (sample as Record<string, unknown>)["cpu-load"];
      if (Array.isArray(load)) samples.push(load);
    }
  }
  const latest = samples[samples.length - 1];
  if (!latest) return null;

  const rows = latest
    .map((raw): CpuUsageRow | null => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Record<string, unknown>;
      const cpu = typeof row.cpu === "string" ? row.cpu : null;
      const user = numberField(row.usr);
      const system = numberField(row.sys);
      const iowait = numberField(row.iowait);
      const idle = numberField(row.idle);
      if (cpu == null || user == null || system == null || iowait == null || idle == null) {
        return null;
      }
      return {
        cpu,
        user,
        system,
        iowait,
        idle,
        usage: Math.max(0, Math.min(100, 100 - idle - iowait)),
      };
    })
    .filter((row): row is CpuUsageRow => row != null);
  return rows.some((row) => row.cpu === "all") ? rows : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
