export interface ProcessUsageRow {
  pid: string;
  cpu: string;
  mem: string;
  command: string;
}

/**
 * Parse the combined horizontal report from
 * `pidstat -h -l -u -r -p ALL 1 1`.
 *
 * A small leading offset is detected because some locales add a separate
 * AM/PM token beside the timestamp. Everything from Command onward is kept so
 * `-l` can preserve the executable and its arguments.
 */
export function pidstatProcessRows(output: string): ProcessUsageRow[] | null {
  const lines = output.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const headers = headerTokens(line);
    return (
      headers.includes("PID") &&
      headers.includes("UID") &&
      headers.includes("%usr") &&
      headers.includes("%CPU") &&
      headers.includes("%MEM") &&
      commandIndex(headers) >= 0
    );
  });
  if (headerIndex < 0) return null;

  const headers = headerTokens(lines[headerIndex]);
  const commandI = commandIndex(headers);
  const uidI = headers.indexOf("UID");
  const pidI = headers.indexOf("PID");
  const cpuI = headers.indexOf("%CPU");
  const memI = headers.indexOf("%MEM");
  if ([commandI, uidI, pidI, cpuI, memI].some((index) => index < 0)) return null;

  const rows: ProcessUsageRow[] = [];
  for (const raw of lines.slice(headerIndex + 1)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("Average:")) continue;
    const tokens = line.split(/\s+/);
    for (let offset = 0; offset <= 2; offset += 1) {
      const uid = tokens[uidI + offset] ?? "";
      const pid = tokens[pidI + offset] ?? "";
      const cpu = tokens[cpuI + offset] ?? "";
      const mem = tokens[memI + offset] ?? "";
      const command = tokens.slice(commandI + offset).join(" ");
      if (
        !/^\d+$/.test(uid) ||
        !/^\d+$/.test(pid) ||
        !isMetric(cpu) ||
        !isMetric(mem) ||
        !command
      ) continue;
      rows.push({ pid, cpu, mem, command });
      break;
    }
  }
  return rows.length > 0 ? rows : null;
}

function headerTokens(line: string): string[] {
  return line.trim().replace(/^#\s*/, "").split(/\s+/).filter(Boolean);
}

function commandIndex(headers: string[]): number {
  const command = headers.indexOf("Command");
  return command >= 0 ? command : headers.indexOf("CMD");
}

function isMetric(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}
