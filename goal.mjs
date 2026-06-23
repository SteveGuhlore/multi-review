#!/usr/bin/env node
// /goal — the one-stop orchestrator. Drives an idea to "done" through one loop:
//
//   PLAN (/helpmecode) -> BUILD -> GATE LADDER -> REVIEW (multi-review loop.mjs)
//        -> route findings -> run-manifest -> (re-plan / re-build) -> ... converge
//
// with an autonomy dial (--checkpoints | --auto), a fail-closed security perimeter,
// data-plane/control-plane separation, and a TerminationGuard that guarantees the loop
// stops (caps / oscillation / failure breaker) and never blocks-and-waits.
//
// HONESTY: the deterministic spine — config, the gate ladder, finding routing, the run
// manifest, and termination — runs fully and for real here. The PLAN/BUILD/REVIEW phases
// need model CLIs (claude/codex/gemini) and the multi-review loop; when those are present
// /goal dispatches to them, and under --dry-run (or when they're absent) it DESCRIBES the
// phase instead of spending model calls. So you can watch the whole machine turn without
// authenticating a single model. "Converged" = gates green + reviewers agree nothing
// material remains — not a proof of correctness.

import { spawnSync } from "node:child_process";
import { writeDashboard } from "./dashboard.mjs";
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSummary, classifyCommit, aggregate, selfChangeAcceptable } from "./lib/metrics.mjs";
import {
  autodetectConfig, routeFinding, gateVerdict, isControlPlane,
  buildManifest, parseAutonomy, TerminationGuard, fingerprintFindings,
  findSecrets, findCodeSlop, manifestSha, pickLatestRoundFile, verifyChain,
  makeOpt, tokenizeCmd, stripAnsi,
} from "./lib/core.mjs";
// Shared shell/git helpers (single source of truth — see lib/sh.mjs).
import { cliWorks, toolPresent, trackedFiles, gitSha, changedFiles, runCmd, currentBranch, gitLogSubjects } from "./lib/sh.mjs";

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = makeOpt(argv);
// Flags that consume the following token as their value.
const VALUE_FLAGS = new Set(["--target", "--rounds", "--minutes", "--model-timeout"]);
// Goal text = the bare positional tokens (not a flag, not a flag's value).
const GOAL = argv.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(argv[i - 1])).join(" ").trim();
const TARGET = opt("--target", ".");
const DRY = flag("--dry-run");
const APPLY = flag("--apply");
const PLAN_ONLY = flag("--plan-only");
// Run only the deterministic spine (gate ladder + routing + manifest); no model phases.
// Ideal for CI and for verifying the gates without spending model calls.
const GATES_ONLY = flag("--gates-only");
const MAX_ROUNDS = parseInt(opt("--rounds", "6"), 10);
const MAX_MINUTES = parseInt(opt("--minutes", "180"), 10);
const AUTONOMY = parseAutonomy(argv);
const ROOT = process.cwd();
// fileURLToPath (not URL.pathname) — pathname yields "/C:/…" on Windows and breaks join().
const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = join("reviews", `goal-${new Date().toISOString().replace(/[:.]/g, "-")}`);

const C = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", c: "\x1b[36m", x: "\x1b[0m" };
let LOGBUF = "";
const log = (s = "") => { process.stdout.write(s + "\n"); LOGBUF += stripAnsi(s) + "\n"; };
const flushLog = () => { try { writeFileSync(join(RUN_DIR, "log.md"), LOGBUF); } catch { /* dir not made yet */ } };

// ---- config ----------------------------------------------------------------
function loadConfig() {
  let cfg = existsSync(".multi-review.json")
    ? JSON.parse(readFileSync(".multi-review.json", "utf8"))
    : autodetectConfig({ exists: (f) => existsSync(join(ROOT, f)), read: (f) => readFileSync(join(ROOT, f), "utf8") });
  if (!existsSync(".multi-review.json")) {
    writeFileSync(".multi-review.json", JSON.stringify(cfg, null, 2));
    log(`${C.g}✓${C.x} seeded .multi-review.json (detected stack + perimeter) — edit to taste.`);
  }
  // .goal.json may add a gate ladder + autonomy/security overrides (optional, degradable).
  if (existsSync(".goal.json")) {
    try {
      const g = JSON.parse(readFileSync(".goal.json", "utf8"));
      cfg = { ...cfg, ...g, gates: [...(cfg.gates || []), ...(g.gates || [])] };
    } catch (e) { log(`${C.y}⚠${C.x} .goal.json ignored (parse error: ${e.message})`); }
  }
  cfg.gates = cfg.gates || [];
  cfg.securityMode = cfg.securityMode || "propose-isolated";
  return cfg;
}

// ---- tool / CLI detection (cliWorks/toolPresent shared via lib/sh.mjs) ------
function detectModels() {
  return ["claude", "codex", "gemini"].filter(cliWorks);
}

// ---- the gate ladder -------------------------------------------------------
// A gate is { name, cmd, required?, controlPlane?, on? }. Default gates come from
// the validation matrix; .goal.json can add mutation/coverage/scanners/a11y/etc.
// Control-plane gates (deploy/pipeline) are never run autonomously.
function buildGateLadder(cfg) {
  // Always-on, zero-dependency perimeter gate first, then the validation matrix, then the
  // optional configured ladder. Opt out with "secretScan": false in config.
  const builtin = [
    ...(cfg.secretScan === false ? [] : [{ name: "secrets (builtin)", builtin: "secrets", required: true }]),
    ...(cfg.codeSlopScan === false ? [] : [{ name: "code-slop (builtin)", builtin: "codeslop", required: true }]),
  ];
  const fromValidation = (cfg.validation?.default || []).map((cmd) => {
    const label = Array.isArray(cmd) ? cmd.join(" ") : cmd; // array-form cmd is valid (see tokenizeCmd/runCmd)
    return { name: label.length <= 24 ? label : tokenizeCmd(cmd)[0], cmd, required: true };
  });
  return [...builtin, ...fromValidation, ...(cfg.gates || [])];
}
// Built-in gates run in-process (no external tool, always available). Currently: a
// secret scan over tracked files — gives the perimeter teeth with zero dependencies.
// Scan every tracked file with `detect(body)`; log up to 10 hits; pass iff none.
function builtinScan(label, detect, fmt) {
  const hits = [];
  for (const f of trackedFiles()) {
    let body;
    try { body = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    for (const h of detect(body)) hits.push({ ...h, file: f });
  }
  for (const h of hits.slice(0, 10)) log(`      ${C.r}${label}${C.x} ${h.file}:${h.line} ${C.dim}${fmt(h)}${C.x}`);
  return hits.length === 0;
}
const BUILTINS = {
  secrets: () => builtinScan("secret", findSecrets, (h) => `${h.type} ${h.match}`),
  codeslop: () => builtinScan("code-slop", findCodeSlop, (h) => h.type),
};

function runGate(gate) {
  if (isControlPlane(gate)) return { name: gate.name, pass: null, skipped: true, reason: "control-plane (never autonomous)", required: gate.required };
  if (gate.builtin) {
    if (DRY) return { name: gate.name, pass: true, dry: true, required: gate.required };
    const fn = BUILTINS[gate.builtin];
    if (!fn) return { name: gate.name, pass: false, reason: `unknown builtin '${gate.builtin}'`, required: gate.required };
    return { name: gate.name, pass: fn(), exitCode: null, required: gate.required };
  }
  if (DRY) return { name: gate.name, pass: true, dry: true, required: gate.required };
  const bin = tokenizeCmd(gate.cmd)[0]; // first bareword, just for the tool-presence probe
  // Degradable, but safely: if the tool is absent, a REQUIRED gate fails closed (we can't
  // verify, so we don't pass), while an optional gate is skipped. Never fail-open on a
  // required check just because its scanner isn't installed.
  if (!toolPresent(bin)) {
    return gate.required === false
      ? { name: gate.name, pass: null, skipped: true, reason: `${bin} not installed`, required: false }
      : { name: gate.name, pass: false, reason: `${bin} not installed (required ⇒ fail-closed)`, required: true };
  }
  const r = runCmd(gate.cmd, { stdio: "pipe" });
  return { name: gate.name, pass: r.status === 0, exitCode: r.status ?? null, required: gate.required };
}
function runLadder(ladder) {
  const results = [];
  for (const g of ladder) {
    const res = runGate(g);
    const mark = res.skipped ? `${C.y}skip${C.x}` : res.dry ? `${C.dim}dry${C.x}` : res.pass ? `${C.g}pass${C.x}` : `${C.r}FAIL${C.x}`;
    log(`    ${mark}  ${g.name}${res.reason ? ` ${C.dim}(${res.reason})${C.x}` : ""}${res.exitCode ? ` ${C.dim}exit ${res.exitCode}${C.x}` : ""}`);
    results.push(res);
  }
  return results;
}

// ---- phases (model-dependent; described under --dry-run) --------------------
// gitSha() and changedFiles() are imported from lib/sh.mjs (shared with loop.mjs).
function phasePlan(cfg, models) {
  log(`\n${C.b}● PLAN${C.x}  ${C.dim}/helpmecode — interview → research+validator → design${C.x}`);
  const planPath = join(RUN_DIR, "PLAN.md");
  if (DRY || !models.includes("claude")) {
    log(`    ${C.dim}(describe) would run /helpmecode on the goal, emit PLAN.md (PRP-style tasks`);
    log(`    with acceptance criteria), ensure .multi-review.json, and a DESIGN.md if UI.${C.x}`);
    writeFileSync(planPath, `# PLAN — ${GOAL || "(no goal text)"}\n\n_Generated by /goal (${DRY ? "dry-run" : "no claude CLI"})._\n\n## Tasks\n- [ ] (planner output would appear here)\n\n## Acceptance criteria\n- All gates green; reviewers converge; no perimeter edits auto-merged.\n`);
    return { ok: true, planPath };
  }
  // Real planner dispatch (kept minimal; the SKILL drives the interview).
  const prompt = `Use the /helpmecode workflow to turn this goal into PLAN.md + seeded .multi-review.json + DESIGN.md. Goal: ${GOAL}`;
  spawnSync("claude", ["-p", "--model", "opus", prompt], { shell: true, stdio: "inherit", encoding: "utf8" });
  return { ok: existsSync(planPath) || existsSync("PLAN.md"), planPath };
}

function phaseBuild(models) {
  log(`\n${C.b}● BUILD${C.x}  ${C.dim}implement the plan (TDD); writer ≠ approver${C.x}`);
  if (DRY || !models.includes("claude")) {
    log(`    ${C.dim}(describe) would dispatch an implementer subagent per task, denied write`);
    log(`    access to test/eval files (reward-hacking guard).${C.x}`);
    return { ok: true };
  }
  spawnSync("claude", ["-p", "--model", "opus", "--permission-mode", "acceptEdits", `Implement the next task from ${join(RUN_DIR, "PLAN.md")}. Edit only source; do not edit tests to pass. Reply DONE.`], { shell: true, stdio: "inherit" });
  return { ok: true };
}

function phaseReview(cfg, models) {
  log(`\n${C.b}● REVIEW${C.x}  ${C.dim}multi-review — Claude + Codex + Gemini debate to consensus${C.x}`);
  if (DRY || !models.length) {
    log(`    ${C.dim}(describe) would run: node loop.mjs --target ${TARGET}${APPLY ? " --apply" : ""}`);
    log(`    models present: ${models.join(", ") || "none"}.${C.x}`);
    return { findings: [] };
  }
  const loop = join(HERE, "loop.mjs");
  const a = ["--target", TARGET]; if (APPLY && !PLAN_ONLY) a.push("--apply");
  spawnSync("node", [loop, ...a], { shell: false, stdio: "inherit" });
  return { findings: harvestLoopFindings() };
}

// Read the most-converged round of the newest multi-review loop run so the router sees
// real validated findings. Returns [] if no loop output exists.
function harvestLoopFindings() {
  if (!existsSync("reviews")) return [];
  const loopDirs = readdirSync("reviews").filter((d) => d.startsWith("loop-")).sort();
  const latest = loopDirs[loopDirs.length - 1];
  if (!latest) return [];
  let files; try { files = readdirSync(join("reviews", latest)); } catch { return []; }
  const roundFile = pickLatestRoundFile(files);
  if (!roundFile) return [];
  try {
    const arr = JSON.parse(readFileSync(join("reviews", latest, roundFile), "utf8"));
    return Array.isArray(arr) ? arr.filter((f) => f && f.issue) : [];
  } catch { return []; }
}

// ---- routing + manifest ----------------------------------------------------
function routeAndReport(cfg, findings, iteration) {
  const buckets = { auto: [], quarantine: [], plan: [] };
  for (const f of findings) buckets[routeFinding(f, cfg).bucket].push(f);
  if (findings.length) {
    log(`\n${C.b}● ROUTE${C.x}  auto:${buckets.auto.length}  quarantine:${buckets.quarantine.length}  plan:${buckets.plan.length}`);
  }
  if (buckets.plan.length || buckets.quarantine.length) {
    const items = [...buckets.plan, ...buckets.quarantine];
    writeFileSync(join(RUN_DIR, "PLAN.md"), `# Remediation — perimeter / critical (review required)\n\n` +
      items.map((f) => `- **${(f.severity || "?")}** \`${f.file || "?"}\` — ${f.issue}`).join("\n") + "\n");
  }
  return buckets;
}

let PREV_MANIFEST_SHA = null;
function writeManifest(cfg, models, gateResults, iteration) {
  const manifest = buildManifest({
    model: models[0] || (DRY ? "dry-run" : null),
    promptText: GOAL,
    filesTouched: changedFiles(),
    gitSha: gitSha(),
    gates: gateResults,
    specVersion: existsSync("PLAN.md") ? "PLAN.md" : null,
    iteration,
    prev: PREV_MANIFEST_SHA, // hash-chain: each manifest references the previous one
  });
  writeFileSync(join(RUN_DIR, `manifest-${iteration}.json`), JSON.stringify(manifest, null, 2));
  PREV_MANIFEST_SHA = manifestSha(manifest);
  return manifest;
}

// ---- self-evaluation: read past run-manifests + git history into a trend ---
// `--metrics` realizes the self-evaluating loop: slop-rate from gate history and a
// bug-escape proxy from revert/hotfix commits. The numbers gate whether a self-rewrite
// is kept (see lib/metrics.selfChangeAcceptable).
function reportMetrics() {
  const summaries = [];
  if (existsSync("reviews")) {
    for (const d of readdirSync("reviews").filter((x) => x.startsWith("goal-"))) {
      for (const f of (() => { try { return readdirSync(join("reviews", d)); } catch { return []; } })()) {
        if (/^manifest-\d+\.json$/.test(f)) {
          try { summaries.push(runSummary(JSON.parse(readFileSync(join("reviews", d, f), "utf8")))); } catch { /* skip */ }
        }
      }
    }
  }
  const report = aggregate(summaries, gitLogSubjects(500).map(classifyCommit));

  // Metrics TREND vs the last recorded snapshot, using the same keep-only-if-it-improves
  // rule (selfChangeAcceptable). NOTE: report.* are cumulative over all manifests in this
  // checkout, so this is cross-run drift detection — a directional signal, NOT an isolated
  // measurement of a single self-rewrite (that needs a before/after harness around one
  // change; see docs/ROADMAP.md). Snapshot lives under gitignored reviews/.
  const snapPath = join("reviews", ".metrics-prev.json");
  const cur = { escapeRate: report.escapeRateProxy, slopRate: report.slopRate };
  let verdict = "";
  if (existsSync(snapPath)) {
    try {
      const prev = JSON.parse(readFileSync(snapPath, "utf8"));
      const ok = selfChangeAcceptable(prev, cur);
      verdict = `- metrics trend vs last snapshot: **${ok ? "IMPROVING" : "not improving"}** ` +
        `(prev escape ${prev.escapeRate}/slop ${prev.slopRate} → now ${cur.escapeRate}/${cur.slopRate})\n`;
    } catch { /* corrupt snapshot — ignore, reseed below */ }
  }
  try { mkdirSync("reviews", { recursive: true }); writeFileSync(snapPath, JSON.stringify(cur)); } catch { /* best effort */ }

  const md = `# /goal metrics\n\n` +
    `- runs analyzed: **${report.runs}** (clean: ${report.cleanRuns})\n` +
    `- slop-rate (slop-gate failures / run): **${report.slopRate}**\n` +
    `- commits scanned: **${report.commits}**\n` +
    `- escape signals (reverts + hotfixes): **${report.escapeSignals}**\n` +
    `- bug-escape-rate (proxy): **${report.escapeRateProxy}**\n` +
    verdict + `\n` +
    `_A self-rewrite is kept only if neither slop-rate nor escape-rate worsens and one improves._\n`;
  writeFileSync("METRICS.md", md);
  log(stripAnsi(md.replace(/\*\*/g, "")));
  log(`${C.dim}wrote METRICS.md${C.x}`);
}

const HELP = `/goal — one-stop autonomous build↔review loop

Usage:
  node goal.mjs "<goal>" [options]

Options:
  --auto | --checkpoints   autonomy dial (default: checkpoints)
  --apply                  auto-fix validated non-perimeter findings (branch-only)
  --plan-only              plan + gates only (no build/review)
  --gates-only             deterministic spine only (gate ladder + manifest); no model calls — ideal for CI
  --dry-run                describe model phases; run the real deterministic spine
  --metrics                report bug-escape + slop-rate trend (writes METRICS.md) and exit
  --verify                 verify the manifest hash-chain of the latest run (or --target <run-dir>)
  --target <path>          scope (default: .)
  --rounds N               outer iteration cap (default: 6)
  --minutes N              wall-clock cap (default: 180)
  --help                   this message

Safety: never --apply on main/master; never auto-merges; security perimeter is fail-closed;
control-plane gates never run autonomously. Artifacts: reviews/goal-<ts>/.`;

// Verify the manifest hash-chain of a goal run (latest, or --target <reviews/goal-...>).
function verifyRun() {
  let dir = opt("--target", "");
  if (!dir || !existsSync(join(dir, "manifest-1.json"))) {
    const runs = existsSync("reviews") ? readdirSync("reviews").filter((d) => d.startsWith("goal-")).sort() : [];
    dir = runs.length ? join("reviews", runs[runs.length - 1]) : "";
  }
  if (!dir || !existsSync(dir)) { console.log("verify: no goal run found."); process.exitCode = 2; return; }
  const files = readdirSync(dir).filter((f) => /^manifest-\d+\.json$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const manifests = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  const res = verifyChain(manifests);
  if (res.ok) console.log(`${C.g}✓${C.x} provenance chain intact — ${manifests.length} manifest(s) in ${dir}`);
  else { console.log(`${C.r}✗${C.x} provenance chain BROKEN at manifest index ${res.brokenAt} in ${dir}`); process.exitCode = 1; }
}

// ---- main loop -------------------------------------------------------------
function main() {
  if (flag("--help") || flag("-h")) { console.log(HELP); return; }
  if (flag("--verify")) { verifyRun(); return; }
  if (flag("--metrics")) { reportMetrics(); return; }
  mkdirSync(RUN_DIR, { recursive: true });
  const cfg = loadConfig();
  const models = detectModels();
  const ladder = buildGateLadder(cfg);
  const deadline = Date.now() + MAX_MINUTES * 60_000;
  const guard = new TerminationGuard({ maxRounds: MAX_ROUNDS, maxFailures: 3, deadlineMs: deadline });

  log(`${C.b}# /goal${C.x}  ${C.c}${GOAL || "(no goal text — review/maintain mode)"}${C.x}`);
  log(`${C.dim}target:${C.x} ${TARGET}   ${C.dim}autonomy:${C.x} ${AUTONOMY}   ${C.dim}security:${C.x} ${cfg.securityMode}   ${C.dim}models:${C.x} ${models.join(",") || "none"}   ${C.dim}gates:${C.x} ${ladder.length}   ${C.dim}mode:${C.x} ${DRY ? "DRY-RUN" : APPLY ? "APPLY" : "report"}`);
  if (APPLY && !DRY) {
    const branch = currentBranch();
    if (branch === "main" || branch === "master") { log(`${C.r}REFUSING --apply on the default branch.${C.x}`); flushLog(); process.exit(2); }
  }

  let iteration = 0, stopReason = "converged";
  let lastGates = [], lastVerdict = { pass: true, failures: [] }, lastBuckets = { auto: [], quarantine: [], plan: [] };
  while (true) {
    iteration++;
    log(`\n${C.b}══ iteration ${iteration} ══${C.x}`);
    if (!GATES_ONLY) {
      phasePlan(cfg, models);
      if (!PLAN_ONLY) phaseBuild(models);
    }

    log(`\n${C.b}● GATES${C.x}  ${C.dim}fail-closed; data-plane only; control-plane gates skipped${C.x}`);
    const gateResults = runLadder(ladder);
    const verdict = gateVerdict(gateResults);
    log(`    → ${verdict.pass ? `${C.g}gates green${C.x}` : `${C.r}gates blocked${C.x} (${verdict.failures.join(", ")})`}`);
    guard.recordFix(verdict.pass);

    const review = (PLAN_ONLY || GATES_ONLY) ? { findings: [] } : phaseReview(cfg, models);
    const buckets = routeAndReport(cfg, review.findings, iteration);
    writeManifest(cfg, models, gateResults, iteration);
    lastGates = gateResults; lastVerdict = verdict; lastBuckets = buckets;

    if (GATES_ONLY) { stopReason = verdict.pass ? "gates green" : "gates blocked"; break; }
    if (PLAN_ONLY) { stopReason = "plan-only"; break; }
    const fp = fingerprintFindings(review.findings);
    const t = guard.tick(review.findings.length ? fp : null);
    if (t.stop) { stopReason = t.reason; break; }
    if (!review.findings.length && verdict.pass) { stopReason = "converged"; break; }
    if (DRY) { stopReason = "dry-run (single pass)"; break; }
    if (AUTONOMY === "checkpoints") { stopReason = "checkpoint (awaiting human)"; break; }
  }

  writeSummary({ cfg, models, stopReason, iteration, gates: lastGates, verdict: lastVerdict, buckets: lastBuckets });
  try { writeDashboard("reviews"); log("    📊 dashboard -> reviews/dashboard.html"); } catch { /* cosmetic: never fail a run over the dashboard */ }
  log(`\n${C.b}■ done${C.x}  ${C.dim}stop:${C.x} ${stopReason}   ${C.dim}iterations:${C.x} ${iteration}`);
  log(`${C.dim}artifacts:${C.x} ${RUN_DIR}/ (SUMMARY.md, log.md, manifest-*.json${existsSync(join(RUN_DIR, "PLAN.md")) ? ", PLAN.md" : ""})`);
  flushLog();
}

// Human-readable run report: the deliverable a reviewer reads first.
function writeSummary({ cfg, models, stopReason, iteration, gates, verdict, buckets }) {
  const mark = (r) => r.skipped ? "skip" : r.dry ? "dry" : r.pass ? "pass" : "FAIL";
  const lines = [
    `# /goal run summary`,
    ``,
    `- **goal:** ${GOAL || "(review/maintain mode)"}`,
    `- **stop:** ${stopReason} · **iterations:** ${iteration} · **mode:** ${DRY ? "dry-run" : APPLY ? "apply" : "report"}`,
    `- **autonomy:** ${AUTONOMY} · **security:** ${cfg.securityMode} · **models:** ${models.join(", ") || "none"}`,
    `- **gate verdict:** ${verdict.pass ? "GREEN" : "BLOCKED (" + verdict.failures.join(", ") + ")"}`,
    `- **provenance:** manifest chain head \`${PREV_MANIFEST_SHA || "n/a"}\` (verify: \`goal --verify\`)`,
    ``,
    `## Gates`,
    ...gates.map((g) => `- ${mark(g)} — ${g.name}${g.reason ? ` (${g.reason})` : ""}`),
    ``,
    `## Routed findings`,
    `- auto-fixable (outside perimeter): ${buckets.auto.length}`,
    `- quarantined (perimeter, isolated review): ${buckets.quarantine.length}`,
    `- plan (critical / never auto): ${buckets.plan.length}`,
  ];
  writeFileSync(join(RUN_DIR, "SUMMARY.md"), lines.join("\n") + "\n");
}

main();
