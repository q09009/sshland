import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  highlightSelectionMatches,
  searchKeymap,
  openSearchPanel,
} from "@codemirror/search";
import { download, readRemoteFile, writeRemoteFile } from "../api";
import { useAppStore } from "../store";
import { operationToCommandString } from "../lib/commandLog";
import { baseName } from "../lib/path";
import { editorTheme, editorHighlight } from "../lib/editorTheme";
import { languageForFile, languageLabel } from "../lib/languages";
import { UnsavedChangesDialog } from "./Modal";

/**
 * A lightweight text/code editor for one remote file, rendered with CodeMirror
 * 6. Loads the file's contents into memory on mount (no local temp file), tracks
 * unsaved changes, and writes back to the server on save (Ctrl/Cmd+S or button).
 *
 * If the file can't be opened (too large, binary/non-text, or any read error),
 * the pane offers to download it instead — this is where the backend's UTF-8 /
 * null-byte check (the content-based binary fallback) surfaces to the user.
 */
export default function EditorPane({
  id,
  filePath,
}: {
  id: string;
  filePath: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The last saved/loaded contents; the doc is "dirty" when it differs.
  const baselineRef = useRef("");
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const closePane = useAppStore((s) => s.closePane);
  const requestClose = useAppStore((s) => s.requestClose);
  const closeRequested = useAppStore((s) => s.closeRequest === id);
  const clearCloseRequest = useAppStore((s) => s.clearCloseRequest);
  const setPaneDirty = useAppStore((s) => s.setPaneDirty);
  const startTransfer = useAppStore((s) => s.startTransfer);
  const finishTransfer = useAppStore((s) => s.finishTransfer);
  const logCommand = useAppStore((s) => s.logCommand);
  const connection = useAppStore((s) => s.connection);

  const name = baseName(filePath);

  // Update the dirty flag in both local state and the pane tree (for the close
  // confirm), but only when it actually flips — not on every keystroke.
  const markDirty = useCallback(
    (d: boolean) => {
      if (dirtyRef.current === d) return;
      dirtyRef.current = d;
      setDirty(d);
      setPaneDirty(id, d);
    },
    [id, setPaneDirty]
  );

  // Save the current contents back to the server. Held in a ref so the (once-
  // built) CodeMirror keymap always calls the latest version.
  const doSave = useCallback(async (): Promise<boolean> => {
    const view = viewRef.current;
    if (!view || savingRef.current) return false;
    const content = view.state.doc.toString();
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await writeRemoteFile(filePath, content);
      baselineRef.current = content;
      markDirty(false);
      // Record the save in the command-log bar (a descriptive line, since a
      // save has no clean shell-command equivalent).
      if (connection) {
        logCommand(
          operationToCommandString(
            { type: "save", path: filePath },
            { user: connection.username, host: connection.host }
          )
        );
      }
      return true;
    } catch (err) {
      setSaveError(typeof err === "string" ? err : "저장하지 못했어요.");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [filePath, markDirty, logCommand, connection]);

  const saveRef = useRef(doSave);
  saveRef.current = doSave;

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);
    markDirty(false);

    readRemoteFile(filePath)
      .then((contents) => {
        if (disposed) return;
        const host = hostRef.current;
        if (!host) return;

        baselineRef.current = contents;
        const language = languageForFile(filePath);
        const view = new EditorView({
          parent: host,
          state: EditorState.create({
            doc: contents,
            extensions: [
              lineNumbers(),
              highlightActiveLine(),
              highlightActiveLineGutter(),
              drawSelection(),
              history(),
              bracketMatching(),
              closeBrackets(),
              indentOnInput(),
              autocompletion(),
              highlightSelectionMatches(),
              syntaxHighlighting(editorHighlight()),
              ...(language ? [language] : []),
              // Ctrl/Cmd+S saves; listed first so it wins over any default.
              keymap.of([
                {
                  key: "Mod-s",
                  preventDefault: true,
                  run: () => {
                    void saveRef.current();
                    return true;
                  },
                },
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...historyKeymap,
                ...searchKeymap,
                ...completionKeymap,
                indentWithTab,
              ]),
              editorTheme(),
              // Recompute dirty on edits. Compare length first (cheap) and only
              // stringify the (<=5MB) doc when lengths match, so typing in a big
              // file doesn't serialize it on every keystroke.
              EditorView.updateListener.of((u) => {
                if (!u.docChanged) return;
                const doc = u.state.doc;
                const d =
                  doc.length !== baselineRef.current.length
                    ? true
                    : doc.toString() !== baselineRef.current;
                markDirty(d);
              }),
            ],
          }),
        });
        viewRef.current = view;
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (disposed) return;
        setError(typeof e === "string" ? e : "파일을 열 수 없어요.");
        setLoading(false);
      });

    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [filePath, markDirty]);

  /** Download the file locally (offered when it can't be edited). */
  async function downloadInstead() {
    const local = await save({ defaultPath: name });
    if (!local) return;
    const tid = crypto.randomUUID();
    startTransfer({ id: tid, name, kind: "download", total: 0 });
    try {
      await download(tid, filePath, local);
      finishTransfer(tid);
    } catch (err) {
      finishTransfer(tid, typeof err === "string" ? err : "다운로드에 실패했어요.");
    }
  }

  // Run a CodeMirror command from a toolbar button, then restore editor focus.
  const runCmd = (fn: (v: EditorView) => boolean) => {
    const view = viewRef.current;
    if (!view) return;
    fn(view);
    view.focus();
  };
  // Editing tools only make sense once the doc is actually loaded.
  const ready = !loading && !error;

  return (
    <div className="flex h-full w-full flex-col bg-ink-900">
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-ink-700/60 bg-ink-800 pl-2 pr-1 text-xs text-slate-400">
        <span className="flex min-w-0 items-center gap-1.5" title={filePath}>
          <span className="truncate">📝 {name}</span>
          {dirty && (
            <span className="text-amber-400" title="저장하지 않은 변경사항">
              ●
            </span>
          )}
          <span className="shrink-0 rounded bg-ink-700 px-1.5 py-px text-2xs text-slate-400">
            {languageLabel(filePath)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {ready && (
            <>
              <ToolbarButton label="실행취소 (Ctrl+Z)" onClick={() => runCmd(undo)}>
                ↶
              </ToolbarButton>
              <ToolbarButton label="다시실행 (Ctrl+Y)" onClick={() => runCmd(redo)}>
                ↷
              </ToolbarButton>
              <ToolbarButton
                label="찾기 / 바꾸기 (Ctrl+F)"
                onClick={() =>
                  runCmd((v) => {
                    openSearchPanel(v);
                    return true;
                  })
                }
              >
                찾기
              </ToolbarButton>
              <span className="mx-0.5 h-4 w-px bg-ink-700" />
            </>
          )}
          {!error && (
            <button
              onClick={() => void doSave()}
              disabled={!dirty || saving}
              title="저장 (Ctrl+S)"
              className="rounded px-1.5 py-0.5 hover:bg-ink-700 hover:text-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          )}
          <button
            onClick={() => requestClose(id)}
            title="pane 닫기"
            className="rounded px-1.5 py-0.5 hover:bg-red-500/20 hover:text-red-300"
          >
            ✕
          </button>
        </span>
      </div>
      {closeRequested && (
        <UnsavedChangesDialog
          fileName={name}
          saving={saving}
          onSave={async () => {
            const ok = await doSave();
            clearCloseRequest();
            if (ok) closePane(id);
          }}
          onDiscard={() => {
            clearCloseRequest();
            closePane(id);
          }}
          onCancel={clearCloseRequest}
        />
      )}
      {saveError && (
        <div className="shrink-0 bg-red-950/80 px-2 py-1 text-2xs text-red-300">
          {saveError}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <span className="text-sm text-red-300">{error}</span>
            <button
              onClick={downloadInstead}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500"
            >
              다운로드
            </button>
          </div>
        ) : (
          <>
            <div ref={hostRef} className="h-full w-full overflow-auto" />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                불러오는 중…
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A compact icon/text button in the editor header toolbar. */
function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded px-1.5 py-0.5 hover:bg-ink-700 hover:text-slate-100"
    >
      {children}
    </button>
  );
}
