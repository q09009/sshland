// Map a remote file to a CodeMirror language extension for syntax highlighting.
//
// Detection is by extension (or, for extension-less config files, by name). An
// unknown type simply returns null → the file opens as plain text, never an
// error. Languages are statically imported: this is a desktop app loaded from
// disk, so a slightly larger bundle is a fair trade for reliable highlighting.

import { Extension } from "@codemirror/state";
import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { rust } from "@codemirror/lang-rust";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { go } from "@codemirror/legacy-modes/mode/go";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { fileExtension } from "./editable";
import { baseName } from "./path";

/** Wrap a legacy stream-parser mode as a CodeMirror language extension. */
function stream(parser: Parameters<typeof StreamLanguage.define>[0]): Extension {
  return new LanguageSupport(StreamLanguage.define(parser));
}

// Lazily-constructed extensions keyed by a canonical language name, so we only
// build the ones actually used (and reuse them across editor panes).
const builders: Record<string, () => Extension> = {
  javascript: () => javascript({ jsx: true }),
  jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  python: () => python(),
  json: () => json(),
  markdown: () => markdown(),
  yaml: () => yaml(),
  rust: () => rust(),
  html: () => html(),
  css: () => css(),
  xml: () => xml(),
  sql: () => sql(),
  cpp: () => cpp(),
  java: () => java(),
  shell: () => stream(shell),
  toml: () => stream(toml),
  properties: () => stream(properties),
  go: () => stream(go),
  ruby: () => stream(ruby),
  perl: () => stream(perl),
  lua: () => stream(lua),
  dockerfile: () => stream(dockerFile),
  nginx: () => stream(nginx),
  diff: () => stream(diff),
  powershell: () => stream(powerShell),
};
const cache: Record<string, Extension> = {};
function lang(name: string): Extension {
  return (cache[name] ??= builders[name]());
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

/** The syntax-highlighting extension for a file, or null for plain text. */
export function languageForFile(filePath: string): Extension | null {
  const key = languageNameForFile(filePath);
  return key ? lang(key) : null;
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

/** Display label for a file's language, or "텍스트" when none is detected. */
export function languageLabel(filePath: string): string {
  const key = languageNameForFile(filePath);
  return key ? DISPLAY_NAMES[key] ?? key : "텍스트";
}
