// Binary-tree model for the tiling layout.
//
// A pane is either a `leaf` (an actual file-manager or terminal view) or a
// `split` with exactly two children laid out horizontally or vertically.

export type PaneContent = "file-manager" | "terminal";
export type SplitDirection = "horizontal" | "vertical";

export interface LeafNode {
  type: "leaf";
  id: string;
  content: PaneContent;
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

export function makeLeaf(content: PaneContent): LeafNode {
  return { type: "leaf", id: newId(content === "terminal" ? "term" : "fm"), content };
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
