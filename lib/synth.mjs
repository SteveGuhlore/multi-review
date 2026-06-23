// Mutation-guided test synthesis — the DETERMINISTIC acceptance gate (Meta ACH pattern).
// A model proposes candidate tests for targeted mutants; this module decides which to KEEP,
// with no model judgment: a generated test is admitted only if it runs clean, kills the
// mutant it targeted, raises coverage, and is not flaky. That's what makes LLM-written tests
// trustworthy instead of assertion-free theater. Pure + unit-tested (test/synth.test.mjs).
//
// STATUS: this is the BUILT, tested deterministic half. The generation half (running a
// mutation engine + asking a model for candidates) is designed but not yet wired into the
// runtime loop (see docs/ROADMAP.md). Kept here as a verified building block, not dead code.

// candidate: { name, runsClean, killsMutant, raisesCoverage, flaky }
// Returns { kept: [name], rejected: [{ name, reason }] }.
export function selectGeneratedTests(candidates = []) {
  const kept = [];
  const rejected = [];
  for (const c of candidates) {
    const reason = rejectionReason(c);
    if (reason) rejected.push({ name: c?.name ?? "?", reason });
    else kept.push(c.name);
  }
  return { kept, rejected };
}

// First failing admission criterion (in priority order), or null if the test is admissible.
export function rejectionReason(c = {}) {
  if (!c.runsClean) return "does not run / fails";       // a test that errors is useless
  if (c.flaky) return "flaky (non-deterministic)";        // would poison the loop's signal
  if (!c.killsMutant) return "kills no mutant (no teeth)"; // the core ACH criterion
  if (!c.raisesCoverage) return "raises no coverage";      // redundant with existing tests
  return null;
}

// Roll a synthesis run into a one-line verdict + counts.
export function summarizeSynthesis(result = { kept: [], rejected: [] }) {
  const kept = result.kept?.length ?? 0;
  const total = kept + (result.rejected?.length ?? 0);
  return {
    admitted: kept,
    proposed: total,
    admitRate: total ? Number((kept / total).toFixed(3)) : 0,
    // The gate passes if at least one trustworthy test was synthesized for the change.
    pass: kept > 0,
  };
}
