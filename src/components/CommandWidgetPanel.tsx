import { useMemo, useState } from "react";
import { CommandConfig } from "../api";
import {
  ColumnsData,
  KeyValueData,
  RegexData,
  parseColumns,
  parseKeyValue,
  parseRegex,
} from "../lib/parsers";
import { useI18n } from "../i18n";

/** A captured command whose output matched a config, ready to render. */
export interface CommandResult {
  id: string;
  command: string;
  output: string;
  config: CommandConfig;
}

/**
 * Bottom panel of a terminal pane that renders one command's output as a GUI
 * widget. A toggle flips between the widget and the original raw text, so a
 * wrong parse is never a dead end.
 */
export default function CommandWidgetPanel({
  result,
  onClose,
}: {
  result: CommandResult;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(false);
  const { t } = useI18n();

  return (
    <div className="flex max-h-[45%] shrink-0 flex-col border-t border-ink-700 bg-ink-800">
      <div className="flex items-center gap-2 border-b border-ink-700/60 px-3 py-1.5">
        <span className="truncate font-mono text-xs text-slate-300" title={result.command}>
          {result.command}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setRaw((v) => !v)}
            className="rounded px-2 py-0.5 text-2xs text-slate-400 hover:bg-ink-700 hover:text-slate-100"
            title={t("commandWidget.toggle")}
          >
            {raw ? t("commandWidget.viewGui") : t("commandWidget.viewRaw")}
          </button>
          <button
            onClick={onClose}
            className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {raw ? (
          <pre className="whitespace-pre font-mono text-xs text-slate-300">
            {result.output}
          </pre>
        ) : (
          <WidgetBody result={result} />
        )}
      </div>
    </div>
  );
}

/**
 * Parse with the config's `parser`, then render with its `render`. Only the
 * natural pairings (columns→table, keyvalue→keyvalue-card, regex→list) draw a
 * widget; anything else — including a parse that returned nothing — falls back
 * to raw text so a bad/mismatched config is never a dead end.
 */
function WidgetBody({ result }: { result: CommandResult }) {
  const widget = renderWidget(result.config, result.output);
  return (
    widget ?? (
      <pre className="whitespace-pre font-mono text-xs text-slate-300">
        {result.output}
      </pre>
    )
  );
}

function renderWidget(
  config: CommandConfig,
  output: string
): React.ReactElement | null {
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

function ListWidget({ data }: { data: RegexData }) {
  return (
    <ul className="flex flex-col gap-1">
      {data.items.map((item, i) => (
        <li
          key={i}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md border border-ink-700/50 bg-ink-900/40 px-3 py-1.5"
        >
          {Object.entries(item).map(([k, v]) => (
            <span key={k} className="flex items-baseline gap-1">
              <span className="text-2xs uppercase tracking-wide text-slate-500">
                {k}
              </span>
              <span className="font-mono text-xs text-slate-200">{v}</span>
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

function KeyValueCardWidget({ data }: { data: KeyValueData }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
      {data.pairs.map((p, i) => (
        <div
          key={i}
          className="rounded-lg border border-ink-700/60 bg-ink-900/40 px-3 py-2"
        >
          <div className="truncate text-2xs uppercase tracking-wide text-slate-500" title={p.key}>
            {p.key}
          </div>
          <div className="mt-0.5 break-words font-mono text-xs text-slate-200">
            {p.value}
          </div>
        </div>
      ))}
    </div>
  );
}

type Sort = { col: number; dir: 1 | -1 };

/** Leading numeric value of a cell, e.g. "25%" → 25, "1.2G" → 1.2, "eth0" → null. */
function asNumber(s: string): number | null {
  const t = s.trim();
  if (!/^[+-]?[\d.]/.test(t)) return null;
  const n = Number.parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

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
      const n = asNumber(r[hiIdx] ?? "");
      return n != null && n > max ? n : max;
    }, 0);
  }, [data.rows, hiIdx]);

  const rows = useMemo(() => {
    if (!sort) return data.rows;
    const { col, dir } = sort;
    return [...data.rows].sort((a, b) => {
      const na = asNumber(a[col] ?? "");
      const nb = asNumber(b[col] ?? "");
      const c =
        na != null && nb != null
          ? na - nb
          : (a[col] ?? "").localeCompare(b[col] ?? "");
      return c * dir;
    });
  }, [data.rows, sort]);

  const toggleSort = (col: number) =>
    setSort((s) =>
      s && s.col === col
        ? { col, dir: s.dir === 1 ? -1 : 1 }
        : { col, dir: 1 }
    );

  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          {data.headers.map((h, i) => (
            <th
              key={i}
              onClick={() => toggleSort(i)}
              className="cursor-pointer select-none whitespace-nowrap border-b border-ink-700 px-2 py-1 text-left font-medium text-slate-400 hover:text-slate-100"
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
                const n = asNumber(val);
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
                  className={`whitespace-nowrap px-2 py-0.5 text-slate-200 ${
                    c === data.headers.length - 1 ? "" : "border-r border-ink-700/40"
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
