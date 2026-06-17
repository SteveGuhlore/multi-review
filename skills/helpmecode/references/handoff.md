# Handoff contract — what /goal consumes

The plan isn't done until these three artifacts exist and `.multi-review.json` is valid. They are the
seam between planning and the autonomous loop.

## PLAN.md (PRP-style — executable spec)
A `constitution` section (project invariants injected into every phase) + a task list where **each
task is self-contained** so a fresh executor needs no chat history:
- `Files:` exact paths it will create/edit.
- `Interfaces:` typed signatures it introduces/depends on.
- `Change:` the complete change (no placeholders, no "TODO").
- `Validate:` the command that proves it (feeds the gate ladder).
- `Acceptance:` criteria phrased in multi-review severity terms (what a reviewer would flag).
- `Scope:` which dirs may change (blast-radius bound).
See `assets/plan-template.md`.

## .multi-review.json (pre-arms the reviewer)
Seed or extend — load policy from the trusted base, never weaken it from the working tree:
- `extensions`: file types in scope.
- `validation.default`: the commands that must stay green (becomes the base gate set).
- `protectedPaths`: the security perimeter for this stack (auth, crypto, payments, secrets,
  migrations, CODEOWNERS, …). Broad by design.
- `gates`: the optional/degradable ladder (mutation, diff-coverage, secrets, SAST, dep-vuln,
  malicious-package, a11y, perf). See `.goal.example.json`.
- `securityMode`: `propose-isolated` (default) or `plan-only`.

## DESIGN.md (only if there's a UI)
Taste/brand, two aesthetic families to remix, and the anti-slop **banlist** the design-slop gate
enforces (no `Inter`/system-font defaults, no purple gradients, no glassmorphism, no centered-hero
cliché, no excess border-radius). See `assets/design-template.md`.

## Then
Tell the user exactly how to start the loop:
`node ~/.claude/multi-review/goal.mjs "<goal>" --checkpoints` (large) or `--auto` (small).
