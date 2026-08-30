import assert from "node:assert/strict";
import test from "node:test";

import {
  octalPermissionMode,
  permissionModeFromString,
  togglePermission,
} from "../src/lib/permissions.ts";

test("parses Unix listing permission strings", () => {
  assert.equal(permissionModeFromString("-rwxr-xr--"), 0o754);
  assert.equal(permissionModeFromString("drwx------"), 0o700);
  assert.equal(permissionModeFromString("short"), null);
});

test("toggles and formats permission bits", () => {
  assert.equal(togglePermission(0o644, 0o100), 0o744);
  assert.equal(togglePermission(0o744, 0o100), 0o644);
  assert.equal(octalPermissionMode(0o075), "075");
});
