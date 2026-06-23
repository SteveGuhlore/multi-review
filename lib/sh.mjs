// lib/sh.mjs — shared IMPURE shell/git helpers used by both orchestrators
// (loop.mjs and goal.mjs). Deliberately kept OUT of lib/core.mjs so that file stays
// pure + side-effect-free; everything here shells out and is covered by the
// integration tests. Single source of truth so the two CLIs can't drift (they
// previously carried three divergent tool-detection probes and two copies of
// changedFiles()/log()).
import { spawnSync } from "node:child_process";

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

// Current branch name ("" if detached/unknown).
export function currentBranch() {
  return (spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], SP).stdout || "").trim();
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
