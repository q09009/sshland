import { useEffect, useState } from "react";
import { useDashboardWidgetConfigs, findWidgetConfig } from "../lib/dashboardWidgetConfigs";
import { useDashboardLayout } from "../lib/dashboardLayout";
import { useSettings } from "../lib/settings";
import { Macro, newMacro, useMacros } from "../lib/macros";
import { useReorder } from "../lib/reorder";
import { usePaneMenuRegistration } from "../lib/paneMenus";
import WidgetCard from "./WidgetCard";
import MacroCard from "./MacroCard";
import WidgetPicker from "./WidgetPicker";
import MacroEditor from "./MacroEditor";

/**
 * A dashboard pane: a customizable, responsive grid of cards. Monitoring/process
 * widgets poll the server on a timer (one-shot exec via the SSH worker); macro
 * cards run their steps on demand. Not a Hyprland split tree — just a grid, each
 * card sized small/medium/large.
 *
 * The layout (which cards, order, sizes, intervals) is a single shared model in
 * `useDashboardLayout`. A card's `source` selects its renderer: "macro" cards
 * reference a saved macro (lib/macros), the rest reference a widget config.
 */
export default function DashboardPane({ id }: { id: string }) {
  const loadConfigs = useDashboardWidgetConfigs((s) => s.load);
  const configs = useDashboardWidgetConfigs((s) => s.configs);
  const loadMacros = useMacros((s) => s.load);
  const saveMacro = useMacros((s) => s.save);
  const widgets = useDashboardLayout((s) => s.widgets);
  const addWidget = useDashboardLayout((s) => s.addWidget);
  const addMacroWidget = useDashboardLayout((s) => s.addMacroWidget);
  const defaultInterval = useSettings((s) => s.settings.dashboardDefaultInterval);
  const [pickerOpen, setPickerOpen] = useState(false);
  // A brand-new macro being authored before it's saved + added to the grid.
  const [creating, setCreating] = useState<Macro | null>(null);

  const moveWidget = useDashboardLayout((s) => s.moveWidget);
  const { itemProps, isDragging } = useReorder(widgets.length, moveWidget);

  // Load the widget catalog + saved macros once (idempotent in the stores).
  useEffect(() => {
    void loadConfigs();
    void loadMacros();
  }, [loadConfigs, loadMacros]);

  const handlePick = (widgetId: string) => {
    const cfg = findWidgetConfig(configs, widgetId);
    // The widget's own interval wins; otherwise the global default setting.
    addWidget(widgetId, cfg?.refreshIntervalSeconds ?? defaultInterval);
    setPickerOpen(false);
  };

  const handlePickMacro = (macroId: string) => {
    addMacroWidget(macroId);
    setPickerOpen(false);
  };

  const handleCreateMacro = () => {
    setPickerOpen(false);
    setCreating(newMacro());
  };

  const handleSaveNewMacro = (mac: Macro) => {
    void saveMacro(mac);
    addMacroWidget(mac.id);
    setCreating(null);
  };

  usePaneMenuRegistration(id, [
    {
      label: "위젯",
      items: [
        { label: "위젯 추가", onClick: () => setPickerOpen(true) },
        { label: "새 매크로 만들기", onClick: handleCreateMacro },
      ],
    },
  ]);

  return (
    <div
      className="dashboard-canvas h-full w-full overflow-auto bg-ink-900"
      data-pane-id={id}
    >
      {widgets.length === 0 ? (
        <div className="flex h-full w-full flex-col items-center justify-center text-center">
          <DashboardMark />
          <p className="mt-4 text-sm font-medium text-slate-300">
            대시보드가 비어 있어요
          </p>
          <p className="mt-1 max-w-64 text-2xs leading-relaxed text-slate-500">
            필요한 서버 상태만 골라 현재 작업 공간에 배치할 수 있어요.
          </p>
          <button
            onClick={() => setPickerOpen(true)}
            className="mt-4 rounded-lg border border-sky-500/70 px-3.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/10"
          >
            위젯 추가
          </button>
        </div>
      ) : (
        <div className="dashboard-grid grid">
          {widgets.map((w, i) =>
            w.source === "macro" ? (
              <MacroCard key={w.instanceId} instance={w} drag={itemProps(i)} />
            ) : (
              <WidgetCard key={w.instanceId} instance={w} drag={itemProps(i)} />
            )
          )}
          <button
            onClick={() => setPickerOpen(true)}
            className="dashboard-add-card flex min-h-10 items-center justify-center rounded-lg border border-dashed border-ink-700/70 text-xs text-slate-500 hover:border-sky-500/60 hover:text-slate-300"
          >
            ＋ 위젯 추가
          </button>
        </div>
      )}

      {/* Full-screen "grabbing" overlay while a card is being dragged, same
          trick PaneView uses for divider dragging — keeps the cursor correct
          and swallows stray hover/clicks over other cards mid-drag. */}
      {isDragging && (
        <div className="fixed inset-0 z-40" style={{ cursor: "grabbing" }} />
      )}

      {pickerOpen && (
        <WidgetPicker
          onPick={handlePick}
          onPickMacro={handlePickMacro}
          onCreateMacro={handleCreateMacro}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {creating && (
        <MacroEditor
          initial={creating}
          onSave={handleSaveNewMacro}
          onCancel={() => setCreating(null)}
        />
      )}
    </div>
  );
}

function DashboardMark() {
  return (
    <svg
      className="h-9 w-9 text-slate-600"
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="12" height="12" rx="2.5" stroke="currentColor" />
      <rect x="20.5" y="3.5" width="12" height="12" rx="2.5" stroke="currentColor" />
      <rect x="3.5" y="20.5" width="12" height="12" rx="2.5" stroke="currentColor" />
      <rect x="20.5" y="20.5" width="12" height="12" rx="2.5" stroke="currentColor" />
    </svg>
  );
}
