import { useMemo, useState } from "react";
import {
  collectLayout,
  DividerLayout,
  LeafNode,
  leafCount,
  PaneNode,
  Rect,
} from "../lib/panes";
import { useAppStore } from "../store";
import FilesScreen from "../screens/FilesScreen";
import TerminalPane from "./TerminalPane";

/**
 * Renders the pane tree as a FLAT list of absolutely-positioned leaves plus
 * draggable dividers. Keeping leaves as flat, id-keyed children (instead of
 * nested splits) means a leaf's React component — and its live PTY — survives
 * when the tree is restructured (e.g. a sibling pane is closed).
 */
export default function PaneView({ node }: { node: PaneNode }) {
  const { leaves, dividers } = useMemo(() => collectLayout(node), [node]);

  return (
    <div className="relative h-full w-full">
      {leaves.map(({ node: leaf, rect }) => (
        <div key={leaf.id} className="absolute" style={pctStyle(rect)}>
          <Leaf node={leaf} />
        </div>
      ))}
      {dividers.map((d) => (
        <Divider key={d.splitId} layout={d} />
      ))}
    </div>
  );
}

function pctStyle(rect: Rect) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

function Divider({ layout }: { layout: DividerLayout }) {
  const setRatio = useAppStore((s) => s.setRatio);
  const [dragging, setDragging] = useState(false);
  const horizontal = layout.direction === "horizontal";

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    setDragging(true);
    const parent = layout.parentRect;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const fx = (ev.clientX - rect.left) / rect.width;
      const fy = (ev.clientY - rect.top) / rect.height;
      const raw = horizontal
        ? (fx - parent.x) / parent.w
        : (fy - parent.y) / parent.h;
      setRatio(layout.splitId, Math.min(0.9, Math.max(0.1, raw)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const style = horizontal
    ? {
        left: `${layout.x * 100}%`,
        top: `${layout.parentRect.y * 100}%`,
        height: `${layout.parentRect.h * 100}%`,
        width: 6,
        transform: "translateX(-50%)",
      }
    : {
        top: `${layout.y * 100}%`,
        left: `${layout.parentRect.x * 100}%`,
        width: `${layout.parentRect.w * 100}%`,
        height: 6,
        transform: "translateY(-50%)",
      };

  return (
    <>
      <div
        onMouseDown={onDown}
        style={style}
        className={`absolute z-10 ${
          horizontal ? "cursor-col-resize" : "cursor-row-resize"
        } ${dragging ? "bg-sky-500" : "bg-ink-700 hover:bg-sky-500"}`}
      />
      {dragging && (
        <div
          className="fixed inset-0 z-40"
          style={{ cursor: horizontal ? "col-resize" : "row-resize" }}
        />
      )}
    </>
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
          <FilesScreen paneId={node.id} />
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
          onClick={() =>
            setPaneContent(node.id, isFm ? "terminal" : "file-manager")
          }
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
