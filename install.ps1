# Install multi-review + /goal into ~/.claude (Windows).
$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$claude = Join-Path $env:USERPROFILE ".claude"
New-Item -ItemType Directory -Force -Path `
  (Join-Path $claude "commands"), `
  (Join-Path $claude "multi-review\lib"), `
  (Join-Path $claude "skills") | Out-Null

# Commands
Copy-Item (Join-Path $src "commands\multi-review.md") (Join-Path $claude "commands\multi-review.md") -Force
Copy-Item (Join-Path $src "commands\goal.md") (Join-Path $claude "commands\goal.md") -Force

# Engines + shared core (goal.mjs imports ./lib/core.mjs, so lib/ must travel with it)
Copy-Item (Join-Path $src "loop.mjs") (Join-Path $claude "multi-review\loop.mjs") -Force
Copy-Item (Join-Path $src "goal.mjs") (Join-Path $claude "multi-review\goal.mjs") -Force
Copy-Item (Join-Path $src "lib\core.mjs") (Join-Path $claude "multi-review\lib\core.mjs") -Force
Copy-Item (Join-Path $src ".goal.example.json") (Join-Path $claude "multi-review\.goal.example.json") -Force
Copy-Item (Join-Path $src "bin\codex-review.ps1") (Join-Path $claude "multi-review\codex-review.ps1") -Force
Copy-Item (Join-Path $src "bin\gemini-review.ps1") (Join-Path $claude "multi-review\gemini-review.ps1") -Force

# Skill (recursive)
Copy-Item (Join-Path $src "skills\helpmecode") (Join-Path $claude "skills\helpmecode") -Recurse -Force

Write-Host "multi-review + /goal installed -> $claude"
Write-Host "  commands: /goal | /multi-review     skill: helpmecode"
Write-Host "  goal: node ~/.claude/multi-review/goal.mjs '<goal>' --auto   (or --gates-only for CI)"
