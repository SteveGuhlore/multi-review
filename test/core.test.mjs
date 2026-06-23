// Unit tests for lib/core.mjs — run with `npm test` (node --test). No external deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normPath, globToRegExp, isProtected, findingSig, mergeFindings, netValidated,
  sevRank, routeFinding, extractArr, extractObj, TerminationGuard, fingerprintFindings,
  isControlPlane, gateVerdict, buildManifest, sha256, parseAutonomy, autodetectConfig,
  findSecrets, findCodeSlop, manifestSha, verifyChain, pickLatestRoundFile,
  makeOpt, tokenizeCmd, stripAnsi,
} from "../lib/core.mjs";

test("normPath converts backslashes to forward slashes", () => {
  assert.equal(normPath("a\\b\\c"), "a/b/c");
  assert.equal(normPath(undefined), "");
});

test("globToRegExp: * stays within a path segment, ** crosses segments", () => {
  assert.match("src/auth.ts", globToRegExp("**/*auth*"));
  assert.ok(!globToRegExp("*.env").test("config/prod.env"), "* must not cross /");
  assert.match("config/prod.env", globToRegExp("**/*.env"));
});

test("isProtected matches the security perimeter and normalizes separators", () => {
  const p = ["**/auth/**", "**/*secret*", "**/CODEOWNERS"];
  assert.ok(isProtected("src/auth/login.ts", p));
  assert.ok(isProtected("lib\\api_secret.js", p), "windows path should match");
  assert.ok(isProtected("CODEOWNERS", p));
  assert.ok(!isProtected("src/utils/math.ts", p));
});

test("findingSig collapses same file+issue, separates different ones", () => {
  const a = { file: "src/x.ts", issue: "Null deref on input!" };
  const b = { file: "src/x.ts", issue: "null deref on input" };
  const c = { file: "src/y.ts", issue: "null deref on input" };
  assert.equal(findingSig(a), findingSig(b));
  assert.notEqual(findingSig(a), findingSig(c));
});

test("mergeFindings dedupes and tracks per-model support", () => {
  const m = new Map();
  mergeFindings(m, [{ file: "a.ts", issue: "bug" }], "claude");
  mergeFindings(m, [{ file: "a.ts", issue: "bug" }, { file: "b.ts", issue: "other" }], "codex");
  assert.equal(m.size, 2);
  assert.deepEqual([...m.get(findingSig({ file: "a.ts", issue: "bug" })).support].sort(), ["claude", "codex"]);
});

test("netValidated keeps only net-supported findings", () => {
  const m = new Map();
  mergeFindings(m, [{ file: "a.ts", issue: "real" }], "claude");
  mergeFindings(m, [{ file: "a.ts", issue: "real" }], "codex");
  const refuted = m.get(findingSig({ file: "b.ts", issue: "noise" })) ||
    (mergeFindings(m, [{ file: "b.ts", issue: "noise" }], "claude"), m.get(findingSig({ file: "b.ts", issue: "noise" })));
  refuted.against.add("codex"); refuted.against.add("gemini");
  const v = netValidated(m);
  assert.equal(v.length, 1);
  assert.equal(v[0].file, "a.ts");
});

test("sevRank orders severities", () => {
  assert.ok(sevRank("critical") > sevRank("high"));
  assert.ok(sevRank("high") > sevRank("low"));
  assert.equal(sevRank("garbage"), 0);
});

test("routeFinding: outside perimeter, high severity => auto", () => {
  const r = routeFinding({ file: "src/util.ts", severity: "high" }, { protectedPaths: ["**/auth/**"] });
  assert.equal(r.bucket, "auto");
});

test("routeFinding: critical always => plan", () => {
  const r = routeFinding({ file: "src/util.ts", severity: "critical" }, { protectedPaths: [] });
  assert.equal(r.bucket, "plan");
});

test("routeFinding: inside perimeter => quarantine (default) or plan (plan-only)", () => {
  const path = "src/auth/session.ts", pp = ["**/auth/**"];
  assert.equal(routeFinding({ file: path, severity: "high" }, { protectedPaths: pp }).bucket, "quarantine");
  assert.equal(
    routeFinding({ file: path, severity: "high" }, { protectedPaths: pp, securityMode: "plan-only" }).bucket,
    "plan",
  );
});

test("routeFinding: ambiguity (no file) counts as inside perimeter", () => {
  assert.notEqual(routeFinding({ severity: "high" }, { protectedPaths: [] }).bucket, "auto");
});

test("extractArr/extractObj tolerate prose and code fences", () => {
  assert.deepEqual(extractArr('here you go:\n```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(extractObj('blah {"verdict":"valid"} trailing'), { verdict: "valid" });
  assert.deepEqual(extractArr("not json at all"), []);
  assert.deepEqual(extractObj("["), {});
});

test("TerminationGuard stops on round cap", () => {
  const g = new TerminationGuard({ maxRounds: 2 });
  assert.equal(g.tick("a").stop, false);
  assert.equal(g.tick("b").stop, false);
  assert.equal(g.tick("c").reason, "round cap");
});

test("TerminationGuard detects oscillation on repeated fingerprint", () => {
  const g = new TerminationGuard({ maxRounds: 10 });
  assert.equal(g.tick("same").stop, false);
  assert.equal(g.tick("same").reason, "oscillation");
});

test("TerminationGuard trips the consecutive-failure breaker", () => {
  const g = new TerminationGuard({ maxRounds: 10, maxFailures: 2 });
  g.tick("a"); g.recordFix(false); g.recordFix(false);
  assert.equal(g.tick("b").reason, "failure breaker");
});

test("TerminationGuard respects the time budget", () => {
  const g = new TerminationGuard({ maxRounds: 10, deadlineMs: 1000 });
  assert.equal(g.tick("a", 2000).reason, "time budget");
});

test("fingerprintFindings is order-independent and stable", () => {
  const a = [{ file: "x", issue: "one" }, { file: "y", issue: "two" }];
  const b = [{ file: "y", issue: "two" }, { file: "x", issue: "one" }];
  assert.equal(fingerprintFindings(a), fingerprintFindings(b));
  assert.notEqual(fingerprintFindings(a), fingerprintFindings([{ file: "z", issue: "three" }]));
});

test("pickLatestRoundFile picks the highest round number, ignores noise", () => {
  assert.equal(pickLatestRoundFile(["round-1.json", "round-10.json", "round-2.json", "log.md"]), "round-10.json");
  assert.equal(pickLatestRoundFile(["log.md", "PLAN.md"]), null);
  assert.equal(pickLatestRoundFile([]), null);
});

test("isControlPlane flags deploy/pipeline gates", () => {
  assert.equal(isControlPlane({ name: "deploy", controlPlane: true }), true);
  assert.equal(isControlPlane({ name: "unit-tests" }), false);
});

test("gateVerdict fails closed: any required non-pass blocks; unknown == fail", () => {
  assert.equal(gateVerdict([{ name: "a", pass: true }, { name: "b", pass: true }]).pass, true);
  const v = gateVerdict([{ name: "a", pass: true }, { name: "sec", pass: false }]);
  assert.equal(v.pass, false);
  assert.deepEqual(v.failures, ["sec"]);
  assert.equal(gateVerdict([{ name: "x" }]).pass, false, "missing pass == fail closed");
  assert.equal(gateVerdict([{ name: "opt", pass: false, required: false }]).pass, true);
});

test("gateVerdict: skipped gates never block (control-plane deferred, optional-absent)", () => {
  // Control-plane gate is required but skipped — deferred to human/controller, must not block.
  assert.equal(gateVerdict([{ name: "deploy", required: true, skipped: true, pass: null }]).pass, true);
  // Optional gate whose tool is absent is skipped — must not block.
  assert.equal(gateVerdict([{ name: "a11y", required: false, skipped: true, pass: null }]).pass, true);
  // But a required gate whose tool is absent is pass:false (NOT skipped) — still fails closed.
  assert.equal(gateVerdict([{ name: "sast", required: true, pass: false }]).pass, false);
});

test("buildManifest binds change to model, prompt hash, gates", () => {
  const m = buildManifest({
    model: "opus", promptText: "review this", filesTouched: ["a.ts"],
    gitSha: "abc123", gates: [{ name: "tests", pass: true, exitCode: 0 }], specVersion: "v3", iteration: 2,
  });
  assert.equal(m.schema, "multi-review/run-manifest@1");
  assert.equal(m.promptSha256, sha256("review this"));
  assert.equal(m.model, "opus");
  assert.equal(m.iteration, 2);
  assert.deepEqual(m.gates, [{ name: "tests", pass: true, exitCode: 0 }]);
});

test("manifest chain: prev links each manifest; verifyChain detects tampering", () => {
  const m1 = buildManifest({ model: "opus", iteration: 1, ts: "t1" });
  const m2 = buildManifest({ model: "opus", iteration: 2, ts: "t2", prev: manifestSha(m1) });
  const m3 = buildManifest({ model: "opus", iteration: 3, ts: "t3", prev: manifestSha(m2) });
  assert.deepEqual(verifyChain([m1, m2, m3]), { ok: true, brokenAt: -1 });
  // Tamper with m2 after the fact → chain breaks at index 2 (m3.prev no longer matches).
  m2.gitSha = "tampered";
  assert.deepEqual(verifyChain([m1, m2, m3]), { ok: false, brokenAt: 2 });
  assert.deepEqual(verifyChain([m1]), { ok: true, brokenAt: -1 });
});

test("parseAutonomy defaults to checkpoints; flags override", () => {
  assert.equal(parseAutonomy([]), "checkpoints");
  assert.equal(parseAutonomy(["--auto"]), "auto");
  assert.equal(parseAutonomy(["--checkpoints"]), "checkpoints");
});

test("autodetectConfig detects node + python and seeds a perimeter", () => {
  const files = { "package.json": JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }), "requirements.txt": "" };
  const cfg = autodetectConfig({ exists: (f) => f in files, read: (f) => files[f] || "" });
  assert.ok(cfg.validation.default.includes("npm test"));
  assert.ok(cfg.validation.default.includes("pytest -q"));
  assert.ok(cfg.extensions.includes(".py"));
  assert.ok(cfg.protectedPaths.some((g) => g.includes("auth")));
  assert.equal(cfg.securityMode, "propose-isolated");
});

test("autodetectConfig falls back to a broad extension set with no manifests", () => {
  const cfg = autodetectConfig({ exists: () => false, read: () => "" });
  assert.ok(cfg.extensions.length > 3);
  assert.deepEqual(cfg.validation.default, []);
});

test("findSecrets detects well-known credential formats and redacts them", () => {
  // Built from fragments so these source lines don't themselves trip the repo's own scan.
  const text = [
    'const k = "AKIA' + "IOSFODNN7EXAMPLE" + '";',
    "-----BEGIN OPENSSH " + "PRIVATE KEY-----",
    'token = "ghp_' + "0123456789abcdefghijklmnopqrstuvwxyz" + '";',
  ].join("\n");
  const hits = findSecrets(text);
  const types = hits.map((h) => h.type).sort();
  assert.deepEqual(types, ["aws-access-key-id", "github-token", "private-key-block"]);
  assert.ok(hits.every((h) => !/EXAMPLE|abcdefghij/.test(h.match)), "matches must be redacted");
  assert.equal(hits.find((h) => h.type === "aws-access-key-id").line, 1);
});

test("findSecrets honors the allowlist pragma", () => {
  const text = 'const k = "AKIA' + 'IOSFODNN7EXAMPLE";  // goal:allow-secret';
  assert.deepEqual(findSecrets(text), []);
});

test("findCodeSlop flags conflict markers and leftover debugger, honors pragma", () => {
  const conflict = "<".repeat(7) + " HEAD";
  assert.equal(findCodeSlop(conflict)[0].type, "merge-conflict-marker");
  assert.equal(findCodeSlop("  debugger;  ")[0].type, "leftover-debugger"); // goal:allow-secret
  assert.deepEqual(findCodeSlop("const x = 1; // ordinary code"), []);
  assert.deepEqual(findCodeSlop("debugger; // goal:allow-secret"), [], "pragma suppresses");
  // A '<<<<<<<' inside prose without the trailing space is not a marker.
  assert.deepEqual(findCodeSlop("a" + "<".repeat(7) + "b"), []);
});

test("findSecrets is quiet on clean code and bad input", () => {
  assert.deepEqual(findSecrets("const x = 1 + 2; // nothing secret here"), []);
  assert.deepEqual(findSecrets(""), []);
  assert.deepEqual(findSecrets(null), []);
});

test("autodetectConfig: java/kotlin and broad perimeter (unioned single source of truth)", () => {
  const files = { "pom.xml": "" };
  const cfg = autodetectConfig({ exists: (f) => f in files, read: () => "" });
  assert.ok(cfg.extensions.includes(".java") && cfg.extensions.includes(".kt"));
  // Perimeter now covers the money/crypto globs the loop's old inline copy had.
  for (const g of ["**/*wallet*", "**/*broker*", "**/*crypto*", "**/CODEOWNERS"]) {
    assert.ok(cfg.protectedPaths.includes(g), `perimeter should include ${g}`);
  }
});

test("makeOpt: reads flag values by index, honors empty, falls back when absent or trailing", () => {
  const opt = makeOpt(["--target", "src", "--rounds", "0", "--empty", "", "--end"]);
  assert.equal(opt("--target", "."), "src");
  assert.equal(opt("--rounds", "6"), "0", "explicit 0 is not dropped");
  assert.equal(opt("--empty", "d"), "", "explicit empty value honored");
  assert.equal(opt("--missing", "fallback"), "fallback");
  assert.equal(opt("--end", "fallback"), "fallback", "flag at end with no value falls back");
});

test("tokenizeCmd: respects quotes, passes arrays through, tolerates junk", () => {
  assert.deepEqual(tokenizeCmd("pytest -q"), ["pytest", "-q"]);
  assert.deepEqual(tokenizeCmd('mypy "src dir" --strict'), ["mypy", "src dir", "--strict"]);
  assert.deepEqual(tokenizeCmd("echo 'a b' c"), ["echo", "a b", "c"]);
  assert.deepEqual(tokenizeCmd(["mypy", "src dir"]), ["mypy", "src dir"]);
  assert.deepEqual(tokenizeCmd(""), []);
  assert.deepEqual(tokenizeCmd(null), []);
});

test("stripAnsi removes color escapes", () => {
  assert.equal(stripAnsi("\x1b[32mok\x1b[0m"), "ok");
  assert.equal(stripAnsi("plain"), "plain");
});
