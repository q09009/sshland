import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  attachShellIntegration,
  SHELL_INTEGRATION_SETUP,
} from "../lib/shellIntegration";
import { matchCommand, useCommandConfigs } from "../lib/commandConfigs";
import { useSettings } from "../lib/settings";
import CommandWidgetPanel, {
  CommandResult,
} from "./CommandWidgetPanel";

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

  // Command-GUI results captured in this pane, and which one is open below.
  const [results, setResults] = useState<CommandResult[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

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
      allowProposedApi: true, // for buffer markers + inline decorations
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;

    const encoder = new TextEncoder();
    let disposed = false;

    // Detect command boundaries via OSC 133 markers. When a command's output
    // matches a config, drop a small inline "view as GUI" icon on its line
    // (a decoration) that opens the rendered widget in the panel below.
    const shellIntegration = attachShellIntegration(term, (block) => {
      if (!useSettings.getState().settings.commandGuiEnabled) return;
      const config = matchCommand(
        useCommandConfigs.getState().configs,
        block.command
      );
      if (!config || !block.marker) return;

      const resultId = crypto.randomUUID();
      setResults((prev) => [
        ...prev,
        {
          id: resultId,
          command: block.command,
          output: block.output,
          config,
        },
      ]);

      const decoration = term.registerDecoration({
        marker: block.marker,
        x: 0,
        width: 3,
        height: 1,
      });
      decoration?.onRender((el) => {
        el.textContent = "▦";
        el.title = "GUI로 보기";
        el.style.cursor = "pointer";
        el.style.pointerEvents = "auto";
        el.style.color = colorToken("--color-ink-900");
        el.style.background = colorToken("--color-sky-400");
        el.style.textAlign = "center";
        el.style.borderRadius = "2px";
        el.onclick = () => setOpenId(resultId);
      });
    });

    openTerminal(id, term.cols, term.rows)
      .then(() => {
        // Inject the shell-integration setup once the shell is ready.
        writeTerminal(
          id,
          Array.from(encoder.encode(SHELL_INTEGRATION_SETUP))
        ).catch(() => {});
      })
      .catch(() => {
        if (!disposed)
          term.write("\r\n\x1b[31m터미널을 열지 못했어요.\x1b[0m\r\n");
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
      shellIntegration.dispose();
      outputSub.then((fn) => fn());
      closedSub.then((fn) => fn());
      closeTerminal(id).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
  }, [id, flush]);

  const openResult = openId
    ? results.find((r) => r.id === openId) ?? null
    : null;

  return (
    <div className="flex h-full w-full flex-col bg-ink-900">
      <div ref={hostRef} className="min-h-0 flex-1 p-1" />
      {openResult && (
        <CommandWidgetPanel
          result={openResult}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
