/**
 * Pure helpers for running a macro: assembling the shell script that runs its
 * steps sequentially in ONE shell (so cd/exports persist across steps), and
 * parsing the streamed output back into per-step status + captured output.
 *
 * The script emits a unique sentinel line after each step —
 * `___SSHLAND_STEP_<token>___<stepId>___<exitCode>___` — which we control and
 * parse out of the `macro-output` stream (the same "read markers out of a
 * stream" idea as shellIntegration.ts's OSC 133 handling, but simpler since this
 * headless channel isn't a visible terminal, so no OSC codes are needed).
 *
 * Stop-on-error is baked into the script (safe by default): after each step, if
 * its exit code is non-zero the script `exit`s, so later steps never run and are
 * reported as skipped.
 */

import { Macro } from "../api";

export type MacroStepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export interface MacroStepState {
  stepId: string;
  status: MacroStepStatus;
  /** Output captured for this step (stdout+stderr, sentinel line excluded). */
  output: string;
  /** The step's exit code once it finished, else null. */
  exitCode: number | null;
}

const SENTINEL_PREFIX = "___SSHLAND_STEP_";

/** A short, unique per-run token so a step's own output can't fake a sentinel. */
export function makeRunToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

/**
 * Assemble the full script. Each step runs, then a sentinel echoes its id +
 * exit code; a non-zero exit stops the whole run (stop-on-error). `exec 2>&1`
 * merges stderr into stdout so the single streamed channel carries everything.
 */
export function buildMacroScript(macro: Macro, token: string): string {
  const lines: string[] = ["exec 2>&1"];
  for (const step of macro.steps) {
    lines.push(step.command);
    lines.push(
      `__rc=$?; echo "${SENTINEL_PREFIX}${token}___${step.id}___${"$"}{__rc}___"; [ "$__rc" -eq 0 ] || exit "$__rc"`
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Assemble a macro as a real, standalone shell script for "export to server":
 * a `#!/bin/bash` shebang, a `# <label>` comment above each step, and one raw
 * command per line. Unlike buildMacroScript this has NO sentinel echoes or
 * `exec 2>&1` — those are only for the app's own run-time progress tracking, not
 * wanted in a script the user keeps and runs themselves.
 */
export function buildExportScript(macro: Macro): string {
  const lines = ["#!/bin/bash", "", `# ${macro.name}`, ""];
  for (const step of macro.steps) {
    const label = step.label.trim();
    if (label) lines.push(`# ${label}`);
    lines.push(step.command);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Strip this run's sentinel marker lines from raw output, for display in the
 * live view. The markers are purely internal bookkeeping (see buildMacroScript
 * / parseMacroStream) and would look like confusing noise to the user, who
 * only cares about their commands' actual output.
 */
export function stripSentinels(text: string, token: string): string {
  const re = new RegExp(
    `${SENTINEL_PREFIX}${token}___[0-9a-zA-Z-]+___\\d+___\\r?\\n?`,
    "g"
  );
  return text.replace(re, "");
}

interface Marker {
  stepId: string;
  exitCode: number;
  start: number;
  end: number;
}

/** Strip a single leading and trailing newline (the sentinel sits on its own line). */
function trimEdges(s: string): string {
  return s.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

/**
 * Turn the full accumulated run output into per-step state. Pure: given the same
 * buffer + steps + token it always yields the same result, so the widget can
 * re-derive state on every streamed chunk.
 *
 * - A step with a sentinel → success (exit 0) or failed (non-zero), output = the
 *   text since the previous sentinel.
 * - The first step without a sentinel → running (while the run is open), output
 *   = the trailing text; later steps stay pending.
 * - Once the run is closed, any step still without a sentinel → skipped (it
 *   never ran, because an earlier step failed / the run was stopped).
 */
export function parseMacroStream(
  fullOutput: string,
  steps: { id: string }[],
  token: string,
  closed: boolean
): MacroStepState[] {
  const result: MacroStepState[] = steps.map((s) => ({
    stepId: s.id,
    status: "pending",
    output: "",
    exitCode: null,
  }));
  const indexOfStep = new Map(steps.map((s, i) => [s.id, i]));

  const re = new RegExp(
    `${SENTINEL_PREFIX}${token}___([0-9a-zA-Z-]+)___(\\d+)___`,
    "g"
  );
  const markers: Marker[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullOutput)) !== null) {
    markers.push({
      stepId: m[1],
      exitCode: Number.parseInt(m[2], 10),
      start: m.index,
      end: re.lastIndex,
    });
  }

  let segStart = 0;
  for (const mk of markers) {
    const idx = indexOfStep.get(mk.stepId);
    if (idx != null) {
      result[idx].output = trimEdges(fullOutput.slice(segStart, mk.start));
      result[idx].status = mk.exitCode === 0 ? "success" : "failed";
      result[idx].exitCode = mk.exitCode;
    }
    segStart = mk.end;
  }

  const trailing = trimEdges(fullOutput.slice(segStart));
  let assignedRunning = false;
  for (const step of result) {
    if (step.status !== "pending") continue;
    if (closed) {
      step.status = "skipped";
    } else if (!assignedRunning) {
      step.status = "running";
      step.output = trailing;
      assignedRunning = true;
    }
    // remaining pending steps stay pending until they run
  }

  return result;
}
