// Integration test: spawn goal.mjs --gates-only against a fixture repo and assert the
// run-manifest + the data-plane/control-plane verdict behavior end-to-end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
