// Human-friendly formatting helpers for the file manager.

/** Format a byte count like "1.4 MB". */
export function formatSize(bytes: number, isDir: boolean): string {
  if (isDir) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format a session's elapsed time (given in ms) with minute granularity. This
 * keeps the status bar minimal and is computed entirely
 * locally — never asks the server for the time.
 */
export function formatElapsed(ms: number, language: "ko" | "en"): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return language === "ko" ? "1분 미만" : "Under 1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (language === "ko") {
    if (hours > 0) return `${hours}시간 ${minutes}분`;
    return `${minutes}분`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes} min`;
}

/**
 * Format a Date as a wall clock, "HH:MM" or "HH:MM:SS". Uses the OS local time
 * only — the server is never contacted for the time.
 */
export function formatClock(d: Date, showSeconds: boolean): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return showSeconds ? `${base}:${pad(d.getSeconds())}` : base;
}

/** Format a Unix time using an explicit UTC offset instead of the local OS zone. */
export function formatClockAtOffset(
  unixMs: number,
  utcOffsetMinutes: number,
  showSeconds: boolean
): string {
  const d = new Date(unixMs + utcOffsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return showSeconds ? `${base}:${pad(d.getUTCSeconds())}` : base;
}

/** Format a Unix timestamp (seconds) as "YYYY-MM-DD HH:mm". */
export function formatDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "-";
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
