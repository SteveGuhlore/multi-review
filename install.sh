#!/usr/bin/env sh
# Install multi-review + /goal into ~/.claude (macOS / Linux).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="$HOME/.claude"
mkdir -p "$CLAUDE/commands" "$CLAUDE/multi-review/lib" "$CLAUDE/skills"

# Commands
cp "$SRC/commands/multi-review.md" "$CLAUDE/commands/multi-review.md"
cp "$SRC/commands/goal.md" "$CLAUDE/commands/goal.md"

# Engines + shared lib (goal.mjs imports ./lib/{core,metrics}.mjs, so all of lib/ must travel with it)
cp "$SRC/loop.mjs" "$CLAUDE/multi-review/loop.mjs"
cp "$SRC/goal.mjs" "$CLAUDE/multi-review/goal.mjs"
cp "$SRC/lib/"*.mjs "$CLAUDE/multi-review/lib/"
cp "$SRC/.goal.example.json" "$CLAUDE/multi-review/.goal.example.json"
cp "$SRC/bin/codex-review.ps1" "$CLAUDE/multi-review/" 2>/dev/null || true
cp "$SRC/bin/gemini-review.ps1" "$CLAUDE/multi-review/" 2>/dev/null || true

# Skills (recursive)
cp -R "$SRC/skills/helpmecode" "$CLAUDE/skills/helpmecode"

echo "✓ multi-review + /goal installed → $CLAUDE"
echo "  commands: /goal  ·  /multi-review        skill: helpmecode"
echo "  loop:  node ~/.claude/multi-review/loop.mjs --target . --apply"
echo "  goal:  node ~/.claude/multi-review/goal.mjs \"<goal>\" --auto   (or --gates-only for CI)"
