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

/** Open an SSH/SFTP connection. Resolves with the home directory. */
export function connect(params: ConnectParams): Promise<ConnectResult> {
  return invoke<ConnectResult>("connect", { params });
}

/** Close the active connection (no-op if already disconnected). */
export function disconnect(): Promise<void> {
  return invoke<void>("disconnect");
}
