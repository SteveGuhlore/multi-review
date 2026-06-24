import test from "node:test";
import assert from "node:assert/strict";
import { parseRunDir, aggregate, renderHtml, parseLog } from "../lib/dashboard.mjs";

test("parseRunDir: a loop run uses its newest round-*.json and maps support[] -> models", () => {
  const run = parseRunDir("loop-2026-06-17T23-16-18-431Z", {
    "round-1.json": [
      { severity: "high", file: "db.js", issue: "sql concat", support: ["claude"], against: [] },
    ],
    "round-2.json": [
      { severity: "high", file: "db.js", issue: "sql concat", support: ["claude", "codex", "gemini"], against: [] },
    ],
  });
  assert.equal(run.type, "loop");
  assert.equal(run.findings.length, 1);
  assert.deepEqual(run.findings[0].models, ["claude", "codex", "gemini"]);
});

test("parseRunDir: loop run computes severityCounts, marks critical as plan, counts plan items", () => {
  const run = parseRunDir("loop-2026-06-17T20-00-00-000Z", {
    "round-1.json": [
      { severity: "critical", file: "auth.js", issue: "authz", support: ["claude"], against: [] },
      { severity: "high", file: "db.js", issue: "sql", support: ["claude", "codex"], against: [] },
      { severity: "high", file: "x.js", issue: "y", support: ["gemini"], against: [] },
      { severity: "low", file: "z.js", issue: "w", support: ["claude"], against: [] },
    ],
  });
  assert.deepEqual(run.severityCounts, { critical: 1, high: 2, medium: 0, low: 1, info: 0 });
  assert.equal(run.planCount, 1);
  assert.equal(run.findings.find((f) => f.file === "auth.js").isPlan, true);
  assert.equal(run.findings.find((f) => f.file === "db.js").isPlan, false);
});

test("parseRunDir: a review-slash run reads findings.json and is typed 'review'", () => {
  const run = parseRunDir("2026-06-17-231600-branch-abc1234", {
    "findings.json": [
      { severity: "medium", file: "a.js", issue: "thing", models: ["claude", "gemini"] },
    ],
  });
  assert.equal(run.type, "review");
  assert.equal(run.findings.length, 1);
  assert.deepEqual(run.findings[0].models, ["claude", "gemini"]);
});

test("parseRunDir: returns null for an unrecognized directory", () => {
  assert.equal(parseRunDir("scratch-notes", { "notes.txt": "hi" }), null);
});

test("aggregate: latest is the newest run; history is chronological (oldest-first) with rollups", () => {
  const older = parseRunDir("loop-2026-06-17T20-00-00-000Z", { "round-1.json": [{ severity: "low", file: "a", issue: "x", support: ["claude"] }] });
  const newer = parseRunDir("loop-2026-06-17T23-00-00-000Z", { "round-1.json": [{ severity: "high", file: "b", issue: "y", support: ["claude", "codex"] }] });
  const { latest, history } = aggregate([newer, older]); // deliberately unsorted
  assert.equal(latest.id, "loop-2026-06-17T23-00-00-000Z");
  assert.equal(history.length, 2);
  assert.equal(history[0].id, "loop-2026-06-17T20-00-00-000Z");
  assert.equal(history[1].id, "loop-2026-06-17T23-00-00-000Z");
  assert.deepEqual(history[1].severityCounts, { critical: 0, high: 1, medium: 0, low: 0, info: 0 });
});

test("aggregate: ignores nulls and returns latest=null when there are no runs", () => {
  const { latest, history } = aggregate([null, null]);
  assert.equal(latest, null);
  assert.equal(history.length, 0);
});

test("renderHtml: self-contained HTML with the latest run's findings and a history section", () => {
  const run = parseRunDir("loop-2026-06-17T23-00-00-000Z", { "round-1.json": [{ severity: "high", file: "db.js", issue: "sql concat", support: ["claude", "codex"] }] });
  const html = renderHtml(aggregate([run]));
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /db\.js/);
  assert.match(html, /sql concat/);
  assert.match(html, /history/i);
});

test("renderHtml: shows an empty state when there are no runs", () => {
  const html = renderHtml({ latest: null, history: [] });
  assert.match(html, /no runs yet/i);
});

test("parseRunDir: a goal run is typed 'goal' (findings come from its linked loop runs)", () => {
  const run = parseRunDir("goal-2026-06-17T21-00-00-000Z", {
    "manifest-1.json": { gates: { pass: true } },
    "SUMMARY.md": "# summary",
  });
  assert.equal(run.type, "goal");
  assert.equal(run.id, "goal-2026-06-17T21-00-00-000Z");
  assert.deepEqual(run.findings, []);
  assert.deepEqual(run.severityCounts, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
});

test("renderHtml: escapes untrusted finding text (no raw <script> survives)", () => {
  const run = parseRunDir("loop-2026-06-17T23-00-00-000Z", {
    "round-1.json": [{ severity: "high", file: "<img src=x onerror=alert(1)>", issue: "<script>alert(1)</script>", support: ["claude"] }],
  });
  const html = renderHtml(aggregate([run]));
  assert.ok(!html.includes("<script>alert(1)</script>"), "raw <script> must not appear");
  assert.match(html, /&lt;script&gt;/);
});

test("aggregate: history keeps only the 10 most recent runs (newest last)", () => {
  const runs = [];
  for (let h = 0; h < 14; h++) {
    const hh = String(h).padStart(2, "0");
    runs.push(parseRunDir(`loop-2026-06-17T${hh}-00-00-000Z`, {
      "round-1.json": [{ severity: "low", file: "a", issue: "x", support: ["claude"] }],
    }));
  }
  const { history } = aggregate(runs);
  assert.equal(history.length, 10);
  assert.equal(history[9].id, "loop-2026-06-17T13-00-00-000Z");
  assert.equal(history[0].id, "loop-2026-06-17T04-00-00-000Z");
});

test("parseRunDir: findings are sorted by severity, critical first (quick-read)", () => {
  const run = parseRunDir("loop-2026-06-17T23-00-00-000Z", {
    "round-1.json": [
      { severity: "low", file: "a", issue: "x", support: ["claude"] },
      { severity: "critical", file: "b", issue: "y", support: ["claude"] },
      { severity: "info", file: "c", issue: "z", support: ["claude"] },
      { severity: "medium", file: "d", issue: "w", support: ["claude"] },
      { severity: "high", file: "e", issue: "v", support: ["claude"] },
    ],
  });
  assert.deepEqual(run.findings.map((f) => f.severity), ["critical", "high", "medium", "low", "info"]);
});

test("renderHtml: severity chips are clickable filters and rows are tagged for filtering", () => {
  const run = parseRunDir("loop-2026-06-17T23-00-00-000Z", {
    "round-1.json": [
      { severity: "critical", file: "auth.js", issue: "x", support: ["claude"] },
      { severity: "low", file: "log.js", issue: "y", support: ["codex"] },
    ],
  });
  const html = renderHtml(aggregate([run]));
  assert.match(html, /class="chip"[^>]*data-sev="critical"/);
  assert.match(html, /class="chip"[^>]*data-sev="low"/);
  assert.match(html, /<tr data-sev="critical"/);
  assert.match(html, /<tr data-sev="low"/);
  assert.match(html, /function flt\(/);
});

test("parseLog: extracts mode, model counts, validated/fixable/plan, applied, converged, outcomes", () => {
  const log = [
    "# multi-review loop (debate)",
    "Target: . · models: claude, codex, gemini · mode: APPLY · caps: 6 rounds",
    "## Round 1 — 3 file(s)",
    "  claude review: 4",
    "  codex review: 2",
    "  gemini review: 1",
    "  debate pass 1: 7 findings tracked",
    "  validated: 7 (fixable: 5, plan: 2)",
    "  ✓ committed — files: a.js",
    "  ✗ reverted → PLAN: b.js",
    "  applied 1 fix(es).",
    "✅ CONVERGED — no auto-fixable validated findings remain.",
  ].join("\n");
  const s = parseLog(log);
  assert.equal(s.mode, "apply");
  assert.deepEqual(s.models, { claude: 4, codex: 2, gemini: 1 });
  assert.equal(s.validated, 7);
  assert.equal(s.fixable, 5);
  assert.equal(s.plan, 2);
  assert.equal(s.applied, 1);
  assert.equal(s.converged, true);
  assert.deepEqual(s.committed, ["a.js"]);
  assert.deepEqual(s.reverted, ["b.js"]);
});

test("parseLog: report-only run, no apply lines", () => {
  const s = parseLog("Target: . · models: claude · mode: report\n  claude review: 3\n  validated: 3 (fixable: 2, plan: 1)\n(report-only) 2 fixable + 1 plan items");
  assert.equal(s.mode, "report");
  assert.equal(s.applied, undefined);
  assert.equal(s.converged, false);
  assert.deepEqual(s.committed, []);
});

test("parseRunDir: derives finding outcomes from the log (committed=fixed, reverted/critical=plan)", () => {
  const run = parseRunDir("loop-2026-06-17T23-00-00-000Z", {
    "round-1.json": [
      { severity: "critical", file: "auth.js", issue: "authz", support: ["claude"] },
      { severity: "high", file: "db.js", issue: "sql", support: ["claude", "codex"] },
      { severity: "medium", file: "x.js", issue: "y", support: ["codex"] },
    ],
    "log.md": "mode: APPLY\n  ✓ committed — files: db.js\n  ✗ reverted → PLAN: auth.js",
  });
  const o = Object.fromEntries(run.findings.map((f) => [f.file, f.outcome]));
  assert.equal(o["db.js"], "fixed");
  assert.equal(o["auth.js"], "plan");
  assert.equal(o["x.js"], "reported");
});

test("renderHtml: operations console — what happened, what worked, outcomes, copyable next actions", () => {
  const run = parseRunDir("loop-2026-06-17T23-00-00-000Z", {
    "round-1.json": [{ severity: "high", file: "db.js", issue: "sql concat", support: ["claude", "codex"] }],
    "log.md": "mode: APPLY\n  claude review: 2\n  codex review: 1\n  validated: 2 (fixable: 1, plan: 0)\n  ✓ committed — files: db.js\n  applied 1 fix(es).\n✅ CONVERGED",
  });
  const html = renderHtml(aggregate([run]));
  assert.match(html, /what happened/i);
  assert.match(html, /what worked/i);
  assert.match(html, /next actions/i);
  assert.match(html, /loop\.mjs --target \./);
  assert.match(html, /onclick="cp\(/);
  assert.match(html, /fixed/);
});
