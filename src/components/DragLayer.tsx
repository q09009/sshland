import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { useI18n } from "../i18n";

/** A small ghost label that follows the cursor while dragging items to move. */
export default function DragLayer() {
  const dragItem = useAppStore((s) => s.dragItem);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const { t } = useI18n();

  useEffect(() => {
    if (!dragItem) return;
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [dragItem]);

  if (!dragItem) return null;
  const first = dragItem.items[0];
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md border border-sky-500 bg-ink-800/95 px-2 py-1 text-xs text-slate-100 shadow-popover"
      style={{ left: pos.x + 12, top: pos.y + 12 }}
    >
      {dragItem.items.length === 1 ? (
        <>
          {first.isDir ? "📁 " : "📄 "}
          {first.name}
        </>
      ) : (
        <>▦ {t("files.drag.count", { count: dragItem.items.length })}</>
      )}
    </div>
  );
}
