# multi-review

Autonomous, multi-model code review + fix loop. **Claude + GPT (Codex) + Gemini** debate findings
round-after-round, auto-fix the validated **non-security** ones (validation-gated, revertible, branch-only),
and write an Opus remediation **PLAN** for anything critical or security. Language-agnostic. Zero-config
(it auto-detects the repo's language, test command, and a safe protected-paths list on first run).

## Install
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1   # Windows
```
```sh
sh ./install.sh                                            # macOS / Linux
```
Installs the `/multi-review` slash command + `loop.mjs` into `~/.claude/`.

Prereqs (authed): `claude`, `codex`, and (optional) `gemini` CLIs. The loop uses whichever are present.

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
