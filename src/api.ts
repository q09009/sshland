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

/**
 * Read a remote text file's whole contents (for the editor pane).
 * Rejects if the file is too large or isn't valid UTF-8 text.
 */
export function readRemoteFile(path: string): Promise<string> {
  return invoke<string>("read_remote_file", { path });
}

/** Overwrite a remote file with new text contents (from the editor pane). */
export function writeRemoteFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_remote_file", { path, contents });
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

/** Read the persisted settings object (empty object on first run). */
export function loadSettings(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("load_settings");
}

/** Persist the whole settings object to disk. */
export function saveSettings(settings: Record<string, unknown>): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

/** A declarative command-GUI config (from a default or user TOML file). */
export interface CommandConfig {
  /** Filename stem; also the override key and settings-list label. */
  name: string;
  source: "default" | "user";
  /** Regex matched against the whole command string. */
  match: string;
  parser: "columns" | "keyvalue" | "regex";
  render: "table" | "keyvalue-card" | "list";
  /** Named-capture regex applied per line (parser = "regex"). */
  capturePattern?: string;
  /** Column whose values get a color gradient (render = "table"). */
  highlightColumn?: string;
}

/** Load + merge command-GUI configs (bundled defaults + user folder). */
export function loadCommandConfigs(): Promise<CommandConfig[]> {
  return invoke<CommandConfig[]>("load_command_configs");
}

/** Absolute path of the user command-config folder (created if missing). */
export function commandsDirPath(): Promise<string> {
  return invoke<string>("commands_dir_path");
}

/** Open the user command-config folder in the OS file manager. */
export function openCommandsDir(): Promise<void> {
  return invoke<void>("open_commands_dir");
}
