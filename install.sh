#!/usr/bin/env sh
# Install multi-review into ~/.claude (macOS / Linux).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="$HOME/.claude"
mkdir -p "$CLAUDE/commands" "$CLAUDE/multi-review"
cp "$SRC/commands/multi-review.md" "$CLAUDE/commands/multi-review.md"
cp "$SRC/loop.mjs" "$CLAUDE/multi-review/loop.mjs"
cp "$SRC/bin/codex-review.ps1" "$CLAUDE/multi-review/" 2>/dev/null || true
cp "$SRC/bin/gemini-review.ps1" "$CLAUDE/multi-review/" 2>/dev/null || true
echo "✓ multi-review installed → $CLAUDE"
echo "  command: /multi-review   ·   loop: node ~/.claude/multi-review/loop.mjs --target . --apply"
