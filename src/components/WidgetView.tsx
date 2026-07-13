import { useMemo, useState } from "react";
import { DashboardWidgetConfig } from "../lib/dashboardWidgetConfigs";
import {
  ColumnsData,
  KeyValueData,
  RegexData,
  leadingNumber,
  parseColumns,
  parseKeyValue,
  parseRegex,
} from "../lib/parsers";
import ProcessTable from "./ProcessTable";

/**
 * Renders one dashboard widget's raw command output as a GUI body, using the
 * widget config's `parser` + `render`. Pure and side-effect-free — it just turns
 * text into a widget. Only the natural parser→render pairings draw something;
 * anything else (or an empty parse) returns null so the card can fall back to
 * raw text, matching the app's silent-fallback rule.
 *
 * The `gauge` renderer is new here; `table`/`keyvalue-card`/`list` mirror the
 * terminal command-GUI panel's widgets but styled compactly for a dashboard card.
 */
export default function WidgetView({
  config,
  output,
}: {
  config: DashboardWidgetConfig;
  output: string;
}) {
  const body = renderWidget(config, output);
  return (
    body ?? (
      <pre className="max-h-full overflow-auto whitespace-pre font-mono text-2xs text-slate-300">
        {output.trim() || "(빈 출력)"}
      </pre>
    )
  );
}

/** Extract a single numeric value for a gauge from parsed output. */
function gaugeValue(
  config: DashboardWidgetConfig,
  output: string
): number | null {
  const field = config.valueField;
  if (config.parser === "regex" && config.capturePattern) {
    const data = parseRegex(output, config.capturePattern);
    if (!data) return null;
    const item = data.items[0];
    const raw = field ? item[field] : Object.values(item)[0];
    return raw != null ? leadingNumber(raw) : null;
  }
  if (config.parser === "keyvalue") {
    const data = parseKeyValue(output);
    if (!data) return null;
    const pair = field
      ? data.pairs.find((p) => p.key === field)
      : data.pairs[0];
    return pair ? leadingNumber(pair.value) : null;
  }
  return null;
}

function renderWidget(
  config: DashboardWidgetConfig,
  output: string
): React.ReactElement | null {
  if (config.render === "gauge") {
    const value = gaugeValue(config, output);
    return value != null ? <Gauge value={value} unit={config.unit} /> : null;
  }
  // Process-manager widgets use a dedicated table (subset columns, CPU sort,
  // and a per-row kill action) instead of the generic table renderer.
  if (config.category === "process-manager" && config.parser === "columns") {
    const data = parseColumns(output);
    if (data && data.rows.length > 0) return <ProcessTable data={data} />;
    return null;
  }
  switch (config.parser) {
    case "columns": {
      const data = parseColumns(output);
      if (data && data.rows.length > 0 && config.render === "table") {
        return (
          <TableWidget data={data} highlightColumn={config.highlightColumn} />
        );
      }
      return null;
    }
    case "keyvalue": {
      const data = parseKeyValue(output);
      if (data && config.render === "keyvalue-card") {
        return <KeyValueCardWidget data={data} />;
      }
      return null;
    }
    case "regex": {
      if (!config.capturePattern) return null;
      const data = parseRegex(output, config.capturePattern);
      if (data && config.render === "list") return <ListWidget data={data} />;
      return null;
    }
    default:
      return null;
  }
}

/**
 * A linear percentage gauge with a big value label. The fill color follows the
 * conventional thresholds — green under 70%, amber 70–90%, red above 90% — using
 * design-token palette classes (never hardcoded hex).
 */
function Gauge({ value, unit }: { value: number; unit?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const level = pct >= 90 ? "red" : pct >= 70 ? "amber" : "emerald";
  const fillClass =
    level === "red"
      ? "bg-red-500"
      : level === "amber"
        ? "bg-amber-500"
        : "bg-emerald-500";
  const textClass =
    level === "red"
      ? "text-red-400"
      : level === "amber"
        ? "text-amber-400"
        : "text-emerald-400";

  return (
    <div className="flex h-full w-full flex-col justify-center gap-3">
      <div className="flex items-baseline gap-1">
        <span className={`text-3xl font-semibold tabular-nums ${textClass}`}>
          {formatNumber(value)}
        </span>
        {unit && <span className="text-sm text-slate-400">{unit}</span>}
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-700">
        <div
          className={`h-full rounded-full transition-all ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Trim a trailing ".0" so 4.0 shows as "4" but 4.2 stays "4.2". */
function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function ListWidget({ data }: { data: RegexData }) {
  return (
    <ul className="flex flex-col gap-1">
      {data.items.map((item, i) => (
        <li
          key={i}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md border border-ink-700/50 bg-ink-900/40 px-2.5 py-1"
        >
          {Object.entries(item).map(([k, v]) => (
            <span key={k} className="flex items-baseline gap-1">
              <span className="text-2xs uppercase tracking-wide text-slate-500">
                {k}
              </span>
              <span className="font-mono text-2xs text-slate-200">{v}</span>
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

function KeyValueCardWidget({ data }: { data: KeyValueData }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {data.pairs.map((p, i) => (
        <div
          key={i}
          className="rounded-md border border-ink-700/60 bg-ink-900/40 px-2.5 py-1.5"
        >
          <div
            className="truncate text-2xs uppercase tracking-wide text-slate-500"
            title={p.key}
          >
            {p.key}
          </div>
          <div className="mt-0.5 break-words font-mono text-2xs text-slate-200">
            {p.value}
          </div>
        </div>
      ))}
    </div>
  );
}

type Sort = { col: number; dir: 1 | -1 };

function TableWidget({
  data,
  highlightColumn,
}: {
  data: ColumnsData;
  highlightColumn?: string;
}) {
  const [sort, setSort] = useState<Sort | null>(null);
  const hiIdx = highlightColumn ? data.headers.indexOf(highlightColumn) : -1;

  const hiMax = useMemo(() => {
    if (hiIdx < 0) return 0;
    return data.rows.reduce((max, r) => {
      const n = leadingNumber(r[hiIdx] ?? "");
      return n != null && n > max ? n : max;
    }, 0);
  }, [data.rows, hiIdx]);

  const rows = useMemo(() => {
    if (!sort) return data.rows;
    const { col, dir } = sort;
    return [...data.rows].sort((a, b) => {
      const na = leadingNumber(a[col] ?? "");
      const nb = leadingNumber(b[col] ?? "");
      const c =
        na != null && nb != null
          ? na - nb
          : (a[col] ?? "").localeCompare(b[col] ?? "");
      return c * dir;
    });
  }, [data.rows, sort]);

  const toggleSort = (col: number) =>
    setSort((s) =>
      s && s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }
    );

  return (
    <table className="w-full border-collapse text-2xs">
      <thead>
        <tr>
          {data.headers.map((h, i) => (
            <th
              key={i}
              onClick={() => toggleSort(i)}
              className="cursor-pointer select-none whitespace-nowrap border-b border-ink-700 px-1.5 py-1 text-left font-medium text-slate-400 hover:text-slate-100"
            >
              {h}
              {sort?.col === i && (
                <span className="ml-1 text-slate-500">
                  {sort.dir === 1 ? "▲" : "▼"}
                </span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r} className="hover:bg-ink-700/30">
            {data.headers.map((_, c) => {
              const val = row[c] ?? "";
              let style: React.CSSProperties | undefined;
              if (c === hiIdx && hiMax > 0) {
                const n = leadingNumber(val);
                if (n != null) {
                  const intensity = Math.min(1, n / hiMax);
                  style = {
                    backgroundColor: `rgb(var(--color-red-500) / ${(
                      intensity * 0.55
                    ).toFixed(2)})`,
                  };
                }
              }
              return (
                <td
                  key={c}
                  style={style}
                  className={`whitespace-nowrap px-1.5 py-0.5 text-slate-200 ${
                    c === data.headers.length - 1
                      ? ""
                      : "border-r border-ink-700/40"
                  }`}
                >
                  {val}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
