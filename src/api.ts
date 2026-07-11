// Typed wrappers around the Rust Tauri commands.
// Every command rejects with a friendly Korean string on failure.
import { invoke } from "@tauri-apps/api/core";

export type AuthMethod =
  | { type: "password"; password: string }
  | { type: "key"; path: string; passphrase?: string };

export interface ConnectParams {
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
}

export interface ConnectResult {
  /** Absolute path of the starting (home) directory. */
  home: string;
}

export interface FileEntry {
  name: string;
  /** Absolute path on the server. */
  path: string;
  size: number;
  isDir: boolean;
  isSymlink: boolean;
  /** Last-modified time as a Unix timestamp (seconds), or null. */
  modified: number | null;
  /** Unix permission string, e.g. "drwxr-xr-x". */
  permissions: string;
}

/** Open an SSH/SFTP connection. Resolves with the home directory. */
export function connect(params: ConnectParams): Promise<ConnectResult> {
  return invoke<ConnectResult>("connect", { params });
}

/** List the contents of a directory on the server. */
export function listDir(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_dir", { path });
}

/** Download a remote file to a local path (emits `transfer-progress`). */
export function download(
  id: string,
  remotePath: string,
  localPath: string
): Promise<void> {
  return invoke<void>("download", { id, remotePath, localPath });
}

/** Upload a local file to a remote path (emits `transfer-progress`). */
export function upload(
  id: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  return invoke<void>("upload", { id, localPath, remotePath });
}

/** Rename or move a remote entry. */
export function rename(from: string, to: string): Promise<void> {
  return invoke<void>("rename", { from, to });
}

/** Create a new directory. */
export function mkdir(path: string): Promise<void> {
  return invoke<void>("mkdir", { path });
}

/** Delete a file, or a directory and its contents. */
export function deletePath(path: string, isDir: boolean): Promise<void> {
  return invoke<void>("delete", { path, isDir });
}

/** Copy a file or directory to a new path on the server. */
export function copyPath(src: string, dst: string): Promise<void> {
  return invoke<void>("copy", { src, dst });
}

/** Progress event payload emitted during a transfer. */
export interface TransferProgress {
  id: string;
  transferred: number;
  total: number;
}

/** Open a new PTY shell on the connection. `id` is a frontend-generated id. */
export function openTerminal(
  id: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke<void>("open_terminal", { id, cols, rows });
}

/** Send input bytes (keystrokes) to a terminal. */
export function writeTerminal(id: string, data: number[]): Promise<void> {
  return invoke<void>("write_terminal", { id, data });
}

/** Notify a terminal that its window size changed. */
export function resizeTerminal(
  id: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke<void>("resize_terminal", { id, cols, rows });
}

/** Close a terminal channel (SSH connection stays open). */
export function closeTerminal(id: string): Promise<void> {
  return invoke<void>("close_terminal", { id });
}

/** Payload of a `terminal-output` event. */
export interface TerminalOutput {
  id: string;
  data: number[];
}

/** Close the active connection (no-op if already disconnected). */
export function disconnect(): Promise<void> {
  return invoke<void>("disconnect");
}
