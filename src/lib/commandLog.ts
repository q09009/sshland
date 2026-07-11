/**
 * Turns a file-manager operation into the CLI command a user would have typed
 * in a real terminal. This is for DISPLAY / LEARNING only — the app performs
 * the operation over SFTP, never by running these strings. Keeping the
 * conversion here (pure, reusable) means the log bar and anything else can
 * render the same friendly command text.
 */

/** The remote side of an scp command (`user@host`). */
export interface RemoteTarget {
  user: string;
  host: string;
}

/** A file-manager operation, in terms the command formatter understands. */
export type FileOperation =
  | { type: "upload"; localPath: string; remoteDir: string }
  | { type: "download"; remotePath: string }
  | { type: "delete"; path: string; isDir: boolean }
  | { type: "mkdir"; path: string }
  | { type: "move"; from: string; to: string }
  | { type: "copy"; from: string; to: string };

/** Last path segment, handling both `/` and `\` separators. */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * Quote a path for the displayed command only when it contains characters that
 * would break a real shell command. Clean paths stay unquoted (readable, like
 * the examples); messy ones get single-quoted so the shown command still works.
 */
function shellArg(p: string): string {
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

function withTrailingSlash(p: string): string {
  return p.endsWith("/") ? p : `${p}/`;
}

/** Format a single operation as its equivalent terminal command. */
export function operationToCommandString(
  op: FileOperation,
  remote: RemoteTarget
): string {
  const host = `${remote.user}@${remote.host}`;
  switch (op.type) {
    case "upload":
      return `scp ${shellArg("./" + baseName(op.localPath))} ${host}:${shellArg(
        withTrailingSlash(op.remoteDir)
      )}`;
    case "download":
      return `scp ${host}:${shellArg(op.remotePath)} ./`;
    case "delete":
      return `rm ${op.isDir ? "-r " : ""}${shellArg(op.path)}`;
    case "mkdir":
      return `mkdir ${shellArg(op.path)}`;
    case "move":
      return `mv ${shellArg(op.from)} ${shellArg(op.to)}`;
    case "copy":
      return `cp -r ${shellArg(op.from)} ${shellArg(op.to)}`;
  }
}
