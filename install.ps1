# Install multi-review into ~/.claude (Windows).
$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$claude = Join-Path $env:USERPROFILE ".claude"
New-Item -ItemType Directory -Force -Path (Join-Path $claude "commands"), (Join-Path $claude "multi-review") | Out-Null
Copy-Item (Join-Path $src "commands\multi-review.md") (Join-Path $claude "commands\multi-review.md") -Force
Copy-Item (Join-Path $src "loop.mjs") (Join-Path $claude "multi-review\loop.mjs") -Force
Copy-Item (Join-Path $src "bin\codex-review.ps1") (Join-Path $claude "multi-review\codex-review.ps1") -Force
Copy-Item (Join-Path $src "bin\gemini-review.ps1") (Join-Path $claude "multi-review\gemini-review.ps1") -Force
Write-Host "✓ multi-review installed → $claude"
Write-Host "  command: /multi-review   ·   loop: node ~/.claude/multi-review/loop.mjs --target . --apply"
