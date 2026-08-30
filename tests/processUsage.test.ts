import assert from "node:assert/strict";
import test from "node:test";

import { pidstatProcessRows } from "../src/lib/processUsage.ts";

const header =
  "# Time UID PID %usr %system %guest %wait %CPU CPU minflt/s majflt/s VSZ RSS %MEM Command";

test("parses horizontal pidstat CPU and memory rows", () => {
  const output = [
    "Linux 6.12.0 (server) 08/30/2026 x86_64 (8 CPU)",
    "",
    header,
    "14:30:01 1000 401 12.00 3.00 0.00 0.50 15.00 2 4.00 0.00 200000 50000 1.25 /usr/bin/node server.js",
    "14:30:01 0 99 1.00 2.00 0.00 0.00 3.00 0 0.00 0.00 10000 2000 0.05 sshd",
  ].join("\n");

  assert.deepEqual(pidstatProcessRows(output), [
    { pid: "401", cpu: "15.00", mem: "1.25", command: "/usr/bin/node server.js" },
    { pid: "99", cpu: "3.00", mem: "0.05", command: "sshd" },
  ]);
});

test("handles a locale-style AM/PM timestamp column", () => {
  const output = [
    header,
    "02:30:01 PM 1000 401 12.00 3.00 0.00 0.50 15.00 2 4.00 0.00 200000 50000 1.25 node",
  ].join("\n");

  assert.deepEqual(pidstatProcessRows(output), [
    { pid: "401", cpu: "15.00", mem: "1.25", command: "node" },
  ]);
});

test("does not mistake ps output for pidstat", () => {
  assert.equal(
    pidstatProcessRows(
      "USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\nroot 1 0.1 0.2 1 1 ? S 00:00 0:01 init",
    ),
    null,
  );
});
