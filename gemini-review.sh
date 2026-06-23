#!/usr/bin/env sh
# gemini-review.sh — read-only Gemini reviewer wrapper for /multi-review.
#
# Reads the prompt from STDIN and asks Gemini non-interactively. Kept read-only:
# no tool/edit approval (Gemini only emits text findings). Requires a one-time
# `gemini` Google login (free tier) or GEMINI_API_KEY. If unauthed, this exits
# non-zero and the orchestrator skips Gemini for the run.
set -eu

# Headless + READ-ONLY: `--approval-mode plan` is Gemini's read-only mode (it may
# read/grep but never edits). The full prompt is piped via stdin; `-p` triggers
# non-interactive mode and nudges it to honor the piped instructions. Cosmetic
# warnings (256-color / ripgrep) go to stderr and are dropped.
gemini -p "Follow the review instructions in the input above and return ONLY the requested output (no preamble)." --approval-mode plan 2>/dev/null
