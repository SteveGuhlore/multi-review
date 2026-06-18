// lib/dashboard.mjs — PURE helpers for the run dashboard (no I/O). Unit-tested in
// test/dashboard.test.mjs. The dashboard.mjs shell does the fs and calls these.

// Normalize one reviews/<dir>/ into a Run, or null if unrecognized. `fileMap` is
// { filename: parsedJSON | text } for the files in that dir (the shell does the reading).
function toFinding(f) {
  return {
    severity: f.severity,
    file: f.file,
    issue: f.issue,
    models: Array.isArray(f.models) ? f.models : Array.isArray(f.support) ? f.support : [],
    isPlan: String(f.severity || "").toLowerCase() === "critical",
  };
}

function makeRun(type, id, rawFindings) {
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const findings = (Array.isArray(rawFindings) ? rawFindings : []).map(toFinding)
    .sort((a, b) => (order[String(a.severity || "").toLowerCase()] ?? 9) - (order[String(b.severity || "").toLowerCase()] ?? 9));
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const s = String(f.severity || "").toLowerCase();
    if (s in severityCounts) severityCounts[s]++;
  }
  return { type, id, time: id.replace(/^(loop|goal)-/, ""), findings, severityCounts, planCount: findings.filter((f) => f.isPlan).length };
}

export function parseRunDir(dirName, fileMap) {
  if (dirName.startsWith("loop-")) {
    const newest = Object.keys(fileMap)
      .filter((k) => /^round-\d+\.json$/.test(k))
      .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
      .pop();
    return makeRun("loop", dirName, newest ? fileMap[newest] : []);
  }
  if (dirName.startsWith("goal-")) {
    return makeRun("goal", dirName, []); // findings come from its linked loop-* runs (v1)
  }
  if (Array.isArray(fileMap["findings.json"])) {
    return makeRun("review", dirName, fileMap["findings.json"]);
  }
  return null;
}

const SEV_ORDER = ["critical", "high", "medium", "low", "info"];
const SEV_COLOR = { critical: "#f85149", high: "#ff8a4c", medium: "#d29922", low: "#3fb950", info: "#58a6ff" };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Roll parsed runs (oldest -> newest by timestamp) into the dashboard's two views.
export function aggregate(runs) {
  const valid = (runs || []).filter(Boolean).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const latest = valid.length ? valid[valid.length - 1] : null;
  const history = valid.slice(-10).map((r) => ({ id: r.id, type: r.type, time: r.time, severityCounts: r.severityCounts }));
  return { latest, history };
}

function bars(counts) {
  return SEV_ORDER.map((s) => (counts[s] ? `<span class="seg" style="background:${SEV_COLOR[s]};flex:${counts[s]}" title="${s}: ${counts[s]}"></span>` : "")).join("");
}

function dots(models) {
  return ["claude", "codex", "gemini"].map((m) => `<span class="dot ${models.includes(m) ? "on" : "off"}">${models.includes(m) ? "●" : "·"}</span>`).join(" ");
}

// Render the self-contained dashboard HTML (layout A: history strip on top, latest detail below).
export function renderHtml({ latest, history }) {
  const css = `body{margin:0;background:#0b0f17;color:#e6edf3;font:14px ui-sans-serif,system-ui,sans-serif;padding:24px}h1{font-size:18px;margin:0 0 2px}.mut{color:#8b949e}.card{background:#121826;border:1px solid #243044;border-radius:12px;padding:14px 16px;margin:14px 0}.strip{display:flex;gap:6px;align-items:flex-end}.runbar{display:flex;flex-direction:column-reverse;width:26px;height:48px;border-radius:3px;overflow:hidden;background:#0a0e16}.seg{display:block}.chips span{display:inline-block;border-radius:6px;padding:2px 8px;margin:2px 6px 2px 0;font-size:12px}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #243044}th{color:#8b949e}.dot.off{color:#3a4658}.plan{color:#f85149}.ok{color:#3fb950}`;
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>multi-review dashboard</title><style>${css}</style></head><body><h1>multi-review · dashboard</h1>`;
  const foot = `</body></html>`;
  if (!latest) {
    return `${head}<div class="card mut">No runs yet — run <code>/multi-review</code> or <code>/goal</code>; this page refreshes automatically at the end of each run.</div>${foot}`;
  }
  const strip = history.map((r) => `<div class="runbar" title="${esc(r.id)}">${bars(r.severityCounts)}</div>`).join("");
  const c = latest.severityCounts;
  const chips = SEV_ORDER.map((s) => `<span style="background:${SEV_COLOR[s]}22;color:${SEV_COLOR[s]}">${s.toUpperCase()} ${c[s]}</span>`).join("");
  const rows = latest.findings.map((f) => `<tr><td>${esc(f.file)}</td><td>${esc(f.severity)}</td><td>${dots(f.models)}</td><td>${f.isPlan ? '<span class="plan">&rarr; PLAN</span>' : '<span class="ok">reported</span>'}</td><td class="mut">${esc(f.issue)}</td></tr>`).join("");
  return `${head}<div class="mut">generated ${new Date().toISOString()} &middot; ${history.length} run(s)</div>
<div class="card"><div class="mut" style="margin-bottom:8px">history &middot; last ${history.length} run(s)</div><div class="strip">${strip}</div></div>
<div class="card"><div class="mut">latest &middot; ${esc(latest.type)} &middot; ${esc(latest.id)}</div><div class="chips" style="margin:8px 0">${chips}</div>
<table><tr><th>file</th><th>sev</th><th>C X G</th><th>status</th><th>issue</th></tr>${rows}</table></div>${foot}`;
}
