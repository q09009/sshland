/**
 * Read design tokens (defined in :root, see src/index.css) from JS. Needed for
 * places that can't use a CSS class — xterm.js and CodeMirror both consume
 * plain JS theme objects. Keeps them on the same source of truth as the app.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { DEFAULT_THEME_SETTINGS, type ThemeSettings } from "./settings";
import {
  isValidThemeTokenValue,
  THEME_TOKEN_KINDS,
  THEME_TOKEN_NAMES,
  themeTokenCssValue,
  type ThemeTokenValues,
} from "./themeTokens";

export const THEME_CHANGE_EVENT = "sshland-theme-change";

const DEFAULT_ACCENT = DEFAULT_THEME_SETTINGS.accentColor;
const DEFAULT_ACCENT_RAMP = {
  200: [231, 229, 254],
  300: [210, 206, 253],
  400: [181, 171, 252],
  500: [145, 132, 217],
  600: [121, 108, 191],
  950: [43, 39, 65],
} as const;

const UI_FONTS: Record<ThemeSettings["uiFont"], string> = {
  default:
    '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Malgun Gothic", sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif',
  segoe: '"Segoe UI", "Malgun Gothic", system-ui, sans-serif',
};

const TERMINAL_FONTS: Record<ThemeSettings["terminalFont"], string> = {
  default: '"Cascadia Code", "D2Coding", Consolas, "Courier New", monospace',
  cascadia: '"Cascadia Code", Consolas, "Courier New", monospace',
  d2coding: '"D2Coding", Consolas, "Courier New", monospace',
  consolas: 'Consolas, "Courier New", monospace',
  system: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

/** Read a plain-string token (e.g. a font stack), with whitespace normalized
 *  (a multi-line CSS value keeps its newlines otherwise). */
export function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Read a color token — stored as space-separated RGB channels ("15 23 42") —
 * and return it as a CSS `rgb(...)` string that xterm.js understands.
 */
export function colorToken(name: string): string {
  const channels = token(name).split(/\s+/).join(", ");
  return `rgb(${channels})`;
}

/** Read a pixel-valued token for JS libraries such as xterm. */
export function pixelToken(name: string, fallback: number): number {
  const parsed = Number.parseFloat(token(name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeHex(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function mix(
  base: readonly number[],
  target: readonly number[],
  targetWeight: number,
): [number, number, number] {
  return base.map((channel, index) =>
    Math.round(channel * (1 - targetWeight) + target[index] * targetWeight),
  ) as [number, number, number];
}

/** Build a readable six-step accent ramp from one user-selected base color. */
export function accentRamp(hex: string): Record<string, readonly number[]> {
  const normalized = normalizeHex(hex, DEFAULT_ACCENT);
  if (normalized === DEFAULT_ACCENT) return DEFAULT_ACCENT_RAMP;
  const base = hexToRgb(normalized);
  const white = [255, 255, 255] as const;
  const black = [0, 0, 0] as const;
  return {
    200: mix(base, white, 0.78),
    300: mix(base, white, 0.58),
    400: mix(base, white, 0.3),
    500: base,
    600: mix(base, black, 0.16),
    950: mix(base, black, 0.7),
  };
}

function channelsToHex(value: string): string | null {
  const channels = value.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!channels || channels.length !== 3 || channels.some((channel) => channel < 0 || channel > 255)) {
    return null;
  }
  return `#${channels
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function colorTokenToHex(name: string, seen = new Set<string>()): string | null {
  if (seen.has(name)) return null;
  seen.add(name);
  const value = token(`--${name}`);
  const direct = channelsToHex(value);
  if (direct) return direct;
  const reference = /^var\(--([a-z0-9-]+)\)$/i.exec(value);
  return reference ? colorTokenToHex(reference[1], seen) : null;
}

/** Snapshot every public design token in TOML-friendly form for export. */
export function collectThemeTokens(): ThemeTokenValues {
  const values: ThemeTokenValues = {};
  for (const name of THEME_TOKEN_NAMES) {
    const value = THEME_TOKEN_KINDS[name] === "color"
      ? colorTokenToHex(name)
      : token(`--${name}`);
    if (value && isValidThemeTokenValue(name, value)) values[name] = value;
  }
  return values;
}

function assetUrl(path: string): string | null {
  try {
    return convertFileSrc(path);
  } catch {
    // Plain Vite/browser previews do not expose Tauri's convertFileSrc hook.
    return null;
  }
}

/** Apply the simple settings first, then any advanced TOML token overrides. */
export function applyTheme(theme: ThemeSettings): void {
  const root = document.documentElement;
  for (const name of THEME_TOKEN_NAMES) root.style.removeProperty(`--${name}`);
  const backgroundColor = normalizeHex(
    theme.backgroundColor,
    DEFAULT_THEME_SETTINGS.backgroundColor,
  );
  const accentColor = normalizeHex(theme.accentColor, DEFAULT_ACCENT);
  const backgroundImage = theme.backgroundImagePath
    ? assetUrl(theme.backgroundImagePath)
    : null;

  root.style.setProperty("--app-background-color", backgroundColor);
  root.style.setProperty(
    "--app-background-image",
    backgroundImage ? `url(${JSON.stringify(backgroundImage)})` : "none",
  );
  root.style.setProperty(
    "--app-background-overlay-opacity",
    String(Math.min(90, Math.max(0, theme.backgroundOverlay)) / 100),
  );
  root.dataset.themeHasImage = backgroundImage ? "true" : "false";
  root.dataset.motion = theme.motion;

  const ramp = accentRamp(accentColor);
  for (const [step, channels] of Object.entries(ramp)) {
    root.style.setProperty(`--color-sky-${step}`, channels.join(" "));
  }

  root.style.setProperty("--font-sans", UI_FONTS[theme.uiFont] ?? UI_FONTS.default);
  root.style.setProperty(
    "--font-terminal",
    TERMINAL_FONTS[theme.terminalFont] ?? TERMINAL_FONTS.default,
  );

  for (const [name, value] of Object.entries(theme.tokens)) {
    if (!isValidThemeTokenValue(name, value)) continue;
    root.style.setProperty(`--${name}`, themeTokenCssValue(name, value));
  }

  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
}
