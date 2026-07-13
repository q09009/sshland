import { useEffect } from "react";
import { useDashboardWidgetConfigs } from "../lib/dashboardWidgetConfigs";
import { useMacros } from "../lib/macros";

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
          <Category label="모니터링" />
          {configs.length === 0 ? (
            <p className="px-3 py-4 text-center text-2xs text-slate-500">
              추가할 수 있는 위젯이 없어요.
            </p>
          ) : (
            <ul className="mb-2 flex flex-col gap-1">
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

          <Category label="매크로" />
          <ul className="flex flex-col gap-1">
            <li>
              <button
                onClick={onCreateMacro}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-ink-700 px-3 py-2.5 text-left text-sky-200 hover:bg-sky-500/10"
              >
                <span className="text-xl leading-none select-none">＋</span>
                <span className="text-sm">새 매크로 만들기</span>
              </button>
            </li>
            {macros.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => onPickMacro(m.id)}
                  className="flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-ink-700 hover:bg-ink-700/40"
                >
                  <span className="mt-0.5 text-xl leading-none select-none">⚙</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-100">
                      {m.name}
                    </span>
                    <span className="mt-0.5 block text-2xs text-slate-500">
                      {m.steps.length}단계
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
