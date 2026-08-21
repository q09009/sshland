import { useEffect, useState } from "react";
import { Macro, MacroStep } from "../api";
import { newMacroStep } from "../lib/macros";
import { moveItem, useReorder } from "../lib/reorder";
import { useI18n } from "../i18n";

/**
 * Modal for creating or editing a macro: a name plus an ordered list of steps
 * (a short label + a single-line shell command each), with add / remove / drag-
 * reorder (reusing the same DnD reorder as the dashboard grid).
 *
 * v1 limitation: one single-line command per step — no multi-line bodies,
 * heredocs, or loops (a step is one command string). Documented as future work.
 */
export default function MacroEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Macro;
  onSave: (mac: Macro) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [steps, setSteps] = useState<MacroStep[]>(initial.steps);
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const move = (from: number, to: number) =>
    setSteps((s) => moveItem(s, from, to));
  const { itemProps: stepDrag, isDragging: stepsDragging } = useReorder(
    steps.length,
    move
  );

  const setStep = (id: string, patch: Partial<MacroStep>) =>
    setSteps((s) => s.map((st) => (st.id === id ? { ...st, ...patch } : st)));

  const removeStep = (id: string) =>
    setSteps((s) => s.filter((st) => st.id !== id));

  const addStep = () => setSteps((s) => [...s, newMacroStep()]);

  const canSave =
    name.trim() !== "" && steps.some((s) => s.command.trim() !== "");

  const save = () => {
    if (!canSave) return;
    // Drop blank steps; keep order and ids. Default a label from the command.
    const cleaned = steps
      .filter((s) => s.command.trim() !== "")
      .map((s) => ({
        ...s,
        label: s.label.trim() || s.command.trim(),
        command: s.command.trim(),
      }));
    onSave({ ...initial, name: name.trim(), steps: cleaned });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={onCancel}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-100">
            {initial.steps.length || initial.name ? t("macro.edit") : t("macro.editor.new")}
          </h2>
          <button
            onClick={onCancel}
            className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <label className="block text-xs text-slate-400">{t("common.name")}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("macro.editor.namePlaceholder")}
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40"
          />

          <div className="mt-4 mb-1 flex items-center justify-between">
            <span className="text-xs text-slate-400">{t("macro.editor.steps")}</span>
            <button
              onClick={addStep}
              className="rounded-md bg-sky-500/15 px-2 py-1 text-2xs text-sky-200 hover:bg-sky-500/25"
            >
              {t("macro.editor.addStep")}
            </button>
          </div>

          {steps.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink-700 px-3 py-6 text-center text-2xs text-slate-500">
              {t("macro.editor.noSteps")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {steps.map((st, i) => {
                const drag = stepDrag(i);
                return (
                  <li
                    key={st.id}
                    ref={drag.itemRef}
                    className={`flex items-start gap-2 rounded-lg border bg-ink-900/40 p-2 ${
                      drag.dropTarget ? "border-sky-500" : "border-ink-700/60"
                    } ${drag.dragging ? "opacity-40" : ""}`}
                  >
                    <span
                      onMouseDown={drag.onHandleMouseDown}
                      title={t("macro.editor.reorder")}
                      className="mt-1.5 cursor-grab select-none px-0.5 text-slate-500 hover:text-slate-300 active:cursor-grabbing"
                    >
                      ⠿
                    </span>
                    <span className="mt-1.5 w-4 shrink-0 text-center text-2xs text-slate-600">
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <input
                        value={st.label}
                        onChange={(e) => setStep(st.id, { label: e.target.value })}
                        placeholder={t("macro.editor.stepLabelPlaceholder")}
                        spellCheck={false}
                        className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:border-sky-600 focus:outline-none"
                      />
                      <input
                        value={st.command}
                        onChange={(e) => setStep(st.id, { command: e.target.value })}
                        placeholder={t("macro.editor.commandPlaceholder")}
                        spellCheck={false}
                        className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-sky-600 focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={() => removeStep(st.id)}
                      title={t("macro.editor.deleteStep")}
                      className="mt-1 rounded px-1.5 py-0.5 text-slate-500 hover:bg-red-500/20 hover:text-red-300"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-3 text-2xs leading-relaxed text-slate-600">
            {t("macro.editor.help")}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700/60 px-4 py-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-300 hover:bg-ink-700"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {t("common.save")}
          </button>
        </div>
      </div>

      {stepsDragging && (
        <div className="fixed inset-0 z-[60]" style={{ cursor: "grabbing" }} />
      )}
    </div>
  );
}
