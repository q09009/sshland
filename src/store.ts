import { create } from "zustand";
import { FileEntry, listDir } from "./api";
import {
  collectRects,
  Direction,
  findNeighbor,
  firstLeafId,
  makeLeaf,
  PaneNode,
  removeLeaf,
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

/** Folders first, then files, each group sorted case-insensitively by name. */
function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

interface AppState {
  screen: Screen;
  connection: ConnectionInfo | null;
  /**
   * A message to show on the connect screen after being kicked back there
   * (e.g. the connection dropped). Cleared once shown.
   */
  connectNotice: string | null;

  // --- File manager state ---
  currentPath: string;
  entries: FileEntry[];
  filesLoading: boolean;
  filesError: string | null;
  /** Whether dot-files are shown in the listing. */
  showHidden: boolean;
  /** Current file-listing layout. */
  viewMode: ViewMode;

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

  /** Switch to the file manager after a successful connect. */
  enterFiles: (connection: ConnectionInfo) => void;
  /** Return to the connect screen, optionally with a notice to display. */
  returnToConnect: (notice?: string) => void;
  /** Clear a pending notice once it has been surfaced. */
  clearNotice: () => void;
  /** Load (or reload) a directory and make it the current one. */
  loadDir: (path: string) => Promise<void>;
  /** Toggle visibility of dot-files. */
  toggleHidden: () => void;
  /** Change the file-listing layout. */
  setViewMode: (mode: ViewMode) => void;

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

  currentPath: "",
  entries: [],
  filesLoading: false,
  filesError: null,
  showHidden: false,
  viewMode: "details",

  enterFiles: (connection) => {
    // Start with a single full-screen file-manager pane.
    const fm = makeLeaf("file-manager");
    set({
      screen: "files",
      connection,
      connectNotice: null,
      currentPath: connection.home,
      entries: [],
      filesError: null,
      paneTree: fm,
      focusedPaneId: fm.id,
    });
  },

  returnToConnect: (notice) =>
    set({
      screen: "connect",
      connection: null,
      connectNotice: notice ?? null,
      currentPath: "",
      entries: [],
      filesError: null,
    }),

  clearNotice: () => set({ connectNotice: null }),

  loadDir: async (path) => {
    set({ filesLoading: true, filesError: null, currentPath: path });
    try {
      const entries = await listDir(path);
      // Ignore if we navigated elsewhere while this request was in flight.
      set((s) =>
        s.currentPath === path
          ? { entries: sortEntries(entries), filesLoading: false }
          : {}
      );
    } catch (err) {
      const message =
        typeof err === "string" ? err : "폴더를 불러오지 못했어요.";
      set((s) =>
        s.currentPath === path
          ? { filesError: message, filesLoading: false }
          : {}
      );
    }
  },

  toggleHidden: () => set((s) => ({ showHidden: !s.showHidden })),
  setViewMode: (mode) => set({ viewMode: mode }),

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
