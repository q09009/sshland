import { useEffect, useState } from "react";
import { useDashboardWidgetConfigs, findWidgetConfig } from "../lib/dashboardWidgetConfigs";
import { useDashboardLayout } from "../lib/dashboardLayout";
import { useSettings } from "../lib/settings";
import WidgetCard from "./WidgetCard";
import WidgetPicker from "./WidgetPicker";

/**
 * A dashboard pane: a customizable, responsive grid of monitoring widget cards
 * that poll the server on a timer (via `poll_widget_command`, a one-shot exec
 * sharing the SSH worker). Unlike the rest of the app this pane is NOT a
 * Hyprland split tree — just a grid of cards, each sized small/medium/large.
 *
 * The layout (which widgets, order, sizes, intervals) is a single shared model
 * in `useDashboardLayout`; every card owns its own polling timer and clears it
 * on unmount, so closing the pane stops all polling.
 */
export default function DashboardPane({ id }: { id: string }) {
  const loadConfigs = useDashboardWidgetConfigs((s) => s.load);
  const configs = useDashboardWidgetConfigs((s) => s.configs);
  const widgets = useDashboardLayout((s) => s.widgets);
  const addWidget = useDashboardLayout((s) => s.addWidget);
  const defaultInterval = useSettings((s) => s.settings.dashboardDefaultInterval);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Load the merged widget catalog once (idempotent in the store).
  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const handlePick = (widgetId: string) => {
    const cfg = findWidgetConfig(configs, widgetId);
    // The widget's own interval wins; otherwise the global default setting.
    addWidget(widgetId, cfg?.refreshIntervalSeconds ?? defaultInterval);
    setPickerOpen(false);
  };

  return (
    <div className="h-full w-full overflow-auto bg-ink-900 p-4" data-pane-id={id}>
      {widgets.length === 0 ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
          <div className="text-4xl opacity-40 select-none">📊</div>
          <p className="text-sm text-slate-400">아직 위젯이 없어요.</p>
          <p className="text-2xs text-slate-500">
            위젯을 추가해 서버 상태를 한눈에 확인해보세요.
          </p>
          <button
            onClick={() => setPickerOpen(true)}
            className="mt-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            ＋ 위젯 추가
          </button>
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gridAutoRows: "min-content",
          }}
        >
          {widgets.map((w, i) => (
            <WidgetCard key={w.instanceId} instance={w} index={i} />
          ))}
          <button
            onClick={() => setPickerOpen(true)}
            className="flex min-h-[96px] items-center justify-center rounded-xl border border-dashed border-ink-700 text-sm text-slate-500 hover:border-sky-600/60 hover:text-slate-300"
          >
            ＋ 위젯 추가
          </button>
        </div>
      )}

      {pickerOpen && (
        <WidgetPicker onPick={handlePick} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  );
}
