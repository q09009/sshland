import { useRef, useState } from "react";
import { LeafNode, PaneNode, SplitNode } from "../lib/panes";
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
      className={`h-full w-full overflow-hidden border-2 ${
        focused ? "border-sky-500" : "border-transparent"
      }`}
    >
      {node.content === "file-manager" ? (
        <FilesScreen />
      ) : (
        <TerminalPane id={node.id} />
      )}
    </div>
  );
}
