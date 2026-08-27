import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/** A small right-click menu positioned near the cursor. */
export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the menu inside the viewport.
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const nx = Math.min(x, window.innerWidth - rect.width - 8);
      const ny = Math.min(y, window.innerHeight - rect.height - 8);
      setPos({ x: Math.max(8, nx), y: Math.max(8, ny) });
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [x, y, onClose]);

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-40 min-w-[140px] overflow-hidden rounded-lg border border-ink-700 bg-surface-popover py-1 shadow-popover"
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={`block w-full px-3.5 py-1.5 text-left text-sm hover:bg-ink-700 ${
            item.danger ? "text-red-400" : "text-slate-200"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
