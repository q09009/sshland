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
import { useSettings } from "../lib/settings";
import FilesScreen from "../screens/FilesScreen";
import TerminalPane from "./TerminalPane";
import EditorPane from "./EditorPane";
import DashboardPane from "./DashboardPane";
import { useI18n } from "../i18n";

/**
 * Renders the pane tree as a FLAT list of absolutely-positioned leaves plus
 * draggable dividers. Keeping leaves as flat, id-keyed children (instead of
 * nested splits) means a leaf's React component — and its live PTY — survives
 * when the tree is restructured (e.g. a sibling pane is closed).
 */
export default function PaneView({ node }: { node: PaneNode }) {
  const { leaves, dividers } = useMemo(() => collectLayout(node), [node]);
  const [resizing, setResizing] = useState(false);

  return (
    <div
      className="pane-stage relative h-full w-full overflow-hidden bg-transparent"
      data-resizing={resizing || undefined}
    >
      {leaves.map(({ node: leaf, rect }, i) => (
        <div
          key={leaf.id}
          className="pane-layout-slot absolute"
          style={paneStyle(rect)}
        >
          <Leaf node={leaf} index={i + 1} />
        </div>
      ))}
      {dividers.map((d) => (
        <Divider
          key={d.splitId}
          layout={d}
          onDraggingChange={setResizing}
        />
      ))}
    </div>
  );
}

const EDGE_EPSILON = 0.000001;

function startInset(position: number) {
  return position <= EDGE_EPSILON
    ? "var(--space-pane-edge)"
    : "var(--space-pane-half-gap)";
}

function endInset(position: number) {
  return position >= 1 - EDGE_EPSILON
    ? "var(--space-pane-edge)"
    : "var(--space-pane-half-gap)";
}

/**
 * Keep the pane tree's normalized geometry intact while insetting each visual
 * surface. Adjacent panes each contribute half the gap; outer panes use the
 * full edge spacing token.
 */
function paneStyle(rect: Rect) {
  const leftInset = startInset(rect.x);
  const topInset = startInset(rect.y);
  const rightInset = endInset(rect.x + rect.w);
  const bottomInset = endInset(rect.y + rect.h);
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;
  const enterX =
    centerX < 0.45
      ? "calc(var(--distance-spatial) * -1)"
      : centerX > 0.55
        ? "var(--distance-spatial)"
        : "0px";
  const enterY =
    centerY < 0.45
      ? "calc(var(--distance-spatial) * -1)"
      : centerY > 0.55
        ? "var(--distance-spatial)"
        : "0px";

  return {
    left: `calc(${rect.x * 100}% + ${leftInset})`,
    top: `calc(${rect.y * 100}% + ${topInset})`,
    width: `calc(${rect.w * 100}% - ${leftInset} - ${rightInset})`,
    height: `calc(${rect.h * 100}% - ${topInset} - ${bottomInset})`,
    "--pane-enter-x": enterX,
    "--pane-enter-y": enterY,
  } as React.CSSProperties;
}

function Divider({
  layout,
  onDraggingChange,
}: {
  layout: DividerLayout;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const setRatio = useAppStore((s) => s.setRatio);
  const [dragging, setDragging] = useState(false);
  const horizontal = layout.direction === "horizontal";

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    setDragging(true);
    onDraggingChange(true);
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
      onDraggingChange(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const style = horizontal
    ? {
        left: `${layout.x * 100}%`,
        top: `calc(${layout.parentRect.y * 100}% + ${startInset(
          layout.parentRect.y
        )})`,
        height: `calc(${layout.parentRect.h * 100}% - ${startInset(
          layout.parentRect.y
        )} - ${endInset(layout.parentRect.y + layout.parentRect.h)})`,
        width: "var(--space-pane-gap)",
        transform: "translateX(-50%)",
      }
    : {
        top: `${layout.y * 100}%`,
        left: `calc(${layout.parentRect.x * 100}% + ${startInset(
          layout.parentRect.x
        )})`,
        width: `calc(${layout.parentRect.w * 100}% - ${startInset(
          layout.parentRect.x
        )} - ${endInset(layout.parentRect.x + layout.parentRect.w)})`,
        height: "var(--space-pane-gap)",
        transform: "translateY(-50%)",
      };

  return (
    <>
      <div
        onMouseDown={onDown}
        style={style}
        data-dragging={dragging || undefined}
        className={`pane-divider absolute z-10 ${
          horizontal ? "cursor-col-resize" : "cursor-row-resize"
        }`}
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

function Leaf({ node, index }: { node: LeafNode; index: number }) {
  const focused = useAppStore((s) => s.focusedPaneId === node.id);
  const setFocus = useAppStore((s) => s.setFocus);
  // The editor provides its own metadata header, so it skips the generic
  // PaneHeader; its commands live in the app-wide contextual menu.
  const isEditor = node.content === "editor";

  return (
    <div
      onMouseDownCapture={() => setFocus(node.id)}
      data-focused={focused}
      className="pane-surface flex h-full w-full flex-col overflow-hidden"
    >
      {!isEditor && <PaneHeader node={node} index={index} focused={focused} />}
      <div className="min-h-0 flex-1 overflow-hidden">
        {node.content === "file-manager" ? (
          <FilesScreen id={node.id} />
        ) : node.content === "editor" ? (
          <EditorPane
            id={node.id}
            filePath={node.filePath ?? ""}
            index={index}
            focused={focused}
          />
        ) : node.content === "dashboard" ? (
          <DashboardPane id={node.id} />
        ) : (
          <TerminalPane id={node.id} />
        )}
      </div>
    </div>
  );
}

/** Slim per-pane title bar with content-switch and close controls. */
function PaneHeader({
  node,
  index,
  focused,
}: {
  node: LeafNode;
  index: number;
  focused: boolean;
}) {
  const setPaneContent = useAppStore((s) => s.setPaneContent);
  const requestClose = useAppStore((s) => s.requestClose);
  const canClose = useAppStore((s) => leafCount(s.paneTree) > 1);
  const dashboardEnabled = useSettings((s) => s.settings.dashboardEnabled);
  const { t } = useI18n();
  const isFm = node.content === "file-manager";
  const isDashboard = node.content === "dashboard";

  const label = isFm
    ? t("pane.fileManager")
    : isDashboard
      ? t("pane.dashboard")
      : t("pane.terminal");

  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-b border-ink-700/60 bg-ink-800 pl-2.5 pr-1 text-xs text-slate-400">
      <span className="flex items-center gap-1.5 select-none">
        {focused && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />}
        <span className="font-medium text-slate-300">{label}</span>
        <span className="font-mono text-2xs text-slate-500">.{index}</span>
      </span>
      <span className="flex items-center gap-0.5">
        {isDashboard ? (
          <button
            onClick={() => setPaneContent(node.id, "file-manager")}
            title={t("pane.switchToFileManager")}
            className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
          >
            📁
          </button>
        ) : (
          <>
            <button
              onClick={() =>
                setPaneContent(node.id, isFm ? "terminal" : "file-manager")
              }
              title={isFm ? t("pane.switchToTerminal") : t("pane.switchToFileManager")}
              className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
            >
              ⇄
            </button>
            {dashboardEnabled && (
              <button
                onClick={() => setPaneContent(node.id, "dashboard")}
                title={t("pane.switchToDashboard")}
                className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
              >
                📊
              </button>
            )}
          </>
        )}
        <button
          onClick={() => requestClose(node.id)}
          disabled={!canClose}
          title={t("pane.close")}
          className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ✕
        </button>
      </span>
    </div>
  );
}
