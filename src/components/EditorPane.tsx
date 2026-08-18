import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Compartment, EditorState } from "@codemirror/state";
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
  selectAll,
  toggleComment,
  indentMore,
  indentLess,
  moveLineUp,
  moveLineDown,
  copyLineDown,
  deleteLine,
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
  gotoLine,
} from "@codemirror/search";
import { download, readRemoteFile, writeRemoteFile } from "../api";
import { useAppStore } from "../store";
import { operationToCommandString } from "../lib/commandLog";
import { baseName } from "../lib/path";
import { editorTheme, editorHighlight } from "../lib/editorTheme";
import { languageLabel, loadLanguageForFile } from "../lib/languages";
import { UnsavedChangesDialog } from "./Modal";
import type { DropItem } from "./Menu";
import { usePaneMenuRegistration } from "../lib/paneMenus";

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
  // The language-highlighting extension lives in a Compartment so it can be
  // swapped in at runtime once the (dynamically-imported) grammar resolves —
  // the file opens as plain text immediately and highlighting pops in after.
  const langCompartmentRef = useRef(new Compartment());
  const wrapCompartmentRef = useRef(new Compartment());
  const fontCompartmentRef = useRef(new Compartment());
  const positionRef = useRef<HTMLSpanElement>(null);
  // The last saved/loaded contents; the doc is "dirty" when it differs.
  const baselineRef = useRef("");
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  // The file's original encoding, echoed back on save so it's preserved.
  const encodingRef = useRef("UTF-8");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [encoding, setEncoding] = useState("UTF-8");
  const [lineEnding, setLineEnding] = useState("LF");
  const [wordWrap, setWordWrap] = useState(false);
  const [fontSize, setFontSize] = useState(13);

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
    setActionError(null);
    try {
      await writeRemoteFile(filePath, content, encodingRef.current);
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
      setActionError(typeof err === "string" ? err : "저장하지 못했어요.");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [filePath, markDirty, logCommand, connection]);

  const saveRef = useRef(doSave);
  saveRef.current = doSave;

  const updateCursorStatus = useCallback((state: EditorState) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const selected = state.selection.ranges.reduce(
      (total, range) => total + range.to - range.from,
      0
    );
    if (positionRef.current) {
      positionRef.current.textContent = `${line.number}줄, ${
        head - line.from + 1
      }열${selected > 0 ? ` (${selected}자 선택)` : ""}`;
    }
  }, []);

  const toggleWordWrap = useCallback(() => {
    setWordWrap((current) => {
      const next = !current;
      viewRef.current?.dispatch({
        effects: wrapCompartmentRef.current.reconfigure(
          next ? EditorView.lineWrapping : []
        ),
      });
      return next;
    });
  }, []);

  const changeFontSize = useCallback((amount: number | "reset") => {
    setFontSize((current) => {
      const next =
        amount === "reset"
          ? 13
          : Math.min(20, Math.max(10, current + amount));
      viewRef.current?.dispatch({
        effects: fontCompartmentRef.current.reconfigure(
          EditorView.theme({ "&": { fontSize: `${next}px` } })
        ),
      });
      return next;
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);
    markDirty(false);

    readRemoteFile(filePath)
      .then(({ content: contents, encoding: enc }) => {
        if (disposed) return;
        const host = hostRef.current;
        if (!host) return;

        baselineRef.current = contents;
        encodingRef.current = enc;
        setEncoding(enc);
        const separator = contents.includes("\r\n")
          ? "\r\n"
          : contents.includes("\r")
            ? "\r"
            : "\n";
        setLineEnding(separator === "\r\n" ? "CRLF" : separator === "\r" ? "CR" : "LF");
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
              EditorState.lineSeparator.of(separator),
              // Starts empty (plain text); reconfigured once the grammar loads.
              langCompartmentRef.current.of([]),
              wrapCompartmentRef.current.of(
                wordWrap ? EditorView.lineWrapping : []
              ),
              fontCompartmentRef.current.of(
                EditorView.theme({ "&": { fontSize: `${fontSize}px` } })
              ),
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
                { key: "Mod-g", preventDefault: true, run: gotoLine },
                {
                  key: "Alt-z",
                  preventDefault: true,
                  run: () => {
                    toggleWordWrap();
                    return true;
                  },
                },
                {
                  key: "Mod-=",
                  preventDefault: true,
                  run: () => {
                    changeFontSize(1);
                    return true;
                  },
                },
                {
                  key: "Mod--",
                  preventDefault: true,
                  run: () => {
                    changeFontSize(-1);
                    return true;
                  },
                },
                {
                  key: "Mod-0",
                  preventDefault: true,
                  run: () => {
                    changeFontSize("reset");
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
                if (u.selectionSet || u.docChanged) updateCursorStatus(u.state);
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
        updateCursorStatus(view.state);
        setLoading(false);

        // Load the language grammar in the background and swap it into the
        // compartment once it resolves — the file is already visible as plain
        // text. Guard against a stale result: if this effect was torn down (a
        // different file opened in the meantime), or this view was replaced,
        // don't reconfigure — the late import must not clobber the new file.
        void loadLanguageForFile(filePath).then((language) => {
          if (disposed || viewRef.current !== view || !language) return;
          view.dispatch({
            effects: langCompartmentRef.current.reconfigure(language),
          });
        });
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
  }, [
    changeFontSize,
    filePath,
    markDirty,
    toggleWordWrap,
    updateCursorStatus,
  ]);

  useEffect(() => {
    if (!loading && !error && viewRef.current) {
      updateCursorStatus(viewRef.current.state);
    }
  }, [error, loading, updateCursorStatus]);

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

  const copySelection = async (cut: boolean) => {
    const view = viewRef.current;
    if (!view) return;
    const ranges = view.state.selection.ranges.filter((range) => !range.empty);
    const currentLine = view.state.doc.lineAt(view.state.selection.main.head);
    const text =
      ranges.length > 0
        ? ranges
            .map((range) => view.state.sliceDoc(range.from, range.to))
            .join("\n")
        : `${currentLine.text}\n`;
    setActionError(null);
    try {
      await navigator.clipboard.writeText(text);
      if (cut && ranges.length > 0) {
        view.dispatch(view.state.replaceSelection(""));
      } else if (cut) {
        const from =
          currentLine.to === view.state.doc.length && currentLine.from > 0
            ? currentLine.from - 1
            : currentLine.from;
        const to =
          currentLine.to < view.state.doc.length
            ? currentLine.to + 1
            : currentLine.to;
        view.dispatch({ changes: { from, to } });
      }
    } catch {
      setActionError("클립보드에 접근하지 못했어요.");
    } finally {
      view.focus();
    }
  };

  const pasteClipboard = async () => {
    const view = viewRef.current;
    if (!view) return;
    setActionError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text) view.dispatch(view.state.replaceSelection(text));
    } catch {
      setActionError("클립보드 내용을 읽지 못했어요.");
    } finally {
      view.focus();
    }
  };
  // Editing tools only make sense once the doc is actually loaded.
  const ready = !loading && !error;

  const fileMenu: DropItem[] = [
    {
      label: saving ? "저장 중…" : "저장",
      shortcut: "Ctrl+S",
      onClick: () => void doSave(),
      disabled: !ready || !dirty || saving,
    },
    { type: "separator" },
    {
      label: "pane 닫기",
      shortcut: "Alt+Shift+W",
      onClick: () => requestClose(id),
    },
  ];
  const editMenu: DropItem[] = [
    {
      label: "실행 취소",
      shortcut: "Ctrl+Z",
      onClick: () => runCmd(undo),
      disabled: !ready,
    },
    {
      label: "다시 실행",
      shortcut: "Ctrl+Y",
      onClick: () => runCmd(redo),
      disabled: !ready,
    },
    { type: "separator" },
    {
      label: "잘라내기",
      shortcut: "Ctrl+X",
      onClick: () => void copySelection(true),
      disabled: !ready,
    },
    {
      label: "복사",
      shortcut: "Ctrl+C",
      onClick: () => void copySelection(false),
      disabled: !ready,
    },
    {
      label: "붙여넣기",
      shortcut: "Ctrl+V",
      onClick: () => void pasteClipboard(),
      disabled: !ready,
    },
    {
      label: "모두 선택",
      shortcut: "Ctrl+A",
      onClick: () => runCmd(selectAll),
      disabled: !ready,
    },
    { type: "separator" },
    {
      label: "찾기 / 바꾸기",
      shortcut: "Ctrl+F",
      onClick: () =>
        runCmd((view) => {
          openSearchPanel(view);
          return true;
        }),
      disabled: !ready,
    },
  ];
  const codeMenu: DropItem[] = [
    {
      label: "줄 주석 전환",
      shortcut: "Ctrl+/",
      onClick: () => runCmd(toggleComment),
      disabled: !ready,
    },
    {
      label: "들여쓰기",
      shortcut: "Ctrl+]",
      onClick: () => runCmd(indentMore),
      disabled: !ready,
    },
    {
      label: "내어쓰기",
      shortcut: "Ctrl+[",
      onClick: () => runCmd(indentLess),
      disabled: !ready,
    },
    { type: "separator" },
    {
      label: "줄 위로 이동",
      shortcut: "Alt+↑",
      onClick: () => runCmd(moveLineUp),
      disabled: !ready,
    },
    {
      label: "줄 아래로 이동",
      shortcut: "Alt+↓",
      onClick: () => runCmd(moveLineDown),
      disabled: !ready,
    },
    {
      label: "줄 아래에 복제",
      shortcut: "Shift+Alt+↓",
      onClick: () => runCmd(copyLineDown),
      disabled: !ready,
    },
    {
      label: "줄 삭제",
      shortcut: "Ctrl+Shift+K",
      onClick: () => runCmd(deleteLine),
      disabled: !ready,
    },
    { type: "separator" },
    {
      label: "특정 줄로 이동",
      shortcut: "Ctrl+G",
      onClick: () => runCmd(gotoLine),
      disabled: !ready,
    },
  ];
  const viewMenu: DropItem[] = [
    {
      type: "check",
      label: "자동 줄 바꿈",
      checked: wordWrap,
      onClick: toggleWordWrap,
      disabled: !ready,
    },
    { type: "separator" },
    {
      label: "글자 크게",
      shortcut: "Ctrl+=",
      onClick: () => changeFontSize(1),
      disabled: !ready || fontSize >= 20,
    },
    {
      label: "글자 작게",
      shortcut: "Ctrl+-",
      onClick: () => changeFontSize(-1),
      disabled: !ready || fontSize <= 10,
    },
    {
      label: "글자 크기 초기화",
      shortcut: "Ctrl+0",
      onClick: () => changeFontSize("reset"),
      disabled: !ready || fontSize === 13,
    },
  ];

  usePaneMenuRegistration(id, [
    { label: "파일", items: fileMenu },
    { label: "편집", items: editMenu },
    { label: "코드", items: codeMenu },
    { label: "보기", items: viewMenu },
  ]);

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
          {ready && encoding !== "UTF-8" && (
            <span
              className="shrink-0 rounded bg-amber-400/15 px-1.5 py-px text-2xs text-amber-400"
              title={`이 파일은 ${encoding} 인코딩이에요. 저장할 때도 같은 인코딩으로 유지돼요.`}
            >
              {encoding}
            </span>
          )}
        </span>
        <button
          onClick={() => requestClose(id)}
          title="pane 닫기"
          aria-label="pane 닫기"
          className="shrink-0 rounded px-1.5 py-0.5 hover:bg-red-500/20 hover:text-red-300"
        >
          ✕
        </button>
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
      {actionError && (
        <div className="shrink-0 bg-red-950/80 px-2 py-1 text-2xs text-red-300">
          {actionError}
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
      {ready && (
        <div className="flex h-6 shrink-0 items-center justify-end gap-3 border-t border-ink-700/60 bg-ink-800 px-2 font-mono text-2xs text-slate-500">
          <span title="탭 한 칸이 차지하는 열 수">탭: 4</span>
          <span title="줄바꿈 형식">{lineEnding}</span>
          <span title="문자 인코딩">{encoding}</span>
          <span title="편집기 글자 크기">{fontSize}px</span>
          <span ref={positionRef} className="min-w-[5.5rem] text-right" />
        </div>
      )}
    </div>
  );
}
