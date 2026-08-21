import { create } from "zustand";
import {
  collectRects,
  Direction,
  findEditorLeaf,
  findLeaf,
  findNeighbor,
  firstLeafId,
  makeLeaf,
  PaneContent,
  PaneNode,
  removeLeaf,
  setLeafContent,
  setLeafDirty,
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

/**
 * A multi-item drag-in upload, shown as an overall "N개 중 M개 완료" counter
 * above the per-item transfer cards. Only created when >1 item is dropped.
 */
export interface UploadBatch {
  id: string;
  /** How many top-level files/folders this batch is uploading. */
  total: number;
  /** How many have finished (success or error). */
  done: number;
}

/** One entry in the command-log bar (a file op rendered as a CLI command). */
export interface CommandLogEntry {
  id: string;
  command: string;
  /** Local timestamp (ms) when it was logged. */
  at: number;
}

/** How many recent commands to keep (session-only, shown in the history popup). */
const COMMAND_LOG_MAX = 20;

/** Which top-level screen is shown. */
export type Screen = "connect" | "files";

/** A file/folder being dragged for an in-app move. */
export interface DragItem {
  name: string;
  path: string;
  isDir: boolean;
  /** Directory the item is being dragged from. */
  sourceDir: string;
}

/** File-listing layout: compact list, detailed table, or large icons. */
export type ViewMode = "list" | "details" | "grid";

/** Details about the live connection, shown in the file manager header. */
export interface ConnectionInfo {
  host: string;
  username: string;
  /** Home directory reported by the server on connect. */
  home: string;
  /** Local timestamp (ms) of when the session started, for elapsed-time display. */
  connectedAt: number;
}

/**
 * Health of the live connection, shown in the status bar. "reconnecting" is
 * reserved for future auto-reconnect; today the app drops to the connect screen
 * on loss, so only "connected" is seen while the shell is up.
 */
export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

interface AppState {
  screen: Screen;
  connection: ConnectionInfo | null;
  /** Live connection health, shown in the status bar. */
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;

  /** Whether the settings overlay is open. */
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;

  /**
   * Recent file-manager operations shown as CLI commands, newest first.
   * Session-only (not persisted); reset on app restart.
   */
  commandLog: CommandLogEntry[];
  logCommand: (command: string) => void;
  /**
   * A message to show on the connect screen after being kicked back there
   * (e.g. the connection dropped). Cleared once shown.
   */
  connectNotice: string | null;

  // Note: per-directory file-manager state (path, entries, view mode, …) lives
  // locally in each FilesScreen so multiple file-manager panes are independent.

  /** A copied file/folder, shared across panes for paste. */
  clipboard: { name: string; path: string; isDir: boolean } | null;
  setClipboard: (item: { name: string; path: string; isDir: boolean }) => void;

  /** The file/folder currently being dragged between panes (move), if any. */
  dragItem: DragItem | null;
  setDragItem: (item: DragItem | null) => void;

  /**
   * Bumped after any filesystem mutation so every file-manager pane reloads its
   * directory and they stay in sync.
   */
  fsVersion: number;
  bumpFs: () => void;

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
  /**
   * Request to close a pane. For an editor with unsaved changes this defers to
   * a confirm dialog (via `closeRequest`); otherwise it closes immediately.
   * Every close path (pane ✕, Alt+Shift+W) goes through here.
   */
  requestClose: (id: string) => void;
  /** The editor pane awaiting an unsaved-changes decision, or null. */
  closeRequest: string | null;
  /** Dismiss the unsaved-changes dialog without closing. */
  clearCloseRequest: () => void;
  /** Set the ratio (0..1) of a split node while dragging its divider. */
  setRatio: (splitId: string, ratio: number) => void;
  /** Switch a pane between the file manager and a terminal. */
  setPaneContent: (id: string, content: PaneContent) => void;
  /**
   * Open a remote file in an editor pane. If an editor for that file is already
   * open, just focus it; otherwise split the focused pane and open it beside.
   */
  openEditor: (filePath: string) => void;
  /** Mark an editor pane's unsaved-changes state (drives the dirty indicator
   *  and the unsaved-changes confirm on close). */
  setPaneDirty: (id: string, isDirty: boolean) => void;

  /** Switch to the file manager after a successful connect. */
  enterFiles: (connection: Omit<ConnectionInfo, "connectedAt">) => void;
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

  // --- Multi-item upload batches (overall progress) ---
  uploadBatches: UploadBatch[];
  startBatch: (id: string, total: number) => void;
  advanceBatch: (id: string) => void;
  dismissBatch: (id: string) => void;
}

// Placeholder tree until a connection seeds a real one.
const initialLeaf = makeLeaf("file-manager");

export const useAppStore = create<AppState>((set, get) => ({
  screen: "connect",
  connection: null,
  connectNotice: null,
  connectionStatus: "disconnected",
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  commandLog: [],
  logCommand: (command) =>
    set((s) => ({
      commandLog: [
        { id: crypto.randomUUID(), command, at: Date.now() },
        ...s.commandLog,
      ].slice(0, COMMAND_LOG_MAX),
    })),

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
      return {
        paneTree,
        focusedPaneId,
        closeRequest: s.closeRequest === id ? null : s.closeRequest,
      };
    }),
  setRatio: (splitId, ratio) =>
    set((s) => ({ paneTree: updateRatio(s.paneTree, splitId, ratio) })),
  setPaneContent: (id, content) =>
    set((s) => ({ paneTree: setLeafContent(s.paneTree, id, content) })),
  openEditor: (filePath) =>
    set((s) => {
      const existing = findEditorLeaf(s.paneTree, filePath);
      if (existing) return { focusedPaneId: existing };
      const ed = makeLeaf("editor", filePath);
      return {
        paneTree: splitLeaf(s.paneTree, s.focusedPaneId, "horizontal", ed),
        focusedPaneId: ed.id,
      };
    }),
  setPaneDirty: (id, isDirty) =>
    set((s) => ({ paneTree: setLeafDirty(s.paneTree, id, isDirty) })),

  closeRequest: null,
  requestClose: (id) => {
    const s = get();
    const leaf = findLeaf(s.paneTree, id);
    if (leaf && leaf.content === "editor" && leaf.isDirty) {
      set({ closeRequest: id });
    } else {
      s.closePane(id);
    }
  },
  clearCloseRequest: () => set({ closeRequest: null }),

  enterFiles: (connection) => {
    // Start with a single full-screen file-manager pane.
    const fm = makeLeaf("file-manager");
    set({
      screen: "files",
      connection: { ...connection, connectedAt: Date.now() },
      connectionStatus: "connected",
      connectNotice: null,
      settingsOpen: false,
      paneTree: fm,
      focusedPaneId: fm.id,
    });
  },

  returnToConnect: (notice) =>
    set({
      screen: "connect",
      connection: null,
      connectionStatus: "disconnected",
      settingsOpen: false,
      connectNotice: notice ?? null,
    }),

  clearNotice: () => set({ connectNotice: null }),

  clipboard: null,
  setClipboard: (item) => set({ clipboard: item }),

  dragItem: null,
  setDragItem: (item) => set({ dragItem: item }),

  fsVersion: 0,
  bumpFs: () => set((s) => ({ fsVersion: s.fsVersion + 1 })),

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

  uploadBatches: [],
  startBatch: (id, total) =>
    set((s) => ({ uploadBatches: [...s.uploadBatches, { id, total, done: 0 }] })),
  advanceBatch: (id) =>
    set((s) => ({
      uploadBatches: s.uploadBatches.map((b) =>
        b.id === id ? { ...b, done: b.done + 1 } : b
      ),
    })),
  dismissBatch: (id) =>
    set((s) => ({ uploadBatches: s.uploadBatches.filter((b) => b.id !== id) })),
}));
