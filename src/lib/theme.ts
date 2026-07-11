/**
 * Read design tokens (defined in :root, see src/index.css) from JS. Needed for
 * places that can't use a CSS class — currently the xterm.js terminal, whose
 * theme is a plain JS object. Keeps the terminal on the same single source of
 * truth as the rest of the app instead of duplicating hex codes.
 */

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
