// Unit tests for the license-policy gate (scripts/deny-copyleft.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCopyleft, findCopyleft } from "../scripts/deny-copyleft.mjs";

test("isCopyleft flags GPL/AGPL/SSPL but allows LGPL and permissive", () => {
  for (const yes of ["GPL-3.0", "GPL-2.0-only", "AGPL-3.0", "SSPL-1.0", "gpl-3.0"]) {
    assert.equal(isCopyleft(yes), true, `${yes} should be copyleft`);
  }
  for (const no of ["MIT", "Apache-2.0", "BSD-3-Clause", "LGPL-3.0", "LGPL-2.1", "MPL-2.0", "", null]) {
    assert.equal(isCopyleft(no), false, `${no} should be allowed`);
  }
});

test("findCopyleft reads spdx_license_key, key, and detected_license_expression", () => {
  const scancode = {
    files: [
      { path: "node_modules/a/LICENSE", licenses: [{ spdx_license_key: "MIT" }] },
      { path: "node_modules/b/LICENSE", licenses: [{ spdx_license_key: "AGPL-3.0" }] },
      { path: "node_modules/c/LICENSE", detected_license_expression: "GPL-2.0-only" },
      { path: "node_modules/d/LICENSE", licenses: [{ key: "lgpl-3.0" }] },
    ],
  };
  const offenders = findCopyleft(scancode);
  assert.deepEqual(offenders.map((o) => o.path).sort(), ["node_modules/b/LICENSE", "node_modules/c/LICENSE"]);
});

test("findCopyleft trips on a GPL component inside a composite expression", () => {
  const scancode = { files: [{ path: "x", detected_license_expression: "MIT AND GPL-3.0-or-later" }] };
  assert.equal(findCopyleft(scancode).length, 1);
});

test("findCopyleft is empty for an all-permissive tree and tolerates missing fields", () => {
  assert.deepEqual(findCopyleft({ files: [{ path: "x", licenses: [{ spdx_license_key: "Apache-2.0" }] }] }), []);
  assert.deepEqual(findCopyleft({}), []);
  assert.deepEqual(findCopyleft(null), []);
});
