import { useCallback, useEffect, useRef } from "react";
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
import { colorToken, token } from "../lib/theme";

/** xterm color theme, sourced from the central design tokens (see index.css). */
function terminalTheme() {
  return {
    background: colorToken("--color-ink-900"),
    foreground: colorToken("--color-slate-200"),
    cursor: colorToken("--color-sky-400"),
    selectionBackground: colorToken("--color-ink-700"),
    black: colorToken("--color-ink-800"),
    brightBlack: colorToken("--color-ink-600"),
  };
}

/** How often to repaint an unfocused terminal that keeps producing output. */
const BLUR_FLUSH_MS = 200;

/**
 * A single interactive shell rendered with xterm.js. Opens a PTY channel on
 * mount (using the pane id) and cleans it up on unmount.
 *
 * Performance: the focused terminal writes output immediately; unfocused
 * terminals buffer output and flush at ~5fps, so background panes streaming
 * logs don't burn CPU repainting every frame.
 */
export default function TerminalPane({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const pendingRef = useRef<Uint8Array[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const focusedRef = useRef(false);
  const focused = useAppStore((s) => s.focusedPaneId === id);

  const flush = useCallback(() => {
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const term = termRef.current;
    if (!term || pendingRef.current.length === 0) return;
    const chunks = pendingRef.current;
    pendingRef.current = [];
    for (const c of chunks) term.write(c);
  }, []);

  // When this pane gains focus: flush any buffered output and grab input.
  useEffect(() => {
    focusedRef.current = focused;
    if (focused) {
      flush();
      termRef.current?.focus();
    }
  }, [focused, flush]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: token("--font-terminal"),
      fontSize: 13,
      cursorBlink: true,
      theme: terminalTheme(),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;

    const encoder = new TextEncoder();
    let disposed = false;

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
          if (text)
            writeTerminal(id, Array.from(encoder.encode(text))).catch(() => {});
        });
        return false;
      }
      return true;
    });

    // Shell output: write immediately if focused, otherwise buffer + throttle.
    const outputSub = listen<TerminalOutput>("terminal-output", (e) => {
      if (e.payload.id !== id) return;
      const bytes = new Uint8Array(e.payload.data);
      if (focusedRef.current) {
        term.write(bytes);
      } else {
        pendingRef.current.push(bytes);
        if (flushTimerRef.current == null) {
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            flush();
          }, BLUR_FLUSH_MS);
        }
      }
    });
    const closedSub = listen<string>("terminal-closed", (e) => {
      if (e.payload === id && !disposed) {
        flush();
        term.write("\r\n\x1b[90m[세션이 종료되었습니다]\x1b[0m\r\n");
      }
    });

    // Keep the PTY size in sync with the pane (debounced backend call).
    let resizeTimer: number | null = null;
    const doResize = () => {
      try {
        fit.fit();
      } catch {
        return; /* element not visible yet */
      }
      if (resizeTimer != null) clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTerminal(id, term.cols, term.rows).catch(() => {});
      }, 100);
    };
    const observer = new ResizeObserver(doResize);
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      if (resizeTimer != null) clearTimeout(resizeTimer);
      if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
      dataSub.dispose();
      outputSub.then((fn) => fn());
      closedSub.then((fn) => fn());
      closeTerminal(id).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
  }, [id, flush]);

  return <div ref={hostRef} className="h-full w-full bg-ink-900 p-1" />;
}
