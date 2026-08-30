import assert from "node:assert/strict";
import test from "node:test";

import { operationToCommandString } from "../src/lib/commandLog.ts";

const remote = { user: "alice", host: "server" };

test("shows the collision-safe destination name for cross-side uploads", () => {
  assert.equal(
    operationToCommandString(
      {
        type: "upload",
        localPath: "C:/Users/alice/report.txt",
        remoteDir: "/home/alice",
        remotePath: "/home/alice/report 복사본.txt",
        isDir: false,
      },
      remote,
    ),
    "scp ./report.txt alice@server:'/home/alice/report 복사본.txt'",
  );
});

test("shows the collision-safe destination name for cross-side downloads", () => {
  assert.equal(
    operationToCommandString(
      {
        type: "download",
        remotePath: "/home/alice/report.txt",
        localName: "report copy.txt",
      },
      remote,
    ),
    "scp alice@server:/home/alice/report.txt './report copy.txt'",
  );
});
