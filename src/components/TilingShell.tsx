import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { disconnect, TransferProgress } from "../api";
import { useAppStore } from "../store";
import PaneView from "./PaneView";
import ShortcutsHelp from "./ShortcutsHelp";
import TransfersPanel from "./TransfersPanel";
import DragLayer from "./DragLayer";

/** Hosts the pane tree, global tiling shortcuts, and connection-wide events. */
export default function TilingShell() {
  const paneTree = useAppStore((s) => s.paneTree);
  const splitFocused = useAppStore((s) => s.splitFocused);
  const moveFocus = useAppStore((s) => s.moveFocus);
  const requestClose = useAppStore((s) => s.requestClose);
  const updateTransfer = useAppStore((s) => s.updateTransfer);
  const returnToConnect = useAppStore((s) => s.returnToConnect);

  // Tiling keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.shiftKey) {
        if (e.code === "KeyH") {
          e.preventDefault();
          e.stopPropagation();
          splitFocused("horizontal");
        } else if (e.code === "KeyV") {
          e.preventDefault();
          e.stopPropagation();
          splitFocused("vertical");
        } else if (e.code === "KeyW") {
          e.preventDefault();
          e.stopPropagation();
          requestClose(useAppStore.getState().focusedPaneId);
        }
        return;
      }
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
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [splitFocused, moveFocus, requestClose]);

  // Transfer progress (shared across all panes).
  useEffect(() => {
    const unlisten = listen<TransferProgress>("transfer-progress", (e) => {
      updateTransfer(e.payload.id, e.payload.transferred, e.payload.total);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [updateTransfer]);

  // Connection dropped: return to the connect screen.
  useEffect(() => {
    const unlisten = listen("connection-lost", () => {
      void disconnect().catch(() => {});
      returnToConnect("서버와의 연결이 끊어졌어요. 다시 접속해주세요.");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [returnToConnect]);

  return (
    <div className="h-full w-full">
      <PaneView node={paneTree} />
      <ShortcutsHelp />
      <TransfersPanel />
      <DragLayer />
    </div>
  );
}
