# Interview question blocks

Ask one at a time, adaptively. Skip anything already answered by the codebase or the user. Always
offer 2–3 options + a recommendation when the user is unsure. Each block → a small JSON "context
packet" you carry forward.

## A. Identity & intent
- What is it, in one sentence? Who is it for? What problem does it remove?
- New project, or a change to an existing one? (If existing: read CLAUDE.md / README / package.json
  first and reflect back what's already true — don't re-ask it.)
- What does "done" look like? One concrete success criterion.

## B. Scope & size
- Smallest useful version (MVP) vs. the full vision — where's the line for *this* run?
- Must-haves vs. nice-to-haves. What is explicitly **out** of scope?
- Is this a small update (→ `--auto`) or a large build (→ `--checkpoints`)?

## C. Stack & constraints
- Language/runtime/framework — user-chosen or "recommend one"? (Detect from lockfiles if existing.)
- Data: storage, schema, migrations? External APIs/integrations? Auth?
- Non-functional: perf targets, scale, offline, accessibility, i18n.
- Compliance/regulatory domains (GDPR, PCI, etc.) — these widen the security perimeter.

## D. Taste (only if there's a UI)
- Two aesthetic families to remix (e.g. "editorial + brutalist"). Brand colors/typeface if any.
- Tone: clinical / warm / playful / loud. Motion: still / subtle / expressive.
- Anti-slop banlist to enforce (see visuals.md / DESIGN.md template).

## E. Operations (only if it ships somewhere)
- Where does it run? CI/CD present? Deploy target? Feature flags / rollback expectations?
- Observability/SLOs that a control-plane gate would defer to a human.

Stop when you can restate the spec in ~5 bullets and the user confirms. Record every assumption you
made (especially in `--auto` mode) so PLAN.md is honest about what was inferred vs. stated.
