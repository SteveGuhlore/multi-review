// lib/sh.mjs — shared IMPURE shell/git helpers used by both orchestrators
// (loop.mjs and goal.mjs). Deliberately kept OUT of lib/core.mjs so that file stays
// pure + side-effect-free; everything here shells out and is covered by the
// integration tests. Single source of truth so the two CLIs can't drift (they
// previously carried three divergent tool-detection probes and two copies of
// changedFiles()/log()).
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const SP = { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
const lines = (s) => String(s || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

// Execute a gate/validation command. A STRING runs under the shell, exactly as written, so
// quotes, pipes and `npm test` behave as expected (the shell does the word-splitting — we
// must NOT pre-tokenize or the quoting is processed twice). An ARRAY runs argv-exact with no
// shell: the unambiguous form for args containing spaces/quotes. Returns the spawnSync result.
export function runCmd(cmd, opts = {}) {
  const o = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts };
  return Array.isArray(cmd)
    ? spawnSync(cmd[0], cmd.slice(1), { ...o, shell: false })
    : spawnSync(cmd, { ...o, shell: true });
}

// True iff `bin` resolves on PATH. Cross-platform: `where` on Windows (cmd.exe has no
// `command`), POSIX `command -v` otherwise. Replaces goal.mjs's `toolPresent`.
export function toolPresent(bin) {
  return process.platform === "win32"
    ? spawnSync("where", [bin], { ...SP, timeout: 15_000 }).status === 0
    : spawnSync("command", ["-v", bin], { ...SP, timeout: 15_000 }).status === 0;
}

// `<cmd> --version` exits 0 — used to detect model CLIs (claude/codex/gemini). 60s
// because a CLI auto-updating on --version (e.g. codex) can stall past 30s and be
// wrongly dropped. Replaces loop.mjs's `has` and goal.mjs's `have`.
export function cliWorks(cmd) {
  return spawnSync(cmd, ["--version"], { ...SP, timeout: 60_000 }).status === 0;
}

// Files changed vs HEAD (staged or not), excluding the run's own artifacts.
export function changedFiles() {
  return lines(spawnSync("git", ["diff", "--name-only", "HEAD"], SP).stdout).filter((f) => !f.startsWith("reviews/"));
}

// Tracked files, excluding the run's own artifacts.
export function trackedFiles() {
  return lines(spawnSync("git", ["ls-files"], SP).stdout).filter((f) => !f.startsWith("reviews/"));
}

// Short HEAD sha, or null outside a repo.
export function gitSha() {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], SP);
  return r.status === 0 ? r.stdout.trim() : null;
}

// Current branch name ("" if detached/unknown). The `|| ""` guards a null stdout
// (git absent / spawn error) so callers never crash on `.trim()`.
export function currentBranch() {
  return (spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], SP).stdout || "").trim();
}

// Recent commit subject lines (newest first) — the metrics escape-signal scan.
export function gitLogSubjects(n = 500) {
  return lines(spawnSync("git", ["log", "--pretty=%s", "-n", String(n)], SP).stdout);
}

// True iff the working tree has no uncommitted changes. reviews/ is gitignored so it
// never counts. Gates the destructive --apply path (which runs `git reset --hard`).
export function workingTreeClean() {
  return lines(spawnSync("git", ["status", "--porcelain"], SP).stdout).length === 0;
}

// Resolve a TRUSTED base ref (the default branch) to read policy from. The change under
// review lives on a feature branch, so its own commits must not be the policy source —
// the perimeter must come from main/master. Returns a ref name or null if none resolves.
export function trustedBaseRef() {
  const ok = (r) => spawnSync("git", ["rev-parse", "--verify", "--quiet", r], SP).status === 0;
  const sym = spawnSync("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], SP);
  if (sym.status === 0) { const r = sym.stdout.trim().replace("refs/remotes/", ""); if (r) return r; }
  for (const r of ["origin/main", "origin/master", "main", "master"]) if (ok(r)) return r;
  return null;
}

// Read a path AS COMMITTED at <ref> (e.g. "HEAD"), parsed as JSON. Returns null when
// the ref/path is absent or unparseable. Lets --apply load its security perimeter from
// a trusted committed snapshot instead of the editable working tree (defense against a
// change weakening its own guardrails).
export function gitShowJSON(ref, path) {
  const r = spawnSync("git", ["show", `${ref}:${path}`], SP);
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

// Apply a change in an ISOLATED git worktree, so the user's working tree is NEVER touched
// — no in-place edit, no `git reset --hard`/`git clean` on their files. Flow:
//   edit(dir)     mutates files in the throwaway worktree (e.g. a model edit, cwd=dir);
//   validate(dir) returns true iff the change holds (the repo's validation matrix, cwd=dir);
//   on success the change is committed in the worktree and cherry-picked onto the current
//   branch (the user's clean tree fast-forwards); on failure NOTHING reaches their tree.
// The worktree (detached at HEAD) is always removed. Returns
// { ok, committed, touched[], error? }. Requires the current working tree to be clean
// (callers gate on workingTreeClean) so the cherry-pick applies without conflict.
export function applyInWorktree({ edit, validate, message, cwd = process.cwd() }) {
  const main = { ...SP, cwd };                          // git commands against the user's repo
  const inWt = (wt) => ({ ...SP, cwd: wt });            // git commands inside the worktree
  const wt = join(tmpdir(), `mr-wt-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`);
  const cleanup = () => {
    spawnSync("git", ["worktree", "remove", "--force", wt], main);
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* already gone */ }
  };
  try {
    const add = spawnSync("git", ["worktree", "add", "--detach", wt, "HEAD"], main);
    if (add.status !== 0) return { ok: false, committed: false, touched: [], error: (add.stderr || "git worktree add failed").trim() };
    edit(wt);
    if (!validate(wt)) return { ok: false, committed: false, touched: [] };
    spawnSync("git", ["add", "-A"], inWt(wt));
    const touched = lines(spawnSync("git", ["diff", "--name-only", "--cached"], inWt(wt)).stdout);
    if (!touched.length) return { ok: true, committed: false, touched: [] }; // validated, but the edit changed nothing
    const c = spawnSync("git", ["commit", "-F", "-"], { ...inWt(wt), input: message || "fix [multi-review]\n" });
    if (c.status !== 0) return { ok: false, committed: false, touched, error: (c.stderr || "commit failed").trim() };
    const sha = (spawnSync("git", ["rev-parse", "HEAD"], inWt(wt)).stdout || "").trim();
    const cp = spawnSync("git", ["cherry-pick", sha], main); // onto the user's branch (clean tree → clean apply)
    if (cp.status !== 0) {
      spawnSync("git", ["cherry-pick", "--abort"], main);
      return { ok: false, committed: false, touched, error: (cp.stderr || "cherry-pick failed").trim() };
    }
    return { ok: true, committed: true, touched };
  } finally { cleanup(); }
}
