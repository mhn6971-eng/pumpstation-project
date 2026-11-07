import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentAppVersion, fetchUpdateManifest, isNewerVersion } from "../src/lib/updater.ts";

const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const checks = [];
function check(name, fn) {
  try { fn(); checks.push(name); console.log(`PASS | updater | ${name}`); }
  catch (error) { console.error(`FAIL | updater | ${name} | ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
}

check("current version comes from package", () => assert.equal(currentAppVersion(), packageVersion));
check("numeric release comparison", () => {
  assert.equal(isNewerVersion("1.4.14", "1.4.13"), true);
  assert.equal(isNewerVersion("1.5.0", "1.4.99"), true);
  assert.equal(isNewerVersion("2.0.0", "1.99.99"), true);
  assert.equal(isNewerVersion("1.4.13", "1.4.14"), false);
  assert.equal(isNewerVersion("1.4.14", "1.4.14"), false);
  assert.equal(isNewerVersion("not-a-version", "1.4.13"), false);
});

const originalFetch = globalThis.fetch;
const feed = "https://raw.githubusercontent.com/mhn6971-eng/pumpstation-project/main/updates/latest.json";
process.env.PUMPSTATION_UPDATE_FEED = feed;
const sample = {
  version: "1.4.15",
  archiveUrl: "https://raw.githubusercontent.com/mhn6971-eng/pumpstation-project/main/updates/Pumpstation-App-Update-1.4.15.zip",
  sha256: "a".repeat(64),
  notes: ["تغییر آزمایشی"],
  publishedAt: "2026-11-07",
};

globalThis.fetch = async (url, options) => {
  assert.equal(String(url), feed);
  assert.equal(options?.cache, "no-store");
  return Response.json(sample);
};
try {
  const manifest = await fetchUpdateManifest();
  check("accepts trusted HTTPS project artifact", () => {
    assert.equal(manifest.version, "1.4.15");
    assert.equal(manifest.sha256, sample.sha256);
    assert.equal(manifest.notes[0], "تغییر آزمایشی");
  });
  globalThis.fetch = async () => Response.json({ ...sample, archiveUrl: "https://example.com/evil.zip" });
  await assert.rejects(fetchUpdateManifest(), /معتبر|اعتماد/);
  console.log("PASS | updater | rejects external package host");
  globalThis.fetch = async () => Response.json({ ...sample, sha256: "not-a-hash" });
  await assert.rejects(fetchUpdateManifest(), /ساختار معتبر|اعتماد/);
  console.log("PASS | updater | rejects malformed SHA-256");
} catch (error) {
  console.error(`FAIL | updater manifest checks | ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.PUMPSTATION_UPDATE_FEED;
}

if (!process.exitCode) console.log(`updater tests passed (${checks.length + 3} assertions groups)`);
