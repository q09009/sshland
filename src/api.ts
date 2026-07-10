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

/** Progress event payload emitted during a transfer. */
export interface TransferProgress {
  id: string;
  transferred: number;
  total: number;
}

/** Close the active connection (no-op if already disconnected). */
export function disconnect(): Promise<void> {
  return invoke<void>("disconnect");
}
