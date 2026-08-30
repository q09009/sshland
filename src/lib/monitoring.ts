export type MonitoringEngine = "builtin" | "sysstat";

export interface SysstatToolStatus {
  checked: boolean;
  available: boolean;
  version: string | null;
  missing: string[];
}

export function emptySysstatToolStatus(): SysstatToolStatus {
  return { checked: false, available: false, version: null, missing: [] };
}

export function resolveMonitoringEngine(
  preferred: MonitoringEngine,
  sysstat: SysstatToolStatus,
): MonitoringEngine {
  return preferred === "sysstat" && sysstat.checked && sysstat.available
    ? "sysstat"
    : "builtin";
}

/** One-second per-CPU sample. JSON avoids locale-dependent mpstat columns. */
export const SYSSTAT_CPU_COMMAND =
  "LC_ALL=C mpstat -P ALL -o JSON 1 1";

/** One-second per-process CPU and memory sample on one parseable header. */
export const SYSSTAT_PROCESS_COMMAND =
  "LC_ALL=C S_TIME_FORMAT=ISO pidstat -h -l -u -r -p ALL 1 1";

/**
 * Verify the sysstat commands planned for the monitoring mode. mpstat's JSON
 * support is checked separately because the CPU renderer relies on it.
 */
export const SYSSTAT_CHECK_COMMAND =
  "missing=''; for tool in mpstat pidstat; do " +
  "if ! command -v \"$tool\" >/dev/null 2>&1; then missing=\"${missing}${missing:+,}$tool\"; fi; " +
  "done; if [ -z \"$missing\" ] && ! LC_ALL=C mpstat -P ALL -o JSON >/dev/null 2>&1; then missing='mpstat-json'; fi; " +
  "if [ -z \"$missing\" ] && ! LC_ALL=C pidstat -h -l -u -r -p SELF >/dev/null 2>&1; then missing='pidstat-horizontal'; fi; " +
  "if [ -z \"$missing\" ]; then printf '__SSHLAND_SYSSTAT__:available\\n'; mpstat -V 2>&1 | head -n 1; " +
  "else printf '__SSHLAND_SYSSTAT__:missing:%s\\n' \"$missing\"; fi";

export function parseSysstatToolCheck(output: string): SysstatToolStatus | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const marker = lines.find((line) => line.startsWith("__SSHLAND_SYSSTAT__:"));
  if (!marker) return null;
  if (marker === "__SSHLAND_SYSSTAT__:available") {
    const version = lines.find((line) => line !== marker) ?? null;
    return { checked: true, available: true, version, missing: [] };
  }
  const prefix = "__SSHLAND_SYSSTAT__:missing:";
  if (!marker.startsWith(prefix)) return null;
  const missing = marker
    .slice(prefix.length)
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  return { checked: true, available: false, version: null, missing };
}
