// Unit tests for the self-evaluating loop metrics (lib/metrics.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSummary, slopRate, bugEscapeRate, classifyCommit, selfChangeAcceptable, aggregate,
} from "../lib/metrics.mjs";

test("runSummary counts gates, failures, and slop incidents", () => {
  const s = runSummary({
    ts: "t", gitSha: "abc", iteration: 1,
    gates: [{ name: "npm test", pass: true }, { name: "dead-code", pass: false }, { name: "a11y", pass: false }],
  });
  assert.equal(s.gatesTotal, 3);
  assert.equal(s.gatesFailed, 2);
  assert.equal(s.slopIncidents, 2); // dead-code + a11y
  assert.equal(s.gatesPassed, false);
});

test("slopRate averages slop incidents per run", () => {
  const summaries = [{ slopIncidents: 0 }, { slopIncidents: 2 }, { slopIncidents: 1 }];
  assert.equal(slopRate(summaries), 1);
  assert.equal(slopRate([]), 0);
});

test("bugEscapeRate = reverted among gate-passing (shipped) changes", () => {
  const history = [
    { passedGates: true, reverted: false },
    { passedGates: true, reverted: true },  // an escape: shipped clean, later reverted
    { passedGates: false, reverted: true }, // not shipped clean — not an escape
  ];
  assert.equal(bugEscapeRate(history), 0.5); // 1 of 2 shipped-clean reverted
  assert.equal(bugEscapeRate([]), 0);
});

test("classifyCommit detects reverts and hotfixes", () => {
  assert.equal(classifyCommit('Revert "feat: x"'), "revert");
  assert.equal(classifyCommit("hotfix: prod NPE"), "hotfix");
  assert.equal(classifyCommit("fix(regression): off-by-one"), "hotfix");
  assert.equal(classifyCommit("feat: add thing"), "normal");
});

test("selfChangeAcceptable: keep only if no metric worsens and one improves", () => {
  const base = { escapeRate: 0.2, slopRate: 1.0 };
  assert.equal(selfChangeAcceptable(base, { escapeRate: 0.1, slopRate: 1.0 }), true);  // escape improved
  assert.equal(selfChangeAcceptable(base, { escapeRate: 0.2, slopRate: 0.5 }), true);  // slop improved
  assert.equal(selfChangeAcceptable(base, { escapeRate: 0.2, slopRate: 1.0 }), false); // no change
  assert.equal(selfChangeAcceptable(base, { escapeRate: 0.1, slopRate: 1.5 }), false); // slop worsened
  assert.equal(selfChangeAcceptable(null, base), false);
});

test("aggregate rolls up runs + commit classes into a report", () => {
  const summaries = [{ slopIncidents: 0, gatesPassed: true }, { slopIncidents: 2, gatesPassed: false }];
  const classes = ["normal", "revert", "normal", "hotfix"];
  const r = aggregate(summaries, classes);
  assert.equal(r.runs, 2);
  assert.equal(r.slopRate, 1);
  assert.equal(r.cleanRuns, 1);
  assert.equal(r.escapeSignals, 2);
  assert.equal(r.escapeRateProxy, 0.5);
});
