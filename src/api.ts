// Typed wrappers around the Rust Tauri commands.
// Every command rejects with a friendly message in the current UI language.
import { invoke } from "@tauri-apps/api/core";
import { localizeBackendError } from "./i18n/errors";

function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args).catch((error) =>
    Promise.reject(localizeBackendError(error)),
  );
}

export type AuthMethod =
  | { type: "password"; password: string }
  | { type: "key"; path: string; passphrase?: string };

export interface ConnectParams {
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  /** Fingerprint explicitly approved after an unknown-host challenge. */
  acceptHostFingerprint?: string;
}

export interface ConnectResult {
  /** Absolute path of the starting (home) directory. */
  home: string;
}

export interface HostKeyError {
  type: "unknownHost" | "hostKeyChanged";
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}

export function isHostKeyError(error: unknown): error is HostKeyError {
  if (!error || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  return (
    (value.type === "unknownHost" || value.type === "hostKeyChanged") &&
    typeof value.host === "string" &&
    typeof value.port === "number" &&
    typeof value.algorithm === "string" &&
    typeof value.fingerprint === "string"
  );
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
  return invoke<ConnectResult>("connect", { params }).catch((error: unknown) => {
    if (isHostKeyError(error)) return Promise.reject(error);
    if (error && typeof error === "object") {
      const value = error as Record<string, unknown>;
      if (value.type === "message" && typeof value.message === "string") {
        return Promise.reject(localizeBackendError(value.message));
      }
    }
    return Promise.reject(localizeBackendError(error));
  });
}

/** Forget one saved host key. The next connection still requires approval. */
export function forgetHostKey(host: string, port: number): Promise<void> {
  return invokeCommand<void>("forget_host_key", { host, port });
}

/** List the contents of a directory on the server. */
export function listDir(path: string): Promise<FileEntry[]> {
  return invokeCommand<FileEntry[]>("list_dir", { path });
}

/** Download a remote file to a local path (emits `transfer-progress`). */
export function download(
  id: string,
  remotePath: string,
  localPath: string
): Promise<void> {
  return invokeCommand<void>("download", { id, remotePath, localPath });
}

export interface UploadResult {
  isDir: boolean;
}

/** Upload a local file or folder to a remote path (emits `transfer-progress`). */
export function upload(
  id: string,
  localPath: string,
  remotePath: string
): Promise<UploadResult> {
  return invokeCommand<UploadResult>("upload", { id, localPath, remotePath });
}

/** Copy a selected image into the app-owned theme folder. */
export function importThemeBackground(sourcePath: string): Promise<string> {
  return invokeCommand<string>("import_theme_background", { sourcePath });
}

/** Remove the app-owned theme background image. */
export function clearThemeBackground(): Promise<void> {
  return invokeCommand<void>("clear_theme_background");
}

/** Rename or move a remote entry. */
export function rename(from: string, to: string): Promise<void> {
  return invokeCommand<void>("rename", { from, to });
}

/** Create a new directory. */
export function mkdir(path: string): Promise<void> {
  return invokeCommand<void>("mkdir", { path });
}

/** Create a new, empty file. Rejects if something already exists at the path. */
export function createFile(path: string): Promise<void> {
  return invokeCommand<void>("create_file", { path });
}

/** Delete a file, or a directory and its contents. */
export function deletePath(path: string, isDir: boolean): Promise<void> {
  return invokeCommand<void>("delete", { path, isDir });
}

/** Copy a file or directory to a new path on the server. */
export function copyPath(src: string, dst: string): Promise<void> {
  return invokeCommand<void>("copy", { src, dst });
}

/**
 * Run a single command once over a short-lived exec channel and resolve with
 * its raw stdout. Used by dashboard widgets (polled on a timer) and the process
 * manager's kill action — shares the existing SSH worker, no dedicated channel.
 */
export function pollWidgetCommand(command: string): Promise<string> {
  return invokeCommand<string>("poll_widget_command", { command });
}

/**
 * Kill a process by PID (the dashboard process manager's row action). Reuses the
 * one-shot exec (poll_widget_command / Req::RunOnce) rather than a second worker
 * request. The PID is validated numeric here so the built command can never be
 * anything but `kill [-9] <number>`.
 */
export function killProcess(pid: string, force: boolean): Promise<string> {
  if (!/^\d+$/.test(pid)) {
    return Promise.reject(localizeBackendError("sshland:error:errors.invalidProcessId"));
  }
  const command = `kill ${force ? "-9 " : ""}${pid}`;
  return invokeCommand<string>("poll_widget_command", { command });
}

/**
 * Kill a whole process GROUP by its group id (== the group leader's PID, since
 * a macro run backgrounds its shell via `setsid` — see ssh.rs's
 * wrap_macro_script — which makes the PID double as the PGID). Used to stop a
 * running macro: a plain (non-PTY) exec channel has no line discipline to turn
 * a client-side interrupt into SIGINT, so actually terminating the remote
 * process(es) requires sending a real signal via a one-shot exec instead —
 * reuses the same poll_widget_command mechanism as killProcess, just targeting
 * the group (a negative id) so children a step spawns (e.g. `sleep 100`) are
 * signaled too, not just the orphaned parent shell. The id is validated
 * numeric (same as killProcess) so the built command can only ever be
 * `kill [-9] -<number>`.
 */
export function killProcessGroup(pgid: string, force: boolean): Promise<string> {
  if (!/^\d+$/.test(pgid)) {
    return Promise.reject(localizeBackendError("sshland:error:errors.invalidProcessId"));
  }
  const command = `kill ${force ? "-9 " : ""}-${pgid}`;
  return invokeCommand<string>("poll_widget_command", { command });
}

/**
 * Check whether a process group is still alive: `kill -0` sends no signal but
 * succeeds (silently) if the group still exists. Used to decide whether Stop
 * needs to escalate to a force kill after a short grace period.
 */
export function isProcessGroupAlive(pgid: string): Promise<boolean> {
  if (!/^\d+$/.test(pgid)) return Promise.resolve(false);
  return invokeCommand<string>("poll_widget_command", { command: `kill -0 -${pgid}` })
    .then(() => true)
    .catch(() => false);
}

/** A remote file's decoded text plus the encoding it was stored in. */
export interface FileContent {
  content: string;
  /** e.g. "UTF-8", "EUC-KR" — pass back to writeRemoteFile to keep it. */
  encoding: string;
}

/**
 * Read a remote text file (for the editor pane). Non-UTF-8 files are decoded
 * via their detected encoding; rejects only if too large or truly binary.
 */
export function readRemoteFile(path: string): Promise<FileContent> {
  return invokeCommand<FileContent>("read_remote_file", { path });
}

/**
 * Overwrite a remote file with new text (from the editor pane), re-encoding to
 * `encoding` (the value returned by readRemoteFile) so the file keeps it.
 */
export function writeRemoteFile(
  path: string,
  contents: string,
  encoding: string
): Promise<void> {
  return invokeCommand<void>("write_remote_file", { path, contents, encoding });
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
  rows: number,
  setup: string
): Promise<void> {
  return invokeCommand<void>("open_terminal", { id, cols, rows, setup });
}

/** Send input bytes (keystrokes) to a terminal. */
export function writeTerminal(id: string, data: number[]): Promise<void> {
  return invokeCommand<void>("write_terminal", { id, data });
}

/** Notify a terminal that its window size changed. */
export function resizeTerminal(
  id: string,
  cols: number,
  rows: number
): Promise<void> {
  return invokeCommand<void>("resize_terminal", { id, cols, rows });
}

/** Close a terminal channel (SSH connection stays open). */
export function closeTerminal(id: string): Promise<void> {
  return invokeCommand<void>("close_terminal", { id });
}

/** Payload of a `terminal-output` event. */
export interface TerminalOutput {
  id: string;
  data: number[];
}

/** Close the active connection (no-op if already disconnected). */
export function disconnect(): Promise<void> {
  return invokeCommand<void>("disconnect");
}

/** Read the persisted settings object (empty object on first run). */
export function loadSettings(): Promise<Record<string, unknown>> {
  return invokeCommand<Record<string, unknown>>("load_settings");
}

/** Persist the whole settings object to disk. */
export function saveSettings(settings: Record<string, unknown>): Promise<void> {
  return invokeCommand<void>("save_settings", { settings });
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
  return invokeCommand<CommandConfig[]>("load_command_configs");
}

/** Absolute path of the user command-config folder (created if missing). */
export function commandsDirPath(): Promise<string> {
  return invokeCommand<string>("commands_dir_path");
}

/** Open the user command-config folder in the OS file manager. */
export function openCommandsDir(): Promise<void> {
  return invokeCommand<void>("open_commands_dir");
}

/**
 * A declarative dashboard-widget config (from a default or user TOML file).
 * Parallel to CommandConfig but polled on a timer (fixed `command`, no `match`).
 */
export interface DashboardWidgetConfig {
  /** Filename stem; the override key and settings-list label. */
  name: string;
  source: "default" | "user";
  /** Stable widget id referenced by a persisted dashboard layout. */
  id: string;
  /** Human-friendly title shown on the card and in the picker. */
  label: string;
  /** The command run on each poll (one-shot exec). */
  command: string;
  parser: "columns" | "keyvalue" | "regex";
  render: "gauge" | "table" | "keyvalue-card" | "list";
  /** Named-capture regex applied per line (parser = "regex"). */
  capturePattern?: string;
  /** Column whose values get a color gradient (render = "table"). */
  highlightColumn?: string;
  /** Which parsed field holds the numeric percentage (render = "gauge"). */
  valueField?: string;
  /** Unit suffix shown after a gauge's number (e.g. "%"). */
  unit?: string;
  /** Emoji shown next to the widget in the picker. */
  icon?: string;
  /** One-line description shown in the picker. */
  description?: string;
  /** Optional built-in beginner-friendly view; parser/render stays detailed. */
  simpleView?: "disk" | "network" | "process" | "docker";
  category: "monitoring" | "process-manager";
  /**
   * Suggested poll interval. Optional — when a widget omits it, the app's global
   * default interval is used on add. The UI clamps user edits to a 2s minimum.
   */
  refreshIntervalSeconds?: number;
}

/** Load + merge dashboard-widget configs (bundled defaults + user folder). */
export function loadDashboardWidgetConfigs(): Promise<DashboardWidgetConfig[]> {
  return invokeCommand<DashboardWidgetConfig[]>("load_dashboard_widget_configs");
}

/** Absolute path of the user dashboard-widget folder (created if missing). */
export function dashboardWidgetsDirPath(): Promise<string> {
  return invokeCommand<string>("dashboard_widgets_dir_path");
}

/** One step of a macro: a short label plus the shell command to run. */
export interface MacroStep {
  id: string;
  label: string;
  command: string;
}

/** A user-authored macro: a named, ordered list of shell steps. */
export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
}

/** Load every saved macro (one JSON file per macro in the macros folder). */
export function listMacros(): Promise<Macro[]> {
  return invokeCommand<Macro[]>("list_macros");
}

/** Save (create or overwrite) one macro as `<id>.json`. */
export function saveMacro(mac: Macro): Promise<void> {
  return invokeCommand<void>("save_macro", { mac });
}

/** Delete one macro file by id. */
export function deleteMacro(id: string): Promise<void> {
  return invokeCommand<void>("delete_macro", { id });
}

/** Absolute path of the user macro folder (created if missing). */
export function macrosDirPath(): Promise<string> {
  return invokeCommand<string>("macros_dir_path");
}

/**
 * Run a macro: the frontend-assembled `script` (all steps joined with sentinel
 * echoes) is exec'd over one non-PTY channel, streaming `macro-output` events
 * keyed by `runId`. Resolves once the channel is open; progress arrives as events.
 */
export function runMacro(runId: string, script: string): Promise<void> {
  return invokeCommand<void>("run_macro", { runId, script });
}

/** Stop a running macro by closing its exec channel (terminates the script). */
export function stopMacro(runId: string): Promise<void> {
  return invokeCommand<void>("stop_macro", { runId });
}

/** Payload of a `macro-output` event: a chunk of the run's combined stdout/stderr. */
export interface MacroOutput {
  runId: string;
  data: number[];
}

/** Payload of a `macro-closed` event: the run's exec channel has finished. */
export interface MacroClosed {
  runId: string;
}
