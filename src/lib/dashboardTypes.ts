/**
 * Shared dashboard types + pure helpers, kept in a leaf module (no store or
 * component imports) so both the layout store and the settings store can
 * reference them without forming an import cycle.
 */

/** Card size class within the dashboard grid. */
export type WidgetSize = "small" | "medium" | "large";

/**
 * One placed widget on the dashboard: a reference to a widget config (by its
 * stable `widgetId`) plus per-instance display settings. Multiple instances of
 * the same widget are allowed, so each has its own `instanceId`.
 */
export interface DashboardWidgetInstance {
  instanceId: string;
  /**
   * References a config id: a DashboardWidgetConfig id when `source` is
   * "widget" (a monitoring/process widget), or a Macro id when "macro".
   */
  widgetId: string;
  /** Where widgetId resolves. Absent (older layouts) means "widget". */
  source?: "widget" | "macro";
  size: WidgetSize;
  /** Poll interval in seconds (widget source only); never below MIN_REFRESH_SECONDS. */
  refreshIntervalSeconds: number;
}

/**
 * The smallest allowed poll interval. Enforced by clampInterval (and the UI
 * input) so a widget can never poll the server / worker faster than this.
 */
export const MIN_REFRESH_SECONDS = 2;

/** Order the size classes cycle through when the size button is clicked. */
export const WIDGET_SIZES: WidgetSize[] = ["small", "medium", "large"];

/** Clamp a requested interval to the enforced minimum (and to an integer). */
export function clampInterval(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_REFRESH_SECONDS;
  return Math.max(MIN_REFRESH_SECONDS, Math.round(seconds));
}
