import { useState } from "react";

/** Keyboard shortcuts, shown in a toggleable corner panel. */
const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "Alt+Shift+H", desc: "좌우 분할 (새 터미널)" },
  { keys: "Alt+Shift+V", desc: "상하 분할 (새 터미널)" },
  { keys: "Alt+방향키", desc: "포커스 이동" },
  { keys: "Alt+Shift+W", desc: "현재 pane 닫기" },
];

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-3 right-3 z-30 flex flex-col items-end">
      {open && (
        <div className="mb-2 w-64 rounded-xl border border-ink-700 bg-ink-800 p-3 shadow-2xl">
          <div className="mb-2 text-xs font-medium text-slate-400">
            단축키
          </div>
          <ul className="space-y-1.5">
            {SHORTCUTS.map((s) => (
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
        title="단축키 도움말"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-700 bg-ink-800 text-slate-400 shadow-lg hover:text-slate-100"
      >
        ?
      </button>
    </div>
  );
}
