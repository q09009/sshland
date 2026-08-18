import { ReactNode, useEffect, useRef, useState } from "react";

export type DropItem =
  | {
      type?: "action";
      label: string;
      onClick: () => void;
      disabled?: boolean;
      danger?: boolean;
      shortcut?: string;
    }
  | { type: "check"; label: string; checked: boolean; onClick: () => void }
  | { type: "separator" };

/** A menu-bar dropdown: a label button that opens a list of items. */
export default function Menu({
  label,
  items,
}: {
  label: string;
  items: DropItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded px-2 py-0.5 text-sm hover:bg-ink-700 ${
          open ? "bg-ink-700 text-slate-100" : "text-slate-300"
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-0.5 min-w-[190px] overflow-hidden rounded-lg border border-ink-700 bg-ink-800 py-1 shadow-2xl">
          {items.map((item, i) =>
            item.type === "separator" ? (
              <div key={i} className="my-1 border-t border-ink-700/60" />
            ) : item.type === "check" ? (
              <Row
                key={i}
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
              >
                <span className="w-4 text-sky-400">{item.checked ? "✓" : ""}</span>
                <span>{item.label}</span>
              </Row>
            ) : (
              <Row
                key={i}
                disabled={item.disabled}
                danger={item.danger}
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
              >
                <span className="w-4" />
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="ml-auto pl-4 text-xs text-slate-500">
                    {item.shortcut}
                  </span>
                )}
              </Row>
            )
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-700 disabled:opacity-40 disabled:hover:bg-transparent ${
        danger ? "text-red-400" : "text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
