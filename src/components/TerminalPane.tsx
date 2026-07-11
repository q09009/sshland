import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import {
  closeTerminal,
  openTerminal,
  resizeTerminal,
  TerminalOutput,
  writeTerminal,
} from "../api";
import { useAppStore } from "../store";

const THEME = {
  background: "#0f172a",
  foreground: "#e2e8f0",
  cursor: "#38bdf8",
  selectionBackground: "#334155",
  black: "#1e293b",
  brightBlack: "#475569",
};

/**
 * A single interactive shell rendered with xterm.js. Opens a PTY channel on
 * mount (using the provided pane id) and cleans it up on unmount.
 */
export default function TerminalPane({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const focused = useAppStore((s) => s.focusedPaneId === id);

  // Give the shell input focus when this pane becomes the focused one.
  useEffect(() => {
    if (focused) termRef.current?.focus();
  }, [focused]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily:
        '"Cascadia Code", "D2Coding", Consolas, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;

    const encoder = new TextEncoder();
    let disposed = false;

    // Open the PTY with the current terminal size.
    openTerminal(id, term.cols, term.rows).catch(() => {
      if (!disposed) term.write("\r\n\x1b[31m터미널을 열지 못했어요.\x1b[0m\r\n");
    });

    // Keystrokes -> shell.
    const dataSub = term.onData((data) => {
      writeTerminal(id, Array.from(encoder.encode(data))).catch(() => {});
    });

    // Copy (Ctrl+Shift+C) / paste (Ctrl+Shift+V).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
        const sel = term.getSelection();
        if (sel) void navigator.clipboard.writeText(sel);
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.code === "KeyV") {
        void navigator.clipboard.readText().then((text) => {
          if (text) writeTerminal(id, Array.from(encoder.encode(text))).catch(() => {});
        });
        return false;
      }
      return true;
    });

    // Shell output -> terminal (batched bytes from the backend).
    const outputSub = listen<TerminalOutput>("terminal-output", (e) => {
      if (e.payload.id === id) term.write(new Uint8Array(e.payload.data));
    });
    const closedSub = listen<string>("terminal-closed", (e) => {
      if (e.payload === id && !disposed) {
        term.write("\r\n\x1b[90m[세션이 종료되었습니다]\x1b[0m\r\n");
      }
    });

    // Keep the PTY size in sync with the pane.
    const doResize = () => {
      try {
        fit.fit();
        resizeTerminal(id, term.cols, term.rows).catch(() => {});
      } catch {
        /* element not visible yet */
      }
    };
    const observer = new ResizeObserver(doResize);
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      dataSub.dispose();
      outputSub.then((fn) => fn());
      closedSub.then((fn) => fn());
      closeTerminal(id).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
  }, [id]);

  return <div ref={hostRef} className="h-full w-full bg-ink-900 p-1" />;
}
