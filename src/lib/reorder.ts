import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared drag-and-drop list reordering, used by both the dashboard widget grid
 * and the macro editor's step list (one implementation, not two).
 *
 * This is deliberately POINTER-based (mousedown/mousemove/mouseup), not native
 * HTML5 Drag-and-Drop. Tauri's `dragDropEnabled` (kept at its default `true`
 * because the app's OS file-drag-in upload feature needs it — see the "OS
 * drag-in upload" section in CLAUDE.md) makes WebView2 intercept the native
 * dragstart/dragover/drop events on Windows, so `draggable` elements never
 * receive them inside the app at all — confirmed against real Tauri/WebView2
 * behavior (github.com/tauri-apps/tauri#14373, #8581, #9445). A native-DnD
 * implementation looks correct in a plain browser tab but silently does
 * nothing in the shipped app. This mirrors the mousedown+window-listener
 * pattern PaneView.tsx already uses for divider dragging, and finds the drop
 * target the same way pane focus movement finds a neighbor in panes.ts
 * (nearest item by rect-center distance) — which works for a 2D grid and a
 * simple vertical list alike.
 */

/** Move the item at `from` to index `to`, returning a new array. Out-of-range
 *  or no-op moves return the original array unchanged (referentially). Pure. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= arr.length ||
    to >= arr.length
  ) {
    return arr;
  }
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Per-item props returned by `useReorder`, spread onto that item's elements. */
export interface ReorderItemProps {
  /** Attach to the item's outer element so its position can be measured. */
  itemRef: (el: HTMLElement | null) => void;
  /** Attach to the item's drag-handle element to start dragging it. */
  onHandleMouseDown: (e: React.MouseEvent) => void;
  /** True while this item is the one being dragged (e.g. dim it). */
  dragging: boolean;
  /** True while this item is the current drop target (e.g. highlight it). */
  dropTarget: boolean;
}

/**
 * Pointer-based drag reordering for a list/grid of `count` items. Returns
 * `itemProps(index)` to spread per item, plus whether a drag is in progress
 * (so the caller can render a full-screen "grabbing" cursor overlay, same
 * trick PaneView uses while a divider is being dragged).
 */
export function useReorder(
  count: number,
  onMove: (from: number, to: number) => void
) {
  const elements = useRef(new Map<number, HTMLElement>());
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // If the item count shrinks (e.g. a card was removed) while nothing is
  // being dragged, drop stale element refs so distance lookups can't hit them.
  useEffect(() => {
    if (dragIndex != null) return;
    for (const i of elements.current.keys()) {
      if (i >= count) elements.current.delete(i);
    }
  }, [count, dragIndex]);

  const setItemRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (el) elements.current.set(index, el);
      else elements.current.delete(index);
    },
    []
  );

  const nearestIndex = useCallback((x: number, y: number): number | null => {
    let best: number | null = null;
    let bestDist = Infinity;
    elements.current.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height / 2);
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }, []);

  const startDrag = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      // Only the primary button starts a drag; avoid hijacking right-click etc.
      if (e.button !== 0) return;
      e.preventDefault();
      setDragIndex(index);
      setOverIndex(index);
    },
    []
  );

  useEffect(() => {
    if (dragIndex == null) return;

    const onMouseMove = (e: MouseEvent) => {
      const idx = nearestIndex(e.clientX, e.clientY);
      if (idx != null) setOverIndex(idx);
    };
    const onMouseUp = (e: MouseEvent) => {
      const from = dragIndex;
      const to = nearestIndex(e.clientX, e.clientY);
      setDragIndex(null);
      setOverIndex(null);
      if (to != null && to !== from) onMove(from, to);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIndex, nearestIndex]);

  const itemProps = useCallback(
    (index: number): ReorderItemProps => ({
      itemRef: setItemRef(index),
      onHandleMouseDown: startDrag(index),
      dragging: dragIndex === index,
      dropTarget: dragIndex != null && overIndex === index && dragIndex !== index,
    }),
    [setItemRef, startDrag, dragIndex, overIndex]
  );

  return { itemProps, isDragging: dragIndex != null };
}
