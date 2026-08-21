import { ButtonHTMLAttributes, ReactNode } from "react";
import { WidgetSize } from "../lib/dashboardLayout";
import { ReorderItemProps } from "../lib/reorder";
import { useI18n } from "../i18n";

export function DashboardCardFrame({
  size,
  drag,
  children,
}: {
  size: WidgetSize;
  drag: ReorderItemProps;
  children: ReactNode;
}) {
  return (
    <section
      ref={drag.itemRef}
      data-size={size}
      data-drop-target={drag.dropTarget || undefined}
      data-dragging={drag.dragging || undefined}
      className="dashboard-card flex min-w-0 flex-col overflow-hidden"
    >
      {children}
    </section>
  );
}

export function DashboardCardHeader({
  drag,
  title,
  titleHint,
  busy,
  children,
}: {
  drag: ReorderItemProps;
  title: ReactNode;
  titleHint?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="dashboard-card-header flex h-8 shrink-0 items-center gap-1.5 px-2 text-xs text-slate-400">
      <span
        onMouseDown={drag.onHandleMouseDown}
        title={t("dashboard.card.move")}
        className="cursor-grab px-0.5 text-slate-600 hover:text-slate-300 active:cursor-grabbing select-none"
      >
        ⠿
      </span>
      <span
        className="min-w-0 flex-1 truncate font-medium text-slate-300"
        title={titleHint}
      >
        {title}
      </span>
      {busy && <span className="text-2xs text-sky-400">{t("dashboard.card.refreshing")}</span>}
      <span className="flex shrink-0 items-center gap-0.5">{children}</span>
    </header>
  );
}

export function DashboardCardBody({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard-card-body min-h-0 flex-1 overflow-auto p-3">
      {children}
    </div>
  );
}

export function DashboardCardAction({
  danger,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      data-danger={danger || undefined}
      className={`dashboard-card-action rounded px-1.5 py-0.5 ${
        danger ? "" : "hover:text-slate-200"
      } ${className}`}
      {...props}
    />
  );
}
