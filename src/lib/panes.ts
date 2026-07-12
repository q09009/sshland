// Binary-tree model for the tiling layout.
//
// A pane is either a `leaf` (an actual file-manager or terminal view) or a
// `split` with exactly two children laid out horizontally or vertically.

export type PaneContent = "file-manager" | "terminal" | "editor";
export type SplitDirection = "horizontal" | "vertical";

export interface LeafNode {
  type: "leaf";
  id: string;
  content: PaneContent;
  /** For `editor` leaves: the remote file being edited. */
  filePath?: string;
  /** For `editor` leaves: whether there are unsaved changes. */
  isDirty?: boolean;
}

export interface SplitNode {
  type: "split";
  id: string;
  direction: SplitDirection;
  /** Fraction of space given to the first child (0..1). */
  ratio: number;
  children: [PaneNode, PaneNode];
}

export type PaneNode = LeafNode | SplitNode;

let counter = 0;
/** Generate a process-unique id for a pane or split node. */
export function newId(prefix = "pane"): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function makeLeaf(content: PaneContent, filePath?: string): LeafNode {
  const prefix =
    content === "terminal" ? "term" : content === "editor" ? "ed" : "fm";
  return { type: "leaf", id: newId(prefix), content, filePath };
}

/** Find an existing editor leaf for `filePath`, so re-opening it reuses it. */
export function findEditorLeaf(node: PaneNode, filePath: string): string | null {
  if (node.type === "leaf") {
    return node.content === "editor" && node.filePath === filePath
      ? node.id
      : null;
  }
  return (
    findEditorLeaf(node.children[0], filePath) ??
    findEditorLeaf(node.children[1], filePath)
  );
}

/** Set the dirty (unsaved-changes) flag on an editor leaf, returning a new tree. */
export function setLeafDirty(
  node: PaneNode,
  id: string,
  isDirty: boolean
): PaneNode {
  if (node.type === "leaf") {
    return node.id === id ? { ...node, isDirty } : node;
  }
  return {
    ...node,
    children: [
      setLeafDirty(node.children[0], id, isDirty),
      setLeafDirty(node.children[1], id, isDirty),
    ],
  };
}

/**
 * Replace the leaf `targetId` with a split whose children are that leaf and
 * `addition`. Returns a new tree (structural sharing elsewhere).
 */
export function splitLeaf(
  node: PaneNode,
  targetId: string,
  direction: SplitDirection,
  addition: LeafNode
): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== targetId) return node;
    return {
      type: "split",
      id: newId("split"),
      direction,
      ratio: 0.5,
      children: [node, addition],
    };
  }
  return {
    ...node,
    children: [
      splitLeaf(node.children[0], targetId, direction, addition),
      splitLeaf(node.children[1], targetId, direction, addition),
    ],
  };
}

/**
 * Remove the leaf `targetId`. Its parent split is replaced by the remaining
 * sibling. Removing the root leaf (last pane) is a no-op.
 */
export function removeLeaf(node: PaneNode, targetId: string): PaneNode {
  if (node.type === "leaf") return node;
  const [a, b] = node.children;
  if (a.type === "leaf" && a.id === targetId) return b;
  if (b.type === "leaf" && b.id === targetId) return a;
  return {
    ...node,
    children: [removeLeaf(a, targetId), removeLeaf(b, targetId)],
  };
}

/** The id of the first (top-left-most) leaf in a tree. */
export function firstLeafId(node: PaneNode): string {
  return node.type === "leaf" ? node.id : firstLeafId(node.children[0]);
}

/** Total number of leaves in the tree. */
export function leafCount(node: PaneNode): number {
  return node.type === "leaf"
    ? 1
    : leafCount(node.children[0]) + leafCount(node.children[1]);
}

/** Change the content (file-manager/terminal) of the leaf `id`. */
export function setLeafContent(
  node: PaneNode,
  id: string,
  content: PaneContent
): PaneNode {
  if (node.type === "leaf") {
    return node.id === id ? { ...node, content } : node;
  }
  return {
    ...node,
    children: [
      setLeafContent(node.children[0], id, content),
      setLeafContent(node.children[1], id, content),
    ],
  };
}

/** Set the ratio of the split `splitId`, returning a new tree. */
export function updateRatio(
  node: PaneNode,
  splitId: string,
  ratio: number
): PaneNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) return { ...node, ratio };
  return {
    ...node,
    children: [
      updateRatio(node.children[0], splitId, ratio),
      updateRatio(node.children[1], splitId, ratio),
    ],
  };
}

// --- Geometry for directional focus movement ---

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Direction = "left" | "right" | "up" | "down";

/** Compute each leaf's normalized [0..1] rectangle from the split ratios. */
export function collectRects(
  node: PaneNode,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
  out: Record<string, Rect> = {}
): Record<string, Rect> {
  if (node.type === "leaf") {
    out[node.id] = rect;
    return out;
  }
  const { x, y, w, h } = rect;
  if (node.direction === "horizontal") {
    collectRects(node.children[0], { x, y, w: w * node.ratio, h }, out);
    collectRects(
      node.children[1],
      { x: x + w * node.ratio, y, w: w * (1 - node.ratio), h },
      out
    );
  } else {
    collectRects(node.children[0], { x, y, w, h: h * node.ratio }, out);
    collectRects(
      node.children[1],
      { x, y: y + h * node.ratio, w, h: h * (1 - node.ratio) },
      out
    );
  }
  return out;
}

export interface LeafLayout {
  node: LeafNode;
  rect: Rect;
}
export interface DividerLayout {
  splitId: string;
  direction: SplitDirection;
  /** The split's own rectangle, used to map a cursor position to a ratio. */
  parentRect: Rect;
  /** Position of the divider line (zero thickness along the split axis). */
  x: number;
  y: number;
}

/**
 * Flatten the tree into absolutely-positioned leaves and split dividers, so the
 * React tree stays flat (leaves keyed by id) and panes survive restructuring.
 */
export function collectLayout(
  node: PaneNode,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
  leaves: LeafLayout[] = [],
  dividers: DividerLayout[] = []
): { leaves: LeafLayout[]; dividers: DividerLayout[] } {
  if (node.type === "leaf") {
    leaves.push({ node, rect });
    return { leaves, dividers };
  }
  const { x, y, w, h } = rect;
  if (node.direction === "horizontal") {
    const splitX = x + w * node.ratio;
    collectLayout(node.children[0], { x, y, w: w * node.ratio, h }, leaves, dividers);
    collectLayout(
      node.children[1],
      { x: splitX, y, w: w * (1 - node.ratio), h },
      leaves,
      dividers
    );
    dividers.push({
      splitId: node.id,
      direction: "horizontal",
      parentRect: rect,
      x: splitX,
      y,
    });
  } else {
    const splitY = y + h * node.ratio;
    collectLayout(node.children[0], { x, y, w, h: h * node.ratio }, leaves, dividers);
    collectLayout(
      node.children[1],
      { x, y: splitY, w, h: h * (1 - node.ratio) },
      leaves,
      dividers
    );
    dividers.push({
      splitId: node.id,
      direction: "vertical",
      parentRect: rect,
      x,
      y: splitY,
    });
  }
  return { leaves, dividers };
}

function overlaps(a0: number, al: number, b0: number, bl: number): boolean {
  return a0 < b0 + bl && b0 < a0 + al;
}

/** Find the nearest leaf adjacent to `id` in the given direction, or null. */
export function findNeighbor(
  rects: Record<string, Rect>,
  id: string,
  dir: Direction
): string | null {
  const f = rects[id];
  if (!f) return null;
  const fcx = f.x + f.w / 2;
  const fcy = f.y + f.h / 2;

  let best: string | null = null;
  let bestScore = Infinity;
  for (const [oid, r] of Object.entries(rects)) {
    if (oid === id) continue;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;

    let primary: number;
    let perpOverlap: boolean;
    if (dir === "left") {
      if (cx >= fcx) continue;
      primary = fcx - cx;
      perpOverlap = overlaps(f.y, f.h, r.y, r.h);
    } else if (dir === "right") {
      if (cx <= fcx) continue;
      primary = cx - fcx;
      perpOverlap = overlaps(f.y, f.h, r.y, r.h);
    } else if (dir === "up") {
      if (cy >= fcy) continue;
      primary = fcy - cy;
      perpOverlap = overlaps(f.x, f.w, r.x, r.w);
    } else {
      if (cy <= fcy) continue;
      primary = cy - fcy;
      perpOverlap = overlaps(f.x, f.w, r.x, r.w);
    }
    if (!perpOverlap) continue;

    const perp =
      dir === "left" || dir === "right"
        ? Math.abs(cy - fcy)
        : Math.abs(cx - fcx);
    // Prioritize the primary axis; break ties by perpendicular closeness.
    const score = primary + perp * 0.001;
    if (score < bestScore) {
      bestScore = score;
      best = oid;
    }
  }
  return best;
}
