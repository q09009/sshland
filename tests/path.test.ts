import assert from "node:assert/strict";
import test from "node:test";

import {
  localBreadcrumbs,
  localParentPath,
  localPathContains,
  localRoot,
} from "../src/lib/path.ts";

test("handles Windows local roots and parents", () => {
  assert.equal(localRoot("C:/Users/alice"), "C:/");
  assert.equal(localParentPath("C:/Users/alice"), "C:/Users");
  assert.equal(localParentPath("C:/"), "C:/");
  assert.deepEqual(localBreadcrumbs("C:/Users/alice"), [
    { name: "C:/", path: "C:/" },
    { name: "Users", path: "C:/Users" },
    { name: "alice", path: "C:/Users/alice" },
  ]);
});

test("handles Unix local roots and containment", () => {
  assert.equal(localParentPath("/home/alice"), "/home");
  assert.equal(localParentPath("/"), "/");
  assert.equal(localPathContains("/home/alice", "/home/alice/docs"), true);
  assert.equal(localPathContains("/home/alice", "/home/alice2"), false);
  assert.equal(localPathContains("/home/Alice", "/home/alice/docs"), false);
});
