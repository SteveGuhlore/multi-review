// Integration tests for loop.mjs's --apply preflight (the destructive, autonomous path).
// loop.mjs previously had ZERO test coverage; these lock in the safety guards:
//   • refuse on the default branch
//   • require a clean working tree (the revert runs `git reset --hard`)
//   • require a real validation matrix
//   • load the perimeter from the trusted base; report-only if the change edits policy
// No model CLIs are installed in CI, so review converges immediately (0 findings) and the
// run is fast + deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOOP = join(dirname(fileURLToPath(import.meta.url)), "..", "loop.mjs");
const git = (dir, ...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
const runLoop = (dir, ...a) => spawnSync("node", [LOOP, ...a], { cwd: dir, encoding: "utf8", timeout: 60_000 });

const CFG = {
  extensions: [".js"],
  protectedPaths: ["**/auth/**"],
  validation: { default: ["node --version"] },
};

// A fixture repo with `main` holding a committed .multi-review.json, then a `feature` branch.
function repo(setup = () => {}, { cfg = CFG, onMain = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "loop-it-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@t.t");
  git(dir, "config", "user.name", "t");
  git(dir, "checkout", "-q", "-b", "main");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fix", version: "1.0.0" }));
  writeFileSync(join(dir, ".multi-review.json"), JSON.stringify(cfg, null, 2));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  if (!onMain) git(dir, "checkout", "-q", "-b", "feature");
  setup(dir);
  return dir;
}
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test("loop --init seeds .multi-review.json and exits 0 without running", () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-init-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    const r = runLoop(dir, "--init");
    assert.equal(r.status, 0);
    assert.ok(existsSync(join(dir, ".multi-review.json")), "config seeded");
  } finally { cleanup(dir); }
});

test("loop --apply refuses on the default branch (exit 2)", () => {
  const dir = repo(() => {}, { onMain: true });
  try {
    const r = runLoop(dir, "--apply", "--rounds", "1", "--minutes", "1");
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /REFUSING --apply on the default branch/);
  } finally { cleanup(dir); }
});

test("loop --apply downgrades to report-only on a dirty working tree", () => {
  const dir = repo((d) => writeFileSync(join(d, "stray.js"), "// uncommitted\n"));
  try {
    const r = runLoop(dir, "--apply", "--rounds", "1", "--minutes", "1");
    assert.match(r.stdout, /clean working tree/);
    assert.match(r.stdout, /REPORT-ONLY/);
    assert.notEqual(r.status, 2);
  } finally { cleanup(dir); }
});

test("loop --apply downgrades to report-only with no validation matrix", () => {
  const dir = repo(() => {}, { cfg: { extensions: [".js"], protectedPaths: [], validation: { default: [] } } });
  try {
    const r = runLoop(dir, "--apply", "--rounds", "1", "--minutes", "1");
    assert.match(r.stdout, /validation\.default/);
    assert.match(r.stdout, /REPORT-ONLY/);
  } finally { cleanup(dir); }
});

test("loop --apply downgrades to report-only when the change edits its own policy (vs trusted base)", () => {
  const dir = repo((d) => {
    // Weaken the perimeter on the feature branch and COMMIT it (clean tree, but differs from main).
    writeFileSync(join(d, ".multi-review.json"), JSON.stringify({ ...CFG, protectedPaths: [] }, null, 2));
    git(d, "commit", "-q", "-am", "weaken perimeter");
  });
  try {
    const r = runLoop(dir, "--apply", "--rounds", "1", "--minutes", "1");
    assert.match(r.stdout, /differs from main|guardrails/);
    assert.match(r.stdout, /REPORT-ONLY/);
  } finally { cleanup(dir); }
});

test("loop --apply refuses an empty/absent protectedPaths perimeter (fail safe, not wide open)", () => {
  const dir = repo(() => {}, { cfg: { extensions: [".js"], protectedPaths: [], validation: { default: ["node --version"] } } });
  try {
    const r = runLoop(dir, "--apply", "--rounds", "1", "--minutes", "1");
    assert.match(r.stdout, /no protectedPaths perimeter/);
    assert.match(r.stdout, /REPORT-ONLY/);
  } finally { cleanup(dir); }
});

test("loop --apply preflight passes when clean, on a branch, policy matches the trusted base", () => {
  const dir = repo(); // feature branch, config identical to main, clean tree
  try {
    const r = runLoop(dir, "--apply", "--rounds", "1", "--minutes", "1");
    assert.match(r.stdout, /mode: APPLY/);
    assert.doesNotMatch(r.stdout, /REPORT-ONLY/);
    assert.notEqual(r.status, 2);
  } finally { cleanup(dir); }
});
