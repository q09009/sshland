import { create } from "zustand";
import { useSettings } from "./settings";
import {
  clampInterval,
  DashboardWidgetInstance,
  MIN_REFRESH_SECONDS,
  WIDGET_SIZES,
  WidgetSize,
} from "./dashboardTypes";

// Re-exported so existing imports (`from "./dashboardLayout"`) keep working; the
// definitions live in the leaf `dashboardTypes` module to avoid an import cycle
// with the settings store.
export {
  clampInterval,
  MIN_REFRESH_SECONDS,
  WIDGET_SIZES,
};
export type { DashboardWidgetInstance, WidgetSize };

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

/**
 * Persist the current layout into the settings blob (which saves to disk). Kept
 * out of `setWidgets` so seeding the store from just-loaded settings doesn't
 * immediately write the same data back.
 */
function persist(widgets: DashboardWidgetInstance[]) {
  useSettings.getState().set("dashboardLayout", widgets);
}

export const useDashboardLayout = create<DashboardLayoutState>((set, get) => {
  /** Apply a transform to the widget list, then persist the result. */
  const mutate = (
    fn: (widgets: DashboardWidgetInstance[]) => DashboardWidgetInstance[]
  ) => {
    const widgets = fn(get().widgets);
    set({ widgets });
    persist(widgets);
  };

  return {
    widgets: [],
    // Seeding from persisted settings — does NOT persist (avoids a redundant
    // write of the value we just loaded).
    setWidgets: (widgets) =>
      set({
        widgets: widgets.map((w) => ({
          ...w,
          refreshIntervalSeconds: clampInterval(w.refreshIntervalSeconds),
        })),
      }),
    addWidget: (widgetId, refreshIntervalSeconds) =>
      mutate((widgets) => [
        ...widgets,
        {
          instanceId: crypto.randomUUID(),
          widgetId,
          size: "medium",
          refreshIntervalSeconds: clampInterval(refreshIntervalSeconds),
        },
      ]),
    removeWidget: (instanceId) =>
      mutate((widgets) => widgets.filter((w) => w.instanceId !== instanceId)),
    moveWidget: (from, to) =>
      mutate((widgets) => {
        if (
          from === to ||
          from < 0 ||
          to < 0 ||
          from >= widgets.length ||
          to >= widgets.length
        ) {
          return widgets;
        }
        const next = [...widgets];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      }),
    setSize: (instanceId, size) =>
      mutate((widgets) =>
        widgets.map((w) =>
          w.instanceId === instanceId ? { ...w, size } : w
        )
      ),
    setRefreshInterval: (instanceId, seconds) =>
      mutate((widgets) =>
        widgets.map((w) =>
          w.instanceId === instanceId
            ? { ...w, refreshIntervalSeconds: clampInterval(seconds) }
            : w
        )
      ),
  };
});
