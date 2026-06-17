# multi-review — Cheat-Sheet

> **Three AI models (Claude · Codex · Gemini) review your code together, so one model never gets the last word.** Language-agnostic, zero-config, safe by default.

---

## ⚡ 30-second version

```
                  do you HAVE code, or do you WANT code?
                            │                 │
                   ┌────────┘                 └────────┐
                   ▼                                    ▼
          ╔═════════════════╗                 ╔═════════════════╗
          ║  /multi-review  ║                 ║      /goal       ║
          ║  ─ the AUDITOR ─║                 ║  ─ the BUILDER ─ ║
          ╠═════════════════╣                 ╠═════════════════╣
          ║ check what's    ║                 ║ build new, or    ║
          ║ already there   ║                 ║ change existing  ║
          ║                 ║                 ║                  ║
          ║ → report  (+opt ║                 ║ plan→build→gate  ║
          ║   auto-fix safe)║                 ║ →review→route    ║
          ╚═════════════════╝                 ╚═════════════════╝
            audits · PR review                  features · fixes ·
            · security pass                     refactors
```

**Rule of thumb:** *Have code → `/multi-review`.  Want code → `/goal`.  Add `--apply` only when you want it to actually edit.*

Both are slash commands in **Claude Code** — type `/` to find them. They work in **any repo, with zero setup**.

---

## 🧠 How `/goal` chains everything

`/goal` is the full loop. `/multi-review` is just the **REVIEW** box, run on its own.

```
   ┌─▶  PLAN  ─▶  BUILD  ─▶  GATES  ─▶  REVIEW  ─▶  ROUTE  ─┐
   │  helpmecode   TDD     test/lint  /multi-review  fix ·  │
   │   PLAN.md            /build      (3 models      plan · │
   │                                   debate)       done   │
   └────────── re-plan / re-build until converged ──────────┘
                       (or it hits a cap)
```

---

## 🔍 `/multi-review` — the auditor

```
  /multi-review  <scope>  [--debate]  [--apply]  [--transcript]
                   │           │          │
   scope ──────────┘           │          └─ auto-fix the safe, agreed,
    branch     (default —      │             high-severity, non-protected
               your diff)      │             findings  (implies --debate)
    full       (whole repo)    └─ make the 3 models argue
    path <dir> (one folder)       to consensus before reporting
    staged     (git staged)
```

| You type | What you get |
|---|---|
| `/multi-review` | review your branch's diff · **report only** |
| `/multi-review full` | review the **whole repo** · report only |
| `/multi-review path server` | review just the `server/` folder |
| `/multi-review full --debate` | 3 models debate to consensus, then report |
| `/multi-review path api --apply` | debate **+ auto-fix** the safe ones (on a branch) |

---

## 🔨 `/goal` — the builder

```
  /goal  "<what you want>"   [--auto | --checkpoints]   [--apply]
                                      │                     │
   autonomy ──────────────────────────┘                     └─ let it
    --checkpoints  pause for your OK after PLAN & each round    write
    --auto         run unattended to convergence / caps         fixes

   preview modes (spend $0 / no AI):
    --dry-run     walk the loop, describe AI steps, run the REAL gates
    --gates-only  safety gates only (test/lint/build/secrets), no AI
    --plan-only   plan + gates, then stop before build/review
```

| You type | What you get |
|---|---|
| `/goal "add CSV export" --checkpoints` | plans → asks your OK → builds → reviews |
| `/goal "fix the date bug" --auto --apply` | unattended build + fix on a branch |
| `/goal "redesign settings" --dry-run` | watch the machine turn, spends nothing |
| `/goal --gates-only` | just the safety gates (CI-style) |

---

## 🗺️ helpmecode — the planning brain

The skill `/goal` uses for its **PLAN** step. It also fires on its own when you say things like *"help me plan X"*, *"spec this out"*, *"where do I start"*.

It runs an interview → researches (with a fresh-context fact-checker) → designs (Mermaid diagrams) → and writes **`PLAN.md`** + a seeded **`.multi-review.json`** + a **`DESIGN.md`** (for UI work) that hand straight off to `/goal`.

---

## 🤖 The agent team

Two layers of agents do the work:

**1. Reviewers — deploy on every review** (terminal *and* slash):

```
  Claude (opus) ┐
  Codex  (gpt)  ┤ → debate to consensus → validated findings
  Gemini        ┘
```

These are the `claude review / codex review / gemini review` lines you see in a run.

**2. Builders — only in `/goal`:**

| Phase | Who | Guardrail |
|---|---|---|
| PLAN | a Claude planner running `helpmecode` | emits `PLAN.md` + `.multi-review.json` |
| BUILD | one fresh implementer agent **per task** | can't edit tests (writer ≠ approver) |
| REVIEW | hands the diff to the reviewer team above | Claude is the final arbiter |

> `node loop.mjs` (terminal) deploys layer 1 only. `/goal` adds layer 2 — and that whole `/goal` layer is the recent addition; before it, the tool was just the reviewer loop.

---

## ✅ "Which do I use?" — 6-line decision

```
  Audit my PR before merge ............ /multi-review
  Audit + clean up safe nits .......... /multi-review full --apply
  Build a feature, stay in control .... /goal "…" --checkpoints
  Small fix, hands-free ............... /goal "…" --auto --apply
  Plan it before building ............. "help me plan X"   (helpmecode)
  Prove it's safe — no AI, no tokens .. /goal --gates-only
```

---

## 🎚️ Every flag at a glance

**`/goal`**

| Flag | Meaning | Default |
|---|---|---|
| `--checkpoints` | pause for your OK after PLAN & each round | **default** |
| `--auto` | run unattended to convergence / caps | — |
| `--apply` | let it write fixes (branch only) | off → report-only |
| `--dry-run` | describe AI steps, run real gates, spend $0 | — |
| `--gates-only` | safety gates only, no AI | — |
| `--plan-only` | plan + gates, stop before build/review | — |
| `--target <path>` | scope to a file or directory | `.` |
| `--rounds N` | max build → review rounds | — |
| `--minutes N` | wall-clock cap | — |

**`/multi-review`**

| Arg / Flag | Meaning | Default |
|---|---|---|
| `branch` | review your branch's diff | **default scope** |
| `branch <name>` | review that branch vs base | — |
| `full` | review the whole repo | — |
| `path <dir>` | review one folder | — |
| `staged` | review git-staged changes | — |
| `--debate` | models argue to consensus before reporting | off |
| `--apply` | auto-fix safe agreed findings (implies `--debate`) | off |
| `--transcript` | keep the raw transcript (else a redacted summary) | off |

---

## 🛡️ The 4 safety rails (why you can trust `--apply`)

```
  ✓ Auto-fix runs ONLY on a branch — it refuses on main / master
  ✓ Report-only unless YOU add --apply
  ✓ Critical / security findings are NEVER auto-edited → written to PLAN.md
  ✓ Each fix = its own revertible commit; if tests go red, that fix reverts
```

> `--apply` with no real validation command configured **drops to report-only** — a wrong gate can't silently revert your whole repo. "Converged" means the models agree nothing material remains **and** validation is green — it is *not* a proof of bug-freeness.

---

## 📂 Where the results land

```
  /multi-review  →  reviews/<time>-<scope>-<sha>/
                      report.md       ← human summary, findings by severity
                      findings.json   ← machine-readable

  /goal          →  reviews/goal-<time>/
                      log.md          ← what happened, round by round
                      manifest-*.json ← provenance per iteration
                      PLAN.md         ← critical/security work it won't auto-do
```

Always read **`PLAN.md`** after a run — it's the heightened-review queue for anything the loop refused to touch automatically.

---

## 💻 Outside Claude Code (optional)

Same engine, two other front doors:

**Terminal** — after a one-time `npm link` from this repo:
```sh
goal "add rate limiting" --auto --apply
multi-review --target .
```
Before linking, the long form always works:
```sh
node ~/.claude/multi-review/goal.mjs "add rate limiting" --auto --apply
node ~/.claude/multi-review/loop.mjs --target .
```

**CI / GitHub Actions** — deterministic gates only, no AI, no keys:
```yaml
- uses: actions/setup-node@v4
  with: { node-version: "22" }
- run: node goal.mjs --gates-only     # secrets + code-slop + your test cmd; fail-closed
```

---

## 📦 Requirements & install

- **Node ≥ 18** (CI runs on 22).
- Authed CLIs the loop drives (uses whichever are present): **`claude`** (required), **`codex`** (required), **`gemini`** (optional).
- `--gates-only` and `--dry-run` need **none** of them.

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1   # Windows
```
```sh
sh ./install.sh                                            # macOS / Linux
```
Installs the `/goal` + `/multi-review` slash commands, the `helpmecode` skill, and the engines into `~/.claude/` — once per machine, then call from any repo.
