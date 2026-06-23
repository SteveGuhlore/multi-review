// Integration test: spawn goal.mjs --gates-only against a fixture repo and assert the
// run-manifest + the data-plane/control-plane verdict behavior end-to-end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, manifestSha } from "../lib/core.mjs";

const GOAL = join(dirname(fileURLToPath(import.meta.url)), "..", "goal.mjs");

function runGoalInFixture(files, args) {
  const dir = mkdtempSync(join(tmpdir(), "goal-it-"));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    const r = spawnSync("node", [GOAL, ...args], { cwd: dir, encoding: "utf8", timeout: 60_000 });
    const runDirs = readdirSync(join(dir, "reviews")).filter((d) => d.startsWith("goal-"));
    const manifestPath = join(dir, "reviews", runDirs[0], "manifest-1.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return { stdout: r.stdout || "", stderr: r.stderr || "", status: r.status, manifest };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("goal --gates-only: passing data-plane gate ⇒ green; control-plane gate is skipped, not blocking", () => {
  const goalCfg = {
    gates: [
      { name: "ok", cmd: 'node -e "process.exit(0)"', required: true },
      { name: "deploy", cmd: 'node -e "process.exit(1)"', required: true, controlPlane: true },
    ],
  };
  const { stdout, manifest } = runGoalInFixture(
    { "package.json": JSON.stringify({ name: "fix", version: "1.0.0" }), ".goal.json": JSON.stringify(goalCfg) },
    ["--gates-only"],
  );
  // The control-plane gate must NOT turn the autonomous verdict red.
  assert.match(stdout, /gates green/);
  assert.doesNotMatch(stdout, /gates blocked/);
  // Manifest is well-formed and records both gates.
  assert.equal(manifest.schema, "multi-review/run-manifest@1");
  assert.equal(manifest.iteration, 1);
  const ok = manifest.gates.find((g) => g.name === "ok");
  assert.equal(ok.pass, true);
  assert.equal(ok.exitCode, 0);
  assert.ok(manifest.gates.find((g) => g.name === "deploy"), "control-plane gate is still recorded");
});

test("goal --gates-only: a failing required data-plane gate ⇒ blocked (fail closed)", () => {
  const goalCfg = { gates: [{ name: "must", cmd: 'node -e "process.exit(2)"', required: true }] };
  const { stdout, manifest } = runGoalInFixture(
    { "package.json": JSON.stringify({ name: "fix", version: "1.0.0" }), ".goal.json": JSON.stringify(goalCfg) },
    ["--gates-only"],
  );
  assert.match(stdout, /gates blocked/);
  assert.equal(manifest.gates.find((g) => g.name === "must").pass, false);
});

test("goal --gates-only: a required gate whose tool is absent fails closed (not skipped)", () => {
  const goalCfg = { gates: [{ name: "scanner", cmd: "definitely-not-a-real-binary-xyz scan", required: true }] };
  const { stdout } = runGoalInFixture(
    { "package.json": JSON.stringify({ name: "fix", version: "1.0.0" }), ".goal.json": JSON.stringify(goalCfg) },
    ["--gates-only"],
  );
  assert.match(stdout, /gates blocked/);
  assert.match(stdout, /not installed/);
});

test("goal --gates-only: array-form validation command builds + runs without mangling", () => {
  const { stdout, manifest } = runGoalInFixture(
    {
      "package.json": JSON.stringify({ name: "fix", version: "1.0.0" }),
      // Array form is the unambiguous cmd shape (tokenizeCmd/runCmd) — must not crash ladder build.
      ".multi-review.json": JSON.stringify({ extensions: [".js"], protectedPaths: ["**/auth/**"], validation: { default: [["node", "--version"]] } }),
    },
    ["--gates-only"],
  );
  assert.match(stdout, /gates green/);
  assert.ok(manifest.gates.find((g) => g.name === "node --version"), "array cmd gets a readable joined name");
});

function withFixture(setup, fn) {
  const dir = mkdtempSync(join(tmpdir(), "goal-it-"));
  try { setup(dir); return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("goal --metrics reads run-manifests and writes METRICS.md", () => {
  withFixture(
    (dir) => {
      const runDir = join(dir, "reviews", "goal-x");
      mkdirSync(runDir, { recursive: true });
      const m = buildManifest({ model: "opus", iteration: 1, ts: "t1", gates: [{ name: "dead-code", pass: false }] });
      writeFileSync(join(runDir, "manifest-1.json"), JSON.stringify(m));
    },
    (dir) => {
      const r = spawnSync("node", [GOAL, "--metrics"], { cwd: dir, encoding: "utf8", timeout: 60_000 });
      assert.match(r.stdout, /runs analyzed: 1/);
      assert.match(r.stdout, /slop-rate.*1/);
      assert.ok(existsSync(join(dir, "METRICS.md")));
    },
  );
});

test("goal --verify reports intact, then BROKEN after tampering (exit 1)", () => {
  withFixture(
    (dir) => {
      const runDir = join(dir, "reviews", "goal-y");
      mkdirSync(runDir, { recursive: true });
      const m1 = buildManifest({ model: "opus", iteration: 1, ts: "t1" });
      const m2 = buildManifest({ model: "opus", iteration: 2, ts: "t2", prev: manifestSha(m1) });
      writeFileSync(join(runDir, "manifest-1.json"), JSON.stringify(m1, null, 2));
      writeFileSync(join(runDir, "manifest-2.json"), JSON.stringify(m2, null, 2));
    },
    (dir) => {
      const target = join(dir, "reviews", "goal-y");
      const ok = spawnSync("node", [GOAL, "--verify", "--target", target], { cwd: dir, encoding: "utf8" });
      assert.match(ok.stdout, /chain intact/);
      // Tamper with manifest-1 → chain must break and exit non-zero.
      const f = join(target, "manifest-1.json");
      const m = JSON.parse(readFileSync(f)); m.gitSha = "HACKED";
      writeFileSync(f, JSON.stringify(m, null, 2));
      const bad = spawnSync("node", [GOAL, "--verify", "--target", target], { cwd: dir, encoding: "utf8" });
      assert.match(bad.stdout, /BROKEN/);
      assert.equal(bad.status, 1);
    },
  );
});
