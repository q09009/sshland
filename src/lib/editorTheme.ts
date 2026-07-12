/**
 * CodeMirror 6 theme built from the central design tokens (see index.css).
 * Like the xterm theme, CodeMirror wants a plain JS object, so it can't use
 * Tailwind classes — it reads the same :root variables via `colorToken`/`token`
 * to stay on the single source of truth (no duplicated hex codes).
 */
import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { colorToken, token } from "./theme";

/** A dark CodeMirror theme mirroring the app's ink/slate/sky palette. */
export function editorTheme() {
  const ink900 = colorToken("--color-ink-900");
  const ink800 = colorToken("--color-ink-800");
  const ink700 = colorToken("--color-ink-700");
  const ink600 = colorToken("--color-ink-600");
  const slate100 = colorToken("--color-slate-100");
  const slate200 = colorToken("--color-slate-200");
  const slate400 = colorToken("--color-slate-400");
  const slate500 = colorToken("--color-slate-500");
  const sky400 = colorToken("--color-sky-400");
  // Build a translucent color from a token's raw channels ("56 189 248").
  const rgba = (name: string, a: number) =>
    `rgba(${token(name).split(/\s+/).join(", ")}, ${a})`;

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
      // Bracket matching + same-text selection matches.
      "&.cm-focused .cm-matchingBracket": {
        backgroundColor: rgba("--color-sky-400", 0.2),
        outline: `1px solid ${rgba("--color-sky-400", 0.4)}`,
      },
      "&.cm-focused .cm-nonmatchingBracket": {
        backgroundColor: rgba("--color-red-500", 0.2),
      },
      ".cm-selectionMatch": { backgroundColor: rgba("--color-sky-400", 0.13) },
      // Search / replace panel, styled to match the dark theme.
      ".cm-panels": {
        backgroundColor: ink800,
        color: slate200,
        borderTop: `1px solid ${ink700}`,
      },
      ".cm-panel.cm-search": { padding: "6px 8px" },
      ".cm-panel.cm-search label": { fontSize: "11px", color: slate400 },
      ".cm-textfield": {
        backgroundColor: ink900,
        color: slate200,
        border: `1px solid ${ink700}`,
        borderRadius: "4px",
        padding: "2px 6px",
      },
      ".cm-textfield:focus": { outline: `1px solid ${sky400}` },
      ".cm-button": {
        backgroundColor: ink700,
        backgroundImage: "none",
        color: slate200,
        border: "none",
        borderRadius: "4px",
        padding: "2px 8px",
      },
      ".cm-button:hover": { backgroundColor: ink600 },
      ".cm-completionIcon": { color: slate400 },
      ".cm-tooltip": {
        backgroundColor: ink800,
        color: slate200,
        border: `1px solid ${ink700}`,
        borderRadius: "6px",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: rgba("--color-sky-400", 0.2),
        color: slate100,
      },
    },
    { dark: true }
  );
}

/**
 * Syntax-highlighting colors, built from the design tokens so highlighting
 * matches the app palette (the CodeMirror default style targets light
 * backgrounds and reads poorly on our dark ink surface).
 */
export function editorHighlight() {
  const slate100 = colorToken("--color-slate-100");
  const slate200 = colorToken("--color-slate-200");
  const slate400 = colorToken("--color-slate-400");
  const slate500 = colorToken("--color-slate-500");
  const sky200 = colorToken("--color-sky-200");
  const sky300 = colorToken("--color-sky-300");
  const sky400 = colorToken("--color-sky-400");
  const emerald = colorToken("--color-emerald-500");
  const amber = colorToken("--color-amber-400");
  const red = colorToken("--color-red-400");

  return HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: sky300 },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: slate500, fontStyle: "italic" },
    { tag: [t.string, t.special(t.string), t.docString, t.attributeValue], color: emerald },
    { tag: [t.regexp], color: emerald },
    { tag: [t.escape, t.character], color: amber },
    { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: amber },
    { tag: [t.propertyName], color: sky200 },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: sky200 },
    { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: slate100 },
    { tag: [t.variableName, t.name], color: slate200 },
    { tag: [t.typeName, t.className, t.namespace, t.self, t.constant(t.variableName)], color: amber },
    { tag: [t.tagName], color: red },
    { tag: [t.attributeName], color: amber },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: slate400 },
    { tag: [t.meta, t.processingInstruction], color: slate500 },
    { tag: [t.heading], color: sky300, fontWeight: "bold" },
    { tag: [t.strong], fontWeight: "bold" },
    { tag: [t.emphasis], fontStyle: "italic" },
    { tag: [t.strikethrough], textDecoration: "line-through" },
    { tag: [t.link, t.url], color: sky400, textDecoration: "underline" },
    { tag: [t.invalid], color: red },
  ]);
}
