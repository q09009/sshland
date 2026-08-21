import { useEffect, useState } from "react";
import { writeRemoteFile } from "../api";
import {
  DashboardWidgetInstance,
  useDashboardLayout,
  WIDGET_SIZES,
} from "../lib/dashboardLayout";
import { findMacro, useMacros } from "../lib/macros";
import { buildExportScript } from "../lib/macroRun";
import { ReorderItemProps } from "../lib/reorder";
import { useAppStore } from "../store";
import MacroWidgetCard from "./MacroWidgetCard";
import MacroEditor from "./MacroEditor";
import { PromptDialog } from "./Modal";
import {
  DashboardCardAction,
  DashboardCardBody,
  DashboardCardFrame,
  DashboardCardHeader,
} from "./DashboardCardFrame";
import { useI18n } from "../i18n";

/**
 * Grid card for a macro-backed dashboard widget. Same frame as WidgetCard
 * (drag handle / size / remove, shared drag reorder) but its body is the macro
 * runner (run on demand, no poll timer) and it has an Edit action instead of an
 * interval control. References a saved macro by id via lib/macros.
 */
export default function MacroCard({
  instance,
  drag,
}: {
  instance: DashboardWidgetInstance;
  drag: ReorderItemProps;
}) {
  const macros = useMacros((s) => s.macros);
  const saveMacro = useMacros((s) => s.save);
  const macro = findMacro(macros, instance.widgetId);

  const setSize = useDashboardLayout((s) => s.setSize);
  const removeWidget = useDashboardLayout((s) => s.removeWidget);
  const home = useAppStore((s) => s.connection?.home ?? "");

  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const { t } = useI18n();

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
      .then(() => setToast({ ok: true, text: t("macro.export.success", { path }) }))
      .catch((e) =>
        setToast({
          ok: false,
          text: typeof e === "string" ? e : t("macro.export.error"),
        })
      );
  };

  const cycleSize = () => {
    const i = WIDGET_SIZES.indexOf(instance.size);
    setSize(instance.instanceId, WIDGET_SIZES[(i + 1) % WIDGET_SIZES.length]);
  };

  return (
    <DashboardCardFrame size={instance.size} drag={drag}>
      <DashboardCardHeader
        drag={drag}
        title={<>⚙ {macro?.name ?? t("macro.deleted")}</>}
        titleHint={macro?.name}
      >
          {macro && (
            <>
              <DashboardCardAction
                onClick={() => setExporting(true)}
                title={t("macro.export.title")}
              >
                ⬆
              </DashboardCardAction>
              <DashboardCardAction
                onClick={() => setEditing(true)}
                title={t("macro.edit")}
              >
                ✎
              </DashboardCardAction>
            </>
          )}
          <DashboardCardAction
            onClick={cycleSize}
            title={t("dashboard.card.resize")}
            className="text-2xs"
          >
            {t(`dashboard.card.size.${instance.size}` as const)}
          </DashboardCardAction>
          <DashboardCardAction
            onClick={() => removeWidget(instance.instanceId)}
            title={t("dashboard.card.remove")}
            danger
          >
            ✕
          </DashboardCardAction>
      </DashboardCardHeader>

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

      <DashboardCardBody>
        {macro ? (
          <MacroWidgetCard macro={macro} />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-2xs text-red-300/80">
            {t("macro.missing")}
          </div>
        )}
      </DashboardCardBody>

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
          title={t("macro.export.title")}
          initialValue={defaultExportPath()}
          placeholder={t("macro.export.placeholder")}
          confirmLabel={t("macro.export.action")}
          onConfirm={doExport}
          onCancel={() => setExporting(false)}
        />
      )}
    </DashboardCardFrame>
  );
}
