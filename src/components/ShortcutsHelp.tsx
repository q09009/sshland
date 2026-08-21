import { useState } from "react";
import { useI18n } from "../i18n";

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const shortcuts = [
    { keys: "Alt+Shift+H", desc: t("shortcuts.splitHorizontal") },
    { keys: "Alt+Shift+V", desc: t("shortcuts.splitVertical") },
    { keys: "Alt+Arrow", desc: t("shortcuts.moveFocus") },
    { keys: "Alt+Shift+W", desc: t("shortcuts.closePane") },
    { keys: "Ctrl+Shift+P", desc: t("shortcuts.commandSearch") },
  ];

  return (
    <div className="fixed bottom-3 right-3 z-30 flex flex-col items-end">
      {open && (
        <div className="mb-2 w-64 rounded-xl border border-ink-700 bg-ink-800 p-3 shadow-2xl">
          <div className="mb-2 text-xs font-medium text-slate-400">
            {t("shortcuts.title")}
          </div>
          <ul className="space-y-1.5">
            {shortcuts.map((s) => (
              <li key={s.keys} className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-300">{s.desc}</span>
                <kbd className="shrink-0 rounded bg-ink-900 px-1.5 py-0.5 font-mono text-2xs text-slate-400">
                  {s.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("shortcuts.help")}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-700 bg-ink-800 text-slate-400 shadow-lg hover:text-slate-100"
      >
        ?
      </button>
    </div>
  );
}
