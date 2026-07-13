import { useEffect, useState } from "react";
import { writeRemoteFile } from "../api";
import {
  DashboardWidgetInstance,
  useDashboardLayout,
  WIDGET_SIZES,
  WidgetSize,
} from "../lib/dashboardLayout";
import { findMacro, useMacros } from "../lib/macros";
import { buildExportScript } from "../lib/macroRun";
import { dragReorder } from "../lib/reorder";
import { useAppStore } from "../store";
import MacroWidgetCard from "./MacroWidgetCard";
import MacroEditor from "./MacroEditor";
import { PromptDialog } from "./Modal";

/** MIME type carrying a dragged card's index (shared grid; same as WidgetCard). */
const DRAG_TYPE = "application/x-widget-index";
const SPAN: Record<WidgetSize, number> = { small: 1, medium: 2, large: 3 };
const MIN_H: Record<WidgetSize, number> = { small: 120, medium: 156, large: 208 };
const SIZE_LABEL: Record<WidgetSize, string> = { small: "소", medium: "중", large: "대" };

/**
 * Grid card for a macro-backed dashboard widget. Same frame as WidgetCard
 * (drag handle / size / remove, shared drag reorder) but its body is the macro
 * runner (run on demand, no poll timer) and it has an Edit action instead of an
 * interval control. References a saved macro by id via lib/macros.
 */
export default function MacroCard({
  instance,
  index,
}: {
  instance: DashboardWidgetInstance;
  index: number;
}) {
  const macros = useMacros((s) => s.macros);
  const saveMacro = useMacros((s) => s.save);
  const macro = findMacro(macros, instance.widgetId);

  const setSize = useDashboardLayout((s) => s.setSize);
  const moveWidget = useDashboardLayout((s) => s.moveWidget);
  const removeWidget = useDashboardLayout((s) => s.removeWidget);
  const home = useAppStore((s) => s.connection?.home ?? "");

  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  // Auto-dismiss the export confirmation after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const h = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(h);
  }, [toast]);

  const defaultExportPath = () => {
    const slug = (macro?.name.trim() || "macro").replace(/\s+/g, "_");
    if (!home) return `${slug}.sh`;
    return home.endsWith("/") ? `${home}${slug}.sh` : `${home}/${slug}.sh`;
  };

  const doExport = (path: string) => {
    if (!macro) return;
    setExporting(false);
    writeRemoteFile(path, buildExportScript(macro), "UTF-8")
      .then(() => setToast({ ok: true, text: `내보냈어요: ${path}` }))
      .catch((e) =>
        setToast({
          ok: false,
          text: typeof e === "string" ? e : "내보내지 못했어요.",
        })
      );
  };

  const { handleProps, dropProps } = dragReorder(index, moveWidget, DRAG_TYPE);
  const cycleSize = () => {
    const i = WIDGET_SIZES.indexOf(instance.size);
    setSize(instance.instanceId, WIDGET_SIZES[(i + 1) % WIDGET_SIZES.length]);
  };

  return (
    <div
      style={{ gridColumn: `span ${SPAN[instance.size]}` }}
      {...dropProps}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-ink-700/70 bg-ink-800"
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-ink-700/60 px-1.5 text-xs text-slate-400">
        <span
          {...handleProps}
          title="드래그해서 위치 이동"
          className="cursor-grab select-none px-0.5 text-slate-500 hover:text-slate-300 active:cursor-grabbing"
        >
          ⠿
        </span>
        <span className="truncate text-slate-300" title={macro?.name}>
          ⚙ {macro?.name ?? "삭제된 매크로"}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          {macro && (
            <>
              <button
                onClick={() => setExporting(true)}
                title="서버로 .sh 내보내기"
                className="rounded px-1 py-0.5 hover:bg-ink-700 hover:text-slate-100"
              >
                ⬆
              </button>
              <button
                onClick={() => setEditing(true)}
                title="매크로 편집"
                className="rounded px-1 py-0.5 hover:bg-ink-700 hover:text-slate-100"
              >
                ✎
              </button>
            </>
          )}
          <button
            onClick={cycleSize}
            title="카드 크기 변경"
            className="rounded px-1 py-0.5 text-2xs hover:bg-ink-700 hover:text-slate-100"
          >
            {SIZE_LABEL[instance.size]}
          </button>
          <button
            onClick={() => removeWidget(instance.instanceId)}
            title="위젯 제거"
            className="rounded px-1 py-0.5 hover:bg-red-500/20 hover:text-red-300"
          >
            ✕
          </button>
        </span>
      </div>

      {toast && (
        <div
          className={`shrink-0 truncate px-2 py-1 text-2xs ${
            toast.ok
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-red-500/15 text-red-300"
          }`}
          title={toast.text}
        >
          {toast.text}
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-auto p-2.5"
        style={{ minHeight: MIN_H[instance.size] }}
      >
        {macro ? (
          <MacroWidgetCard macro={macro} />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-2xs text-red-300/80">
            이 매크로를 찾을 수 없어요. 삭제되었을 수 있어요.
          </div>
        )}
      </div>

      {editing && macro && (
        <MacroEditor
          initial={macro}
          onSave={(m) => {
            void saveMacro(m);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {exporting && macro && (
        <PromptDialog
          title="서버로 .sh 내보내기"
          initialValue={defaultExportPath()}
          placeholder="예: /home/user/deploy.sh"
          confirmLabel="내보내기"
          onConfirm={doExport}
          onCancel={() => setExporting(false)}
        />
      )}
    </div>
  );
}
