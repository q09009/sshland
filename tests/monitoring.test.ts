import assert from "node:assert/strict";
import test from "node:test";

import {
  emptySysstatToolStatus,
  parseSysstatToolCheck,
  resolveMonitoringEngine,
  SYSSTAT_CHECK_COMMAND,
} from "../src/lib/monitoring.ts";

test("checks only the sysstat tools used by the dashboard", () => {
  assert.match(SYSSTAT_CHECK_COMMAND, /mpstat pidstat/);
  assert.doesNotMatch(SYSSTAT_CHECK_COMMAND, /iostat|sar/);
});

test("parses an available sysstat check with its version", () => {
  assert.deepEqual(
    parseSysstatToolCheck(
      "__SSHLAND_SYSSTAT__:available\nsysstat version 12.7.7\n",
    ),
    {
      checked: true,
      available: true,
      version: "sysstat version 12.7.7",
      missing: [],
    },
  );
});

test("parses missing sysstat commands", () => {
  assert.deepEqual(
    parseSysstatToolCheck("__SSHLAND_SYSSTAT__:missing:mpstat,pidstat\n"),
    {
      checked: true,
      available: false,
      version: null,
      missing: ["mpstat", "pidstat"],
    },
  );
});

test("falls back to built-in monitoring until sysstat is available", () => {
  assert.equal(resolveMonitoringEngine("sysstat", emptySysstatToolStatus()), "builtin");
  assert.equal(
    resolveMonitoringEngine("sysstat", {
      checked: true,
      available: true,
      version: null,
      missing: [],
    }),
    "sysstat",
  );
});
