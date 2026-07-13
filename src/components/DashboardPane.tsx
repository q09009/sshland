import { useEffect, useState } from "react";
import { useDashboardWidgetConfigs, findWidgetConfig } from "../lib/dashboardWidgetConfigs";
import { useDashboardLayout } from "../lib/dashboardLayout";
import { useSettings } from "../lib/settings";
import { Macro, newMacro, useMacros } from "../lib/macros";
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

  return (
    <div className="h-full w-full overflow-auto bg-ink-900 p-4" data-pane-id={id}>
      {widgets.length === 0 ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
          <div className="text-4xl opacity-40 select-none">📊</div>
          <p className="text-sm text-slate-400">아직 위젯이 없어요.</p>
          <p className="text-2xs text-slate-500">
            위젯이나 매크로를 추가해 서버를 한눈에 관리해보세요.
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
          {widgets.map((w, i) =>
            w.source === "macro" ? (
              <MacroCard key={w.instanceId} instance={w} index={i} />
            ) : (
              <WidgetCard key={w.instanceId} instance={w} index={i} />
            )
          )}
          <button
            onClick={() => setPickerOpen(true)}
            className="flex min-h-[96px] items-center justify-center rounded-xl border border-dashed border-ink-700 text-sm text-slate-500 hover:border-sky-600/60 hover:text-slate-300"
          >
            ＋ 위젯 추가
          </button>
        </div>
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
