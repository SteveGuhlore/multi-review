// Self-evaluating loop metrics — the differentiator no off-the-shelf tool ships:
// track the loop's own bug-escape-rate and slop-rate over time, and only keep a
// self-rewrite (changed prompt/skill/gate) if those trends do not worsen.
// All functions are pure and unit-tested (test/metrics.test.mjs).

// Gates whose FAILURE indicates "slop" (taste/bloat/debt) rather than a correctness bug.
export const SLOP_GATES = new Set([
  "anti-slop", "code-slop", "design-slop", "dead-code", "a11y", "visual-regression",
]);

// Collapse a run-manifest into a compact summary.
export function runSummary(manifest = {}) {
  const gates = Array.isArray(manifest.gates) ? manifest.gates : [];
  const failed = gates.filter((g) => g.pass === false);
  return {
    ts: manifest.ts ?? null,
    gitSha: manifest.gitSha ?? null,
    iteration: manifest.iteration ?? 0,
    gatesTotal: gates.length,
    gatesFailed: failed.length,
    slopIncidents: gates.filter((g) => SLOP_GATES.has(g.name) && g.pass === false).length,
    gatesPassed: failed.length === 0 && gates.length > 0,
  };
}

// Slop-rate = average slop-gate failures per run (lower is better).
export function slopRate(summaries = []) {
  if (!summaries.length) return 0;
  return summaries.reduce((a, s) => a + (s.slopIncidents || 0), 0) / summaries.length;
}

// Bug-escape-rate = of changes that PASSED the gates (i.e. shipped clean), the fraction
// later reverted/hotfixed. This is the number a self-improving loop must drive down: a
// bug the reviewer let through. history: [{ passedGates:boolean, reverted:boolean }].
export function bugEscapeRate(history = []) {
  const shipped = history.filter((h) => h.passedGates);
  if (!shipped.length) return 0;
  return shipped.filter((h) => h.reverted).length / shipped.length;
}

// Classify a commit by its subject line — used to detect escapes (reverts / hotfixes).
export function classifyCommit(subject = "") {
  const s = String(subject);
  if (/^revert[:\s"]/i.test(s)) return "revert";
  if (/\bhotfix\b|fix\(regression\)|regression fix|\brollback\b/i.test(s)) return "hotfix";
  return "normal";
}

// The gating rule for self-modification: keep a self-rewrite ONLY if neither metric
// worsens AND at least one strictly improves. Prevents drift — a self-change that doesn't
// demonstrably lower escapes or slop is rejected.
export function selfChangeAcceptable(before, after, eps = 1e-9) {
  if (!before || !after) return false;
  const notWorse = after.escapeRate <= before.escapeRate + eps && after.slopRate <= before.slopRate + eps;
  const better = after.escapeRate < before.escapeRate - eps || after.slopRate < before.slopRate - eps;
  return notWorse && better;
}

// Aggregate a set of run summaries + a commit classification list into a report object.
export function aggregate(summaries = [], commitClasses = []) {
  const escapes = commitClasses.filter((c) => c === "revert" || c === "hotfix").length;
  return {
    runs: summaries.length,
    slopRate: Number(slopRate(summaries).toFixed(3)),
    cleanRuns: summaries.filter((s) => s.gatesPassed).length,
    commits: commitClasses.length,
    escapeSignals: escapes,
    escapeRateProxy: commitClasses.length ? Number((escapes / commitClasses.length).toFixed(3)) : 0,
  };
}
