#!/usr/bin/env node
// dashboard.mjs — the multi-review run dashboard's I/O shell. Scans a reviews/ dir,
// reads each run's files, and writes a single self-contained reviews/dashboard.html.
// All logic lives in lib/dashboard.mjs (pure, unit-tested); this file only does fs.
//
// Used two ways:
//   - auto: loop.mjs / goal.mjs call writeDashboard("reviews") at the end of a run (guarded).
//   - manual: `node dashboard.mjs [reviewsDir]` regenerates it on demand.
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseRunDir, aggregate, renderHtml } from "./lib/dashboard.mjs";

// Read a run dir into { filename: parsedJSON | text }; malformed/unreadable files are skipped.
function readRunDir(dir) {
  const fileMap = {};
  for (const fn of readdirSync(dir)) {
    if (fn === "dashboard.html") continue;
    try {
      const p = join(dir, fn);
      if (!statSync(p).isFile()) continue;
      const raw = readFileSync(p, "utf8");
      fileMap[fn] = fn.endsWith(".json") ? JSON.parse(raw) : raw;
    } catch { /* skip malformed/unreadable file */ }
  }
  return fileMap;
}

export function writeDashboard(reviewsDir = "reviews") {
  const runs = [];
  if (existsSync(reviewsDir)) {
    for (const name of readdirSync(reviewsDir)) {
      let st;
      try { st = statSync(join(reviewsDir, name)); } catch { continue; }
      if (!st.isDirectory()) continue;
      try {
        const run = parseRunDir(name, readRunDir(join(reviewsDir, name)));
        if (run) runs.push(run);
      } catch { /* a single bad run never breaks the dashboard */ }
    }
  }
  const out = join(reviewsDir, "dashboard.html");
  writeFileSync(out, renderHtml(aggregate(runs)));
  return out;
}

// Run directly: `node dashboard.mjs [reviewsDir]`. The guard keeps imports side-effect-free.
// Entry-point check via realpath, so it also fires when invoked through a junction/symlink
// (e.g. ~/.claude/multi-review -> the repo): argv[1] is the junction path while
// import.meta.url is the resolved real path, so compare their resolved forms.
let _isEntry = false;
try { _isEntry = !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { /* not the entry point */ }
if (_isEntry) {
  console.log(`dashboard -> ${writeDashboard(process.argv[2] || "reviews")}`);
}
