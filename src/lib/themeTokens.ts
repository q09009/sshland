/**
 * Advanced, shareable design tokens.
 *
 * The settings UI intentionally exposes only the easy controls. TOML themes
 * may override every token listed here. Keeping an allow-list means a theme
 * can reshape the whole visual system without becoming arbitrary CSS.
 */

export type ThemeTokenKind =
  | "color"
  | "length"
  | "duration"
  | "opacity"
  | "number"
  | "easing"
  | "font"
  | "shadow";

const groups = {
  color: [
    "color-ink-900", "color-ink-800", "color-ink-700", "color-ink-600",
    "color-slate-100", "color-slate-200", "color-slate-300", "color-slate-400",
    "color-slate-500", "color-slate-600",
    "color-sky-200", "color-sky-300", "color-sky-400", "color-sky-500",
    "color-sky-600", "color-sky-950",
    "color-emerald-300", "color-emerald-400", "color-emerald-500",
    "color-amber-400", "color-amber-500",
    "color-red-200", "color-red-300", "color-red-400", "color-red-500",
    "color-red-600", "color-red-950",
    "color-overlay", "color-on-accent", "color-control-knob", "color-symlink",
    "color-surface-pane", "color-surface-card", "color-surface-popover",
    "color-surface-dialog", "color-border-default", "color-text-primary",
    "color-text-secondary", "color-text-muted",
  ],
  font: ["font-sans", "font-mono", "font-terminal"],
  length: [
    "text-editor", "text-terminal", "text-2xs", "text-xs", "text-sm",
    "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl",
    "leading-xs", "leading-sm", "leading-base", "leading-lg", "leading-xl",
    "leading-2xl", "leading-3xl",
    "distance-spatial", "radius-sm", "radius", "radius-md", "radius-lg",
    "radius-xl", "radius-2xl", "radius-full", "radius-editor-tooltip",
    "blur-surface-pane", "space-pane-gap", "space-pane-half-gap",
    "space-pane-edge", "radius-pane", "space-dashboard-inset",
    "space-dashboard-gap", "radius-dashboard-card",
  ],
  number: ["leading-editor", "scale-spatial-enter"],
  duration: ["duration-instant", "duration-fast", "duration-normal", "duration-slow"],
  easing: ["ease-standard", "ease-spatial"],
  opacity: [
    "opacity-surface-pane", "opacity-pane-divider-hover",
    "opacity-pane-divider-active",
  ],
  shadow: [
    "shadow-control", "shadow-popover", "shadow-dialog", "shadow-pane-rest",
    "shadow-pane-focus", "shadow-dashboard-card",
  ],
} as const satisfies Record<ThemeTokenKind, readonly string[]>;

export const THEME_TOKEN_KINDS: Readonly<Record<string, ThemeTokenKind>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(groups).flatMap(([kind, names]) =>
        names.map((name) => [name, kind as ThemeTokenKind]),
      ),
    ),
  );

export const THEME_TOKEN_NAMES = Object.freeze(Object.keys(THEME_TOKEN_KINDS));

export type ThemeTokenValues = Record<string, string>;

const decimal = "(?:0|[1-9]\\d*)(?:\\.\\d+)?";
const lengthPattern = new RegExp(`^${decimal}(?:px|rem|em|%)$`, "i");
const durationPattern = new RegExp(`^${decimal}(?:ms|s)$`, "i");
const unsafeCss = /[;{}<>\u0000-\u001f]|url\s*\(|@import|expression\s*\(/i;

function validEasing(value: string): boolean {
  if (["linear", "ease", "ease-in", "ease-out", "ease-in-out"].includes(value)) {
    return true;
  }
  const match = /^cubic-bezier\(([^)]+)\)$/i.exec(value);
  if (!match) return false;
  const points = match[1].split(",").map((part) => Number(part.trim()));
  return (
    points.length === 4 &&
    points.every((point) => Number.isFinite(point) && Math.abs(point) <= 10) &&
    points[0] >= 0 && points[0] <= 1 && points[2] >= 0 && points[2] <= 1
  );
}

export function isValidThemeTokenValue(name: string, raw: string): boolean {
  const kind = THEME_TOKEN_KINDS[name];
  const value = raw.trim();
  if (!kind || !value || value.length > 320) return false;

  switch (kind) {
    case "color":
      return /^#[0-9a-f]{6}$/i.test(value);
    case "length": {
      if (!lengthPattern.test(value)) return false;
      const numeric = Number.parseFloat(value);
      return Number.isFinite(numeric) && numeric >= 0 && numeric <= 10_000;
    }
    case "duration": {
      if (!durationPattern.test(value)) return false;
      const numeric = Number.parseFloat(value);
      const milliseconds = value.toLowerCase().endsWith("ms") ? numeric : numeric * 1_000;
      return Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds <= 60_000;
    }
    case "opacity": {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1;
    }
    case "number": {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 && numeric <= 10;
    }
    case "easing":
      return validEasing(value);
    case "font":
    case "shadow":
      return !unsafeCss.test(value);
  }
}

export function normalizeThemeTokens(value: unknown): ThemeTokenValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: ThemeTokenValues = {};
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== "string" || !isValidThemeTokenValue(name, raw)) continue;
    result[name] = THEME_TOKEN_KINDS[name] === "color"
      ? raw.trim().toLowerCase()
      : raw.trim();
  }
  return result;
}

export function themeTokenCssValue(name: string, value: string): string {
  if (THEME_TOKEN_KINDS[name] !== "color") return value;
  return [1, 3, 5]
    .map((start) => Number.parseInt(value.slice(start, start + 2), 16))
    .join(" ");
}

export function withoutThemeTokenGroups(
  tokens: ThemeTokenValues,
  names: readonly string[],
): ThemeTokenValues {
  const next = { ...tokens };
  for (const name of names) delete next[name];
  return next;
}

export const ACCENT_THEME_TOKENS = groups.color.filter((name) => name.startsWith("color-sky-"));
export const MOTION_THEME_TOKENS = [
  ...groups.duration,
  ...groups.easing,
  "distance-spatial",
  "scale-spatial-enter",
] as const;
