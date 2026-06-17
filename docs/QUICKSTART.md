# Quickstart

Get from zero to a running review loop. Two tiers: a **headless CI gate** (no setup, no
model calls) and the **full multi-model loop** (needs a dev machine with authed CLIs).

---

## Tier 1 — CI gate (no install, no API keys)

The deterministic spine runs the gate ladder + emits a run-manifest with **zero model calls**.
Add one step to any repo's workflow:

```yaml
# .github/workflows/ci.yml
- uses: actions/setup-node@v4
  with: { node-version: "22" }
- run: node goal.mjs --gates-only   # secrets + code-slop + your test cmd; fail-closed
```

This is headless — it works from the GitHub web UI / Actions tab, no terminal required.
A required gate whose tool is absent **fails closed** (won't silently pass).

---

## Tier 2 — full loop on a dev machine

### 1. Prerequisites
- **Node 22+**
- Authed CLIs the loop drives (it uses whichever are present):
  - `claude` — required
  - `codex` — required
  - `gemini` — optional
- `--gates-only` and `--dry-run` need **none** of the above.

### 2. Install
```sh
git clone https://github.com/SteveGuhlore/multi-review
cd multi-review
sh ./install.sh          # macOS / Linux
# powershell -ExecutionPolicy Bypass -File .\install.ps1   # Windows
```
Installs the `/goal` + `/multi-review` slash commands, the `helpmecode` skill, and the engines
(`loop.mjs`, `goal.mjs`, and all of `lib/`) into `~/.claude/`.

### 3. Dry run first (watch the machine turn, no model calls)
```sh
cd <any repo>
node ~/.claude/multi-review/goal.mjs --gates-only        # deterministic spine only
node ~/.claude/multi-review/goal.mjs "<goal>" --dry-run  # describe model phases, run real gates
```
If the model phases are dry (CLIs not authed yet), this still exercises the full spine safely.

### 4. Go live
```sh
cd <any repo>
git checkout -b auto/mr        # never runs --apply on main/master

# small, unattended update on a branch:
node ~/.claude/multi-review/goal.mjs "<goal>" --auto --apply

# large build, pause for sign-off at checkpoints:
node ~/.claude/multi-review/goal.mjs "<goal>" --checkpoints

# review-only loop (no goal, just audit + fix the working tree):
node ~/.claude/multi-review/loop.mjs --target . --apply
```

The **first run** auto-writes `.multi-review.json` for that repo (detected file extensions, test
command, and a broad protected-paths list). Edit it to taste, or regenerate with `--init`.

---

## What's safe by default
- Auto-fix runs **only on a branch** — it refuses on `main`/`master`.
- **Critical** findings and anything on **protected/security paths** are never auto-edited — they
  go to a `PLAN.md` for heightened review. Ambiguity counts as inside the perimeter.
- Each auto-fix is a **revertible commit**; if the repo's validation matrix doesn't stay green, the
  fix is reverted.
- `--apply` with no real `validation.default` drops to **report-only** (a wrong gate can't silently
  revert everything).
- "Converged" means the models agree nothing material remains **and** validation passes — it is not
  a proof of bug-freeness.

## Adding gate-ladder coverage
The gate ladder (`.goal.json`, see `.goal.example.json`) degrades gracefully: mutation,
diff-coverage, secrets, SAST, dep-vuln, malicious-package, a11y, perf. Install the underlying
scanners as you want each gate to count; absent **required** gates fail closed, control-plane
gates (deploy) never run autonomously.

## Cutting a release
No terminal needed: **Actions tab → `release` workflow → Run workflow → enter `vX.Y.Z`**. It gates
on `npm test` + `goal --gates-only`, then creates the tag + GitHub Release. From a terminal, pushing
a `vX.Y.Z` tag publishes automatically.

## Artifacts
`reviews/goal-<ts>/` and `reviews/loop-<ts>/` — `log.md`, per-round JSON (validated findings + who
agreed), `PLAN.md`, and per-iteration run-manifests binding each change to its model, prompt hash,
gate exit codes, and spec version.
