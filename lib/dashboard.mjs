// lib/dashboard.mjs — PURE helpers for the run dashboard (no I/O). Unit-tested in
// test/dashboard.test.mjs. The dashboard.mjs shell does the fs and calls these.

function toFinding(f) {
  return {
    severity: f.severity,
    file: f.file,
    issue: f.issue,
    models: Array.isArray(f.models) ? f.models : Array.isArray(f.support) ? f.support : [],
    isPlan: String(f.severity || "").toLowerCase() === "critical",
  };
}

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function makeRun(type, id, rawFindings, log) {
  const committed = new Set((log && log.committed) || []);
  const reverted = new Set((log && log.reverted) || []);
  const findings = (Array.isArray(rawFindings) ? rawFindings : []).map(toFinding)
    .map((f) => ({ ...f, outcome: committed.has(f.file) ? "fixed" : (f.isPlan || reverted.has(f.file)) ? "plan" : "reported" }))
    .sort((a, b) => (SEV_RANK[String(a.severity || "").toLowerCase()] ?? 9) - (SEV_RANK[String(b.severity || "").toLowerCase()] ?? 9));
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) { const s = String(f.severity || "").toLowerCase(); if (s in severityCounts) severityCounts[s]++; }
  return { type, id, time: id.replace(/^(loop|goal)-/, ""), findings, severityCounts, planCount: findings.filter((f) => f.isPlan).length, log: log || null };
}

export function parseRunDir(dirName, fileMap) {
  const log = parseLog(typeof fileMap["log.md"] === "string" ? fileMap["log.md"] : "");
  if (dirName.startsWith("loop-")) {
    const newest = Object.keys(fileMap)
      .filter((k) => /^round-\d+\.json$/.test(k))
      .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
      .pop();
    return makeRun("loop", dirName, newest ? fileMap[newest] : [], log);
  }
  if (dirName.startsWith("goal-")) {
    return makeRun("goal", dirName, [], log);
  }
  if (Array.isArray(fileMap["findings.json"])) {
    return makeRun("review", dirName, fileMap["findings.json"], log);
  }
  return null;
}

// Parse a run's log.md (the event stream) into a "what happened / what worked" summary.
export function parseLog(text) {
  const t = String(text || "");
  const models = {};
  for (const m of t.matchAll(/(claude|codex|gemini) review:\s*(\d+)/g)) models[m[1]] = parseInt(m[2], 10);
  const v = t.match(/validated:\s*(\d+)\s*\(fixable:\s*(\d+),\s*plan:\s*(\d+)\)/);
  const a = t.match(/applied (\d+) fix/);
  const committed = [];
  for (const m of t.matchAll(/✓ committed[^:]*:\s*(.+)/g)) committed.push(...m[1].split(",").map((s) => s.trim()).filter(Boolean));
  const reverted = [];
  for (const m of t.matchAll(/reverted → PLAN:\s*(.+)/g)) reverted.push(m[1].trim());
  return {
    mode: /mode:\s*APPLY/i.test(t) ? "apply" : "report",
    models,
    validated: v ? parseInt(v[1], 10) : undefined,
    fixable: v ? parseInt(v[2], 10) : undefined,
    plan: v ? parseInt(v[3], 10) : undefined,
    applied: a ? parseInt(a[1], 10) : undefined,
    converged: /✅ CONVERGED/.test(t),
    committed,
    reverted,
  };
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

function badge(outcome) {
  if (outcome === "fixed") return '<span class="oc fixed">&#10003; fixed</span>';
  if (outcome === "plan") return '<span class="oc plan">&rarr; PLAN</span>';
  return '<span class="oc rep">reported</span>';
}

function nextActions(id) {
  const cmds = [
    ["re-review this repo", "node ~/.claude/multi-review/loop.mjs --target ."],
    ["auto-fix safe findings (on a branch)", "git switch -c mr/fix && node ~/.claude/multi-review/loop.mjs --target . --apply"],
    ["open the remediation plan", `reviews/${id}/PLAN.md`],
    ["regenerate this dashboard", "node ~/.claude/multi-review/dashboard.mjs"],
  ];
  return cmds.map(([label, cmd]) => `<div class="act"><span class="actlbl">${esc(label)}</span><span class="cmd"><code>${esc(cmd)}</code><button class="copy" onclick="cp(this)">copy</button></span></div>`).join("");
}

// Render the self-contained dashboard HTML — an operations console: what happened
// (models + validation) · what worked (fixed / PLAN / converged) · findings with outcomes ·
// next actions (copyable commands). Severity chips filter the findings table.
export function renderHtml({ latest, history }) {
  const css = `*{box-sizing:border-box}body{margin:0 auto;max-width:1040px;background:#0b0f17;color:#e6edf3;font:14px ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}h1{font-size:19px;margin:0}.sub{color:#8b949e;font-size:12px;margin:2px 0 16px}.card{background:#121826;border:1px solid #243044;border-radius:12px;padding:14px 16px;margin:14px 0}.lbl{color:#8b949e;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}.strip{display:flex;gap:6px;align-items:flex-end}.runbar{display:flex;flex-direction:column-reverse;width:30px;height:46px;border-radius:3px;overflow:hidden;background:#0a0e16}.seg{display:block}.line{margin:6px 0;font-size:13px}.line b{display:inline-block;width:118px;color:#8b949e;font-weight:600;font-size:11px;letter-spacing:.06em;text-transform:uppercase}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.chip{cursor:pointer;border:1px solid #243044;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;background:#0a0e16;color:#e6edf3;user-select:none}.chip:hover{border-color:#8b949e}.chip.active{outline:2px solid currentColor}.chip .n{opacity:.7;font-weight:400}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:7px 8px;border-bottom:1px solid #243044;vertical-align:top}th{color:#8b949e;font-weight:600;font-size:11px;letter-spacing:.06em}tr[data-sev=low],tr[data-sev=info]{opacity:.6}.sev{font-weight:700;text-transform:uppercase;font-size:11px}.dot.off{color:#3a4658}.file{font-family:ui-monospace,Consolas,monospace}.oc{font-size:11px;font-weight:600;white-space:nowrap}.oc.fixed,.fixed{color:#3fb950}.oc.plan,.plan{color:#f85149}.oc.rep{color:#8b949e}.issue{color:#8b949e}.empty{color:#8b949e}.act{display:flex;align-items:center;gap:14px;padding:7px 0;border-bottom:1px dashed #243044}.act:last-child{border-bottom:0}.actlbl{color:#8b949e;width:230px;font-size:12px}.cmd{display:flex;align-items:center;gap:8px;flex:1;min-width:0}.cmd code{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#cfe3ff;background:#0a0e16;border:1px solid #243044;border-radius:6px;padding:4px 8px;overflow:auto;white-space:nowrap}.copy{cursor:pointer;border:1px solid #243044;background:#0a0e16;color:#8b949e;border-radius:6px;padding:4px 8px;font-size:11px}.copy:hover{color:#e6edf3}`;
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>multi-review dashboard</title><style>${css}</style></head><body><h1>multi-review &middot; dashboard</h1>`;
  const foot = `<script>function flt(s){document.querySelectorAll('tr[data-sev]').forEach(function(r){r.style.display=(s==='all'||r.getAttribute('data-sev')===s)?'':'none'});document.querySelectorAll('.chip').forEach(function(c){c.classList.toggle('active',c.getAttribute('data-sev')===s)})}function cp(b){var t=b.previousElementSibling.textContent;if(navigator.clipboard){navigator.clipboard.writeText(t)}b.textContent='copied';setTimeout(function(){b.textContent='copy'},900)}</script></body></html>`;
  if (!latest) {
    return `${head}<div class="card empty">No runs yet — run <code>/multi-review</code> or <code>/goal</code>; this page refreshes automatically at the end of each run.</div>${foot}`;
  }
  const strip = history.map((r) => `<div class="runbar" title="${esc(r.id)}">${bars(r.severityCounts)}</div>`).join("");
  const c = latest.severityCounts;
  const lg = latest.log || {};
  const mc = lg.models || {};
  const reviewed = ["claude", "codex", "gemini"].filter((m) => mc[m] != null).map((m) => `${m} ${mc[m]}`).join(" &middot; ") || `${latest.findings.length} finding(s)`;
  const validated = lg.validated != null ? `validated ${lg.validated} &middot; fixable ${lg.fixable} &middot; plan ${lg.plan}` : "—";
  const fixedN = latest.findings.filter((f) => f.outcome === "fixed").length;
  const planN = latest.findings.filter((f) => f.outcome === "plan").length;
  const repN = latest.findings.length - fixedN - planN;
  const worked = lg.mode === "apply"
    ? `<span class="fixed">&#10003; ${fixedN} fixed</span> &middot; <span class="plan">${planN} &rarr; PLAN</span> &middot; ${repN} reported${lg.converged ? " &middot; converged" : ""}`
    : `report-only${lg.converged ? " &middot; converged" : ""} &middot; <span class="plan">${planN} &rarr; PLAN</span> &middot; ${repN + fixedN} reported`;
  const chips = `<span class="chip active" data-sev="all" onclick="flt('all')">ALL <span class="n">${latest.findings.length}</span></span>` +
    SEV_ORDER.filter((s) => c[s]).map((s) => `<span class="chip" data-sev="${s}" onclick="flt('${s}')" style="color:${SEV_COLOR[s]}">${s.toUpperCase()} <span class="n">${c[s]}</span></span>`).join("");
  const rows = latest.findings.map((f) => {
    const sv = String(f.severity || "").toLowerCase();
    return `<tr data-sev="${esc(sv)}"><td class="sev" style="color:${SEV_COLOR[sv] || "#8b949e"}">${esc(f.severity)}</td><td class="file">${esc(f.file)}</td><td>${dots(f.models)}</td><td>${badge(f.outcome)}</td><td class="issue">${esc(f.issue)}</td></tr>`;
  }).join("");
  return `${head}<div class="sub">generated ${new Date().toISOString()} &middot; ${history.length} run(s)</div>
<div class="card"><div class="lbl">history &middot; last ${history.length} run(s)</div><div class="strip">${strip}</div></div>
<div class="card"><div class="lbl">latest &middot; ${esc(latest.type)} &middot; ${esc(latest.id)}</div>
<div class="line"><b>what happened</b> reviewed: ${reviewed} &nbsp;&rarr;&nbsp; ${validated}</div>
<div class="line"><b>what worked</b> ${worked}</div>
<div class="chips">${chips}</div>
<table><tr><th>sev</th><th>file</th><th>C X G</th><th>outcome</th><th>issue</th></tr>${rows}</table></div>
<div class="card"><div class="lbl">next actions</div>${nextActions(latest.id)}</div>${foot}`;
}
