import { useEffect } from "react";
import { useAppStore } from "../store";
import PaneView from "./PaneView";
import ShortcutsHelp from "./ShortcutsHelp";

/** Hosts the pane tree and the global tiling keyboard shortcuts. */
export default function TilingShell() {
  const paneTree = useAppStore((s) => s.paneTree);
  const splitFocused = useAppStore((s) => s.splitFocused);
  const moveFocus = useAppStore((s) => s.moveFocus);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.shiftKey) {
        // Split the focused pane, adding a new terminal.
        if (e.code === "KeyH") {
          e.preventDefault();
          e.stopPropagation();
          splitFocused("horizontal");
        } else if (e.code === "KeyV") {
          e.preventDefault();
          e.stopPropagation();
          splitFocused("vertical");
        }
        return;
      }
      // Alt + arrow: move focus to the adjacent pane.
      const dir =
        e.code === "ArrowLeft"
          ? "left"
          : e.code === "ArrowRight"
          ? "right"
          : e.code === "ArrowUp"
          ? "up"
          : e.code === "ArrowDown"
          ? "down"
          : null;
      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(dir);
      }
    };
    // Capture phase so shortcuts win even when a terminal has focus.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [splitFocused, moveFocus]);

  return (
    <div className="h-full w-full">
      <PaneView node={paneTree} />
      <ShortcutsHelp />
    </div>
  );
}
