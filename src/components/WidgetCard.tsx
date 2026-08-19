import { useEffect, useMemo, useRef, useState } from "react";
import { killProcess, pollWidgetCommand } from "../api";
import { findWidgetConfig, useDashboardWidgetConfigs } from "../lib/dashboardWidgetConfigs";
import {
  DashboardWidgetInstance,
  MIN_REFRESH_SECONDS,
  useDashboardLayout,
  WIDGET_SIZES,
  WidgetSize,
} from "../lib/dashboardLayout";
import { operationToCommandString } from "../lib/commandLog";
import { ReorderItemProps } from "../lib/reorder";
import { useAppStore } from "../store";
import WidgetView from "./WidgetView";
import { KillProcessDialog } from "./Modal";
import {
  DashboardCardAction,
  DashboardCardBody,
  DashboardCardFrame,
  DashboardCardHeader,
} from "./DashboardCardFrame";

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
  drag,
}: {
  instance: DashboardWidgetInstance;
  drag: ReorderItemProps;
}) {
  const configs = useDashboardWidgetConfigs((s) => s.configs);
  const config = useMemo(
    () => findWidgetConfig(configs, instance.widgetId),
    [configs, instance.widgetId]
  );

  const removeWidget = useDashboardLayout((s) => s.removeWidget);
  const setSize = useDashboardLayout((s) => s.setSize);
  const setRefreshInterval = useDashboardLayout((s) => s.setRefreshInterval);

  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Process-manager kill flow: which process is pending a confirm, and whether
  // the kill exec is in flight.
  const [killTarget, setKillTarget] = useState<{ pid: string; name: string } | null>(null);
  const [killing, setKilling] = useState(false);
  const connection = useAppStore((s) => s.connection);
  const logCommand = useAppStore((s) => s.logCommand);

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

  const cycleSize = () => {
    const i = WIDGET_SIZES.indexOf(instance.size);
    setSize(instance.instanceId, WIDGET_SIZES[(i + 1) % WIDGET_SIZES.length]);
  };

  // Send the kill, log the real command, and re-poll immediately on success so
  // the process list reflects the change without waiting for the next tick.
  const doKill = (force: boolean) => {
    if (!killTarget) return;
    const { pid } = killTarget;
    setKilling(true);
    killProcess(pid, force)
      .then(() => {
        if (connection) {
          logCommand(
            operationToCommandString(
              { type: "kill", pid, force },
              { user: connection.username, host: connection.host }
            )
          );
        }
        setKillTarget(null);
        pollRef.current();
      })
      .catch((e) => {
        if (mounted.current) {
          setError(typeof e === "string" ? e : "프로세스를 종료하지 못했어요.");
        }
        setKillTarget(null);
      })
      .finally(() => {
        if (mounted.current) setKilling(false);
      });
  };

  return (
    <DashboardCardFrame size={instance.size} drag={drag}>
      <DashboardCardHeader
        drag={drag}
        title={
          <>
            {config?.icon ? `${config.icon} ` : ""}
            {config?.label ?? instance.widgetId}
          </>
        }
        titleHint={config?.label}
        busy={loading}
      >
          <IntervalInput
            seconds={intervalSeconds}
            onCommit={(s) => setRefreshInterval(instance.instanceId, s)}
          />
          <DashboardCardAction
            onClick={cycleSize}
            title="카드 크기 변경"
            className="text-2xs"
          >
            {SIZE_LABEL[instance.size]}
          </DashboardCardAction>
          <DashboardCardAction
            onClick={() => pollRef.current()}
            title="지금 새로고침"
          >
            ⟳
          </DashboardCardAction>
          <DashboardCardAction
            onClick={() => removeWidget(instance.instanceId)}
            title="위젯 제거"
            danger
          >
            ✕
          </DashboardCardAction>
      </DashboardCardHeader>

      <DashboardCardBody>
        {!config ? (
          <CardMessage tone="error">
            위젯 설정을 찾을 수 없어요. 제거하거나 설정 파일을 확인해주세요.
          </CardMessage>
        ) : error ? (
          <CardMessage tone="error">{error}</CardMessage>
        ) : output == null ? (
          <CardMessage tone="muted">불러오는 중…</CardMessage>
        ) : (
          <WidgetView
            config={config}
            output={output}
            onKill={(pid, name) => setKillTarget({ pid, name })}
          />
        )}
      </DashboardCardBody>

      {killTarget && (
        <KillProcessDialog
          pid={killTarget.pid}
          name={killTarget.name}
          busy={killing}
          onKill={() => doKill(false)}
          onForceKill={() => doKill(true)}
          onCancel={() => setKillTarget(null)}
        />
      )}
    </DashboardCardFrame>
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
