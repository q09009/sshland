import type { DashboardWidgetConfig } from "../api";
import type { TranslationKey } from "../i18n/ko";
import type { Translator } from "../i18n";

const BUILT_IN_TEXT: Record<
  string,
  { label: TranslationKey; description: TranslationKey }
> = {
  "cpu-usage": {
    label: "dashboard.widget.cpu.label",
    description: "dashboard.widget.cpu.description",
  },
  "mem-usage": {
    label: "dashboard.widget.memory.label",
    description: "dashboard.widget.memory.description",
  },
  "disk-usage": {
    label: "dashboard.widget.disk.label",
    description: "dashboard.widget.disk.description",
  },
  "load-average": {
    label: "dashboard.widget.load.label",
    description: "dashboard.widget.load.description",
  },
  "network-io": {
    label: "dashboard.widget.network.label",
    description: "dashboard.widget.network.description",
  },
  "process-manager": {
    label: "dashboard.widget.process.label",
    description: "dashboard.widget.process.description",
  },
};

function builtInText(config: DashboardWidgetConfig) {
  return config.source === "default" ? BUILT_IN_TEXT[config.id] : undefined;
}

export function dashboardWidgetLabel(
  config: DashboardWidgetConfig,
  t: Translator,
): string {
  const text = builtInText(config);
  return text ? t(text.label) : config.label;
}

export function dashboardWidgetDescription(
  config: DashboardWidgetConfig,
  t: Translator,
): string | undefined {
  const text = builtInText(config);
  return text ? t(text.description) : config.description;
}
