import { useMemo, useState } from "react";
import { ColumnsData, leadingNumber } from "../lib/parsers";

/**
 * The process-manager widget's table. Unlike the generic table renderer it
 * projects `ps aux` down to just PID / CPU% / MEM% / name, defaults to sorting
 * by CPU descending, and (wired in a later step) offers a per-row kill action.
 *
 * Returns null if the expected columns aren't present, so a non-`ps` command
 * routed here falls back to raw text like everywhere else.
 */
export interface ProcessRow {
  pid: string;
  cpu: string;
  mem: string;
  command: string;
}

/** Column the table is sorted by. */
type ProcCol = "pid" | "cpu" | "mem" | "command";
type Sort = { col: ProcCol; dir: 1 | -1 };

/** Pull the PID / %CPU / %MEM / COMMAND columns out of parsed `ps aux` output. */
export function toProcessRows(data: ColumnsData): ProcessRow[] | null {
  const idx = (name: string) => data.headers.indexOf(name);
  const pidI = idx("PID");
  const cpuI = idx("%CPU");
  const memI = idx("%MEM");
  const cmdI = idx("COMMAND") >= 0 ? idx("COMMAND") : idx("CMD");
  if (pidI < 0 || cmdI < 0) return null;

  return data.rows
    .map((r) => ({
      pid: r[pidI] ?? "",
      cpu: cpuI >= 0 ? r[cpuI] ?? "" : "",
      mem: memI >= 0 ? r[memI] ?? "" : "",
      command: r[cmdI] ?? "",
    }))
    .filter((p) => p.pid !== "");
}

export default function ProcessTable({ data }: { data: ColumnsData }) {
  const rows = useMemo(() => toProcessRows(data), [data]);
  // Default: highest CPU first.
  const [sort, setSort] = useState<Sort>({ col: "cpu", dir: -1 });

  const sorted = useMemo(() => {
    if (!rows) return [];
    const { col, dir } = sort;
    return [...rows].sort((a, b) => {
      const na = leadingNumber(a[col]);
      const nb = leadingNumber(b[col]);
      const c =
        na != null && nb != null ? na - nb : a[col].localeCompare(b[col]);
      return c * dir;
    });
  }, [rows, sort]);

  if (!rows) return null;

  const toggle = (col: ProcCol) =>
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: -1 }
    );

  return (
    <table className="w-full border-collapse text-2xs">
      <thead>
        <tr>
          <Th col="pid" label="PID" sort={sort} onClick={toggle} />
          <Th col="cpu" label="CPU%" sort={sort} onClick={toggle} />
          <Th col="mem" label="MEM%" sort={sort} onClick={toggle} />
          <Th col="command" label="명령" sort={sort} onClick={toggle} wide />
        </tr>
      </thead>
      <tbody>
        {sorted.map((p, i) => (
          <tr key={`${p.pid}-${i}`} className="hover:bg-ink-700/30">
            <td className="whitespace-nowrap border-r border-ink-700/40 px-1.5 py-0.5 font-mono text-slate-300">
              {p.pid}
            </td>
            <td className="whitespace-nowrap border-r border-ink-700/40 px-1.5 py-0.5 tabular-nums text-slate-200">
              {p.cpu}
            </td>
            <td className="whitespace-nowrap border-r border-ink-700/40 px-1.5 py-0.5 tabular-nums text-slate-200">
              {p.mem}
            </td>
            <td
              className="max-w-0 truncate px-1.5 py-0.5 font-mono text-slate-300"
              title={p.command}
            >
              {p.command}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({
  col,
  label,
  sort,
  onClick,
  wide,
}: {
  col: ProcCol;
  label: string;
  sort: Sort;
  onClick: (col: ProcCol) => void;
  wide?: boolean;
}) {
  return (
    <th
      onClick={() => onClick(col)}
      className={`cursor-pointer select-none whitespace-nowrap border-b border-ink-700 px-1.5 py-1 text-left font-medium text-slate-400 hover:text-slate-100 ${
        wide ? "w-full" : ""
      }`}
    >
      {label}
      {sort.col === col && (
        <span className="ml-1 text-slate-500">{sort.dir === 1 ? "▲" : "▼"}</span>
      )}
    </th>
  );
}
