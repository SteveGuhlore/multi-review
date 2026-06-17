// Unit tests for the mutation-guided test-synthesis acceptance gate (lib/synth.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectGeneratedTests, rejectionReason, summarizeSynthesis } from "../lib/synth.mjs";

const good = { name: "t-good", runsClean: true, killsMutant: true, raisesCoverage: true, flaky: false };

test("rejectionReason: admissible test returns null", () => {
  assert.equal(rejectionReason(good), null);
});

test("rejectionReason: priority order of criteria", () => {
  assert.equal(rejectionReason({ ...good, runsClean: false }), "does not run / fails");
  assert.equal(rejectionReason({ ...good, flaky: true }), "flaky (non-deterministic)");
  assert.equal(rejectionReason({ ...good, killsMutant: false }), "kills no mutant (no teeth)");
  assert.equal(rejectionReason({ ...good, raisesCoverage: false }), "raises no coverage");
  // A broken test that is also flaky reports the higher-priority failure first.
  assert.equal(rejectionReason({ ...good, runsClean: false, flaky: true }), "does not run / fails");
});

test("selectGeneratedTests keeps only admissible candidates", () => {
  const r = selectGeneratedTests([
    good,
    { name: "t-flaky", runsClean: true, killsMutant: true, raisesCoverage: true, flaky: true },
    { name: "t-toothless", runsClean: true, killsMutant: false, raisesCoverage: true, flaky: false },
    { name: "t-redundant", runsClean: true, killsMutant: true, raisesCoverage: false, flaky: false },
  ]);
  assert.deepEqual(r.kept, ["t-good"]);
  assert.deepEqual(r.rejected.map((x) => x.name).sort(), ["t-flaky", "t-redundant", "t-toothless"]);
  assert.equal(r.rejected.find((x) => x.name === "t-flaky").reason, "flaky (non-deterministic)");
});

test("summarizeSynthesis: gate passes only if ≥1 trustworthy test admitted", () => {
  const pass = summarizeSynthesis(selectGeneratedTests([good]));
  assert.deepEqual(pass, { admitted: 1, proposed: 1, admitRate: 1, pass: true });
  const fail = summarizeSynthesis(selectGeneratedTests([{ ...good, killsMutant: false }]));
  assert.equal(fail.pass, false);
  assert.equal(fail.admitRate, 0);
  assert.equal(summarizeSynthesis().pass, false);
});
