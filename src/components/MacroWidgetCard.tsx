import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Macro, MacroClosed, MacroOutput, runMacro, stopMacro } from "../api";
import {
  MacroStepState,
  MacroStepStatus,
  buildMacroScript,
  makeRunToken,
  parseMacroStream,
  stripSentinels,
} from "../lib/macroRun";

/** Initial (idle) per-step state: everything pending, no output. */
function idleSteps(macro: Macro): MacroStepState[] {
  return macro.steps.map((s) => ({
    stepId: s.id,
    status: "pending" as MacroStepStatus,
    output: "",
    exitCode: null,
  }));
}

const STATUS_ICON: Record<MacroStepStatus, string> = {
  pending: "○",
  running: "⟳",
  success: "✓",
  failed: "✗",
  skipped: "⊘",
};
const STATUS_CLASS: Record<MacroStepStatus, string> = {
  pending: "text-slate-500",
  running: "text-sky-400 animate-spin",
  success: "text-emerald-400",
  failed: "text-red-400",
  skipped: "text-slate-600",
};

/**
 * A dashboard card for one macro: shows its ordered steps with a live status
 * icon each, a Run button, and each step expandable to its captured output.
 * Macros run on demand (no polling timer). Streams progress by listening to
 * `macro-output`/`macro-closed` and re-deriving state via parseMacroStream.
 */
export default function MacroWidgetCard({ macro }: { macro: Macro }) {
  const [steps, setSteps] = useState<MacroStepState[]>(() => idleSteps(macro));
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The full raw stream for the live view below the step list — explicit React
  // state (not just the textRef accumulator) so it re-renders on every chunk
  // without depending on parseMacroStream/steps at all.
  const [rawOutput, setRawOutput] = useState("");
  const rawViewRef = useRef<HTMLPreElement>(null);

  const runIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string>("");
  const textRef = useRef<string>("");
  const decoderRef = useRef<TextDecoder>(new TextDecoder());
  const stepsRef = useRef(macro.steps);
  stepsRef.current = macro.steps;

  // Auto-scroll the live view to the bottom as new output streams in.
  useEffect(() => {
    const el = rawViewRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rawOutput]);

  // Reset the display when the macro's steps change (e.g. it was edited).
  const stepSig = macro.steps.map((s) => s.id).join(",");
  useEffect(() => {
    setSteps(idleSteps(macro));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepSig]);

  // Subscribe once to the streamed run events; filter by the active run id.
  useEffect(() => {
    const outSub = listen<MacroOutput>("macro-output", (e) => {
      if (e.payload.runId !== runIdRef.current) return;
      textRef.current += decoderRef.current.decode(
        new Uint8Array(e.payload.data),
        { stream: true }
      );
      setRawOutput(textRef.current);
      setSteps(parseMacroStream(textRef.current, stepsRef.current, tokenRef.current, false));
    });
    const closeSub = listen<MacroClosed>("macro-closed", (e) => {
      if (e.payload.runId !== runIdRef.current) return;
      setRawOutput(textRef.current);
      setSteps(parseMacroStream(textRef.current, stepsRef.current, tokenRef.current, true));
      setRunning(false);
      setStopping(false);
      runIdRef.current = null;
    });
    return () => {
      outSub.then((f) => f());
      closeSub.then((f) => f());
    };
  }, []);

  const run = async () => {
    if (running || macro.steps.length === 0) return;
    const runId = crypto.randomUUID();
    const token = makeRunToken();
    runIdRef.current = runId;
    tokenRef.current = token;
    textRef.current = "";
    decoderRef.current = new TextDecoder();
    setError(null);
    setExpanded(new Set());
    setRawOutput(""); // clear the live view for the new run
    // First step shows as running immediately.
    setSteps(parseMacroStream("", macro.steps, token, false));
    setRunning(true);
    try {
      await runMacro(runId, buildMacroScript(macro, token));
    } catch (e) {
      setError(typeof e === "string" ? e : "매크로를 실행하지 못했어요.");
      setRunning(false);
      runIdRef.current = null;
    }
  };

  // Stop closes the exec channel, which ends the remote script; the resulting
  // `macro-closed` event finalizes the display (in-flight step → skipped).
  const stop = async () => {
    const runId = runIdRef.current;
    if (!runId || stopping) return;
    setStopping(true);
    try {
      await stopMacro(runId);
    } catch {
      // If the stop call itself fails, let the run finish on its own.
      setStopping(false);
    }
  };

  // The live view hides the internal sentinel markers — the user only cares
  // about their commands' actual output, not our bookkeeping.
  const liveText = stripSentinels(rawOutput, tokenRef.current);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const labelFor = (id: string) =>
    macro.steps.find((s) => s.id === id)?.label || "(이름 없음)";

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={run}
          disabled={running || macro.steps.length === 0}
          className="rounded-md bg-sky-600 px-2.5 py-1 text-2xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
        >
          {running ? "실행 중…" : "▶ 실행"}
        </button>
        {running && (
          <button
            onClick={stop}
            disabled={stopping}
            className="rounded-md border border-red-500/40 px-2.5 py-1 text-2xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-40"
          >
            {stopping ? "중지 중…" : "■ 중지"}
          </button>
        )}
        {error && <span className="truncate text-2xs text-red-300">{error}</span>}
      </div>

      {macro.steps.length === 0 ? (
        <p className="text-2xs text-slate-500">단계가 없어요. 매크로를 편집해 추가하세요.</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
          {steps.map((st) => {
            const open = expanded.has(st.stepId);
            const hasOutput = st.output.trim() !== "";
            return (
              <li key={st.stepId} className="rounded border border-ink-700/40">
                <button
                  onClick={() => hasOutput && toggle(st.stepId)}
                  className={`flex w-full items-center gap-1.5 px-1.5 py-1 text-left text-2xs ${
                    hasOutput ? "hover:bg-ink-700/30" : "cursor-default"
                  }`}
                >
                  <span className={`w-3 shrink-0 text-center ${STATUS_CLASS[st.status]}`}>
                    {STATUS_ICON[st.status]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-300">
                    {labelFor(st.stepId)}
                  </span>
                  {st.exitCode != null && st.exitCode !== 0 && (
                    <span className="shrink-0 text-red-400">exit {st.exitCode}</span>
                  )}
                  {hasOutput && (
                    <span className="shrink-0 text-slate-600">{open ? "▾" : "▸"}</span>
                  )}
                </button>
                {open && hasOutput && (
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words border-t border-ink-700/40 bg-ink-900/50 px-2 py-1 font-mono text-2xs text-slate-400">
                    {st.output}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Live view of the whole run's raw combined stream, separate from each
          step's retrospective expandable output: this answers "what's
          happening right now", the per-step expand answers "what did step N
          produce". Only shown once a run has started (cleared at the next
          run's start). */}
      {(running || rawOutput.trim() !== "") && (
        <div className="mt-2 flex shrink-0 flex-col overflow-hidden rounded border border-ink-700/40">
          <div className="border-b border-ink-700/40 bg-ink-800 px-2 py-0.5 text-2xs uppercase tracking-wide text-slate-500">
            실시간 출력
          </div>
          <pre
            ref={rawViewRef}
            className="max-h-28 overflow-auto whitespace-pre-wrap break-words bg-ink-900 px-2 py-1 font-mono text-2xs text-slate-400"
          >
            {liveText.trim() === "" ? "…" : liveText}
          </pre>
        </div>
      )}
    </div>
  );
}
