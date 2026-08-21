import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePaneMenuStore } from "../lib/paneMenus";
import { useAppStore } from "../store";
import { useI18n } from "../i18n";

const EMPTY_MENUS: never[] = [];

interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  shortcut?: string;
  checked?: boolean;
  run: () => void;
}

/** Searchable launcher backed by the focused pane's existing menu commands. */
export default function CommandPalette() {
  const focusedPaneId = useAppStore((state) => state.focusedPaneId);
  const menus = usePaneMenuStore(
    (state) => state.byPane[focusedPaneId] ?? EMPTY_MENUS
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const commands = useMemo<PaletteCommand[]>(
    () =>
      menus.flatMap((group) =>
        group.items.flatMap((item, index) => {
          if (item.type === "separator" || item.disabled) return [];
          return [
            {
              id: `${group.label}-${index}-${item.label}`,
              group: group.label,
              label: item.label,
              shortcut: item.type === "check" ? undefined : item.shortcut,
              checked: item.type === "check" ? item.checked : undefined,
              run: item.onClick,
            },
          ];
        })
      ),
    [menus]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.group} ${command.label} ${command.shortcut ?? ""}`
        .toLocaleLowerCase()
        .includes(needle)
    );
  }, [commands, query]);

  const show = useCallback(() => {
    if (commands.length === 0) return;
    setQuery("");
    setActive(0);
    setOpen(true);
  }, [commands.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.code === "KeyP" &&
        commands.length > 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        show();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [commands.length, show]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [focusedPaneId]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const run = (command: PaletteCommand) => {
    setOpen(false);
    command.run();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label={t("palette.label")}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-ink-700 bg-ink-800 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((current) =>
                filtered.length === 0 ? 0 : (current + 1) % filtered.length
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((current) =>
                filtered.length === 0
                  ? 0
                  : (current - 1 + filtered.length) % filtered.length
              );
            } else if (event.key === "Enter" && filtered[active]) {
              event.preventDefault();
              run(filtered[active]);
            }
          }}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.search")}
          spellCheck={false}
          className="w-full border-b border-ink-700 bg-ink-900 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
        />

        <div className="max-h-80 overflow-y-auto p-1" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-slate-500">
              {t("palette.empty")}
            </div>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(command)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                  index === active
                    ? "bg-sky-500/15 text-slate-100"
                    : "text-slate-300 hover:bg-ink-700"
                }`}
              >
                <span className="w-4 shrink-0 text-sky-400">
                  {command.checked ? "✓" : ""}
                </span>
                <span className="truncate">{command.label}</span>
                <span className="ml-auto shrink-0 text-xs text-slate-500">
                  {command.group}
                  {command.shortcut ? ` · ${command.shortcut}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
