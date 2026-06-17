# DESIGN — <project>

> Drives the design-slop gate. The agent reads this before writing any UI, and the gate scores the
> rendered result against the banlist below.

## Intent (declare before any CSS)
- **Purpose:** <what this UI is for>
- **Tone:** <clinical | warm | playful | loud>
- **Two aesthetic families to remix:** <e.g. editorial × brutalist>
- **Differentiation:** <what makes it *not* generic>

## Tokens
- **Typeface(s):** <not Inter/Roboto/Arial/system defaults>
- **Color story:** <palette; not purple-on-white gradients>
- **Spacing / radius / density:** <philosophy>
- **Motion:** <still | subtle | expressive — transitions over keyframes>

## Anti-slop banlist (the gate fails on these)
- ❌ `Inter` / `Roboto` / `Arial` / system-font defaults
- ❌ purple→blue/cyan mesh gradients
- ❌ glassmorphism / dark glows
- ❌ centered-hero + three-feature-cards cliché
- ❌ excessive border-radius everywhere
- ❌ floating 3D blobs / generic illustration packs

## Gate
`screenshot the running UI → axe-core a11y (critical/serious block) → score against this banlist →
fail on new violations (baseline-ratchet)`.
