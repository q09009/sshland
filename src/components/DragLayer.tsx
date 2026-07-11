import { useEffect, useState } from "react";
import { useAppStore } from "../store";

/** A small ghost label that follows the cursor while dragging an item to move. */
export default function DragLayer() {
  const dragItem = useAppStore((s) => s.dragItem);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!dragItem) return;
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [dragItem]);

  if (!dragItem) return null;
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md border border-sky-500 bg-ink-800/95 px-2 py-1 text-xs text-slate-100 shadow-xl"
      style={{ left: pos.x + 12, top: pos.y + 12 }}
    >
      {dragItem.isDir ? "📁 " : "📄 "}
      {dragItem.name}
    </div>
  );
}
