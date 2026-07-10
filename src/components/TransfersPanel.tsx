import { useAppStore } from "../store";
import { formatSize } from "../lib/format";

/** Bottom-right panel showing active and finished file transfers. */
export default function TransfersPanel() {
  const transfers = useAppStore((s) => s.transfers);
  const dismiss = useAppStore((s) => s.dismissTransfer);

  if (transfers.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-30 flex w-80 flex-col gap-2">
      {transfers.map((t) => {
        const pct =
          t.total > 0
            ? Math.min(100, Math.round((t.transferred / t.total) * 100))
            : t.status === "done"
            ? 100
            : 0;
        return (
          <div
            key={t.id}
            className="pointer-events-auto rounded-xl border border-ink-700 bg-ink-800 p-3 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="text-xs text-slate-500">
                  {t.kind === "download" ? "↓" : "↑"}
                </span>
                <span className="truncate text-sm text-slate-200" title={t.name}>
                  {t.name}
                </span>
              </span>
              {t.status !== "active" && (
                <button
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 text-slate-500 hover:text-slate-300"
                  aria-label="닫기"
                >
                  ✕
                </button>
              )}
            </div>

            {t.status === "error" ? (
              <p className="mt-1.5 text-xs text-red-400">{t.error}</p>
            ) : (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-900">
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      t.status === "done" ? "bg-emerald-500" : "bg-sky-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-slate-500">
                  <span>
                    {t.status === "done"
                      ? "완료"
                      : t.total > 0
                      ? `${formatSize(t.transferred, false)} / ${formatSize(
                          t.total,
                          false
                        )}`
                      : formatSize(t.transferred, false)}
                  </span>
                  <span>{pct}%</span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
