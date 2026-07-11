import { useAppStore } from "../store";

/**
 * Thin one-line bar at the very bottom of the window (a separate layer below
 * the pane tiling). Shows the most recent file-manager operation rendered as
 * the CLI command it maps to. Clicking to reveal history and the on/off setting
 * come in later steps.
 */
export default function CommandLogBar() {
  const latest = useAppStore((s) => s.commandLog[0] ?? null);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-ink-700/70 bg-ink-800 px-3 font-mono text-xs text-slate-400">
      <span className="select-none text-slate-600">$</span>
      {latest ? (
        <span className="truncate">{latest.command}</span>
      ) : (
        <span className="truncate text-slate-600">
          파일 조작 시 여기에 명령어가 표시돼요
        </span>
      )}
    </footer>
  );
}
