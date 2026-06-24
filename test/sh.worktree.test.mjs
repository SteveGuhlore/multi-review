// Integration tests for lib/sh.applyInWorktree — the worktree-isolated apply that replaces
// loop.mjs's old in-place `git reset --hard`. Uses synthetic edit/validate (no model), so it
// deterministically proves: success cherry-picks onto the branch, failure leaves the user's
// tree untouched, and the throwaway worktree is always cleaned up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyInWorktree } from "../lib/sh.mjs";

const git = (dir, ...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
const head = (dir) => git(dir, "rev-parse", "HEAD").stdout.trim();
const porcelain = (dir) => git(dir, "status", "--porcelain").stdout.trim();
const worktreeCount = (dir) => git(dir, "worktree", "list").stdout.trim().split(/\r?\n/).filter(Boolean).length;

function repo(setup = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "wt-it-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@t.t");
  git(dir, "config", "user.name", "t");
  git(dir, "checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  setup(dir);
  return dir;
}
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test("applyInWorktree: validated edit is committed + cherry-picked onto the branch", () => {
  const dir = repo();
  try {
    const before = head(dir);
    const res = applyInWorktree({
      cwd: dir,
      message: "feat: add b.txt\n",
      edit: (wt) => writeFileSync(join(wt, "b.txt"), "two\n"),
      validate: () => true,
      // (validate runs in the worktree; here we accept unconditionally)
    });
    assert.equal(res.ok, true);
    assert.equal(res.committed, true);
    assert.deepEqual(res.touched, ["b.txt"]);
    assert.notEqual(head(dir), before, "branch HEAD advanced");
    assert.ok(existsSync(join(dir, "b.txt")), "fix landed in the user's working tree");
    assert.equal(porcelain(dir), "", "working tree is clean after cherry-pick");
    assert.equal(worktreeCount(dir), 1, "throwaway worktree removed (only main remains)");
  } finally { cleanup(dir); }
});

test("applyInWorktree: failed validation leaves the user's tree completely untouched", () => {
  const dir = repo();
  try {
    const before = head(dir);
    const res = applyInWorktree({
      cwd: dir,
      edit: (wt) => writeFileSync(join(wt, "b.txt"), "two\n"),
      validate: () => false, // simulate the fix breaking the validation matrix
    });
    assert.equal(res.ok, false);
    assert.equal(res.committed, false);
    assert.equal(head(dir), before, "HEAD unchanged");
    assert.ok(!existsSync(join(dir, "b.txt")), "broken fix never reaches the user's tree");
    assert.equal(porcelain(dir), "", "no stray files left behind");
    assert.equal(worktreeCount(dir), 1, "worktree cleaned up even on failure");
  } finally { cleanup(dir); }
});

test("applyInWorktree: guard veto blocks the commit (protected path never reaches the branch)", () => {
  const dir = repo();
  try {
    const before = head(dir);
    const res = applyInWorktree({
      cwd: dir,
      edit: (wt) => writeFileSync(join(wt, "secret.txt"), "x\n"),
      validate: () => true,
      guard: (touched) => !touched.includes("secret.txt"), // simulate a protected-path veto
    });
    assert.equal(res.ok, false);
    assert.equal(res.blocked, true);
    assert.equal(res.committed, false);
    assert.deepEqual(res.touched, ["secret.txt"]);
    assert.equal(head(dir), before, "HEAD unchanged when guard vetoes");
    assert.ok(!existsSync(join(dir, "secret.txt")), "vetoed change never reaches the user's tree");
    assert.equal(worktreeCount(dir), 1);
  } finally { cleanup(dir); }
});

test("applyInWorktree: a validated but no-op edit commits nothing", () => {
  const dir = repo();
  try {
    const before = head(dir);
    const res = applyInWorktree({ cwd: dir, edit: () => {}, validate: () => true });
    assert.equal(res.ok, true);
    assert.equal(res.committed, false);
    assert.deepEqual(res.touched, []);
    assert.equal(head(dir), before, "no empty commit created");
    assert.equal(worktreeCount(dir), 1);
  } finally { cleanup(dir); }
});

test("applyInWorktree: validate sees the edited files inside the worktree", () => {
  const dir = repo();
  try {
    let sawEdit = false;
    applyInWorktree({
      cwd: dir,
      edit: (wt) => writeFileSync(join(wt, "marker.txt"), "x\n"),
      validate: (wt) => (sawEdit = existsSync(join(wt, "marker.txt")) && readdirSync(wt).includes("a.txt")),
    });
    assert.ok(sawEdit, "validate ran in the worktree and saw both the edit and the checked-out repo");
  } finally { cleanup(dir); }
});
