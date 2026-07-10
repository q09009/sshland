import { create } from "zustand";

/** Which top-level screen is shown. */
export type Screen = "connect" | "files";

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

  /** Switch to the file manager after a successful connect. */
  enterFiles: (connection: ConnectionInfo) => void;
  /** Return to the connect screen, optionally with a notice to display. */
  returnToConnect: (notice?: string) => void;
  /** Clear a pending notice once it has been surfaced. */
  clearNotice: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: "connect",
  connection: null,
  connectNotice: null,

  enterFiles: (connection) =>
    set({ screen: "files", connection, connectNotice: null }),
  returnToConnect: (notice) =>
    set({ screen: "connect", connection: null, connectNotice: notice ?? null }),
  clearNotice: () => set({ connectNotice: null }),
}));
