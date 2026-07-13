import { create } from "zustand";

/** Card size class within the dashboard grid. */
export type WidgetSize = "small" | "medium" | "large";

/**
 * One placed widget on the dashboard: a reference to a widget config (by its
 * stable `widgetId`) plus per-instance display settings. Multiple instances of
 * the same widget are allowed, so each has its own `instanceId`.
 */
export interface DashboardWidgetInstance {
  instanceId: string;
  /** References DashboardWidgetConfig.id in the merged catalog. */
  widgetId: string;
  size: WidgetSize;
  /** Poll interval in seconds; never below MIN_REFRESH_SECONDS. */
  refreshIntervalSeconds: number;
}

/**
 * The smallest allowed poll interval. Enforced here (clamp) as well as in the
 * UI input so a widget can never hammer the server / worker faster than this.
 */
export const MIN_REFRESH_SECONDS = 2;

/** Order the size classes cycle through when the size button is clicked. */
export const WIDGET_SIZES: WidgetSize[] = ["small", "medium", "large"];

/** Clamp a requested interval to the enforced minimum (and to an integer). */
export function clampInterval(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_REFRESH_SECONDS;
  return Math.max(MIN_REFRESH_SECONDS, Math.round(seconds));
}

interface DashboardLayoutState {
  /** The single shared dashboard layout (persisted in a later step). */
  widgets: DashboardWidgetInstance[];
  /** Replace the whole layout (used when loading persisted settings). */
  setWidgets: (widgets: DashboardWidgetInstance[]) => void;
  /** Append a widget instance for `widgetId` with the given default interval. */
  addWidget: (widgetId: string, refreshIntervalSeconds: number) => void;
  /** Remove a widget instance by its instanceId. */
  removeWidget: (instanceId: string) => void;
  /** Move the instance at `from` to index `to` (drag reorder). */
  moveWidget: (from: number, to: number) => void;
  /** Set a widget instance's card size. */
  setSize: (instanceId: string, size: WidgetSize) => void;
  /** Set a widget instance's poll interval (clamped to the minimum). */
  setRefreshInterval: (instanceId: string, seconds: number) => void;
}

export const useDashboardLayout = create<DashboardLayoutState>((set) => ({
  widgets: [],
  setWidgets: (widgets) =>
    set({
      widgets: widgets.map((w) => ({
        ...w,
        refreshIntervalSeconds: clampInterval(w.refreshIntervalSeconds),
      })),
    }),
  addWidget: (widgetId, refreshIntervalSeconds) =>
    set((s) => ({
      widgets: [
        ...s.widgets,
        {
          instanceId: crypto.randomUUID(),
          widgetId,
          size: "medium",
          refreshIntervalSeconds: clampInterval(refreshIntervalSeconds),
        },
      ],
    })),
  removeWidget: (instanceId) =>
    set((s) => ({
      widgets: s.widgets.filter((w) => w.instanceId !== instanceId),
    })),
  moveWidget: (from, to) =>
    set((s) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= s.widgets.length ||
        to >= s.widgets.length
      ) {
        return {};
      }
      const widgets = [...s.widgets];
      const [moved] = widgets.splice(from, 1);
      widgets.splice(to, 0, moved);
      return { widgets };
    }),
  setSize: (instanceId, size) =>
    set((s) => ({
      widgets: s.widgets.map((w) =>
        w.instanceId === instanceId ? { ...w, size } : w
      ),
    })),
  setRefreshInterval: (instanceId, seconds) =>
    set((s) => ({
      widgets: s.widgets.map((w) =>
        w.instanceId === instanceId
          ? { ...w, refreshIntervalSeconds: clampInterval(seconds) }
          : w
      ),
    })),
}));
