#!/usr/bin/env sh
# codex-review.sh — read-only Codex (GPT) reviewer wrapper for /multi-review.
#
# Reads the prompt from STDIN. Runs Codex in a strict read-only sandbox. On a
# NEW session prints "THREAD_ID=<id>" first (so the orchestrator can resume the
# same session for debate rounds), then the model's final message. On resume,
# pass the thread id as the first arg (or via -r <thread_id>).
#
#   codex-review.sh < prompt.txt
#   codex-review.sh 019ed...-... < prompt.txt
#   codex-review.sh -r 019ed...-... < prompt.txt
set -eu

# Parse optional resume id: "codex-review.sh <id>" or "codex-review.sh -r <id>".
resume=""
case "${1:-}" in
  -r) resume="${2:-}" ;;
  ?*) resume="$1" ;;
esac

# Harden against arg/command injection: a resume id must be a plain token (it can
# originate from prior CLI output / model text). Reject anything else.
if [ -n "$resume" ]; then
  case "$resume" in
    *[!A-Za-z0-9-]*|"")
      echo "ERROR: invalid resume thread id"
      exit 1
      ;;
  esac
fi

prompt="$(cat)"
out="${TMPDIR:-/tmp}/codex-review-$$-$(date +%s).txt"
trap 'rm -f "$out"' EXIT INT TERM

if [ -n "$resume" ]; then
  # resume ignores -s; MUST force read-only via -c or it may inherit write access.
  printf '%s' "$prompt" | codex exec resume "$resume" -c sandbox_mode=read-only --json -o "$out" >/dev/null
else
  lines="$(printf '%s' "$prompt" | codex exec -s read-only --json -o "$out")"
  ts="$(printf '%s\n' "$lines" | grep 'thread.started' || true)"
  if [ -n "$ts" ]; then
    tid="$(printf '%s' "$ts" | sed -n 's/.*"thread_id":"\([^"]*\)".*/\1/p' | head -n1)"
    if [ -n "$tid" ]; then echo "THREAD_ID=$tid"; fi
  fi
fi

if [ -f "$out" ]; then
  cat "$out"
else
  echo "ERROR: codex produced no output (auth/model?)"
fi
