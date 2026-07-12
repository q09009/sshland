#!/usr/bin/env node
// Free a TCP port by killing whatever process is LISTENING on it.
//
// Tauri pins the dev server to a fixed port (1420, strictPort) because its
// devUrl points there, so a leftover Vite/Node process from a previous run (or
// a Tauri crash) makes `npm run tauri dev` fail with "Port 1420 is already in
// use". This runs as the `predev` npm hook, so every `npm run dev` (including
// the one Tauri's beforeDevCommand invokes) frees the port first.
//
// Cross-platform (Windows netstat/taskkill, Unix lsof/kill). It always exits 0:
// if it can't free the port, Vite will surface the real error itself.
import { execSync } from "node:child_process";

const port = Number(process.argv[2] || 1420);
const self = process.pid;

/** PIDs currently LISTENING on `port`. */
function pidsOnPort(port) {
  const pids = new Set();
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
      for (const line of out.split(/\r?\n/)) {
        // Columns: Proto  LocalAddress  ForeignAddress  State  PID
        const parts = line.trim().split(/\s+/);
        if (
          parts.length >= 5 &&
          /^LISTENING$/i.test(parts[3]) &&
          parts[1].endsWith(`:${port}`)
        ) {
          const pid = Number(parts[4]);
          if (pid > 0) pids.add(pid);
        }
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
        encoding: "utf8",
      });
      for (const line of out.split(/\r?\n/)) {
        const pid = Number(line.trim());
        if (pid > 0) pids.add(pid);
      }
    }
  } catch {
    // netstat/lsof found nothing (or isn't installed) — treat as no PIDs.
  }
  return [...pids];
}

/** Force-kill a process, returning whether it succeeded. */
function kill(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
}

/** Synchronous sleep (this script must finish before Vite starts). */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const pids = pidsOnPort(port).filter((pid) => pid !== self);
for (const pid of pids) {
  if (kill(pid)) {
    console.log(`[free-port] freed port ${port} (killed leftover pid ${pid})`);
  }
}
// Wait briefly for the OS to release the socket so Vite can bind it right away.
for (let i = 0; i < 20 && pidsOnPort(port).length > 0; i++) {
  sleep(100);
}
process.exit(0);
