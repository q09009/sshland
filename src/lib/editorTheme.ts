/**
 * CodeMirror 6 theme built from the central design tokens (see index.css).
 * Like the xterm theme, CodeMirror wants a plain JS object, so it can't use
 * Tailwind classes — it reads the same :root variables via `colorToken`/`token`
 * to stay on the single source of truth (no duplicated hex codes).
 */
import { EditorView } from "@codemirror/view";
import { colorToken, token } from "./theme";

/** A dark CodeMirror theme mirroring the app's ink/slate/sky palette. */
export function editorTheme() {
  const ink900 = colorToken("--color-ink-900");
  const ink800 = colorToken("--color-ink-800");
  const ink700 = colorToken("--color-ink-700");
  const slate200 = colorToken("--color-slate-200");
  const slate400 = colorToken("--color-slate-400");
  const slate500 = colorToken("--color-slate-500");
  const sky400 = colorToken("--color-sky-400");

  return EditorView.theme(
    {
      "&": {
        color: slate200,
        backgroundColor: ink900,
        height: "100%",
        fontSize: "13px",
      },
      ".cm-content": {
        fontFamily: token("--font-terminal"),
        caretColor: sky400,
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: sky400 },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: ink700 },
      ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.03)" },
      ".cm-gutters": {
        backgroundColor: ink900,
        color: slate500,
        border: "none",
        borderRight: `1px solid ${ink800}`,
      },
      ".cm-activeLineGutter": { backgroundColor: ink800, color: slate400 },
      ".cm-scroller": {
        fontFamily: token("--font-terminal"),
        lineHeight: "1.5",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: ink800,
        border: "none",
        color: slate400,
      },
    },
    { dark: true }
  );
}
