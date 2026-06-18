# Run Dashboard — Design Spec

- **Date:** 2026-06-17
- **Status:** design approved; spec pending user review
- **Feature:** an auto-generated HTML dashboard summarizing multi-review / goal runs.

## Purpose

A self-contained HTML page that surfaces review/build run results at a glance, **auto-refreshed at the end of every run** so it's always current when opened. Audience: the maintainer's own workflow ("I check it only when I need to"). Not a released/shared product.

## Scope

**In (v1):**
- Latest run shown in detail + a history trend strip across the top ("both").
- Reads the existing `reviews/` artifacts; no new data the engines must produce.
- Auto-emitted from `loop.mjs` and `goal.mjs` at end of run (guarded — see Safety).
- Zero runtime dependencies; pre-rendered static HTML (no client-side JS).
- Graceful empty-state and partial/malformed-run handling.

**Out (v1, YAGNI):** live server / browser auto-refresh, client-side filter/sort, a `/dashboard` slash command (no models involved), cross-run diffing, cost/latency analytics.

## Invocation / runtime

- **Primary — auto-emit.** At the very end of a run (after all artifacts + the verdict), `loop.mjs` and `goal.mjs` call `writeDashboard("reviews")`.
- **Idempotent.** `writeDashboard` re-reads *all* of `reviews/` each time and rewrites `reviews/dashboard.html`, so the last writer always produces a complete dashboard. When `/goal` runs the loop and then finishes, both call it — harmless.
- **Optional manual.** Running `dashboard.mjs` directly (or `mr-dashboard` after `npm link`) calls the same `writeDashboard()` for ad-hoc regeneration without a run.

## Architecture

Mirrors the repo's existing **pure-core + thin-shell** split (`lib/core.mjs` ↔ `loop.mjs`):

- **`lib/dashboard.mjs` — pure, no I/O (unit-tested):**
  - `parseRunDir(dirName, fileMap) -> Run | null` — `fileMap` is `{ filename: parsedJSON | text }`; normalizes one run dir to a `Run`. Returns `null` for unrecognized/empty dirs.
  - `aggregate(runs) -> { latest: Run | null, history: HistoryPoint[] }`.
  - `renderHtml({ latest, history }) -> string` — pure string templating (inline CSS, dark, reuses cheat-sheet tokens).
  - severity helpers (canonical order, counts, color map).
- **`dashboard.mjs` — shell (the only fs-touching code):**
  - exports `writeDashboard(reviewsDir)`: list run dirs → read each dir's files → `parseRunDir` → `aggregate` → `renderHtml` → write `<reviewsDir>/dashboard.html`.
  - if run as the entry point (`import.meta.url` is main), calls `writeDashboard("reviews")`. The entry guard ensures importing it (from the engines) has **no side effects**.
- **Engines:** `loop.mjs` and `goal.mjs` add `import { writeDashboard } from "./dashboard.mjs";` and one guarded call at end of run.

## Data model

```
Run         = { id, type: "loop"|"review"|"goal", time, findings: Finding[],
                severityCounts: {critical,high,medium,low,info}, planCount }
Finding     = { severity, file, issue, models: string[], isPlan: boolean }
HistoryPoint= { id, time, type, severityCounts }
```

**Adapters (one per run-dir format):**
- `loop-<ts>/` → highest-numbered `round-*.json`; each item → `Finding` (`models` = `support[]`; `isPlan` = `severity === "critical"`). *Limitation: precise protected-path routing needs `.multi-review.json` + `isProtected`; v1 approximates `isPlan` by critical severity and also reports `planCount` from `PLAN.md` presence/length. Documented, not silently wrong.*
- `<ts>-<scope>-<sha>/` → `findings.json` (the `/multi-review` slash output) → `Finding[]`.
- `goal-<ts>/` → `manifest-*.json` for gate/iteration summary; detailed findings come from its linked `loop-*` entries. v1 shows the goal run as a meta/gates row in history. **If a `goal` run is the most recent run, the latest-detail panel shows its gate/iteration summary plus the findings from its linked `loop-*` run.**

## HTML output — `reviews/dashboard.html`

- Self-contained, dark, reuses `docs/cheatsheet.html` CSS tokens.
- **Header:** title · generated timestamp · run count.
- **History strip:** last ~10 runs, stacked severity bars (newest at right), each labeled by short time + type.
- **Latest run detail:** severity count chips; findings table — `file · severity · model-agreement dots (C/X/G) · PLAN flag`; a note/link to `PLAN.md` when present.
- **Empty state:** "No runs yet — run `/multi-review` or `/goal`."

## Edge cases / safety

- No `reviews/` dir or no recognized runs → friendly empty page (no crash).
- Malformed JSON / partial run (e.g., the Gemini-timeout run) → that file/run is skipped; rendering continues.
- **Auto-emit is wrapped in `try/catch` in both engines and runs only after the verdict** — the dashboard is cosmetic and must **never** break, revert, fail-close, or change the exit code of a review/build.

## Testing

`test/dashboard.test.mjs` (`node --test`), all against in-memory data (no fs):
- `parseRunDir` for each of the three formats, plus malformed input → `null`.
- `aggregate` — history chronological ordering, severity rollup, correct `latest` selection.
- `renderHtml` — contains the expected sections; renders the empty state when `latest` is null.

## Install / docs / rollout

- `install.ps1` + `install.sh`: copy `dashboard.mjs` (the `lib/*.mjs` glob already covers `lib/dashboard.mjs`).
- `package.json`: add bin `"mr-dashboard": "dashboard.mjs"` (optional terminal command after `npm link`).
- Cheat-sheet (`.md` + `.html`): one line noting a dashboard auto-writes to `reviews/dashboard.html`.
- **Rollout note:** because this edits `loop.mjs` + `goal.mjs`, the installed `~/.claude/` copies must be refreshed (re-copy or re-run installer) for auto-emit to take effect — pushing to `main` does **not** update the installed copy.
