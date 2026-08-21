import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Compartment, EditorState, Text } from "@codemirror/state";
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
import {
  ConfirmDialog,
  FileConflictDialog,
  UnsavedChangesDialog,
} from "./Modal";
import type { DropItem } from "./Menu";
import { usePaneMenuRegistration } from "../lib/paneMenus";
import { useI18n } from "../i18n";

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
  index,
  focused,
}: {
  id: string;
  filePath: string;
  index?: number;
  focused?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The language-highlighting extension lives in a Compartment so it can be
  // swapped in at runtime once the (dynamically-imported) grammar resolves —
  // the file opens as plain text immediately and highlighting pops in after.
  const langCompartmentRef = useRef(new Compartment());
  const wrapCompartmentRef = useRef(new Compartment());
  const fontCompartmentRef = useRef(new Compartment());
  const lineEndingCompartmentRef = useRef(new Compartment());
  const positionRef = useRef<HTMLSpanElement>(null);
  // The last saved/loaded contents; the doc is "dirty" when it differs.
  const baselineRef = useRef("");
  const remoteBaselineRef = useRef("");
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const reloadingRef = useRef(false);
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
  const [reloading, setReloading] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [fileConflict, setFileConflict] = useState(false);

  const closePane = useAppStore((s) => s.closePane);
  const requestClose = useAppStore((s) => s.requestClose);
  const closeRequested = useAppStore((s) => s.closeRequest === id);
  const clearCloseRequest = useAppStore((s) => s.clearCloseRequest);
  const setPaneDirty = useAppStore((s) => s.setPaneDirty);
  const startTransfer = useAppStore((s) => s.startTransfer);
  const finishTransfer = useAppStore((s) => s.finishTransfer);
  const logCommand = useAppStore((s) => s.logCommand);
  const connection = useAppStore((s) => s.connection);
  const { language, t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

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
  const doSave = useCallback(async (overwrite = false): Promise<boolean> => {
    const view = viewRef.current;
    if (!view || savingRef.current || reloadingRef.current) return false;
    const normalizedContent = view.state.doc.toString();
    const content = view.state.sliceDoc();
    savingRef.current = true;
    setSaving(true);
    setActionError(null);
    try {
      if (!overwrite) {
        const remote = await readRemoteFile(filePath);
        if (
          remote.content !== remoteBaselineRef.current ||
          remote.encoding !== encodingRef.current
        ) {
          setFileConflict(true);
          return false;
        }
      }
      await writeRemoteFile(filePath, content, encodingRef.current);
      baselineRef.current = normalizedContent;
      remoteBaselineRef.current = content;
      markDirty(view.state.doc.toString() !== normalizedContent);
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
      setActionError(typeof err === "string" ? err : tRef.current("editor.error.save"));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [filePath, markDirty, logCommand, connection]);

  const saveRef = useRef(doSave);
  saveRef.current = doSave;

  const applyRemoteContents = useCallback(
    (contents: string, remoteEncoding: string) => {
      const view = viewRef.current;
      if (!view) return;
      const separator = contents.includes("\r\n")
        ? "\r\n"
        : contents.includes("\r")
          ? "\r"
          : "\n";
      view.dispatch({
        effects: lineEndingCompartmentRef.current.reconfigure(
          EditorState.lineSeparator.of(separator)
        ),
      });
      const text = Text.of(contents.split(/\r\n|\r|\n/));
      baselineRef.current = text.toString();
      remoteBaselineRef.current = contents;
      encodingRef.current = remoteEncoding;
      setEncoding(remoteEncoding);
      setLineEnding(
        separator === "\r\n" ? "CRLF" : separator === "\r" ? "CR" : "LF"
      );
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
      markDirty(false);
      view.focus();
    },
    [markDirty]
  );

  const reloadFromServer = useCallback(async (discardChanges = false) => {
    if (reloadingRef.current || savingRef.current) return;
    const contentsBeforeReload = viewRef.current?.state.doc.toString();
    reloadingRef.current = true;
    setReloading(true);
    setActionError(null);
    try {
      const remote = await readRemoteFile(filePath);
      if (
        !discardChanges &&
        (dirtyRef.current ||
          viewRef.current?.state.doc.toString() !== contentsBeforeReload)
      ) {
        setReloadConfirm(true);
        return;
      }
      applyRemoteContents(remote.content, remote.encoding);
    } catch (err) {
      setActionError(
        typeof err === "string" ? err : tRef.current("editor.error.reload")
      );
    } finally {
      reloadingRef.current = false;
      setReloading(false);
    }
  }, [applyRemoteContents, filePath]);

  const requestReload = useCallback(() => {
    if (dirtyRef.current) setReloadConfirm(true);
    else void reloadFromServer(false);
  }, [reloadFromServer]);

  const updateCursorStatus = useCallback((state: EditorState) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const selected = state.selection.ranges.reduce(
      (total, range) => total + range.to - range.from,
      0
    );
    if (positionRef.current) {
      const params = {
        line: line.number,
        column: head - line.from + 1,
        count: selected,
      };
      positionRef.current.textContent = selected > 0
        ? tRef.current("editor.positionSelected", params)
        : tRef.current("editor.position", params);
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
            doc: Text.of(contents.split(/\r\n|\r|\n/)),
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
              lineEndingCompartmentRef.current.of(
                EditorState.lineSeparator.of(separator)
              ),
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
                  key: "Mod-Shift-r",
                  preventDefault: true,
                  run: () => {
                    requestReload();
                    return true;
                  },
                },
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
        baselineRef.current = view.state.doc.toString();
        remoteBaselineRef.current = contents;
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
        setError(typeof e === "string" ? e : tRef.current("editor.error.open"));
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
    requestReload,
    toggleWordWrap,
    updateCursorStatus,
  ]);

  useEffect(() => {
    if (!loading && !error && viewRef.current) {
      updateCursorStatus(viewRef.current.state);
    }
  }, [error, language, loading, updateCursorStatus]);

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
      finishTransfer(
        tid,
        typeof err === "string" ? err : tRef.current("files.error.download"),
      );
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

  const fileMenu: DropItem[] = [
    {
      label: saving ? t("editor.saving") : t("editor.save"),
      shortcut: "Ctrl+S",
      onClick: () => void doSave(),
      disabled: !ready || !dirty || saving,
    },
    {
      label: reloading ? t("editor.reloading") : t("editor.reload"),
      shortcut: "Ctrl+Shift+R",
      onClick: requestReload,
      disabled: !ready || saving || reloading,
    },
  ];
  const editMenu: DropItem[] = [
    {
      label: t("editor.undo"),
      shortcut: "Ctrl+Z",
      onClick: () => runCmd(undo),
      disabled: !ready,
    },
    {
      label: t("editor.redo"),
      shortcut: "Ctrl+Y",
      onClick: () => runCmd(redo),
      disabled: !ready,
    },
    { type: "separator" },
    {
      label: t("editor.selectAll"),
      shortcut: "Ctrl+A",
      onClick: () => runCmd(selectAll),
      disabled: !ready,
    },
    { type: "separator" },
    {
      label: t("editor.findReplace"),
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
      label: t("editor.toggleComment"),
      shortcut: "Ctrl+/",
      onClick: () => runCmd(toggleComment),
      disabled: !ready,
    },
    {
      label: t("editor.indent"),
      shortcut: "Ctrl+]",
      onClick: () => runCmd(indentMore),
      disabled: !ready,
    },
    {
      label: t("editor.outdent"),
      shortcut: "Ctrl+[",
      onClick: () => runCmd(indentLess),
      disabled: !ready,
    },
    { type: "separator" },
    {
      label: t("editor.moveLineUp"),
      shortcut: "Alt+↑",
      onClick: () => runCmd(moveLineUp),
      disabled: !ready,
    },
    {
      label: t("editor.moveLineDown"),
      shortcut: "Alt+↓",
      onClick: () => runCmd(moveLineDown),
      disabled: !ready,
    },
    {
      label: t("editor.copyLineDown"),
      shortcut: "Shift+Alt+↓",
      onClick: () => runCmd(copyLineDown),
      disabled: !ready,
    },
    {
      label: t("editor.deleteLine"),
      shortcut: "Ctrl+Shift+K",
      onClick: () => runCmd(deleteLine),
      disabled: !ready,
    },
    { type: "separator" },
    {
      label: t("editor.gotoLine"),
      shortcut: "Ctrl+G",
      onClick: () => runCmd(gotoLine),
      disabled: !ready,
    },
  ];
  const viewMenu: DropItem[] = [
    {
      type: "check",
      label: t("editor.wordWrap"),
      checked: wordWrap,
      onClick: toggleWordWrap,
      disabled: !ready,
    },
    { type: "separator" },
    {
      label: t("editor.fontIncrease"),
      shortcut: "Ctrl+=",
      onClick: () => changeFontSize(1),
      disabled: !ready || fontSize >= 20,
    },
    {
      label: t("editor.fontDecrease"),
      shortcut: "Ctrl+-",
      onClick: () => changeFontSize(-1),
      disabled: !ready || fontSize <= 10,
    },
    {
      label: t("editor.fontReset"),
      shortcut: "Ctrl+0",
      onClick: () => changeFontSize("reset"),
      disabled: !ready || fontSize === 13,
    },
  ];

  usePaneMenuRegistration(id, [
    { label: t("common.file"), items: fileMenu },
    { label: t("common.edit"), items: editMenu },
    { label: t("common.code"), items: codeMenu },
    { label: t("common.view"), items: viewMenu },
  ]);

  return (
    <div className="flex h-full w-full flex-col bg-ink-900">
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-ink-700/60 bg-ink-800 pl-2 pr-1 text-xs text-slate-400">
        <span className="flex min-w-0 items-center gap-1.5" title={filePath}>
          {focused && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />}
          <span className="truncate font-medium text-slate-300">{name}</span>
          {index !== undefined && (
            <span className="font-mono text-2xs text-slate-500">.{index}</span>
          )}
          {dirty && (
            <span className="text-amber-400" title={t("editor.unsaved")}>
              ●
            </span>
          )}
          <span className="shrink-0 rounded bg-ink-700 px-1.5 py-px text-2xs text-slate-400">
            {languageLabel(filePath, t("editor.plainText"))}
          </span>
          {ready && encoding !== "UTF-8" && (
            <span
              className="shrink-0 rounded bg-amber-400/15 px-1.5 py-px text-2xs text-amber-400"
              title={t("editor.encodingNotice", { encoding })}
            >
              {encoding}
            </span>
          )}
        </span>
        <button
          onClick={() => requestClose(id)}
          title={t("pane.close")}
          aria-label={t("pane.close")}
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
      {reloadConfirm && (
        <ConfirmDialog
          title={t("editor.reloadConfirm.title")}
          message={t("editor.reloadConfirm.message")}
          confirmLabel={t("editor.reloadConfirm.action")}
          danger
          onConfirm={() => {
            setReloadConfirm(false);
            void reloadFromServer(true);
          }}
          onCancel={() => setReloadConfirm(false)}
        />
      )}
      {fileConflict && (
        <FileConflictDialog
          fileName={name}
          busy={saving || reloading}
          onOverwrite={() => {
            setFileConflict(false);
            void doSave(true);
          }}
          onReload={() => {
            setFileConflict(false);
            void reloadFromServer(true);
          }}
          onCancel={() => setFileConflict(false)}
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
              {t("common.download")}
            </button>
          </div>
        ) : (
          <>
            <div ref={hostRef} className="h-full w-full overflow-auto" />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                {t("files.loading")}
              </div>
            )}
          </>
        )}
      </div>
      {ready && (
        <div className="flex h-6 shrink-0 items-center justify-end gap-3 border-t border-ink-700/60 bg-ink-800 px-2 font-mono text-2xs text-slate-500">
          <span title={t("editor.status.tabWidth")}>{t("editor.status.tab")}</span>
          <span title={t("editor.status.lineEnding")}>{lineEnding}</span>
          <span title={t("editor.status.encoding")}>{encoding}</span>
          <span title={t("editor.status.fontSize")}>{fontSize}px</span>
          <span ref={positionRef} className="min-w-[5.5rem] text-right" />
        </div>
      )}
    </div>
  );
}
