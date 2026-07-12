import { useEffect, useRef, useState } from "react";
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
import { readRemoteFile } from "../api";
import { baseName } from "../lib/path";
import { editorTheme } from "../lib/editorTheme";

/**
 * A lightweight text/code editor for one remote file, rendered with CodeMirror
 * 6. Loads the file's contents into memory on mount (no local temp file) and
 * shows them for editing. Syntax highlighting, saving, and dirty-tracking are
 * layered on in later steps; this is the base load/display integration.
 */
export default function EditorPane({ filePath }: { filePath: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex h-full w-full flex-col bg-ink-900">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-ink-700/60 bg-ink-800 px-2 text-xs text-slate-400">
        <span className="truncate" title={filePath}>
          📝 {baseName(filePath)}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-red-300">
            {error}
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
