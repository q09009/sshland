import { create } from "zustand";
import { FileEntry, listDir } from "./api";

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

export const useAppStore = create<AppState>((set) => ({
  screen: "connect",
  connection: null,
  connectNotice: null,

  currentPath: "",
  entries: [],
  filesLoading: false,
  filesError: null,
  showHidden: false,
  viewMode: "details",

  enterFiles: (connection) =>
    set({
      screen: "files",
      connection,
      connectNotice: null,
      currentPath: connection.home,
      entries: [],
      filesError: null,
    }),

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
