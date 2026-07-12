# SSHland

A beginner-friendly SSH/SFTP GUI client. Tauri 2 (Rust) + React + TypeScript + Vite + Tailwind + zustand.

## Core Philosophy

- **Lightweight first**: think hard about necessity before adding any heavy dependency.
- **Targets beginners**: every error shown to the user must be a natural, non-technical sentence (in Korean) — centrally managed in `src-tauri/src/error.rs`.
- **UI**: minimal dark theme. Color/spacing/font/radius literals live in **one place only — design tokens (`:root` in `src/index.css`)** — see the "Design Tokens" section below. Never hardcode hex/px directly in components.
- **Destructive actions** (deletion, etc.) always go through a confirmation dialog.
- **Passwords stay in memory only**: never persisted to disk, never logged (types holding secrets must not derive `Debug`).
- **User configs are declarative only, never executed as code**: never build a structure where a user-editable config file (e.g. the command-GUI TOML files) can run arbitrary JS/scripts — this app handles SSH credentials and server access, so trusting and executing third-party config as code is never acceptable. Parsing/render rules are expressed as declarative data only.
- **Silently fall back when wrong**: a parse/match failure or an unregistered case is never treated as an error — it falls back naturally to raw output. A GUI rendering must always be toggleable back to the original.

## Architecture

### One connection, fully owned by a worker thread

The `ssh2` crate (built against the WinCNG backend on Windows, so no OpenSSL/Perl/NASM toolchain is required) is **single-thread-only** per session, so the SSH `Session` + `Sftp` + every PTY terminal channel are owned by **one Rust worker thread** (`worker_loop` in `src-tauri/src/ssh.rs`).

- The frontend (Tauri async commands) sends requests over a `std::sync::mpsc::Sender<Req>` and receives replies via `tokio::sync::oneshot`.
- The worker runs a **cooperative polling loop**:
  - With no terminals open, it blocks on `cmd_rx.recv()` (0% CPU).
  - With at least one terminal open, the session switches to non-blocking mode and polls every channel roughly every 15ms (`TERMINAL_POLL`), batching each channel's output into a single `terminal-output` event.
- SFTP operations (list/download/upload/rename/delete/copy/mkdir) are handled blockingly inside this same worker.
- Disconnect detection: when any operation fails, a cheap `sftp.realpath(".")` round-trip confirms whether the connection is truly dead → if so, emits a `connection-lost` event and the worker exits.
- `copy` runs **server-side `cp -r` over an exec channel** so data never passes through the client (not a download-then-reupload over SFTP).

### Frontend state separation principle

- **Global store (zustand, `src/store.ts`)**: connection info, the pane tree (tiling), the transfer (upload/download) list, the clipboard (copy), drag state, `fsVersion` (a counter for broadcasting filesystem changes).
- **Per-pane local state for the file manager**: current path, listing, loading/error, view mode, and the hidden-files toggle live in each `FilesScreen` component's local `useState`. **Never put these in the global store** — it used to be global and caused a bug where "opening two file managers makes them move together" (commit `78b3e13`).
  - When a pane performs a file operation (delete/move/copy, etc.), it bumps `fsVersion` via `bumpFs()`, and every `FilesScreen` instance detects this and silently refreshes (`reloadSilently`).

### Tiling pane tree (Hyprland-style, partial feature set)

Implemented as pure functions in `src/lib/panes.ts`:
- `PaneNode` = a `LeafNode` (`file-manager` | `terminal` | `editor`; an `editor` leaf also carries `filePath`/`isDirty`) or a `SplitNode` (`horizontal`/`vertical`, a `ratio`, and a binary tree of two children).
- `splitLeaf`/`removeLeaf`/`setLeafContent`/`updateRatio`/`setLeafDirty`: immutable tree operations.
- `findLeaf`/`findEditorLeaf`: locate a leaf by id, or an editor leaf by its file (for open-reuse).
- `collectRects`/`findNeighbor`: geometry calculations for arrow-key focus movement.
- `collectLayout`: converts the tree into a **flat list of leaves + absolute coordinates (%)**.

**Important — rendering must always be flat:** `src/components/PaneView.tsx` does **not** recursively render the tree as nested components. Instead it takes the leaves from `collectLayout` and absolutely positions them as a flat `<div>` list keyed by `key={leaf.id}`. Without this, restructuring the tree (e.g. closing a pane) makes React mistake it for a component-type change and unmount a sibling terminal that should have survived (= destroying its PTY channel) — a real bug fixed in commit `cdd64a2`.

Keyboard shortcuts (`src/components/TilingShell.tsx`, registered on the capture phase):
- `Alt+Shift+H` / `Alt+Shift+V`: split the focused pane horizontally/vertically; the new pane opens as a terminal
- `Alt+Arrow`: move focus to the adjacent pane
- `Alt+Shift+W`: close the focused pane (the last remaining pane can't be closed)
- Drag a divider to adjust the split ratio; the ⇄ button in a pane's header switches it between file manager and terminal

### Terminal (xterm.js)

`src/components/TerminalPane.tsx`: opens the PTY on mount (`open_terminal`) and only closes the channel on unmount (`close_terminal`; the SSH connection stays alive). For performance, **an unfocused terminal buffers its output and flushes it in batches every ~200ms (5fps)**, while the focused terminal reflects output immediately. Gaining focus triggers an immediate flush.

### Editor pane (CodeMirror 6) — the third pane type

`src/components/EditorPane.tsx`: a lightweight text/code editor, opened by **double-clicking a text file** in the file manager. It's the third leaf type (`editor`) and reuses all the existing tiling logic. **CodeMirror 6 was chosen over Monaco** to stay light (core is ~3 small packages; language grammars are added on top).

- **Read/write is in-memory SFTP — no local temp file.** Opening calls `read_remote_file` (Rust `sftp.open` → read the whole file into a `String`); saving (Ctrl/Cmd+S or the header 저장 button) calls `write_remote_file` (`sftp.create` truncates + writes the whole buffer). The content lives only in the client-side CodeMirror doc, never a file on local disk — unlike download/upload, which stream to/from a chosen local path. (Editing has to run client-side, so the file's bytes do round-trip through the client's memory; this is *not* a fully server-side operation like `copy`'s `cp -r`.)
- **What may be opened** (`lib/editable.ts`): an **extension denylist** (`isProbablyBinary` — images/video/audio/archives/executables/docs/fonts/db; `svg` is treated as text). Unknown / extension-less files (`.bashrc`, `Makefile`, a bare `config`) are **allowed**, since server config files often have no extension. The backend `read_remote_file` is the real safety net: it refuses files ≥5MB (`MAX_EDIT_SIZE`, mirrored as `MAX_EDITABLE_SIZE`) and anything **truly binary** (contains a null byte, or can't be decoded cleanly), with a friendly error. Binary-by-extension or oversized files aren't opened — the file manager offers to **download** them instead, and any read error inside `EditorPane` also surfaces a download button.
- **Non-UTF-8 text is supported** (`decode_text`/`encode_text` in `ssh.rs`, pure + unit-tested). UTF-8 is the fast path; otherwise the encoding is guessed with **chardetng** and transcoded to UTF-8 with **encoding_rs**. `read_remote_file` returns `{ content, encoding }`; the editor echoes `encoding` back to `write_remote_file`, which **re-encodes to the same bytes** so a CP949/EUC-KR (etc.) file keeps its original encoding on save (never silently rewritten to UTF-8). A non-UTF-8 file shows its encoding as an amber badge in the header. A file that can't decode cleanly is treated as binary (editing could corrupt it).
- **Opens beside, with reuse.** `store.openEditor(filePath)` splits the focused pane **horizontally** and puts the editor on the right; re-opening the same file just focuses the existing editor leaf (`findEditorLeaf`). The editor renders **its own header** (path + undo/redo/find toolbar + language/encoding badges + 저장 + ✕) instead of the shared `PaneHeader`, which stays for file-manager/terminal.
- **New file → straight into the editor.** The file manager's "새 파일" (File menu + empty-area right-click, next to "새 폴더") prompts for a name, calls `create_file` (backend `create_empty_file`: `sftp.stat` existence check → `open_mode(WRITE|CREATE|TRUNCATE)`, so an existing file is never clobbered — a name clash returns `error::already_exists()`), then `openEditor`s the new empty file so the user can type immediately. Logged as `touch <path>`.
- **Dirty tracking.** The doc is compared to the last saved/loaded baseline — **length-first, full string compare only when lengths match**, so typing in a large file doesn't serialize it every keystroke. Dirty shows as an amber ● by the filename and is mirrored onto the leaf (`setPaneDirty` → `setLeafDirty`) so the close guard can see it.
- **Unsaved-changes close guard.** Every close path (editor ✕, shared pane-header ✕, `Alt+Shift+W`) routes through `store.requestClose(id)`: a **dirty editor defers** to `UnsavedChangesDialog` (저장 / 저장 안 함 / 취소) via `store.closeRequest`; everything else closes immediately. Save-and-close only closes if the write succeeded. `closePane` also clears a stale `closeRequest` for the removed pane.
- **Syntax highlighting** (`lib/languages.ts`): language auto-detected from the extension (or exact filename, for extension-less configs), mapped to a CodeMirror grammar — lang packages for js/ts, python, json, markdown, **yaml (`.yaml` and `.yml` alike)**, rust, html, css, xml/svg, sql, cpp/c, java, plus `@codemirror/legacy-modes` stream parsers for shell, toml, ini/properties, go, ruby, perl, lua, dockerfile, nginx, diff, powershell. Unknown → plain text (never an error). Languages are **statically imported** (bundle grew ~+220 KB gzip; fine for a disk-loaded desktop app — dynamic-import code-splitting is a possible future optimization). The dark `HighlightStyle` (`editorHighlight`) is built from the design tokens, since CodeMirror's default style targets light backgrounds.
- **Coding conveniences**: search/replace panel (Ctrl+F), bracket matching, auto-closing brackets, indent-on-input, same-text selection-match highlight, and CodeMirror's built-in keyword autocomplete (completions come from the grammar where available — no heavy LSP). Auto-close bracket insertion rides CodeMirror's real input path, which **can't be driven headlessly** (same limit as xterm decorations) — confirm by typing in the real app.
- **The CodeMirror theme + all its panels/tooltip are themed dark from the design tokens** (`editorTheme` in `lib/editorTheme.ts`, read via `token`/`colorToken` like the xterm theme — CodeMirror themes are JS objects, not CSS classes). A small local `rgba()` helper builds translucent token colors for highlight overlays.
- **Save in the command-log bar**: a save has no honest shell equivalent (`echo`/redirect would misrepresent it), so `operationToCommandString` renders a descriptive `(편집기로 저장) <path>` line (a new `save` case) instead of a fake command.

### OS drag-in upload (local → server)

OS file drops do **not** arrive via the standard browser `ondrop` — they only come through Tauri's native `getCurrentWebview().onDragDropEvent(...)` event (subscribed once on mount in `FilesScreen.tsx`). `dragDropEnabled` must be at its `tauri.conf.json` default of `true` for the event to fire at all.

**The target pane is determined by cursor position, not focus.** The event fires once per window (webview), so every open `FilesScreen`'s listener runs — each pane checks **whether the cursor is inside its own root rect** (`rootRef.getBoundingClientRect()` containment test) and only that pane reacts. Terminal panes have no `FilesScreen` so they're automatically ignored, and since a drop never changes focus, a position check is the only correct approach. (It used to be focus-based, which caused uploads to land in the wrong pane when two panes were open.)

- The payload's `position` is in **physical pixels** (`PhysicalPosition`), so it must be divided by `window.devicePixelRatio` to convert to CSS coordinates matching `getBoundingClientRect` (otherwise it's off whenever Windows display scaling isn't 100%).
- Multiple files upload sequentially. For `>1` files, `store.uploadBatches` creates a batch so `TransfersPanel` shows an overall "M of N complete" progress above the individual cards. Per-file progress still follows the existing `transfer-progress` flow.
- **Folders are rejected by the backend** (`upload_file`) — if `std::fs::metadata` reports a directory, it returns "폴더는 업로드할 수 없어요…" (folders can't be uploaded). The frontend has no clean way to tell whether a local path is a folder (avoiding adding an fs plugin just for that), so the backend blocks it and the frontend shows an error card.
- The hover highlight is **scoped to that pane only** (the pane root is `relative`, and the overlay is `absolute inset-0` with a dashed border) — not a window-wide `fixed` overlay.

### Top status bar + settings (a layer separate from the pane tiling)

The files screen (`App.tsx`) is a **vertical flex**: `StatusBar` (fixed height `h-8`, `shrink-0`) on top, the tiling area (`flex-1 min-h-0`) below. The tiling system only occupies that lower region. Settings render as a modal overlay (`fixed inset-0`) outside the `flex`, covering the tiling.

- **The status bar (`StatusBar.tsx`) never requests anything from the server** (a strict rule). It shows, on the left, `user@host` plus a connection-status indicator (a colored dot: connected = emerald / reconnecting = amber pulse / disconnected = red), and on the right, session elapsed time, the local clock, and the settings gear.
  - Session elapsed time = `now - connection.connectedAt` (both local `Date`s). The clock is `new Date(now)`. **A single 1-second local interval** only updates `now` (= `Date.now()`), from which both are derived. The server's time is never requested.
  - `connectionStatus` lives in the store; today only `connected` is ever actually shown (a lost connection immediately returns to the connect screen). `reconnecting` is a **value reserved for future auto-reconnect** (set via `setConnectionStatus`).
  - The center region is **deliberately left empty for future server-resource widgets (CPU/memory)** — the three-region layout lets them be inserted without any reflow.
- **Settings (`SettingsPanel.tsx`)**: a category sidebar plus content. Categories are a **data-driven `SECTIONS` array** (`{id,label,render}`), so a section like "command log / shortcuts / theme" is just one more array entry. Currently two sections: `General` (a clock-seconds toggle) and `About` (app name/version, via `@tauri-apps/api/app`'s `getVersion`/`getName`/`getTauriVersion`). Closes on Esc, background click, or ✕.
- **Settings persistence**: `lib/settings.ts` (zustand) holds `AppSettings` (type + defaults); at startup, `load()` (backend `load_settings`) merges the on-disk values over the defaults, and every `set(key,val)` immediately persists the whole object via `save_settings`. The backend stores it as an opaque JSON blob at `<app_config_dir>/settings.json` (outside the repo; on Windows, `%APPDATA%\com.sshland.app\`) — it never gets committed to git, and **adding a setting requires no Rust change**. Procedure for adding a setting: add a field to `AppSettings` + a default in `DEFAULTS` + a control in the panel — three places only.
- **Remembering the last connection** (`AppSettings.lastConnection`): on a successful connect, host/port/username/authKind/keyPath are saved so the next launch auto-fills the connect form (`ConnectScreen` prefills once after settings load). **Passwords and key passphrases are never saved** (per the core "passwords stay in memory only" rule — `LastConnection` has no secret field at all).

### Command log bar (bottom of the screen)

A thin one-line bar that turns file-manager operations into **actual terminal command strings** for learning purposes. Positioned below the tiling in `App.tsx`'s vertical flex (symmetric with `StatusBar`).

- **The conversion is one reusable pure function, `operationToCommandString(op, {user,host})` in `lib/commandLog.ts`**: upload/download → `scp`, delete → `rm` (`-r` for directories), new folder → `mkdir`, new file → `touch`, rename/move → `mv`, copy → `cp -r`, **editor save → a descriptive `(편집기로 저장) <path>` line** (no honest shell equivalent). Paths are quoted only when they contain spaces/special characters (so the shown command stays one that would actually work, since this is for learning). The operation itself runs over SFTP; this string is **display-only**.
- The log is **session-only** (`store.commandLog`, newest first, capped at the most recent 20) — not persisted, reset on restart.
- `logOp(op)` is called at each operation's success point (`FilesScreen`'s handleDrop/doDownload/performMove/doRename/doDelete/doNewFolder/doPaste). **Terminal-pane input never lands in this log** — only file-manager operations are explicitly hooked, so there's no automatic duplication.
- Clicking the bar expands a **history popup** upward (the most recent 20, closes on outside click or Esc). Clicking does nothing when there's no history.
- Turning off the `commandLogEnabled` setting (default on, in the settings tab's **first section**, "Command Log") makes `CommandLogBar` return `null`, so the bar itself disappears (for advanced users).

### Command GUI (terminal output → widgets) — the core feature

When a command is run in the terminal, its output is shown as a human-readable GUI widget instead of raw text (toggleable). **Parsing/render rules are defined by declarative TOML, not hardcoded** — so users can add or edit them. **Only a code-execution-free, declarative approach is supported** (arbitrary JS execution is strictly forbidden — this app handles SSH credentials and server access). A non-match falls back silently to raw text; a parse failure is not an error either.

- **Shell-boundary detection (`lib/shellIntegration.ts`)**: when a terminal opens, a setup snippet is injected into bash that emits **OSC 133 markers** (`SHELL_INTEGRATION_SETUP`, via `PROMPT_COMMAND` + `PS1` + a `DEBUG` trap). xterm's `parser.registerOscHandler(133,…)` intercepts the markers **invisibly**, and the command text (B→C), its output (C→D), and its exit code (D;n) are read **from the buffer** (with wrapped lines rejoined). If the shell isn't bash, no markers ever appear, so it falls back to raw text. This is a common base layer, independent of any specific command's parsing.
- **Config loader (backend `commands_config.rs`)**: scans two locations — **read-only bundled defaults** (`default_commands/*.toml`, embedded in the binary) and the **user folder** (`<app_config_dir>/commands/*.toml`, read/write) — merging them so a **user file overrides** a default of the same filename. Invalid TOML or a spec violation only skips that one file (logged to stderr); the app never crashes. `load_command_configs` returns the merged list as JSON. The frontend's `lib/commandConfigs.ts` loads it at startup and exposes a pure `matchCommand(configs, command)` (first match wins; an invalid regex is skipped).
- **TOML spec**: `match` (a regex matched against the whole command string) / `parser` (`columns`|`keyvalue`|`regex`) / `render` (`table`|`keyvalue-card`|`list`) / `capture_pattern` (required for the `regex` parser, uses named groups) / `highlight_column` (optional, for `table`). TOML **literal strings (single quotes)** avoid having to escape regex backslashes.
- **Parsers (`lib/parsers.ts`, pure)**: `columns` (first line is the header; the last column is sliced from its header's start position to preserve a space-containing `COMMAND`, while earlier columns are split on whitespace so right-aligned numbers stay safe; `df`'s two-word `Mounted on` header is detected via the data's token count and merged) / `keyvalue` (`:` or multiple spaces; skips `●`/tree-drawing lines) / `regex` (named groups per line). Returns null on a mismatch → raw.
- **Renderers (`components/CommandWidgetPanel.tsx`)**: parses by `config.parser`, then renders by `config.render` (only the natural pairings; anything else falls back to raw). `table` (sortable, with a red gradient by value for `highlight_column` — via the `rgb(var(--color-red-500)/α)` token) / `keyvalue-card` (a card grid) / `list` (one row per field). `asNumber` parses a leading number (`25%`, `1.2G`).
- **Inline terminal integration (hybrid)**: on a match, shellIntegration's marker at the output's start line gets an xterm **decoration** (requires `allowProposedApi`) showing just a small inline **"▦" icon** — clicking it opens the widget in a panel **below the terminal pane** (`CommandWidgetPanel`). The panel has a **raw ↔ GUI toggle**. Decoration rendering is animation-frame driven and can't be verified headlessly (confirm in the real app). *Drawing a multi-row interactive overlay directly via decorations was avoided as rAF-dependent and complex — pulling any heavy widget out into a plain React panel is the core idea behind this hybrid.*
- **Setting**: turning off `commandGuiEnabled` (default on, in the settings tab's "Command GUI" section) makes `TerminalPane` skip matching entirely → everything stays raw. The section also lists registered commands (read-only), shows the user folder path with an open-folder button (`open_commands_dir`), and a reload button (re-runs `load()`). File-change watching isn't implemented (the spec allows this — the reload button substitutes for it).

### Design tokens (single source of truth)

Every color/typography/radius literal lives in exactly **one place — `:root` in `src/index.css`** as CSS variables. `tailwind.config.js` holds no values; it only **wires** utility names to those CSS variables. So classes like `bg-ink-900` / `text-slate-400` / `rounded-lg` / `text-2xs` all point at the central tokens. A future redesign only needs to change `:root` values — components stay untouched.

- **Colors are stored as RGB channels ("15 23 42")** so Tailwind's opacity modifiers work, mapped in the config as `rgb(var(--color-x) / <alpha-value>)`. This means things like `bg-sky-500/20` still work as expected.
- Palette names (`ink`/`slate`/`sky`/`emerald`/`amber`/`red`) and class names were **deliberately kept as-is** (this was a refactor, not a redesign — only the values moved into `:root`, zero visual change). Verified by comparing computed styles before/after for all 32 colors, font sizes, radii, and terminal colors — **fully identical**.
- **Font sizes**: only `text-2xs` (11px, no line-height — identical to the old `text-[11px]`) is new. The rest of `text-xs`–`text-2xl` moved Tailwind's default scale values into `:root` variables referenced from the config (default line-heights included, unchanged).
- The **spacing scale** stays Tailwind's default scale as-is (already a consistent scale, so no need to move it into `:root`). The remaining one-off layout px values in components (dropdown `min-w-[140px]`/`[160px]`, the settings modal's `max-h-[560px]`) are individual dimensions, not design tokens, so they were left alone.
- **Places that can't use CSS classes (xterm terminal's JS theme object)** read `:root` variables at runtime via `token()`/`colorToken()` in `src/lib/theme.ts` — so the terminal also references the same source with no duplicated hex values (`--font-terminal` included).

## File Structure

```
src-tauri/src/
  ssh.rs      SSH/SFTP session manager + worker loop + every Tauri command (connect, list_dir,
              download, upload, rename, mkdir, create_file (new empty file), delete, copy,
              read_remote_file/write_remote_file (in-memory editor read/write),
              open/write/resize/close_terminal, disconnect)
  settings.rs Settings persistence commands (load_settings/save_settings) — reads/writes a JSON
              blob at the app config folder's settings.json. The frontend owns the schema.
  commands_config.rs  Command-GUI config loader (load_command_configs: scans/merges/validates
              embedded defaults + the user folder, commands_dir_path/open_commands_dir) — uses the toml crate
  default_commands/*.toml  Bundled default command rules (ps-aux/systemctl-status/df-h/du-sh/free-h/ip-addr), embedded via include_str!
  error.rs    Converts technical errors → friendly Korean messages (centrally managed)
  lib.rs      Tauri Builder setup, command registration

src/
  store.ts              zustand: connection (with status/elapsed-time base)/connection status/settings overlay/command log/screen switching/pane tree/transfer list/upload batches/clipboard/drag/fsVersion
  api.ts                Typed Tauri invoke wrappers (including settings load/save)
  lib/panes.ts           Pane-tree pure functions (split/remove/switch/ratio/layout/focus navigation)
  lib/path.ts            Path utilities (join, parent, breadcrumb, baseName)
  lib/files.ts           sortEntries (folders-first sort)
  lib/format.ts          Human-readable size/date/elapsed-time/clock formatting
  lib/commandLog.ts      File operation → CLI command string conversion (operationToCommandString, pure/reusable; incl. the editor "save" case)
  lib/editable.ts        isProbablyBinary (extension denylist) + MAX_EDITABLE_SIZE — what may open in the editor
  lib/languages.ts       Extension/filename → CodeMirror language grammar (lang packages + legacy stream modes); null → plain text
  lib/editorTheme.ts     CodeMirror dark theme + HighlightStyle, built from the design tokens (editorTheme/editorHighlight)
  lib/shellIntegration.ts  OSC 133 shell-boundary detection (setup injection + command/output/exit capture) — a base layer independent of command parsing
  lib/commandConfigs.ts   Command-GUI config zustand store (load) + pure matchCommand
  lib/parsers.ts          columns/keyvalue/regex parsers (pure; return null → raw on mismatch)
  lib/settings.ts        Settings zustand store (AppSettings type + defaults + load/set, auto-persists on change)
  lib/theme.ts           Helper for reading :root design tokens from JS (token/colorToken) — for xterm, which can't use CSS classes
  index.css              Design-token :root definitions (single source for color/typography/radius) + global styles
  ../tailwind.config.js  Wires tokens to Tailwind utility names (holds no values, only var mappings)
  screens/ConnectScreen.tsx   Connect screen (password/private key, loading, errors)
  screens/FilesScreen.tsx     File-manager pane body (fully local state)
  components/StatusBar.tsx    Top GNOME-style status bar (user@host / connection status / session elapsed / local clock / settings icon) — all computed locally, no server calls
  components/CommandLogBar.tsx  Bottom command-log bar (latest line + click for a history popup, toggleable via settings)
  components/CommandWidgetPanel.tsx  Command-GUI widget panel (parses via parser → renders via render as table/card/list, with a raw toggle) — below the terminal pane
  components/SettingsPanel.tsx  Settings modal (category sidebar + sections, extended via the data-driven SECTIONS array; currently Command Log/Command GUI/General/About)
  components/TilingShell.tsx  Pane-tree root + global shortcuts + global event listeners (transfer progress/connection lost)
  components/PaneView.tsx     Pane tree → flat absolute-position renderer + divider dragging
  components/TerminalPane.tsx xterm.js terminal (PTY connection, render throttling, shell integration + command-GUI inline icon + panel)
  components/EditorPane.tsx   CodeMirror 6 editor pane (in-memory SFTP read/write, dirty tracking + save, own header, syntax highlighting, search/brackets/autocomplete)
  components/FileView.tsx     Three view modes — list/details/large icons (selection, drag-start, right-click support)
  components/Menu.tsx         Menu-bar dropdown (File/Edit/View)
  components/ContextMenu.tsx  Right-click context menu
  components/Modal.tsx        Confirm dialog / prompt dialog / unsaved-changes dialog (저장·저장 안 함·취소)
  components/DragLayer.tsx    Ghost label that follows the cursor while dragging
  components/TransfersPanel.tsx  Upload/download progress panel (finished cards/batches auto-fade after 3s; errors are dismissed manually)
  components/ShortcutsHelp.tsx   Bottom-right shortcuts help
```

## Current Status (as of 2026-07-12)

**Phase 1 — SSH connect + SFTP file manager: done**
Connect screen, listing (3 view modes), path navigation/breadcrumbs/hidden files, download/upload (drag-and-drop)/rename/delete/new folder/copy, disconnect detection.

**Phase 2 — Terminal + Hyprland-style tiling: done (all 9 steps)**
PTY streaming → xterm pane → pane tree + renderer → split shortcuts → focus movement → closing → divider dragging → pane switching → render throttling for inactive panes.

**Phase 3 — Top status bar + settings tab: done**
A GNOME-style top status bar separate from the panes (user@host / connection status / session elapsed / local clock / settings icon, all computed locally), a settings modal (category sidebar, data-driven extensible structure), local JSON persistence (`settings.json`). See the "Top status bar + settings" architecture section above.

**Phase 4 — Command log bar: done**
A thin bar at the bottom of the screen showing file-manager operations as real CLI commands (scp/rm/mkdir/mv/cp) — latest line plus a click-to-open history popup, session-only. Toggleable via the settings tab's first section, "Command Log" (off makes the bar disappear). See the "Command log bar" architecture section above. Future shortcuts/theme sections are expected to extend the same settings structure.

**Phase 5 — Command GUI (the core feature): done (all 8 steps)**
Shell-integration (OSC 133) boundary detection → declarative TOML config loader (defaults + user, with override) → columns/keyvalue/regex parsers + table/keyvalue-card/list renderers → inline terminal "▦" icon (decoration) + panel below (with a raw toggle) → 6 bundled defaults (ps aux/systemctl status/df -h/du -sh/free -h/ip addr) → reload/open-folder → a settings master toggle. See the "Command GUI" architecture section above. Parser/render verification was done in-browser against real xterm/React components; the inline decoration display needs confirming in the real app (rAF-dependent). **Not yet implemented (future work): file-change watching (currently a reload button), zsh/fish shell integration (currently bash only), fine-tuning the decoration icon's position (currently covers the first 3 columns of the output's first line).**

**Phase 6 — Editor pane (CodeMirror 6): done (all 8 steps)**
`read_remote_file`/`write_remote_file` (in-memory SFTP, no temp file) → CodeMirror base load/display → third `editor` leaf type + double-click open (text/binary/size gating) → save (Ctrl+S/button) + dirty tracking → unsaved-changes close guard → extension-based syntax highlighting → search/replace + bracket matching/auto-close + autocomplete → save event in the command-log bar. See the "Editor pane" architecture section above. Pure frontend logic (binary classification, pane-tree open/reuse/close-guard, dirty detection, language detection + token colors, save-string formatting) verified in-browser against the real compiled modules; **needs real-SSH confirmation in the app**: the actual load/save round-trip and its command-log line, the binary/oversized download-instead flow, and **bracket auto-close** (CodeMirror's real input path can't be driven headlessly, same limit as the xterm decoration).

**Additional improvements (from user feedback, done):**
- Cleaned up the toolbar into a file-manager menu bar (File/Edit/View), single selection, right-click on empty space (new folder/paste), right-click on a file (copy/download/rename/delete)
- In-app drag to move a file/folder icon into another folder or another pane (via SFTP rename)
- **OS file drag-in upload** (local → server): dragging from Explorer/Finder onto a file-manager pane uploads into that pane's current folder. See the "OS drag-in upload" section above. (The reverse direction, drag-out, wasn't built since Tauri's webview doesn't support it cross-platform — downloads keep the existing button flow.)
- **Design-token centralization** (a refactor, zero visual change): moved every color/typography/radius literal into `:root` (`index.css`) as the single source, with Tailwind only mapping to it. See the "Design tokens" section above. Structural groundwork for a future redesign.

**Fixed bugs:**
- The editor refused to open some valid text files (e.g. a small `.yaml`) with the generic "파일을 여는 중 문제가 발생했어요" error. Cause: `read_file_contents` used `Read::read_to_end` on an `ssh2::File`, which errors on some servers instead of returning `Ok(0)` at EOF. Fixed by reading in a fixed-buffer loop — the same proven path `download_file` uses (both `read` in a loop and break on `Ok(0)`). Read open/read failures now also `eprintln!` the raw ssh2 error to stderr for diagnosis.
- Closing a pane used to kill a sibling terminal that should have survived (fixed by switching rendering from recursive tree to flat absolute positioning)
- Two file-manager panes used to share state and move together (fixed by switching from global state to per-pane local state)
- Getting stuck on "Loading…" on first entry (caused by React StrictMode's double-invoke plus a boolean `fsVersion` guard race condition — fixed with a value-comparison guard)

**Remaining work:** every item the user explicitly requested has been implemented. However, the Command GUI (Phase 5) still needs **verification in the real app against a real SSH server** (each default command's icon→panel behavior, raw-only when the master toggle is off, open-folder/reload), and there are **future items** awaiting the user's priority call: file-change watching (currently a reload button), zsh/fish shell integration (currently bash only), fine-tuning the decoration icon's position. Otherwise, awaiting new feature requests or bug reports.

## Good to Know

- In this environment (Windows), the `create-tauri-app` CLI refuses to run non-interactively (non-TTY), so the project was scaffolded manually.
- Build: `npm run build` (frontend), `cd src-tauri && cargo build` (backend). Run: `npm run tauri dev` (in PowerShell, `~/.cargo/bin` may need adding to `$env:Path`).
- **Port 1420 is auto-freed before the dev server starts.** Tauri pins Vite to port 1420 (`strictPort: true`, since `devUrl` points there), so a leftover Vite/Node process from a crash or restart used to make `npm run tauri dev` fail with "Port 1420 is already in use". A `predev` npm hook (`scripts/free-port.mjs`) now kills whatever is LISTENING on 1420 first — cross-platform (Windows `netstat`/`taskkill`, Unix `lsof`/`kill`), always exits 0, and runs automatically because Tauri's `beforeDevCommand` is `npm run dev` (npm runs `predev` before `dev`). Run it manually with `npm run free-port` if needed. Don't lower `strictPort` — Tauri needs the fixed port, so freeing it (not falling back to another) is the correct fix.
- React `<StrictMode>` is enabled (`src/main.tsx`), so mount effects run twice in dev mode — this must be accounted for whenever adding a mount-time side effect (use a ref-based guard, and compare **values** rather than a boolean "have I already mounted" flag).

### Working conventions & verification (established through this point)

- **Break large features into steps, and after each step: confirm the build, then make a logically-scoped commit.** Don't build everything at once — first verify the whole pipeline end-to-end with one representative case (e.g. `ps aux` for the Command GUI), then extend to the rest. Keep `Co-Authored-By: Claude ...` at the end of commit messages.
- **When a library constraint around shell integration / PTY / xterm is suspected, don't work around it arbitrarily — prototype first to confirm whether the straightforward approach actually works.** (E.g.: attached an actual xterm to test whether decorations work as an interactive multi-row overlay → found it's rAF-dependent and complex → decided on the "inline icon + panel below" hybrid instead.)
- **Real SSH access isn't available in this dev environment** → anything that needs a server (bash markers actually being emitted, real command output, the inline decoration actually showing, etc.) is confirmed by the user in the real app. Instead, **pure frontend logic is verified in-browser against the actual compiled modules**: start `npm run dev` (vite), then in the browser dynamically `import('/src/lib/xxx.ts')` for the real module, and `import('/node_modules/.vite/deps/@xterm_xterm.js?v=…')` / `react` / `react-dom_client` for the real xterm/React, feeding synthetic input to verify parsers, rendering, sorting, and matching (against the genuine module, not a retyped copy). Rust config-parsing is covered with `cargo test` unit tests.
  - **Gotchas in browser verification**: ① Adding a cache-bust like `import('/src/store.ts?t=…')` creates a **different instance** from the zustand singleton the app actually uses, so `setState` won't take effect — import without a cache-bust when you need to manipulate/observe app state. ② Vite deps like `@xterm/xterm` and `react-dom_client` have their real exports under `default` (`m.default.Terminal`, `rd.default.createRoot`). ③ rAF-driven rendering (e.g. decorations) can't be verified in a background tab, since frames don't run there.
- **Using xterm buffer markers/decorations requires `Terminal({ allowProposedApi: true })`** (it's a proposed API).
- Running `cd src-tauri` in the Bash tool persists that shell's cwd, so frontend commands (`npx tsc`/`npm run build`) should be run with an **absolute path back at the repo root** (otherwise they silently run in the wrong folder).
- The `LF will be replaced by CRLF` warning on commit is just a benign Windows line-ending normalization notice (the repo stores LF).
