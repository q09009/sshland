/**
 * Shared drag-and-drop list reordering, used by both the dashboard widget grid
 * and the macro editor's step list (one implementation, not two).
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

/**
 * Build the drag props for a reorderable item. `mime` scopes the drag so drops
 * from unrelated sources are ignored; `onMove(from, to)` is called on a drop.
 * The draggable handle uses `handleProps` (put it on a small grip element); the
 * whole row uses `dropProps` as the drop target.
 */
export function dragReorder(
  index: number,
  onMove: (from: number, to: number) => void,
  mime: string
) {
  return {
    handleProps: {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData(mime, String(index));
        e.dataTransfer.effectAllowed = "move" as const;
      },
    },
    dropProps: {
      onDragOver: (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes(mime)) e.preventDefault();
      },
      onDrop: (e: React.DragEvent) => {
        const raw = e.dataTransfer.getData(mime);
        if (raw === "") return;
        e.preventDefault();
        const from = Number.parseInt(raw, 10);
        if (!Number.isNaN(from)) onMove(from, index);
      },
    },
  };
}
