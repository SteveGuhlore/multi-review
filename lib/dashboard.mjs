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
// Rich but scannable: severity-colored + critical-first, click a severity chip to filter the table.
export function renderHtml({ latest, history }) {
  const css = `*{box-sizing:border-box}body{margin:0 auto;max-width:1000px;background:#0b0f17;color:#e6edf3;font:14px ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}h1{font-size:19px;margin:0}.sub{color:#8b949e;font-size:12px;margin:2px 0 16px}.card{background:#121826;border:1px solid #243044;border-radius:12px;padding:14px 16px;margin:14px 0}.lbl{color:#8b949e;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}.strip{display:flex;gap:6px;align-items:flex-end}.runbar{display:flex;flex-direction:column-reverse;width:30px;height:46px;border-radius:3px;overflow:hidden;background:#0a0e16}.seg{display:block}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}.chip{cursor:pointer;border:1px solid #243044;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;background:#0a0e16;color:#e6edf3;user-select:none}.chip:hover{border-color:#8b949e}.chip.active{outline:2px solid currentColor}.chip .n{opacity:.7;font-weight:400}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:7px 8px;border-bottom:1px solid #243044;vertical-align:top}th{color:#8b949e;font-weight:600;font-size:11px;letter-spacing:.06em}tr[data-sev=low],tr[data-sev=info]{opacity:.6}.sev{font-weight:700;text-transform:uppercase;font-size:11px}.dot.off{color:#3a4658}.file{font-family:ui-monospace,Consolas,monospace}.plan{color:#f85149;font-weight:600}.ok{color:#8b949e}.issue{color:#8b949e}.empty{color:#8b949e}`;
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>multi-review dashboard</title><style>${css}</style></head><body><h1>multi-review &middot; dashboard</h1>`;
  const foot = `<script>function flt(s){document.querySelectorAll('tr[data-sev]').forEach(function(r){r.style.display=(s==='all'||r.getAttribute('data-sev')===s)?'':'none'});document.querySelectorAll('.chip').forEach(function(c){c.classList.toggle('active',c.getAttribute('data-sev')===s)})}</script></body></html>`;
  if (!latest) {
    return `${head}<div class="card empty">No runs yet — run <code>/multi-review</code> or <code>/goal</code>; this page refreshes automatically at the end of each run.</div>${foot}`;
  }
  const strip = history.map((r) => `<div class="runbar" title="${esc(r.id)}">${bars(r.severityCounts)}</div>`).join("");
  const c = latest.severityCounts;
  const chips = `<span class="chip active" data-sev="all" onclick="flt('all')">ALL <span class="n">${latest.findings.length}</span></span>` +
    SEV_ORDER.filter((s) => c[s]).map((s) => `<span class="chip" data-sev="${s}" onclick="flt('${s}')" style="color:${SEV_COLOR[s]}">${s.toUpperCase()} <span class="n">${c[s]}</span></span>`).join("");
  const rows = latest.findings.map((f) => {
    const sv = String(f.severity || "").toLowerCase();
    return `<tr data-sev="${esc(sv)}"><td class="sev" style="color:${SEV_COLOR[sv] || "#8b949e"}">${esc(f.severity)}</td><td class="file">${esc(f.file)}</td><td>${dots(f.models)}</td><td>${f.isPlan ? '<span class="plan">&rarr; PLAN</span>' : '<span class="ok">reported</span>'}</td><td class="issue">${esc(f.issue)}</td></tr>`;
  }).join("");
  const plan = latest.planCount ? ` &middot; <span class="plan">${latest.planCount} &rarr; PLAN</span>` : "";
  return `${head}<div class="sub">generated ${new Date().toISOString()} &middot; ${history.length} run(s)</div>
<div class="card"><div class="lbl">history &middot; last ${history.length} run(s)</div><div class="strip">${strip}</div></div>
<div class="card"><div class="lbl">latest &middot; ${esc(latest.type)} &middot; ${esc(latest.id)}${plan}</div>
<div class="chips">${chips}</div>
<table><tr><th>sev</th><th>file</th><th>C X G</th><th>status</th><th>issue</th></tr>${rows}</table></div>${foot}`;
}
