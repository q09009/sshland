import { useRef, useState } from "react";
import { LeafNode, leafCount, PaneNode, SplitNode } from "../lib/panes";
import { useAppStore } from "../store";
import FilesScreen from "../screens/FilesScreen";
import TerminalPane from "./TerminalPane";

/** Recursively renders a pane tree into nested flex splits. */
export default function PaneView({ node }: { node: PaneNode }) {
  return node.type === "leaf" ? (
    <Leaf node={node} />
  ) : (
    <Split node={node} />
  );
}

function Split({ node }: { node: SplitNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setRatio = useAppStore((s) => s.setRatio);
  const [dragging, setDragging] = useState(false);
  const horizontal = node.direction === "horizontal";

  const onDividerDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const raw = horizontal
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      setRatio(node.id, Math.min(0.9, Math.max(0.1, raw)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full ${horizontal ? "flex-row" : "flex-col"}`}
    >
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexGrow: node.ratio, flexShrink: 1, flexBasis: 0 }}
      >
        <PaneView node={node.children[0]} />
      </div>

      <div
        onMouseDown={onDividerDown}
        className={`group shrink-0 bg-ink-700 transition-colors hover:bg-sky-500 ${
          horizontal
            ? "w-1 cursor-col-resize"
            : "h-1 cursor-row-resize"
        } ${dragging ? "bg-sky-500" : ""}`}
      />

      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexGrow: 1 - node.ratio, flexShrink: 1, flexBasis: 0 }}
      >
        <PaneView node={node.children[1]} />
      </div>

      {/* While dragging, an overlay captures the mouse so panes (terminals)
          underneath don't swallow the move events. */}
      {dragging && (
        <div
          className="fixed inset-0 z-50"
          style={{ cursor: horizontal ? "col-resize" : "row-resize" }}
        />
      )}
    </div>
  );
}

function Leaf({ node }: { node: LeafNode }) {
  const focused = useAppStore((s) => s.focusedPaneId === node.id);
  const setFocus = useAppStore((s) => s.setFocus);

  return (
    <div
      onMouseDownCapture={() => setFocus(node.id)}
      className={`flex h-full w-full flex-col overflow-hidden border-2 ${
        focused ? "border-sky-500" : "border-transparent"
      }`}
    >
      <PaneHeader node={node} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {node.content === "file-manager" ? (
          <FilesScreen />
        ) : (
          <TerminalPane id={node.id} />
        )}
      </div>
    </div>
  );
}

/** Slim per-pane title bar with content-switch and close controls. */
function PaneHeader({ node }: { node: LeafNode }) {
  const setPaneContent = useAppStore((s) => s.setPaneContent);
  const closePane = useAppStore((s) => s.closePane);
  const canClose = useAppStore((s) => leafCount(s.paneTree) > 1);
  const isFm = node.content === "file-manager";

  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-b border-ink-700/60 bg-ink-800 pl-2 pr-1 text-xs text-slate-400">
      <span className="select-none">
        {isFm ? "📁 파일관리자" : "❯_ 터미널"}
      </span>
      <span className="flex items-center gap-0.5">
        <button
          onClick={() => setPaneContent(node.id, isFm ? "terminal" : "file-manager")}
          title={isFm ? "터미널로 전환" : "파일관리자로 전환"}
          className="rounded px-1.5 py-0.5 hover:bg-ink-700 hover:text-slate-100"
        >
          ⇄
        </button>
        <button
          onClick={() => closePane(node.id)}
          disabled={!canClose}
          title="pane 닫기"
          className="rounded px-1.5 py-0.5 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ✕
        </button>
      </span>
    </div>
  );
}
