import { useEffect, useMemo, useRef, useState } from "react";
import { pollWidgetCommand } from "../api";
import { findWidgetConfig, useDashboardWidgetConfigs } from "../lib/dashboardWidgetConfigs";
import {
  DashboardWidgetInstance,
  MIN_REFRESH_SECONDS,
  useDashboardLayout,
  WIDGET_SIZES,
  WidgetSize,
} from "../lib/dashboardLayout";
import WidgetView from "./WidgetView";

/** MIME type carrying a dragged card's index for grid reordering. */
const DRAG_TYPE = "application/x-widget-index";

/** Grid column span per card size. */
const SPAN: Record<WidgetSize, number> = { small: 1, medium: 2, large: 3 };
/** Minimum card body height per size. */
const MIN_H: Record<WidgetSize, number> = { small: 96, medium: 132, large: 184 };
const SIZE_LABEL: Record<WidgetSize, string> = {
  small: "소",
  medium: "중",
  large: "대",
};

/**
 * One dashboard widget card: polls its command on a timer and renders the result
 * via WidgetView. The polling timer is owned here and cleared on unmount (and
 * whenever the command or interval changes), so closing the dashboard pane —
 * which unmounts every card — stops all polling with no lingering intervals.
 *
 * A poll failure sets an inline error on THIS card only; other cards keep going.
 */
export default function WidgetCard({
  instance,
  index,
}: {
  instance: DashboardWidgetInstance;
  index: number;
}) {
  const configs = useDashboardWidgetConfigs((s) => s.configs);
  const config = useMemo(
    () => findWidgetConfig(configs, instance.widgetId),
    [configs, instance.widgetId]
  );

  const removeWidget = useDashboardLayout((s) => s.removeWidget);
  const setSize = useDashboardLayout((s) => s.setSize);
  const setRefreshInterval = useDashboardLayout((s) => s.setRefreshInterval);
  const moveWidget = useDashboardLayout((s) => s.moveWidget);

  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Keep the latest poll behaviour in a ref so the interval effect only depends
  // on the command + interval (not on every state change).
  const mounted = useRef(true);
  const pollRef = useRef<() => void>(() => {});
  const command = config?.command ?? "";

  pollRef.current = () => {
    if (!command) return;
    setLoading(true);
    pollWidgetCommand(command)
      .then((out) => {
        if (!mounted.current) return;
        setOutput(out);
        setError(null);
      })
      .catch((e) => {
        if (!mounted.current) return;
        setError(typeof e === "string" ? e : "명령을 실행하지 못했어요.");
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const intervalSeconds = instance.refreshIntervalSeconds;
  useEffect(() => {
    if (!command) return;
    const run = () => pollRef.current();
    run(); // poll immediately, then on the interval
    const handle = window.setInterval(run, intervalSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [command, intervalSeconds]);

  const spanStyle = { gridColumn: `span ${SPAN[instance.size]}` };

  // --- drag-and-drop reorder ---
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, String(index));
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
  };
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (raw === "") return;
    e.preventDefault();
    const from = Number.parseInt(raw, 10);
    if (!Number.isNaN(from)) moveWidget(from, index);
  };

  const cycleSize = () => {
    const i = WIDGET_SIZES.indexOf(instance.size);
    setSize(instance.instanceId, WIDGET_SIZES[(i + 1) % WIDGET_SIZES.length]);
  };

  return (
    <div
      style={spanStyle}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-ink-700/70 bg-ink-800"
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-ink-700/60 px-1.5 text-xs text-slate-400">
        <span
          draggable
          onDragStart={onDragStart}
          title="드래그해서 위치 이동"
          className="cursor-grab select-none px-0.5 text-slate-500 hover:text-slate-300 active:cursor-grabbing"
        >
          ⠿
        </span>
        <span className="truncate text-slate-300" title={config?.label}>
          {config?.icon ? `${config.icon} ` : ""}
          {config?.label ?? instance.widgetId}
        </span>
        {loading && <span className="text-2xs text-slate-600">…</span>}
        <span className="ml-auto flex items-center gap-0.5">
          <IntervalInput
            seconds={intervalSeconds}
            onCommit={(s) => setRefreshInterval(instance.instanceId, s)}
          />
          <button
            onClick={cycleSize}
            title="카드 크기 변경"
            className="rounded px-1 py-0.5 text-2xs hover:bg-ink-700 hover:text-slate-100"
          >
            {SIZE_LABEL[instance.size]}
          </button>
          <button
            onClick={() => pollRef.current()}
            title="지금 새로고침"
            className="rounded px-1 py-0.5 hover:bg-ink-700 hover:text-slate-100"
          >
            ⟳
          </button>
          <button
            onClick={() => removeWidget(instance.instanceId)}
            title="위젯 제거"
            className="rounded px-1 py-0.5 hover:bg-red-500/20 hover:text-red-300"
          >
            ✕
          </button>
        </span>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto p-2.5"
        style={{ minHeight: MIN_H[instance.size] }}
      >
        {!config ? (
          <CardMessage tone="error">
            위젯 설정을 찾을 수 없어요. 제거하거나 설정 파일을 확인해주세요.
          </CardMessage>
        ) : error ? (
          <CardMessage tone="error">{error}</CardMessage>
        ) : output == null ? (
          <CardMessage tone="muted">불러오는 중…</CardMessage>
        ) : (
          <WidgetView config={config} output={output} />
        )}
      </div>
    </div>
  );
}

/** A number input for the poll interval, clamped to the minimum on commit. */
function IntervalInput({
  seconds,
  onCommit,
}: {
  seconds: number;
  onCommit: (seconds: number) => void;
}) {
  const [text, setText] = useState(String(seconds));
  useEffect(() => setText(String(seconds)), [seconds]);

  const commit = () => {
    const n = Number.parseInt(text, 10);
    const clamped = Number.isNaN(n) ? seconds : Math.max(MIN_REFRESH_SECONDS, n);
    onCommit(clamped);
    setText(String(clamped));
  };

  return (
    <span className="flex items-center text-2xs text-slate-500">
      <input
        type="number"
        min={MIN_REFRESH_SECONDS}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        title={`새로고침 주기 (최소 ${MIN_REFRESH_SECONDS}초)`}
        className="w-9 rounded bg-ink-900 px-1 py-0.5 text-right text-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-600/50"
      />
      <span className="pl-0.5">초</span>
    </span>
  );
}

function CardMessage({
  tone,
  children,
}: {
  tone: "error" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex h-full items-center justify-center px-2 text-center text-2xs ${
        tone === "error" ? "text-red-300/80" : "text-slate-500"
      }`}
    >
      {children}
    </div>
  );
}
