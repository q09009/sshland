import { useEffect, useMemo, useRef, useState } from "react";
import { killProcess, pollWidgetCommand } from "../api";
import { findWidgetConfig, useDashboardWidgetConfigs } from "../lib/dashboardWidgetConfigs";
import {
  DashboardWidgetInstance,
  MIN_REFRESH_SECONDS,
  useDashboardLayout,
  WIDGET_SIZES,
} from "../lib/dashboardLayout";
import { operationToCommandString } from "../lib/commandLog";
import {
  resolveMonitoringEngine,
  SYSSTAT_CPU_COMMAND,
  SYSSTAT_PROCESS_COMMAND,
} from "../lib/monitoring";
import { ReorderItemProps } from "../lib/reorder";
import { getCachedMonitoringTools, useSettings } from "../lib/settings";
import { useAppStore } from "../store";
import WidgetView from "./WidgetView";
import type { PreviousDashboardSample } from "./SimpleDashboardView";
import { KillProcessDialog } from "./Modal";
import {
  DashboardCardAction,
  DashboardCardBody,
  DashboardCardFrame,
  DashboardCardHeader,
} from "./DashboardCardFrame";
import { useI18n } from "../i18n";
import { dashboardWidgetLabel } from "../lib/dashboardWidgetText";

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
  const setViewMode = useDashboardLayout((s) => s.setViewMode);
  const setRefreshInterval = useDashboardLayout((s) => s.setRefreshInterval);

  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previousSample, setPreviousSample] = useState<PreviousDashboardSample | null>(null);

  // Process-manager kill flow: which process is pending a confirm, and whether
  // the kill exec is in flight.
  const [killTarget, setKillTarget] = useState<{ pid: string; name: string } | null>(null);
  const [killing, setKilling] = useState(false);
  const connection = useAppStore((s) => s.connection);
  const preferredMonitoringEngine = useSettings((s) => s.settings.monitoringEngine);
  const monitoringToolCache = useSettings((s) => s.settings.monitoringToolCache);
  const logCommand = useAppStore((s) => s.logCommand);
  const { language, t } = useI18n();

  // Keep the latest poll behaviour in a ref so the interval effect only depends
  // on the command + interval (not on every state change).
  const mounted = useRef(true);
  const pollRef = useRef<() => void>(() => {});
  const latestSampleRef = useRef<{ output: string; at: number } | null>(null);
  const counterMeasureTimerRef = useRef<number | null>(null);
  const sysstat = connection
    ? getCachedMonitoringTools(monitoringToolCache, connection)
    : { checked: false, available: false, version: null, missing: [] };
  const effectiveMonitoringEngine = resolveMonitoringEngine(
    preferredMonitoringEngine,
    sysstat,
  );
  const usesSysstatCpu =
    config?.name === "cpu-usage" &&
    config.source === "default" &&
    effectiveMonitoringEngine === "sysstat";
  const usesSysstatProcess =
    config?.name === "process-manager" &&
    config.source === "default" &&
    effectiveMonitoringEngine === "sysstat";
  const command = usesSysstatCpu
    ? SYSSTAT_CPU_COMMAND
    : usesSysstatProcess
      ? SYSSTAT_PROCESS_COMMAND
      : config?.command ?? "";

  pollRef.current = () => {
    if (!command) return;
    setLoading(true);
    pollWidgetCommand(command)
      .then((out) => {
        if (!mounted.current) return;
        const now = Date.now();
        const previous = latestSampleRef.current;
        setPreviousSample(
          previous
            ? {
                output: previous.output,
                elapsedSeconds: Math.max(0.001, (now - previous.at) / 1000),
              }
            : null,
        );
        latestSampleRef.current = { output: out, at: now };
        setOutput(out);
        setError(null);
        // CPU usage and current network throughput need two counter snapshots.
        // Take the second one quickly without sleeping in the shared SSH worker.
        if (
          ((!usesSysstatCpu && config?.simpleView === "cpu") ||
            config?.simpleView === "network") &&
          previous == null &&
          counterMeasureTimerRef.current == null
        ) {
          counterMeasureTimerRef.current = window.setTimeout(() => {
            counterMeasureTimerRef.current = null;
            pollRef.current();
          }, 1000);
        }
      })
      .catch((e) => {
        if (!mounted.current) return;
        setError(typeof e === "string" ? e : t("dashboard.error.command"));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (counterMeasureTimerRef.current != null) {
        window.clearTimeout(counterMeasureTimerRef.current);
      }
    };
  }, []);

  const intervalSeconds = instance.refreshIntervalSeconds;
  useEffect(() => {
    if (!command) return;
    latestSampleRef.current = null;
    setPreviousSample(null);
    if (counterMeasureTimerRef.current != null) {
      window.clearTimeout(counterMeasureTimerRef.current);
      counterMeasureTimerRef.current = null;
    }
    const run = () => pollRef.current();
    run(); // poll immediately, then on the interval
    const handle = window.setInterval(run, intervalSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [command, intervalSeconds]);

  const cycleSize = () => {
    const i = WIDGET_SIZES.indexOf(instance.size);
    setSize(instance.instanceId, WIDGET_SIZES[(i + 1) % WIDGET_SIZES.length]);
  };
  const viewMode = instance.viewMode ?? "simple";

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
              { user: connection.username, host: connection.host },
              language,
            )
          );
        }
        setKillTarget(null);
        pollRef.current();
      })
      .catch((e) => {
        if (mounted.current) {
          setError(typeof e === "string" ? e : t("dashboard.error.kill"));
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
            {config ? dashboardWidgetLabel(config, t) : instance.widgetId}
          </>
        }
        titleHint={config ? dashboardWidgetLabel(config, t) : undefined}
        busy={loading}
      >
          {config?.simpleView && (
            <DashboardCardAction
              onClick={() =>
                setViewMode(
                  instance.instanceId,
                  viewMode === "simple" ? "detailed" : "simple",
                )
              }
              title={
                viewMode === "simple"
                  ? t("dashboard.card.switchToDetailed")
                  : t("dashboard.card.switchToSimple")
              }
              className="text-2xs"
            >
              {viewMode === "simple"
                ? t("dashboard.card.simple")
                : t("dashboard.card.detailed")}
            </DashboardCardAction>
          )}
          <IntervalInput
            seconds={intervalSeconds}
            onCommit={(s) => setRefreshInterval(instance.instanceId, s)}
          />
          <DashboardCardAction
            onClick={cycleSize}
            title={t("dashboard.card.resize")}
            className="text-2xs"
          >
            {t(`dashboard.card.size.${instance.size}` as const)}
          </DashboardCardAction>
          <DashboardCardAction
            onClick={() => pollRef.current()}
            title={t("dashboard.card.refreshNow")}
          >
            ⟳
          </DashboardCardAction>
          <DashboardCardAction
            onClick={() => removeWidget(instance.instanceId)}
            title={t("dashboard.card.remove")}
            danger
          >
            ✕
          </DashboardCardAction>
      </DashboardCardHeader>

      <DashboardCardBody>
        {!config ? (
          <CardMessage tone="error">
            {t("dashboard.card.missing")}
          </CardMessage>
        ) : error ? (
          <CardMessage tone="error">{error}</CardMessage>
        ) : output == null ? (
          <CardMessage tone="muted">{t("dashboard.card.loading")}</CardMessage>
        ) : (
          <WidgetView
            config={config}
            output={output}
            viewMode={viewMode}
            previousSample={previousSample}
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
  const { t } = useI18n();
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
        title={t("dashboard.card.interval", { seconds: MIN_REFRESH_SECONDS })}
        className="w-9 rounded bg-ink-900 px-1 py-0.5 text-right text-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-600/50"
      />
      <span className="pl-0.5">{t("common.seconds")}</span>
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
