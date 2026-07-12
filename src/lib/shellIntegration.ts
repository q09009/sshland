import type { IDisposable, IMarker, Terminal } from "@xterm/xterm";

/**
 * Shell integration: detect where each shell command starts and ends so its
 * output can (later) be rendered as a GUI widget. This is the common base layer
 * shared by every command — it knows nothing about specific commands or how
 * they're parsed/rendered.
 *
 * Mechanism: we inject a small bash snippet that emits OSC 133 markers around
 * the prompt and command (the same scheme VS Code / iTerm2 use):
 *   A = prompt start, B = command input start, C = output start, D = command end.
 * xterm parses these invisibly via an OSC handler; we read the command text
 * (B→C) and output text (C→D) straight from the terminal buffer. Non-bash shells
 * simply never emit the markers, so nothing happens and output stays raw.
 */

/**
 * Bash setup sent once when a terminal opens. `String.raw` keeps the `\033`
 * etc. as literal backslash sequences for the remote shell (not JS escapes).
 * DEBUG traps don't fire inside functions (no `functrace`), so the `__ssl_a`
 * guard is what keeps the C marker to exactly one emit per command.
 */
export const SHELL_INTEGRATION_SETUP =
  String.raw`__ssl_pe(){ if [ -n "$__ssl_a" ]; then printf '\033]133;C\007'; __ssl_a=; fi; }; __ssl_pc(){ local s=$?; printf '\033]133;D;%s\007' "$s"; printf '\033]133;A\007'; __ssl_a=1; }; PROMPT_COMMAND='__ssl_pc'; PS1="$PS1"'\[\e]133;B\a\]'; trap '__ssl_pe' DEBUG` +
  "\n";

/** One captured command: what was typed, its output, and its exit code. */
export interface CommandBlock {
  command: string;
  output: string;
  exitCode: number | null;
  /**
   * A marker anchored at the command's output-start line, for attaching an
   * inline affordance (e.g. a "view as GUI" icon) that scrolls with the buffer.
   * Undefined if the terminal couldn't create one.
   */
  marker?: IMarker;
}

/** Absolute buffer position (line index includes scrollback). */
interface Pos {
  x: number;
  y: number;
}

/**
 * Watch a terminal for OSC 133 command boundaries. Calls `onCommand` once per
 * finished command with its text, output, and exit code. Returns a disposable
 * that unregisters the handler.
 */
export function attachShellIntegration(
  term: Terminal,
  onCommand: (block: CommandBlock) => void
): IDisposable {
  let commandStart: Pos | null = null; // B: where the typed command begins
  let outputStart: Pos | null = null; // C: where the command output begins
  let outputMarker: IMarker | undefined; // anchor at the output-start line
  let command = "";

  const pos = (): Pos => {
    const b = term.buffer.active;
    return { x: b.cursorX, y: b.baseY + b.cursorY };
  };

  const handler = term.parser.registerOscHandler(133, (data) => {
    const semi = data.indexOf(";");
    const kind = semi === -1 ? data : data.slice(0, semi);
    const arg = semi === -1 ? "" : data.slice(semi + 1);

    switch (kind) {
      case "A": // prompt start — nothing to record
        break;
      case "B": // command input start
        commandStart = pos();
        break;
      case "C": // output start; the command line is now complete (B→C)
        outputStart = pos();
        outputMarker = term.registerMarker(0) ?? undefined;
        command = commandStart
          ? readRange(term, commandStart, outputStart).trim()
          : "";
        break;
      case "D": {
        // Command finished. Output is everything between C and here.
        if (outputStart) {
          const output = readRange(term, outputStart, pos());
          const code = arg === "" ? NaN : Number.parseInt(arg, 10);
          onCommand({
            command,
            output,
            exitCode: Number.isNaN(code) ? null : code,
            marker: outputMarker,
          });
        }
        commandStart = null;
        outputStart = null;
        outputMarker = undefined;
        command = "";
        break;
      }
    }
    return true; // handled — don't render the marker
  });

  return handler;
}

/**
 * Read plain text from the terminal buffer between two absolute positions.
 * Wrapped continuation lines are re-joined (no newline) so a single logical
 * line that wrapped is reconstructed. Trailing spaces are kept so column
 * alignment survives (the `columns` parser relies on it).
 */
function readRange(term: Terminal, from: Pos, to: Pos): string {
  const buf = term.buffer.active;
  let out = "";
  for (let y = from.y; y <= to.y; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const startCol = y === from.y ? from.x : 0;
    const endCol = y === to.y ? to.x : undefined;
    out += line.translateToString(false, startCol, endCol);
    if (y < to.y) {
      const next = buf.getLine(y + 1);
      if (!next || !next.isWrapped) out += "\n";
    }
  }
  return out;
}
