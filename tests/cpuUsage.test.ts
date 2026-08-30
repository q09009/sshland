import assert from "node:assert/strict";
import test from "node:test";

import {
  cpuCounters,
  cpuUsageBetween,
  sysstatCpuUsage,
} from "../src/lib/cpuUsage.ts";

const header = "USER NICE SYSTEM IDLE IOWAIT IRQ SOFTIRQ STEAL";

test("parses aggregate /proc/stat counters", () => {
  assert.deepEqual(
    cpuCounters(`${header}\n100 2 30 800 20 1 4 3\n`),
    {
      user: 100,
      nice: 2,
      system: 30,
      idle: 800,
      iowait: 20,
      irq: 1,
      softirq: 4,
      steal: 3,
    },
  );
});

test("calculates usage from the difference between two snapshots", () => {
  const previous = cpuCounters(`${header}\n100 0 50 800 50 0 0 0`);
  const current = cpuCounters(`${header}\n130 0 70 840 60 0 0 0`);
  assert.ok(previous && current);
  assert.equal(cpuUsageBetween(previous, current), 50);
});

test("treats iowait as idle time", () => {
  const previous = cpuCounters(`${header}\n100 0 0 800 0 0 0 0`);
  const current = cpuCounters(`${header}\n100 0 0 800 100 0 0 0`);
  assert.ok(previous && current);
  assert.equal(cpuUsageBetween(previous, current), 0);
});

test("rejects malformed and reset samples", () => {
  assert.equal(cpuCounters("cpu 1 2 3"), null);
  const previous = cpuCounters(`${header}\n100 0 50 800 50 0 0 0`);
  const reset = cpuCounters(`${header}\n10 0 5 80 5 0 0 0`);
  assert.ok(previous && reset);
  assert.equal(cpuUsageBetween(previous, reset), null);
  assert.equal(cpuUsageBetween(previous, previous), null);
});

test("parses total and per-core mpstat JSON", () => {
  const output = JSON.stringify({
    sysstat: {
      hosts: [
        {
          statistics: [
            {
              timestamp: "12:00:01",
              "cpu-load": [
                { cpu: "all", usr: 20, sys: 10, iowait: 5, idle: 65 },
                { cpu: "0", usr: 35, sys: 10, iowait: 5, idle: 50 },
                { cpu: "1", usr: 5, sys: 10, iowait: 5, idle: 80 },
              ],
            },
          ],
        },
      ],
    },
  });
  const rows = sysstatCpuUsage(output);
  assert.ok(rows);
  assert.deepEqual(rows.map(({ cpu, usage }) => ({ cpu, usage })), [
    { cpu: "all", usage: 30 },
    { cpu: "0", usage: 45 },
    { cpu: "1", usage: 15 },
  ]);
});

test("rejects malformed mpstat JSON", () => {
  assert.equal(sysstatCpuUsage("not-json"), null);
  assert.equal(sysstatCpuUsage('{"sysstat":{"hosts":[]}}'), null);
});
