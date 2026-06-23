// Shared, pure, side-effect-free core for multi-review + /goal.
// Everything here is deterministic and unit-tested (see test/core.test.mjs) so the
// orchestrators (loop.mjs, goal.mjs) can stay thin and the risky logic — protected-path
// matching, finding routing, convergence/oscillation, provenance — is verified in isolation.

import { createHash } from "node:crypto";

// ---- path / protected-glob matching ----------------------------------------
// Normalize OS-specific separators to "/" so globs behave the same everywhere.
export const normPath = (f) => String(f ?? "").split("\\").join("/");

// Translate a restricted glob (supporting ** and *) into an anchored RegExp.
// Improves on loop.mjs's inline matcher: a leading/embedded "**/" matches zero or
// more path segments INCLUDING the repo root, so "**/CODEOWNERS" also matches a
// root-level "CODEOWNERS" (the old matcher silently required a subdirectory — a real
// hole in the security perimeter, caught by the test suite).
export function globToRegExp(glob) {
  const DSTAR_SLASH = "\x01", DSTAR = "\x02"; // sentinels that cannot occur in a real glob
  const body = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex metachars (leaves * and / literal)
    .replace(/\*\*\//g, DSTAR_SLASH)       // "**/" => optional any-depth prefix (incl. root)
    .replace(/\*\*/g, DSTAR)               // bare "**" => any chars incl. /
    .replace(/\*/g, "[^/]*")               // "*" => within a single path segment
    .split(DSTAR_SLASH).join("(?:.*/)?")
    .split(DSTAR).join(".*");
  return new RegExp("^" + body + "$");
}

export function isProtected(file, protectedPaths = []) {
  const f = normPath(file);
  return protectedPaths.some((g) => globToRegExp(g).test(f));
}

// ---- findings: dedup, support tracking, convergence ------------------------
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Stable identity for a finding = file + normalized issue prefix. Two models
// reporting "the same" bug collapse to one entry.
export function findingSig(f) {
  return `${normPath(f?.file) || "?"}|${slug(f?.issue).slice(0, 70)}`;
}

// Merge a list of raw findings (from one model) into a master Map, recording
// which model supports each. Returns the same Map for chaining.
export function mergeFindings(master, findings, modelName) {
  for (const f of findings || []) {
    if (!f || !f.issue) continue;
    const k = findingSig(f);
    if (!master.has(k)) master.set(k, { ...f, support: new Set(), against: new Set() });
    master.get(k).support.add(modelName);
  }
  return master;
}

// Net agreement: a finding survives debate when more models support than refute it.
export function netValidated(master) {
  return [...master.values()].filter((f) => f.support.size > f.against.size);
}

export const SEVERITY = ["info", "low", "medium", "high", "critical"];
export const sevRank = (s) => Math.max(0, SEVERITY.indexOf(String(s || "").toLowerCase()));

// ---- finding routing: the data-plane / control-plane + security perimeter --
// Decides what the autonomous loop is allowed to do with a validated finding.
//   auto       — fix autonomously (outside the perimeter, mechanical)
//   quarantine — auto-fix attempt, but isolated + heightened review (security mode)
//   plan       — never auto-edit; write a remediation PLAN entry
// "Ambiguity counts as inside the perimeter" — protected OR critical => never plain auto.
export function routeFinding(f, opts = {}) {
  const { protectedPaths = [], securityMode = "propose-isolated" } = opts;
  const sev = String(f?.severity || "").toLowerCase();
  const inPerimeter = !f?.file || isProtected(f.file, protectedPaths);
  if (sev === "critical") return { bucket: "plan", reason: "critical severity" };
  if (inPerimeter) {
    return securityMode === "plan-only"
      ? { bucket: "plan", reason: "security perimeter (plan-only)" }
      : { bucket: "quarantine", reason: "security perimeter (isolated review)" };
  }
  if (["high", "medium", "low"].includes(sev)) return { bucket: "auto", reason: "outside perimeter" };
  return { bucket: "plan", reason: "unrankable severity" };
}

// ---- JSON extraction from model output (tolerant of prose / code fences) ---
function sliceJSON(text, open, close) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const r = fence ? fence[1] : text;
  const a = r.indexOf(open), z = r.lastIndexOf(close);
  if (a < 0 || z <= a) return null;
  try { return JSON.parse(r.slice(a, z + 1)); } catch { return null; }
}
export function extractArr(text) {
  const v = sliceJSON(text, "[", "]");
  return Array.isArray(v) ? v : [];
}
export function extractObj(text) {
  const v = sliceJSON(text, "{", "}");
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

// ---- termination: caps, oscillation, consecutive-failure breaker -----------
// Guarantees an autonomous loop stops: it converges, hits a cap, oscillates, or
// the breaker trips. Never blocks-and-waits; always terminates.
export class TerminationGuard {
  constructor({ maxRounds = 6, maxFailures = 3, deadlineMs = null } = {}) {
    this.maxRounds = maxRounds;
    this.maxFailures = maxFailures;
    this.deadline = deadlineMs;
    this.round = 0;
    this.consecutiveFailures = 0;
    this.seen = new Set(); // fingerprints of prior round states => oscillation
  }
  // Returns {stop, reason}. `fingerprint` is a stable hash of the round's validated
  // findings; repeating one means we're going in circles.
  tick(fingerprint, now = Date.now()) {
    this.round += 1;
    if (this.round > this.maxRounds) return { stop: true, reason: "round cap" };
    if (this.deadline != null && now > this.deadline) return { stop: true, reason: "time budget" };
    if (this.consecutiveFailures >= this.maxFailures) return { stop: true, reason: "failure breaker" };
    if (fingerprint != null) {
      if (this.seen.has(fingerprint)) return { stop: true, reason: "oscillation" };
      this.seen.add(fingerprint);
    }
    return { stop: false };
  }
  recordFix(ok) { this.consecutiveFailures = ok ? 0 : this.consecutiveFailures + 1; }
}

// Stable fingerprint of a set of findings (order-independent) for oscillation detection.
export function fingerprintFindings(findings) {
  const keys = (findings || []).map(findingSig).sort();
  return createHash("sha256").update(keys.join("\n")).digest("hex").slice(0, 16);
}

// Pick the highest-numbered round-<N>.json from a list of filenames (the last/most-
// converged review round that loop.mjs wrote). Returns the filename or null.
export function pickLatestRoundFile(filenames = []) {
  let best = null, bestN = -1;
  for (const f of filenames) {
    const m = /^round-(\d+)\.json$/.exec(f);
    if (m && Number(m[1]) > bestN) { bestN = Number(m[1]); best = f; }
  }
  return best;
}

// ---- gates: data-plane vs control-plane ------------------------------------
// Control-plane gates (deploy/pipeline/prod policy) never run autonomously — the
// agent stays in the data-plane (code/test/config proposals).
export function isControlPlane(gate) {
  return !!(gate && gate.controlPlane);
}

// Reduce gate results to a fail-closed AUTONOMOUS verdict: any required gate that
// actually ran and did not pass blocks (unknown/errored == not passed). A SKIPPED gate
// never blocks — whether it's optional-with-absent-tool or a control-plane gate
// intentionally deferred to a human / deterministic controller (data-plane vs.
// control-plane separation). Note a required gate whose tool is ABSENT is reported as
// pass:false (not skipped), so it still fails closed.
export function gateVerdict(results = []) {
  const blocking = results.filter((r) => r.required !== false && r.skipped !== true);
  const failures = blocking.filter((r) => r.pass !== true);
  return { pass: failures.length === 0, failures: failures.map((r) => r.name) };
}

// ---- provenance: signed-ready run manifest ---------------------------------
export const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

// One manifest per loop iteration: binds the change to the model, the exact prompt,
// the validation outcomes, and the spec/plan version it advanced. This is the
// living-docs<->provenance bridge — the thing no off-the-shelf tool emits.
export function buildManifest({
  model, promptText = "", filesTouched = [], gitSha = null,
  gates = [], specVersion = null, iteration = 0, ts = new Date().toISOString(), prev = null,
} = {}) {
  return {
    schema: "multi-review/run-manifest@1",
    iteration,
    ts,
    prev, // sha256 of the previous manifest — makes the run an append-only, tamper-evident chain
    model: model || null,
    promptSha256: promptText ? sha256(promptText) : null,
    gitSha,
    filesTouched: [...filesTouched],
    gates: gates.map((g) => ({ name: g.name, pass: g.pass === true, exitCode: g.exitCode ?? null })),
    specVersion,
  };
}

// Content hash of a manifest (stable: keys are emitted in a fixed order by buildManifest).
export function manifestSha(manifest) {
  return sha256(JSON.stringify(manifest));
}

// Verify a sequence of manifests forms an unbroken hash chain. Returns {ok, brokenAt}.
export function verifyChain(manifests = []) {
  for (let i = 1; i < manifests.length; i++) {
    if (manifests[i].prev !== manifestSha(manifests[i - 1])) return { ok: false, brokenAt: i };
  }
  return { ok: true, brokenAt: -1 };
}

// ---- built-in secret scan (zero-dependency, always-available gate) ---------
// Conservative, low-false-positive patterns for well-known credential formats, so the
// perimeter has teeth even when no external scanner (gitleaks/trufflehog) is installed.
export const SECRET_PATTERNS = [
  ["aws-access-key-id", /\bAKIA[0-9A-Z]{16}\b/g],
  ["private-key-block", /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_\-]{35}\b/g],
  ["stripe-secret-key", /\bsk_live_[0-9a-zA-Z]{24,}\b/g],
  ["slack-webhook", /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g],
];
const redact = (s) => { const t = String(s); return t.length <= 8 ? "****" : t.slice(0, 4) + "…" + t.slice(-2); };

// Lines carrying an allowlist pragma are skipped (for fixtures / known-safe sample keys),
// matching the gitleaks convention. Use sparingly and only on genuinely non-secret lines.
const ALLOW_PRAGMA = /(?:gitleaks|goal):allow(?:-secret)?/i;

// Returns [{ type, line, match (redacted) }] for any secrets found in `text`.
export function findSecrets(text) {
  const out = [];
  const lines = String(text ?? "").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (ALLOW_PRAGMA.test(line)) return; // allowlisted line
    for (const [type, re] of SECRET_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        out.push({ type, line: i + 1, match: redact(m[0]) });
        if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width loops
      }
    }
  });
  return out;
}

// ---- built-in code-slop scan (high-confidence, zero-dependency) ------------
// Only unambiguous, never-want-this-merged signals (low false-positive): committed merge
// conflict markers and leftover debugger statements. Honors the same allowlist pragma.
export const CODE_SLOP_PATTERNS = [
  ["merge-conflict-marker", /^(?:<{7}|>{7})\s/],
  ["leftover-debugger", /\bdebugger\s*;/],
];
export function findCodeSlop(text) {
  const out = [];
  String(text ?? "").split(/\r?\n/).forEach((line, i) => {
    if (ALLOW_PRAGMA.test(line)) return;
    for (const [type, re] of CODE_SLOP_PATTERNS) if (re.test(line)) out.push({ type, line: i + 1 });
  });
  return out;
}

// ---- args / autonomy dial --------------------------------------------------
export function parseAutonomy(args = []) {
  if (args.includes("--checkpoints")) return "checkpoints";
  if (args.includes("--auto")) return "auto";
  return "checkpoints"; // safe default: pause at checkpoints unless told otherwise
}

// Build a `--flag value` reader over an argv array. Presence is decided by INDEX, not
// truthiness, so an explicit empty value is honored and "flag at end with no value"
// falls back to the default. Shared by loop.mjs + goal.mjs (were two copies).
export function makeOpt(argv = []) {
  return (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
  };
}

// Strip ANSI color escapes (for log buffers / file output).
export const stripAnsi = (s) => String(s ?? "").replace(/\x1b\[[0-9;]*m/g, "");

// Split a gate/validation command into argv, respecting single/double quotes so a
// command with a quoted arg or a space-containing path tokenizes correctly (the old
// `cmd.split(" ")` silently mangled those). An array is passed through unchanged, which
// lets config use the unambiguous array form: { "cmd": ["mypy", "src dir"] }.
export function tokenizeCmd(cmd) {
  if (Array.isArray(cmd)) return cmd.map(String);
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(cmd ?? ""))) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// ---- zero-config detection (fs injected for testability) -------------------
// `exists(path)` and `read(path)` are injected so this is pure + unit-testable.
export function autodetectConfig({ exists, read } = {}) {
  const ex = exists || (() => false);
  const rd = read || (() => "");
  const extensions = new Set();
  const validation = [];
  if (ex("package.json")) {
    let pkg = {};
    try { pkg = JSON.parse(rd("package.json")); } catch { /* ignore */ }
    const s = pkg.scripts || {};
    if (s.test) validation.push("npm test");
    if (s.lint) validation.push("npm run lint");
    if (s.build) validation.push("npm run build");
    [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"].forEach((e) => extensions.add(e));
  }
  if (ex("pyproject.toml") || ex("requirements.txt") || ex("setup.py") || ex("setup.cfg") || ex("pytest.ini") || ex("tox.ini")) {
    validation.push("pytest -q"); extensions.add(".py");
  }
  if (ex("go.mod")) { validation.push("go test ./..."); extensions.add(".go"); }
  if (ex("Cargo.toml")) { validation.push("cargo test"); extensions.add(".rs"); }
  if (ex("pom.xml") || ex("build.gradle") || ex("build.gradle.kts")) { extensions.add(".java"); extensions.add(".kt"); }
  if (!extensions.size) [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".go", ".rs", ".java", ".rb", ".php", ".sql", ".css"].forEach((e) => extensions.add(e));
  return {
    extensions: [...extensions],
    // Broad-by-design security perimeter (union of both orchestrators' historical lists):
    // ambiguity counts as inside the perimeter, so --apply never auto-edits security/money code.
    protectedPaths: [
      ".env*", "**/.env*", "**/*secret*", "**/*credential*", "**/*apikey*", "**/*api_key*",
      "**/*password*", "**/*token*", "**/*key*", "**/*wallet*", "**/*sign*", "**/*private*",
      "**/auth/**", "**/*auth*", "**/security/**", "**/migrations/**",
      "**/*payment*", "**/*billing*", "**/*order*", "**/*execut*", "**/*trade*", "**/*risk*",
      "**/*broker*", "**/*crypto*", "**/CODEOWNERS",
    ],
    validation: { default: validation },
    // /goal extends the multi-review schema with a gate ladder; all optional + degradable.
    gates: [],
    securityMode: "propose-isolated",
  };
}
