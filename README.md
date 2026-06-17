# multi-review + /goal

Autonomous, multi-model code review + fix loop. **Claude + GPT (Codex) + Gemini** debate findings
round-after-round, auto-fix the validated **non-security** ones (validation-gated, revertible, branch-only),
and write an Opus remediation **PLAN** for anything critical or security. Language-agnostic. Zero-config
(it auto-detects the repo's language, test command, and a safe protected-paths list on first run).

> **New here?** The **[Cheat-Sheet](docs/CHEATSHEET.md)** shows every command, flag, and how to call it — visually, on one page.

## `/goal` — the one-stop build↔review loop

`/goal` takes an idea (small update or large build) all the way through:

```
PLAN (/helpmecode) → BUILD → GATE LADDER → REVIEW (multi-review) → ROUTE → run-manifest
        └──────────────── re-plan / re-build until converge or caps ───────────────┘
```

- **`/helpmecode`** (skill) turns a rough idea into a build-ready `PLAN.md` + a seeded
  `.multi-review.json` + `DESIGN.md` (adaptive interview → research-with-a-fresh-context-validator →
  Mermaid design). It *pre-arms* the reviewer — the thing no other planner does.
- **Autonomy dial:** `--checkpoints` (pause for sign-off; big builds) or `--auto` (unattended to
  convergence/caps; small updates). Never auto-merges to `main`; terminal state is a green PR.
- **Fail-closed security perimeter:** findings on protected paths or `critical` severity are
  quarantined for heightened review, never plainly auto-fixed. Ambiguity counts as inside.
- **Degradable gate ladder** (`.goal.json`): mutation, diff-coverage, secrets, SAST, dep-vuln,
  malicious-package, a11y, perf… Each reduces to an exit code; a required gate whose tool is absent
  **fails closed**; control-plane gates (deploy) never run autonomously. See `.goal.example.json`.
- **Run-manifest** per iteration binds each change to its model, prompt hash, gate exit codes, and
  spec version — the living-docs↔provenance bridge.

```sh
node ~/.claude/multi-review/goal.mjs "<goal>" --checkpoints     # large build (gated)
node ~/.claude/multi-review/goal.mjs "<goal>" --auto --apply    # small update (unattended, on a branch)
node ~/.claude/multi-review/goal.mjs --gates-only               # CI: deterministic gates only, no model calls
node ~/.claude/multi-review/goal.mjs "<goal>" --dry-run         # watch the machine turn without model calls
```

The design rationale, ecosystem research, and build-vs-borrow decisions live in
[`docs/ROADMAP.md`](docs/ROADMAP.md) and [`docs/RESEARCH.md`](docs/RESEARCH.md). The pure core
(`lib/core.mjs`) is covered by `npm test` (run `node --test`), so the repo is self-validating.

## Install
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1   # Windows
```
```sh
sh ./install.sh                                            # macOS / Linux
```
Installs the `/multi-review` + `/goal` slash commands, the `helpmecode` skill, and the engines
(`loop.mjs`, `goal.mjs`, `lib/core.mjs`) into `~/.claude/`.

Prereqs (authed): `claude`, `codex`, and (optional) `gemini` CLIs. The loop uses whichever are present.
`/goal --gates-only` and `--dry-run` need none of them.

## Use — any repo, no setup
```sh
cd <any repo>
git checkout -b auto/mr
node ~/.claude/multi-review/loop.mjs --target . --apply
```
The first run writes `.multi-review.json` for that repo automatically (detected extensions, test command,
and a broad protected-paths list). Edit it to taste, or run with `--init` to just (re)generate it.

### Flags
| Flag | Meaning | Default |
|---|---|---|
| `--target <path>` | File or dir to review | `.` |
| `--apply` | Auto-fix validated non-security findings (else report-only) | off |
| `--rounds N` | Outer review → fix → re-review rounds | 6 |
| `--debate D` | Debate passes per round (models judge each other's findings) | 2 |
| `--minutes N` | Wall-clock cap | 180 |
| `--model-timeout N` | Per-model-call cap (minutes); a stuck/hung CLI sits out that pass instead of stalling the run | 8 |
| `--init` | Just (re)generate `.multi-review.json` and exit | — |
| `MR_GEMINI_MODEL` (env) | Gemini model override | CLI default |

## How it works
Each round: every model reviews the target → the **union** of findings is debated (each model validates/refutes/adds,
round after round) → findings with net agreement are **validated** → non-security ones are auto-fixed (each fix is
applied, the repo's validation matrix must stay green or it's reverted, and it's committed as its own step) →
re-review. Stops when the models converge (no validated fixable findings + green) or hits the caps.

## Safety
- **Critical + protected/security paths are never auto-edited** — they go to `reviews/loop-*/PLAN.md`.
- Auto-fix runs **only on a branch** (refuses on `main`/`master`), each fix a **revertible commit**.
- `--apply` needs a real `validation.default` or it drops to **report-only** (so a wrong gate can't silently revert everything).
- "Converged" = the models agree nothing material remains **and** validation passes — not a proof of bug-freeness.

## Artifacts
`reviews/loop-<timestamp>/` — `log.md`, `round-*.json` (validated findings + who agreed), `PLAN.md`.
