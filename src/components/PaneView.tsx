import { LeafNode, PaneNode } from "../lib/panes";
import { useAppStore } from "../store";
import FilesScreen from "../screens/FilesScreen";
import TerminalPane from "./TerminalPane";

/** Recursively renders a pane tree into nested flex splits. */
export default function PaneView({ node }: { node: PaneNode }) {
  if (node.type === "leaf") return <Leaf node={node} />;

  const horizontal = node.direction === "horizontal";
  return (
    <div className={`flex h-full w-full ${horizontal ? "flex-row" : "flex-col"}`}>
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexGrow: node.ratio, flexShrink: 1, flexBasis: 0 }}
      >
        <PaneView node={node.children[0]} />
      </div>
      <div
        className={`shrink-0 bg-ink-700 ${horizontal ? "w-px" : "h-px"}`}
      />
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexGrow: 1 - node.ratio, flexShrink: 1, flexBasis: 0 }}
      >
        <PaneView node={node.children[1]} />
      </div>
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
