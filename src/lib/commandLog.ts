/**
 * Turns a file-manager operation into the CLI command a user would have typed
 * in a real terminal. This is for DISPLAY / LEARNING only: even where SSHland
 * runs an equivalent fixed search command, this formatted string itself is
 * never executed. Keeping conversion here makes every log use the same text.
 */

/** The remote side of an scp command (`user@host`). */
export interface RemoteTarget {
  user: string;
  host: string;
}

/** A file-manager operation, in terms the command formatter understands. */
export type FileOperation =
  | {
      type: "upload";
      localPath: string;
      remoteDir: string;
      remotePath?: string;
      isDir: boolean;
    }
  | { type: "download"; remotePath: string; localName?: string; isDir?: boolean }
  | { type: "delete"; path: string; isDir: boolean }
  | { type: "mkdir"; path: string }
  | { type: "newfile"; path: string }
  | { type: "move"; from: string; to: string }
  | { type: "copy"; from: string; to: string }
  | { type: "chmod"; path: string; mode: number; recursive: boolean }
  | { type: "save"; path: string }
  | { type: "kill"; pid: string; force: boolean }
  | {
      type: "search";
      root: string;
      query: string;
      engine: "find" | "fd" | "fdfind";
      includeHidden: boolean;
    };

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

/** Quote find glob metacharacters so its displayed pattern stays literal. */
function findLiteralPattern(query: string): string {
  let escaped = "";
  for (const character of query) {
    if (
      character === "\\" ||
      character === "*" ||
      character === "?" ||
      character === "["
    ) {
      escaped += "\\";
    }
    escaped += character;
  }
  return `*${escaped}*`;
}

/** Format a single operation as its equivalent terminal command. */
export function operationToCommandString(
  op: FileOperation,
  remote: RemoteTarget,
  language: "ko" | "en" = "en",
): string {
  const host = `${remote.user}@${remote.host}`;
  switch (op.type) {
    case "upload":
      return `scp ${op.isDir ? "-r " : ""}${shellArg(
        "./" + baseName(op.localPath)
      )} ${host}:${shellArg(op.remotePath ?? withTrailingSlash(op.remoteDir))}`;
    case "download":
      return `scp ${op.isDir ? "-r " : ""}${host}:${shellArg(op.remotePath)} ${
        op.localName ? shellArg(`./${op.localName}`) : "./"
      }`;
    case "delete":
      return `rm ${op.isDir ? "-r " : ""}${shellArg(op.path)}`;
    case "mkdir":
      return `mkdir ${shellArg(op.path)}`;
    case "newfile":
      return `touch ${shellArg(op.path)}`;
    case "move":
      return `mv ${shellArg(op.from)} ${shellArg(op.to)}`;
    case "copy":
      return `cp -r ${shellArg(op.from)} ${shellArg(op.to)}`;
    case "chmod":
      return `chmod ${op.recursive ? "-R " : ""}${op.mode
        .toString(8)
        .padStart(3, "0")} ${shellArg(op.path)}`;
    case "save":
      // Saving edits has no single natural shell equivalent (echo/redirect
      // would be misleading), so show a plain descriptive line instead.
      return `${language === "ko" ? "(편집기로 저장)" : "(saved in editor)"} ${shellArg(op.path)}`;
    case "kill":
      // A real, working command (unlike `save`): the dashboard process manager
      // runs exactly this over a one-shot exec.
      return `kill ${op.force ? "-9 " : ""}${op.pid}`;
    case "search": {
      if (op.engine === "find") {
        const prefix = `find ${shellArg(op.root)} -mindepth 1`;
        const pattern = shellArg(findLiteralPattern(op.query));
        return op.includeHidden
          ? `${prefix} -iname ${pattern}`
          : `${prefix} \\( -name '.*' -prune \\) -o \\( -iname ${pattern} -print \\)`;
      }
      const hidden = op.includeHidden ? " --hidden" : "";
      return `${op.engine} --fixed-strings --ignore-case --no-ignore${hidden} -- ${shellArg(op.query)} ${shellArg(op.root)}`;
    }
  }
}
