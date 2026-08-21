// Map a remote file to a CodeMirror language extension for syntax highlighting.
//
// Detection is by extension (or, for extension-less config files, by name). An
// unknown type simply returns null → the file opens as plain text, never an
// error. The grammars are loaded on demand via dynamic import(): only the
// language a file actually uses is fetched, so the ~220 KB of CodeMirror
// grammars stays out of the main bundle until something needs it. The browser/
// bundler caches each module, and the per-name promise cache below dedupes
// concurrent requests, so re-opening a language never re-fetches.

import { Extension } from "@codemirror/state";
import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { fileExtension } from "./editable";
import { baseName } from "./path";

/** Wrap a legacy stream-parser mode as a CodeMirror language extension. */
function stream(parser: Parameters<typeof StreamLanguage.define>[0]): Extension {
  return new LanguageSupport(StreamLanguage.define(parser));
}

// Dynamic-import loaders keyed by a canonical language name. Each does the
// actual import() of its grammar (a lang package or a legacy stream mode)
// inside the function, so it's only fetched when that language is first opened.
const loaders: Record<string, () => Promise<Extension>> = {
  javascript: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  jsx: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  typescript: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  tsx: async () =>
    (await import("@codemirror/lang-javascript")).javascript({
      jsx: true,
      typescript: true,
    }),
  python: async () => (await import("@codemirror/lang-python")).python(),
  json: async () => (await import("@codemirror/lang-json")).json(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  html: async () => (await import("@codemirror/lang-html")).html(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  xml: async () => (await import("@codemirror/lang-xml")).xml(),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  java: async () => (await import("@codemirror/lang-java")).java(),
  shell: async () =>
    stream((await import("@codemirror/legacy-modes/mode/shell")).shell),
  toml: async () =>
    stream((await import("@codemirror/legacy-modes/mode/toml")).toml),
  properties: async () =>
    stream((await import("@codemirror/legacy-modes/mode/properties")).properties),
  go: async () => stream((await import("@codemirror/legacy-modes/mode/go")).go),
  ruby: async () =>
    stream((await import("@codemirror/legacy-modes/mode/ruby")).ruby),
  perl: async () =>
    stream((await import("@codemirror/legacy-modes/mode/perl")).perl),
  lua: async () =>
    stream((await import("@codemirror/legacy-modes/mode/lua")).lua),
  dockerfile: async () =>
    stream((await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile),
  nginx: async () =>
    stream((await import("@codemirror/legacy-modes/mode/nginx")).nginx),
  diff: async () =>
    stream((await import("@codemirror/legacy-modes/mode/diff")).diff),
  powershell: async () =>
    stream((await import("@codemirror/legacy-modes/mode/powershell")).powerShell),
};

// Per-name promise cache: the first request for a language kicks off its
// import; later requests reuse the same promise (and thus the same resolved
// extension), so a grammar is imported at most once per session.
const cache: Record<string, Promise<Extension>> = {};
function lang(name: string): Promise<Extension> | null {
  const loader = loaders[name];
  if (!loader) return null;
  return (cache[name] ??= loader());
}

/** Extension → canonical language name. */
const BY_EXTENSION: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  ts: "typescript", tsx: "tsx",
  py: "python", pyw: "python",
  json: "json", jsonc: "json", json5: "json",
  md: "markdown", markdown: "markdown", mdx: "markdown",
  yaml: "yaml", yml: "yaml",
  rs: "rust",
  html: "html", htm: "html", xhtml: "html", vue: "html", svelte: "html",
  css: "css", scss: "css", sass: "css", less: "css",
  xml: "xml", svg: "xml", xsl: "xml", xslt: "xml", plist: "xml", rss: "xml",
  sql: "sql",
  c: "cpp", h: "cpp", cpp: "cpp", cc: "cpp", cxx: "cpp",
  hpp: "cpp", hh: "cpp", hxx: "cpp",
  java: "java",
  go: "go",
  rb: "ruby",
  pl: "perl", pm: "perl",
  lua: "lua",
  sh: "shell", bash: "shell", zsh: "shell", ksh: "shell",
  toml: "toml",
  ini: "properties", conf: "properties", cfg: "properties", config: "properties",
  properties: "properties", env: "properties", editorconfig: "properties",
  ps1: "powershell", psm1: "powershell", psd1: "powershell",
  diff: "diff", patch: "diff",
};

/** Exact (lowercased) filename → language, for extension-less config files. */
const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  ".bashrc": "shell", ".bash_profile": "shell", ".bash_aliases": "shell",
  ".zshrc": "shell", ".zprofile": "shell", ".profile": "shell",
  ".env": "properties", ".editorconfig": "properties", ".gitconfig": "properties",
  ".npmrc": "properties", ".inputrc": "properties",
  "nginx.conf": "nginx",
};

/** The canonical language key for a file (e.g. "yaml"), or null for plain text. */
function languageNameForFile(filePath: string): string | null {
  const name = baseName(filePath).toLowerCase();
  return BY_NAME[name] ?? BY_EXTENSION[fileExtension(name)] ?? null;
}

/**
 * Load the syntax-highlighting extension for a file, or null for plain text.
 * Async because the grammar is fetched on demand via import(); the caller
 * should show the file immediately and apply the result once it resolves.
 */
export async function loadLanguageForFile(
  filePath: string
): Promise<Extension | null> {
  const key = languageNameForFile(filePath);
  const pending = key ? lang(key) : null;
  return pending ? pending : null;
}

/** Human-readable label for the detected language, shown in the editor header. */
const DISPLAY_NAMES: Record<string, string> = {
  javascript: "JavaScript", jsx: "JSX", typescript: "TypeScript", tsx: "TSX",
  python: "Python", json: "JSON", markdown: "Markdown", yaml: "YAML",
  rust: "Rust", html: "HTML", css: "CSS", xml: "XML", sql: "SQL",
  cpp: "C/C++", java: "Java", shell: "Shell", toml: "TOML",
  properties: "INI", go: "Go", ruby: "Ruby", perl: "Perl", lua: "Lua",
  dockerfile: "Dockerfile", nginx: "Nginx", diff: "Diff", powershell: "PowerShell",
};

/** Display label for a file's language, or the supplied plain-text label. */
export function languageLabel(filePath: string, plainTextLabel = "Text"): string {
  const key = languageNameForFile(filePath);
  return key ? DISPLAY_NAMES[key] ?? key : plainTextLabel;
}
