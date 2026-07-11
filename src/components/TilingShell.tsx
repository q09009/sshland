import { useEffect } from "react";
import { useAppStore } from "../store";
import PaneView from "./PaneView";
import ShortcutsHelp from "./ShortcutsHelp";

/** Hosts the pane tree and the global tiling keyboard shortcuts. */
export default function TilingShell() {
  const paneTree = useAppStore((s) => s.paneTree);
  const splitFocused = useAppStore((s) => s.splitFocused);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.altKey && e.shiftKey)) return;
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
    };
    // Capture phase so shortcuts win even when a terminal has focus.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [splitFocused]);

  return (
    <div className="h-full w-full">
      <PaneView node={paneTree} />
      <ShortcutsHelp />
    </div>
  );
}
