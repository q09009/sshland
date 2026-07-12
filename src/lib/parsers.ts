/**
 * Parsers turn a command's raw text output into structured data for the render
 * widgets. Each is pure and self-contained. They return `null` when the text
 * doesn't fit the shape, so the caller can fall back to raw text.
 */

export interface ColumnsData {
  headers: string[];
  rows: string[][];
}

export interface KeyValueData {
  pairs: { key: string; value: string }[];
}

export interface RegexData {
  /** One object per matching line, keyed by the regex's named capture groups. */
  items: Record<string, string>[];
}

/**
 * `regex` parser: run a named-capture-group regex against each line and collect
 * the groups. Lines that don't match are skipped. Returns null if the pattern
 * is invalid or nothing matched (caller falls back to raw text).
 */
export function parseRegex(text: string, pattern: string): RegexData | null {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return null;
  }
  const items: Record<string, string>[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(re);
    if (!m || !m.groups) continue;
    const obj: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.groups)) {
      if (v != null) obj[k] = v;
    }
    if (Object.keys(obj).length > 0) items.push(obj);
  }
  return items.length > 0 ? { items } : null;
}

/**
 * `keyvalue` parser: one key-value pair per line, split on the first `:` or on
 * a run of 2+ spaces (e.g. `systemctl status`, `free -h` style lines). Header
 * bullets and tree-drawing lines are skipped, and overly long keys (prose) are
 * ignored so the card grid stays clean.
 */
export function parseKeyValue(text: string): KeyValueData | null {
  const pairs: { key: string; value: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (/^[●○├└│─*•]/.test(line)) continue; // bullets / tree lines

    let key = "";
    let value = "";
    const colon = line.indexOf(":");
    if (colon > 0) {
      key = line.slice(0, colon).trim();
      value = line.slice(colon + 1).trim();
    } else {
      const m = line.match(/^(.*?)\s{2,}(.*)$/);
      if (!m) continue;
      key = m[1].trim();
      value = m[2].trim();
    }
    if (key === "" || value === "" || key.length > 40) continue;
    pairs.push({ key, value });
  }
  return pairs.length > 0 ? { pairs } : null;
}

/**
 * `columns` parser: whitespace-separated table with a header row.
 *
 * The last column keeps everything from its header's start position, so a
 * value with spaces (e.g. `COMMAND` in `ps aux`) survives. The columns before
 * it are taken by splitting the left part on whitespace — a hard positional cut
 * would break on right-aligned numbers (a wide PID/VSZ overflows left of its
 * header and bleeds into the previous column).
 */
export function parseColumns(text: string): ColumnsData | null {
  const lines = text.replace(/\s+$/, "").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  if (lines.length < 1) return null;

  const headerLine = lines[0];
  const starts: number[] = [];
  const headers: string[] = [];
  const tokenRe = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(headerLine)) !== null) {
    starts.push(m.index);
    headers.push(m[0]);
  }
  let n = headers.length;
  if (n === 0) return null;

  const dataLines = lines.slice(1).filter((l) => l.trim() !== "");
  // Detect a multi-word last header (e.g. df's "Mounted on"): if every data row
  // has consistently fewer whitespace tokens than there are header words, fold
  // the trailing header words into the last column. `ps aux` is unaffected — its
  // rows have >= as many tokens as headers (COMMAND spans several words).
  if (dataLines.length > 0) {
    let minTokens = Infinity;
    for (const l of dataLines) {
      minTokens = Math.min(minTokens, l.trim().split(/\s+/).length);
    }
    if (minTokens >= 1 && minTokens < n) {
      const merged = headers.slice(minTokens - 1).join(" ");
      headers.length = minTokens - 1;
      headers.push(merged);
      starts.length = minTokens;
      n = minTokens;
    }
  }
  const lastStart = starts[n - 1];

  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const cells: string[] = [];
    if (n === 1) {
      cells.push(line.trim());
    } else {
      const left = line.slice(0, lastStart).trim();
      const tokens = left === "" ? [] : left.split(/\s+/);
      for (let c = 0; c < n - 1; c++) cells.push(tokens[c] ?? "");
      cells.push(line.slice(lastStart).trim());
    }
    rows.push(cells);
  }
  return { headers, rows };
}
