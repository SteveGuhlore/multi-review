import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDashboard } from "../dashboard.mjs";

test("writeDashboard: scans a reviews dir and writes a self-contained dashboard.html", () => {
  const reviews = mkdtempSync(join(tmpdir(), "mr-dash-"));
  const runDir = join(reviews, "loop-2026-06-17T23-00-00-000Z");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "round-1.json"),
    JSON.stringify([{ severity: "high", file: "db.js", issue: "sql concat", support: ["claude", "codex"] }]),
  );

  const out = writeDashboard(reviews);

  assert.ok(existsSync(out), "dashboard.html should be written");
  const html = readFileSync(join(reviews, "dashboard.html"), "utf8");
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /db\.js/);
  assert.match(html, /sql concat/);
});

test("writeDashboard: a malformed run file is skipped, not fatal", () => {
  const reviews = mkdtempSync(join(tmpdir(), "mr-dash-"));
  const runDir = join(reviews, "loop-2026-06-17T22-00-00-000Z");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "round-1.json"), "{ this is not valid json ");

  const out = writeDashboard(reviews); // must not throw

  assert.ok(existsSync(out));
});
