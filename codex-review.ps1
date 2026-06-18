# codex-review.ps1 — read-only Codex (GPT) reviewer wrapper for /multi-review.
#
# Reads the prompt from STDIN (the bare-arg form hangs on Windows). Runs Codex
# in a strict read-only sandbox. On a NEW session prints "THREAD_ID=<id>" first
# (so the orchestrator can resume the same session for debate rounds), then the
# model's final message. On resume, pass -Resume <thread_id>.
#
#   Get-Content prompt.txt | codex-review.ps1
#   Get-Content prompt.txt | codex-review.ps1 -Resume 019ed...-...
param([string]$Resume = "")
$ErrorActionPreference = "Stop"
# Harden against arg/command injection: a resume id must be a plain token (it can
# originate from prior CLI output / model text). Reject anything else.
if ($Resume -and ($Resume -notmatch '^[A-Za-z0-9-]+$')) {
  Write-Output "ERROR: invalid resume thread id"; exit 1
}
$prompt = [Console]::In.ReadToEnd()
$out = Join-Path $env:TEMP ("codex-review-" + [guid]::NewGuid().ToString("N") + ".txt")
try {
  if ($Resume) {
    # resume ignores -s; MUST force read-only via -c or it may inherit write access.
    $null = ($prompt | codex exec resume $Resume -c sandbox_mode=read-only --json -o $out)
  } else {
    $lines = ($prompt | codex exec -s read-only --json -o $out)
    $ts = $lines | Select-String 'thread.started'
    if ($ts) {
      $tid = ([regex]'"thread_id":"([^"]+)"').Match("$ts").Groups[1].Value
      if ($tid) { Write-Output "THREAD_ID=$tid" }
    }
  }
  if (Test-Path $out) { Get-Content -Raw $out } else { Write-Output "ERROR: codex produced no output (auth/model?)" }
} finally {
  Remove-Item $out -ErrorAction SilentlyContinue
}
