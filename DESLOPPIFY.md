# DESLOPPIFY — cleanup backlog

A prioritized review of `multi-review` / `/goal`. Nothing here is fixed yet; this is the
working backlog. Each item lists **where**, **why it matters**, **recommendation**, and
**safe to fix now? / wait**.

Legend: 🔴 critical · 🟡 medium · 🟢 nice-to-have · ☐ open · ☑ done

---

## 1. Critical issues

### 🔴 C1 — `loop.mjs --apply` can have its security perimeter weakened by the change under review ☐
- **Where:** `loop.mjs:44` (config loaded from working tree) + `loop.mjs:248-251`, `applyFix` at `loop.mjs:211`.
- **Why it matters:** `loop.mjs` reads `.multi-review.json` (the `protectedPaths` perimeter + validation
  matrix) from the **working tree**. The `/multi-review` command spec (`commands/multi-review.md:60-67, 85-86`)
  explicitly mandates loading policy from the *trusted base revision* and forcing report-only if the change set
  touches `.multi-review.json` — "a change must not be allowed to weaken its own guardrails." The autonomous
  engine, which is the one that actually auto-commits, does **not** implement that guard. A PR that loosens
  `protectedPaths` would be honored on the same run that edits it.
- **Recommendation:** In `--apply` mode load config via `git show <base>:.multi-review.json`, and if the diff
  modifies `.multi-review.json` at all, drop to report-only. Mirror the command spec's invariant.
- **Safe to fix now?** Yes, but it changes `--apply` behavior — add a test (the loop has none yet) alongside it.

### 🔴 C2 — `--apply` revert path can destroy pre-existing uncommitted work ☐
- **Where:** `loop.mjs:233-234` (`git reset --hard HEAD` + `git clean -fd`) inside `applyFix`.
- **Why it matters:** On any fix that fails validation, the loop hard-resets the working tree and runs
  `git clean -fd`. If the user had uncommitted changes when they launched `--apply`, those are silently and
  unrecoverably destroyed. The only current guard is "not on main/master" (`loop.mjs:250`).
- **Recommendation:** Before `--apply`, require a clean working tree (`git status --porcelain` empty) and abort
  with a clear message otherwise; or stash-and-restore around the run. Document the precondition.
- **Safe to fix now?** Yes — adding a precondition check is low-risk and purely protective.

### 🔴 C3 — `autodetect()` is duplicated and has **diverged** from the shared core ☐
- **Where:** inline `autodetect()` at `loop.mjs:66-95` vs `autodetectConfig()` at `lib/core.mjs:263-296`
  (the latter is pure + unit-tested; `goal.mjs:61` already uses it).
- **Why it matters:** The two entry points seed **different** `.multi-review.json`. `loop.mjs`'s copy detects
  `.cjs/.vue/.svelte`, Java/Kotlin (`pom.xml`/`gradle`), `setup.cfg`, and a wider protected-path list
  (`*wallet*`, `*sign*`, `*crypto*`, `*risk*`, `*broker*`, `*order*`); `core`'s copy adds `**/CODEOWNERS` but
  omits the rest. So the security perimeter you get depends on *which tool wrote the config first* — a
  correctness and security inconsistency, and a textbook single-source-of-truth violation.
- **Recommendation:** Delete `loop.mjs`'s inline `autodetect()`; import `autodetectConfig` from `lib/core.mjs`.
  Fold the richer detection (Java/Kotlin, `setup.cfg`, the extra protected globs) into the core version so
  nothing regresses (see N5).
- **Safe to fix now?** Yes, but it changes generated config — reconcile the union of both lists and update
  `test/core.test.mjs`.

---

## 2. Medium cleanup items

### 🟡 M1 — Two divergent review engines with different `--apply` safety semantics ☐
- **Where:** `commands/multi-review.md` (Claude-orchestrated flow) vs `loop.mjs` (autonomous flow).
- **Why it matters:** Same product, two implementations with materially different guardrails. The command spec:
  isolated git worktree, severity ≥ **high**, config from trusted base, config-edit ⇒ report-only. `loop.mjs`:
  in-place edit + hard reset, severity **high/medium/low** (`loop.mjs:297`), config from working tree, no
  config-edit guard. A maintainer reading one will be wrong about the other.
- **Recommendation:** Decide the canonical semantics and converge the weaker engine onto it (worktree
  isolation + base-config are the safe defaults). At minimum, document the divergence explicitly.
- **Safe to fix now?** Partially — documenting is safe now; unifying execution is a larger change, do after C1–C3.

### 🟡 M2 — Dead / unwired code: tested but never called ☐
- **Where:** `lib/synth.mjs` (entire module — no importer outside its test); `lib/metrics.mjs`
  `selfChangeAcceptable` (`:52`) and `bugEscapeRate` (`:35`) (only referenced in a *comment* at
  `goal.mjs:261`); unused `netValidated` import at `goal.mjs:26`.
- **Why it matters:** Carrying fully-tested modules with zero callers makes the architecture read as more
  capable than it is (the self-improving "keep a rewrite only if metrics improve" loop is advertised but not
  wired). Future readers can't tell aspirational from live code.
- **Recommendation:** Either wire them in (a `--synth` gate; have `--metrics` actually call
  `selfChangeAcceptable`) or move them to a clearly-marked `experimental/` area / remove. Drop the unused
  `netValidated` import now.
- **Safe to fix now?** The unused import: yes. The modules: decide wire-vs-remove first (cheap, no behavior risk).

### 🟡 M3 — Windows-breaking path resolution in `goal.mjs` ☐
- **Where:** `goal.mjs:49` `const HERE = new URL(".", import.meta.url).pathname;` then `join(HERE, "loop.mjs")`
  at `:204`.
- **Why it matters:** On Windows `URL.pathname` yields `/C:/…`, which `path.join` mangles — so `/goal`'s
  dispatch to `loop.mjs` is broken on the very platform the rest of the codebase bends over backwards to support
  (`.ps1` wrappers, `where`, `cmd.exe` notes). The integration test already uses `fileURLToPath` correctly.
- **Recommendation:** `import { fileURLToPath } from "node:url"` and `const HERE = dirname(fileURLToPath(import.meta.url))`.
- **Safe to fix now?** Yes — straight correctness fix.

### 🟡 M4 — `/multi-review` references POSIX wrappers that don't exist ☐
- **Where:** `commands/multi-review.md:44-46` cites `codex-review.sh` / `gemini-review.sh`; only `.ps1` versions
  exist (`codex-review.ps1`, `gemini-review.ps1`), and `install.sh:18-19` copies only the `.ps1` files.
- **Why it matters:** The POSIX `/multi-review` path points at files that are never created — broken docs and a
  broken flow for macOS/Linux users of the command (the autonomous `loop.mjs` path is unaffected).
- **Recommendation:** Either add `.sh` equivalents (and copy them in `install.sh`) or update the doc to describe
  the actual POSIX invocation.
- **Safe to fix now?** Yes.

### 🟡 M5 — Duplicated helpers across `loop.mjs` and `goal.mjs` ☐
- **Where:** `opt()` (`loop.mjs:26`, `goal.mjs:33`); `changedFiles()` (`loop.mjs:197`, `goal.mjs:166`); three
  separate tool-detection impls — `has` (`loop.mjs:180`, `--version`), `have` (`goal.mjs:79`, `--version`),
  `toolPresent` (`goal.mjs:102`, `command -v`/`where`); two different `log()` impls.
- **Why it matters:** Drift risk — fixing a bug in one copy silently leaves the other broken (exactly what
  happened with `autodetect`). Three tool-detection strategies give inconsistent results across the two tools.
- **Recommendation:** Lift `opt`, `changedFiles`, and a single canonical `toolPresent` into `lib/core.mjs`
  (the `command -v`/`where` version is the most correct) and import in both.
- **Safe to fix now?** Yes, incrementally — these are pure helpers; move one at a time with a test each.

### 🟡 M6 — `loop.mjs` `log()` is O(n²) file I/O ☐
- **Where:** `loop.mjs:42` — reads the entire existing log file and rewrites it on **every** line.
- **Why it matters:** For long autonomous runs (the intended use) the log file is re-read+rewritten per line,
  which is quadratic and slows as it grows. `goal.mjs:54` already buffers correctly.
- **Recommendation:** Use `appendFileSync` (or buffer + flush like `goal.mjs`).
- **Safe to fix now?** Yes — behavior-preserving.

### 🟡 M7 — Naive gate/validation command parsing ☐
- **Where:** `goal.mjs:138` `gate.cmd.split(" ")`; `loop.mjs:190` `c.split(" ")` in `validate()`.
- **Why it matters:** Any command with a quoted argument or a path containing spaces is split incorrectly,
  silently running the wrong command (or failing closed on a required gate ⇒ false "blocked").
- **Recommendation:** Support array-form `cmd` in config, or use a minimal shell-aware tokenizer.
- **Safe to fix now?** Yes, additively (accept both string and array `cmd`), keeping back-compat.

---

## 3. Nice-to-have polish

### 🟢 N1 — Stale Playwright artifact committed to the repo ☐
- **Where:** `test-results/.last-run.json` (tracked; content `{"status":"failed",...}`).
- **Why it matters:** A generated, stale test artifact is checked in; `test-results/` isn't gitignored.
- **Recommendation:** `git rm --cached` it and add `test-results/` to `.gitignore`.
- **Safe to fix now?** Yes.

### 🟢 N2 — `--rounds 0` / empty option values silently ignored ☐
- **Where:** `opt()` (`loop.mjs:26`, `goal.mjs:33`) — `argv[i+1]` truthiness check drops `0`/empty.
- **Why it matters:** Minor surprising-input edge; `--rounds 0` falls back to the default instead of erroring.
- **Recommendation:** Distinguish "flag absent" from "value present" by index, not truthiness.
- **Safe to fix now?** Yes (fold into the M5 consolidation).

### 🟢 N3 — Consolidate ad-hoc logging/ANSI handling ☐
- **Where:** color object `C` only in `goal.mjs:52`; `loop.mjs` and `dashboard.mjs` log differently.
- **Why it matters:** Cosmetic inconsistency once `log()`/helpers are shared (M5/M6).
- **Recommendation:** Single small logging helper in `lib/` with ANSI-strip-on-buffer.
- **Safe to fix now?** Yes, after M5/M6.

### 🟢 N4 — Docs/README accuracy pass for unwired features ☐
- **Where:** `README.md`, `docs/` — claims about the self-evaluating/synthesis loop (see M2).
- **Why it matters:** If `synth`/`selfChangeAcceptable` stay unwired, docs overstate current capability.
- **Recommendation:** Align docs with whatever M2 decides (wire vs. mark experimental).
- **Safe to fix now?** Yes, after M2.

### 🟢 N5 — Enrich `autodetectConfig` when merging the duplicate (follow-up to C3) ☐
- **Where:** `lib/core.mjs:263-296`.
- **Why it matters:** Core's detector lacks Java/Kotlin, `setup.cfg`, and several protected globs that the
  loop's copy had; collapsing to one shouldn't lose that coverage.
- **Recommendation:** Take the union of both lists into core; extend `test/core.test.mjs`.
- **Safe to fix now?** Do as part of C3.

---

## Suggested order

C2 → C1 → C3 (safety + the single-source-of-truth win), then M2/M3/M4 (cheap, isolated),
then M5/M6/M7 (consolidation), then the 🟢 polish. M1 (unifying the two engines) is the
biggest design decision — tackle it after C1–C3 make the loop's guardrails match the spec.
