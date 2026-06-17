#!/usr/bin/env node
// License-policy gate: read ScanCode JSON on stdin and fail (exit 1) if any dependency
// carries a strong/network copyleft license (GPL / AGPL / SSPL). LGPL (weak copyleft,
// safe to link) is allowed. AGPL matters because it triggers on *network use* — an AGPL
// lib in a SaaS backend can obligate releasing server source.
//
//   scancode --license --json-pp - <path> | node scripts/deny-copyleft.mjs
//
// The detection is exported (findCopyleft) and unit-tested in test/deny-copyleft.test.mjs.

// True for GPL*/AGPL*/SSPL* but NOT LGPL*.
export function isCopyleft(spdx) {
  const s = String(spdx || "").toLowerCase();
  if (!s) return false;
  if (/agpl/.test(s) || /sspl/.test(s)) return true;
  if (/gpl/.test(s) && !/lgpl/.test(s)) return true;
  return false;
}

// Walk a ScanCode result (tolerant of version differences in the JSON shape) and return
// the list of { path, license } offenders.
export function findCopyleft(scancode) {
  const offenders = [];
  const files = Array.isArray(scancode?.files) ? scancode.files : [];
  for (const f of files) {
    const path = f?.path ?? "?";
    const candidates = new Set();
    if (typeof f?.detected_license_expression === "string") candidates.add(f.detected_license_expression);
    for (const l of f?.licenses || []) {
      if (l?.spdx_license_key) candidates.add(l.spdx_license_key);
      if (l?.key) candidates.add(l.key);
    }
    for (const l of f?.license_detections || []) {
      if (l?.license_expression) candidates.add(l.license_expression);
    }
    for (const c of candidates) {
      // A composite expression like "MIT AND GPL-3.0" trips on its GPL component.
      for (const token of String(c).split(/\s+(?:and|or|with)\s+|[()]/i)) {
        if (isCopyleft(token)) { offenders.push({ path, license: c }); break; }
      }
    }
  }
  return offenders;
}

// CLI entry (only when run directly, not when imported by tests).
async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let parsed;
  try { parsed = JSON.parse(input || "{}"); }
  catch { process.stderr.write("deny-copyleft: could not parse ScanCode JSON on stdin\n"); process.exit(2); }
  const offenders = findCopyleft(parsed);
  if (offenders.length) {
    process.stderr.write(`deny-copyleft: ${offenders.length} copyleft (GPL/AGPL/SSPL) dependency(ies):\n`);
    for (const o of offenders) process.stderr.write(`  ${o.path} — ${o.license}\n`);
    process.exit(1);
  }
  process.stdout.write("deny-copyleft: no GPL/AGPL/SSPL licenses found\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
