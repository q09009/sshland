import { create } from "zustand";
import {
  collectRects,
  Direction,
  findNeighbor,
  firstLeafId,
  makeLeaf,
  PaneContent,
  PaneNode,
  removeLeaf,
  setLeafContent,
  splitLeaf,
  SplitDirection,
  updateRatio,
} from "./lib/panes";

/** A file transfer shown in the transfers panel. */
export interface Transfer {
  id: string;
  name: string;
  kind: "download" | "upload";
  transferred: number;
  total: number;
  status: "active" | "done" | "error";
  error?: string;
}

/** Which top-level screen is shown. */
export type Screen = "connect" | "files";

/** File-listing layout: compact list, detailed table, or large icons. */
export type ViewMode = "list" | "details" | "grid";

/** Details about the live connection, shown in the file manager header. */
export interface ConnectionInfo {
  host: string;
  username: string;
  /** Home directory reported by the server on connect. */
  home: string;
}

interface AppState {
  screen: Screen;
  connection: ConnectionInfo | null;
  /**
   * A message to show on the connect screen after being kicked back there
   * (e.g. the connection dropped). Cleared once shown.
   */
  connectNotice: string | null;

  // Note: per-directory file-manager state (path, entries, view mode, …) lives
  // locally in each FilesScreen so multiple file-manager panes are independent.

  // --- Tiling pane tree ---
  paneTree: PaneNode;
  focusedPaneId: string;
  /** Mark a pane as focused. */
  setFocus: (id: string) => void;
  /** Split the focused pane, adding a new terminal pane and focusing it. */
  splitFocused: (direction: SplitDirection) => void;
  /** Move focus to the nearest pane in a direction. */
  moveFocus: (direction: Direction) => void;
  /** Close a pane; its sibling takes over the space. Last pane can't close. */
  closePane: (id: string) => void;
  /** Set the ratio (0..1) of a split node while dragging its divider. */
  setRatio: (splitId: string, ratio: number) => void;
  /** Switch a pane between the file manager and a terminal. */
  setPaneContent: (id: string, content: PaneContent) => void;

  /** Switch to the file manager after a successful connect. */
  enterFiles: (connection: ConnectionInfo) => void;
  /** Return to the connect screen, optionally with a notice to display. */
  returnToConnect: (notice?: string) => void;
  /** Clear a pending notice once it has been surfaced. */
  clearNotice: () => void;

  // --- Transfers ---
  transfers: Transfer[];
  startTransfer: (t: Omit<Transfer, "transferred" | "status">) => void;
  updateTransfer: (id: string, transferred: number, total: number) => void;
  finishTransfer: (id: string, error?: string) => void;
  dismissTransfer: (id: string) => void;
}

// Placeholder tree until a connection seeds a real one.
const initialLeaf = makeLeaf("file-manager");

export const useAppStore = create<AppState>((set) => ({
  screen: "connect",
  connection: null,
  connectNotice: null,

  paneTree: initialLeaf,
  focusedPaneId: initialLeaf.id,
  setFocus: (id) => set({ focusedPaneId: id }),
  splitFocused: (direction) =>
    set((s) => {
      const term = makeLeaf("terminal");
      return {
        paneTree: splitLeaf(s.paneTree, s.focusedPaneId, direction, term),
        focusedPaneId: term.id,
      };
    }),
  moveFocus: (direction) =>
    set((s) => {
      const next = findNeighbor(
        collectRects(s.paneTree),
        s.focusedPaneId,
        direction
      );
      return next ? { focusedPaneId: next } : {};
    }),
  closePane: (id) =>
    set((s) => {
      const oldRects = collectRects(s.paneTree);
      // Never close the last remaining pane.
      if (Object.keys(oldRects).length <= 1 || !oldRects[id]) return {};

      const paneTree = removeLeaf(s.paneTree, id);
      const newRects = collectRects(paneTree);
      let focusedPaneId = s.focusedPaneId;
      if (!newRects[focusedPaneId]) {
        // Focus the pane nearest the one we just closed.
        const c = oldRects[id];
        const ccx = c.x + c.w / 2;
        const ccy = c.y + c.h / 2;
        let best = firstLeafId(paneTree);
        let bestDist = Infinity;
        for (const [lid, r] of Object.entries(newRects)) {
          const dx = r.x + r.w / 2 - ccx;
          const dy = r.y + r.h / 2 - ccy;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            best = lid;
          }
        }
        focusedPaneId = best;
      }
      return { paneTree, focusedPaneId };
    }),
  setRatio: (splitId, ratio) =>
    set((s) => ({ paneTree: updateRatio(s.paneTree, splitId, ratio) })),
  setPaneContent: (id, content) =>
    set((s) => ({ paneTree: setLeafContent(s.paneTree, id, content) })),

  enterFiles: (connection) => {
    // Start with a single full-screen file-manager pane.
    const fm = makeLeaf("file-manager");
    set({
      screen: "files",
      connection,
      connectNotice: null,
      paneTree: fm,
      focusedPaneId: fm.id,
    });
  },

  returnToConnect: (notice) =>
    set({
      screen: "connect",
      connection: null,
      connectNotice: notice ?? null,
    }),

  clearNotice: () => set({ connectNotice: null }),

  transfers: [],
  startTransfer: (t) =>
    set((s) => ({
      transfers: [
        ...s.transfers,
        { ...t, transferred: 0, status: "active" as const },
      ],
    })),
  updateTransfer: (id, transferred, total) =>
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === id && t.status === "active"
          ? { ...t, transferred, total: total || t.total }
          : t
      ),
    })),
  finishTransfer: (id, error) =>
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === id
          ? {
              ...t,
              status: error ? ("error" as const) : ("done" as const),
              error,
              transferred: error ? t.transferred : t.total,
            }
          : t
      ),
    })),
  dismissTransfer: (id) =>
    set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) })),
}));
