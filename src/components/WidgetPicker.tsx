import { useEffect } from "react";
import { useDashboardWidgetConfigs } from "../lib/dashboardWidgetConfigs";

/**
 * Modal listing the merged widget catalog (bundled defaults + user folder).
 * Picking an entry adds it to the dashboard and closes. Closes on Esc, backdrop
 * click, or ✕. An empty catalog just shows a hint (never an error).
 */
export default function WidgetPicker({
  onPick,
  onClose,
}: {
  onPick: (widgetId: string) => void;
  onClose: () => void;
}) {
  const configs = useDashboardWidgetConfigs((s) => s.configs);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[560px] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-100">위젯 추가</h2>
          <button
            onClick={onClose}
            className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {configs.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500">
              추가할 수 있는 위젯이 없어요.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {configs.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => onPick(c.id)}
                    className="flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-ink-700 hover:bg-ink-700/40"
                  >
                    <span className="mt-0.5 text-xl leading-none select-none">
                      {c.icon ?? "📊"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-100">
                        {c.label}
                      </span>
                      {c.description && (
                        <span className="mt-0.5 block text-2xs text-slate-500">
                          {c.description}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
