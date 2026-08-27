import { useEffect } from "react";
import { useDashboardWidgetConfigs } from "../lib/dashboardWidgetConfigs";
import { useMacros } from "../lib/macros";
import { useI18n } from "../i18n";
import {
  dashboardWidgetDescription,
  dashboardWidgetLabel,
} from "../lib/dashboardWidgetText";

/**
 * Modal for adding a card to the dashboard. Two categories: the merged monitoring
 * widget catalog (bundled defaults + user folder) and Macros (a "create new"
 * entry plus every saved macro). Closes on Esc, backdrop click, or ✕.
 */
export default function WidgetPicker({
  onPick,
  onPickMacro,
  onCreateMacro,
  onClose,
}: {
  onPick: (widgetId: string) => void;
  onPickMacro: (macroId: string) => void;
  onCreateMacro: () => void;
  onClose: () => void;
}) {
  const configs = useDashboardWidgetConfigs((s) => s.configs);
  const macros = useMacros((s) => s.macros);
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="motion-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-6"
      onMouseDown={onClose}
    >
      <div
        className="motion-dialog-surface flex max-h-[560px] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 shadow-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-100">{t("dashboard.addWidget")}</h2>
          <button
            onClick={onClose}
            className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <Category label={t("dashboard.monitoring")} />
          {configs.length === 0 ? (
            <p className="px-3 py-4 text-center text-2xs text-slate-500">
              {t("dashboard.noWidgets")}
            </p>
          ) : (
            <ul className="mb-2 flex flex-col gap-1">
              {configs.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => onPick(c.id)}
                    className="flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors duration-fast ease-standard hover:border-ink-700 hover:bg-ink-700/40"
                  >
                    <span className="mt-0.5 text-xl leading-none select-none">
                      {c.icon ?? "📊"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-100">
                        {dashboardWidgetLabel(c, t)}
                      </span>
                      {dashboardWidgetDescription(c, t) && (
                        <span className="mt-0.5 block text-2xs text-slate-500">
                          {dashboardWidgetDescription(c, t)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Category label={t("dashboard.macros")} />
          <ul className="flex flex-col gap-1">
            <li>
              <button
                onClick={onCreateMacro}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-ink-700 px-3 py-2.5 text-left text-sky-200 transition-colors duration-fast ease-standard hover:bg-sky-500/10"
              >
                <span className="text-xl leading-none select-none">＋</span>
                <span className="text-sm">{t("dashboard.createMacro")}</span>
              </button>
            </li>
            {macros.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => onPickMacro(m.id)}
                  className="flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors duration-fast ease-standard hover:border-ink-700 hover:bg-ink-700/40"
                >
                  <span className="mt-0.5 text-xl leading-none select-none">⚙</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-100">
                      {m.name}
                    </span>
                    <span className="mt-0.5 block text-2xs text-slate-500">
                      {t("dashboard.steps", { count: m.steps.length })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Category({ label }: { label: string }) {
  return (
    <div className="px-3 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-slate-500">
      {label}
    </div>
  );
}
