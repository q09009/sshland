import { useEffect, useRef, useState } from "react";
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
} from "@codemirror/commands";
import { download, readRemoteFile } from "../api";
import { useAppStore } from "../store";
import { baseName } from "../lib/path";
import { editorTheme } from "../lib/editorTheme";

/**
 * A lightweight text/code editor for one remote file, rendered with CodeMirror
 * 6. Loads the file's contents into memory on mount (no local temp file) and
 * shows them for editing. Syntax highlighting, saving, and dirty-tracking are
 * layered on in later steps; this is the base load/display integration.
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const closePane = useAppStore((s) => s.closePane);
  const startTransfer = useAppStore((s) => s.startTransfer);
  const finishTransfer = useAppStore((s) => s.finishTransfer);

  const name = baseName(filePath);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);

    readRemoteFile(filePath)
      .then((contents) => {
        if (disposed) return;
        const host = hostRef.current;
        if (!host) return;

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
              keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
              editorTheme(),
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
  }, [filePath]);

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

  return (
    <div className="flex h-full w-full flex-col bg-ink-900">
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-ink-700/60 bg-ink-800 pl-2 pr-1 text-xs text-slate-400">
        <span className="truncate" title={filePath}>
          📝 {name}
        </span>
        <button
          onClick={() => closePane(id)}
          title="pane 닫기"
          className="rounded px-1.5 py-0.5 hover:bg-red-500/20 hover:text-red-300"
        >
          ✕
        </button>
      </div>
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
