import { create } from "zustand";
import {
  DashboardWidgetConfig,
  loadDashboardWidgetConfigs,
} from "../api";

export type { DashboardWidgetConfig };

/** Find a widget config by its stable `id`, or null. Pure (easy to test). */
export function findWidgetConfig(
  configs: DashboardWidgetConfig[],
  id: string
): DashboardWidgetConfig | null {
  return configs.find((c) => c.id === id) ?? null;
}

interface DashboardWidgetConfigsState {
  configs: DashboardWidgetConfig[];
  loaded: boolean;
  /** (Re)load widget configs from the backend (defaults + user folder). */
  load: () => Promise<void>;
}

export const useDashboardWidgetConfigs = create<DashboardWidgetConfigsState>(
  (set) => ({
    configs: [],
    loaded: false,
    load: async () => {
      try {
        const configs = await loadDashboardWidgetConfigs();
        set({ configs, loaded: true });
      } catch {
        // Backend unavailable — keep whatever we have; feature just stays off.
        set({ loaded: true });
      }
    },
  })
);
