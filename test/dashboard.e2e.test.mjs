import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeDashboard } from "../dashboard.mjs";

// End-to-end: render a real dashboard.html and drive it in a headless browser, asserting
// both the rendered DOM and a CLEAN debug console (no errors / page exceptions).
//
// Playwright is optional so the repo stays zero-dependency — this test SKIPS if it isn't
// installed. To actually run the browser checks:
//   npm i -D playwright && npx playwright install chromium
//   node --test test/dashboard.e2e.test.mjs
let chromium;
try { ({ chromium } = await import("playwright")); } catch { /* not installed -> skip */ }
const e2e = chromium ? test : test.skip;

function sampleDashboard() {
  const reviews = mkdtempSync(join(tmpdir(), "mr-e2e-"));
  const older = join(reviews, "loop-2026-06-17T20-00-00-000Z");
  const latest = join(reviews, "loop-2026-06-17T23-16-00-000Z");
  mkdirSync(older, { recursive: true });
  mkdirSync(latest, { recursive: true });
  writeFileSync(join(older, "round-1.json"), JSON.stringify([
    { severity: "medium", file: "a.js", issue: "thing", support: ["claude"] },
  ]));
  writeFileSync(join(latest, "round-1.json"), JSON.stringify([
    { severity: "critical", file: "auth.js", issue: "missing authz", support: ["claude", "codex", "gemini"] },
    { severity: "high", file: "db.js", issue: "<script>alert(1)</script>", support: ["claude", "codex"] },
  ]));
  return writeDashboard(reviews);
}

e2e("e2e: dashboard renders in a browser with a clean debug console", async () => {
  const out = sampleDashboard();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await page.goto(pathToFileURL(out).href);

    // Title + the two structural sections render.
    assert.match(await page.title(), /dashboard/i);
    assert.equal(await page.locator(".runbar").count(), 2, "history strip shows both runs");
    assert.ok((await page.locator("table td").count()) >= 2, "findings table has rows");
    assert.ok(await page.getByText("auth.js").first().isVisible(), "latest finding shown");
    assert.ok(await page.getByText("missing authz").first().isVisible());

    // Untrusted finding text is rendered as visible text, never executed.
    assert.ok(await page.getByText("<script>alert(1)</script>").first().isVisible(), "script shown as text");

    // The debug console is clean.
    assert.deepEqual(consoleErrors, [], "no console errors or page exceptions");
  } finally {
    await browser.close();
  }
});
