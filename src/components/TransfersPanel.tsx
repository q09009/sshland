import { useEffect, useRef, useState } from "react";
import { Transfer, UploadBatch, useAppStore } from "../store";
import { formatSize } from "../lib/format";

/** How long a completed card stays before it starts fading out. */
const AUTO_DISMISS_MS = 3000;
/** Fade-out transition duration; must match the CSS duration below. */
const FADE_MS = 300;

/** Bottom-right completion/error toasts; active progress lives in StatusBar. */
export default function TransfersPanel() {
  const transfers = useAppStore((s) => s.transfers);
  const batches = useAppStore((s) => s.uploadBatches);
  const visibleTransfers = transfers.filter(
    (transfer) => transfer.status !== "active"
  );
  const visibleBatches = batches.filter((batch) => batch.done >= batch.total);

  if (visibleTransfers.length === 0 && visibleBatches.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-30 flex w-80 flex-col gap-2">
      {visibleBatches.map((b) => (
        <BatchCard key={b.id} batch={b} />
      ))}
      {visibleTransfers.map((t) => (
        <TransferCard key={t.id} transfer={t} />
      ))}
    </div>
  );
}

/**
 * Runs `onExpire` once, `AUTO_DISMISS_MS` after `when` first becomes true, and
 * returns whether the card is now fading out. Errors never expire — the user
 * dismisses them so they aren't missed.
 */
function useAutoDismiss(when: boolean, onExpire: () => void) {
  const [leaving, setLeaving] = useState(false);
  // Keep the latest callback in a ref so the removal timer below depends only
  // on `leaving` — an unrelated parent re-render (another transfer's progress
  // tick) must not restart the fade-out timer.
  const cb = useRef(onExpire);
  cb.current = onExpire;

  useEffect(() => {
    if (!when) return;
    const t = setTimeout(() => setLeaving(true), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [when]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => cb.current(), FADE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  return leaving;
}

/** A dismissable card wrapper that slides/fades out when `leaving`. */
function Card({
  leaving,
  accent,
  children,
}: {
  leaving: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`pointer-events-auto rounded-xl border bg-ink-800 p-3 shadow-2xl transition-all duration-300 ${
        accent ? "border-sky-500/40" : "border-ink-700"
      } ${leaving ? "translate-x-6 opacity-0" : "translate-x-0 opacity-100"}`}
    >
      {children}
    </div>
  );
}

function BatchCard({ batch }: { batch: UploadBatch }) {
  const dismiss = useAppStore((s) => s.dismissBatch);
  const complete = batch.done >= batch.total;
  const leaving = useAutoDismiss(complete, () => dismiss(batch.id));
  const pct = batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0;

  return (
    <Card leaving={leaving} accent>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-slate-200">
          {complete ? "업로드 완료" : "업로드 중"}
        </span>
        <span className="text-slate-400">
          {batch.total}개 중 {batch.done}개 완료
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-900">
        <div
          className={`h-full rounded-full transition-[width] ${
            complete ? "bg-emerald-500" : "bg-sky-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </Card>
  );
}

function TransferCard({ transfer: t }: { transfer: Transfer }) {
  const dismiss = useAppStore((s) => s.dismissTransfer);
  const leaving = useAutoDismiss(t.status === "done", () => dismiss(t.id));

  const pct =
    t.total > 0
      ? Math.min(100, Math.round((t.transferred / t.total) * 100))
      : t.status === "done"
      ? 100
      : 0;

  return (
    <Card leaving={leaving}>
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
    </Card>
  );
}
