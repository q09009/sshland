import { create } from "zustand";
import { FileEntry, listDir } from "./api";

/** Which top-level screen is shown. */
export type Screen = "connect" | "files";

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

  /** Switch to the file manager after a successful connect. */
  enterFiles: (connection: ConnectionInfo) => void;
  /** Return to the connect screen, optionally with a notice to display. */
  returnToConnect: (notice?: string) => void;
  /** Clear a pending notice once it has been surfaced. */
  clearNotice: () => void;
  /** Load (or reload) a directory and make it the current one. */
  loadDir: (path: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  screen: "connect",
  connection: null,
  connectNotice: null,

  currentPath: "",
  entries: [],
  filesLoading: false,
  filesError: null,

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
}));
