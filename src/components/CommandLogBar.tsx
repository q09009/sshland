import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { useSettings } from "../lib/settings";
import { formatClock } from "../lib/format";
import { useI18n } from "../i18n";

/**
 * Thin one-line bar at the very bottom of the window (a separate layer below
 * the pane tiling). Shows the most recent file-manager operation or recursive
 * search as its CLI equivalent; clicking expands recent history upward.
 * Session-only — history resets on restart. The on/off setting comes later.
 */
export default function CommandLogBar() {
  const enabled = useSettings((s) => s.settings.commandLogEnabled);
  const log = useAppStore((s) => s.commandLog);
  const [open, setOpen] = useState(false);
  const latest = log[0] ?? null;
  const canOpen = log.length > 0;
  const { t } = useI18n();

  // Close the history popup on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // Nothing to expand once history is emptied — collapse.
  useEffect(() => {
    if (!canOpen) setOpen(false);
  }, [canOpen]);

  // Advanced-user opt-out: the whole bar disappears when disabled.
  if (!enabled) return null;

  return (
    <div className="relative shrink-0">
      {open && (
        <>
          {/* Click-away layer */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-full z-40 max-h-64 overflow-y-auto border-t border-ink-700 bg-surface-popover shadow-popover">
            <div className="sticky top-0 border-b border-ink-700/60 bg-ink-800 px-3 py-1.5 text-2xs text-slate-500">
              {t("commandLog.history", { count: log.length })}
            </div>
            <ul className="py-1">
              {log.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 px-3 py-1 font-mono text-xs text-slate-300"
                >
                  <span className="select-none text-slate-600">$</span>
                  <span className="truncate">{e.command}</span>
                  <span className="ml-auto shrink-0 font-sans text-2xs text-slate-600">
                    {formatClock(new Date(e.at), false)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => canOpen && setOpen((v) => !v)}
        title={canOpen ? t("commandLog.view") : undefined}
        className={`flex h-7 w-full items-center gap-2 border-t border-ink-700/70 bg-ink-800 px-3 text-left font-mono text-xs text-slate-400 ${
          canOpen ? "hover:bg-ink-700/40" : "cursor-default"
        }`}
      >
        <span className="select-none text-slate-600">$</span>
        {latest ? (
          <span className="truncate">{latest.command}</span>
        ) : (
          <span className="truncate text-slate-600">
            {t("commandLog.empty")}
          </span>
        )}
        {canOpen && (
          <span className="ml-auto shrink-0 text-slate-600">
            {open ? "▾" : "▴"}
          </span>
        )}
      </button>
    </div>
  );
}
