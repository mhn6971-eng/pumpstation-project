import assert from "node:assert/strict";
import { inspectUpdateZip } from "../src/lib/update-zip.ts";
import { zipStored } from "../src/lib/zip.ts";

const base = [
  { name: "pumpstation-v1.2/package.json", data: Buffer.from(JSON.stringify({ name: "pumpstation-monitoring", version: "1.4.15" })) },
  { name: "pumpstation-v1.2/package-lock.json", data: Buffer.from(JSON.stringify({ name: "pumpstation-monitoring", lockfileVersion: 3 })) },
  { name: "pumpstation-v1.2/scripts/init-db.mjs", data: Buffer.from("export {};\n") },
  { name: "pumpstation-v1.2/scripts/serve.mjs", data: Buffer.from("export {};\n") },
  { name: "pumpstation-v1.2/scripts/update-runner.mjs", data: Buffer.from("// runner\n") },
  { name: "pumpstation-v1.2/launch-pumpstation.ps1", data: Buffer.from("# launcher\n") },
  { name: "pumpstation-v1.2/launch-pumpstation.vbs", data: Buffer.from("Option Explicit\n") },
];
const makeZip = (entries) => Buffer.from(zipStored(entries));

const valid = await inspectUpdateZip(makeZip(base));
assert.equal(valid.name, "pumpstation-monitoring");
assert.equal(valid.version, "1.4.15");
assert.equal(valid.entryCount, base.length);
console.log("PASS | update zip | accepts expected package structure");

const corrupted = makeZip(base);
const marker = corrupted.indexOf(Buffer.from("pumpstation-monitoring"));
assert.notEqual(marker, -1);
corrupted[marker] ^= 1;
await assert.rejects(inspectUpdateZip(corrupted), /محتوای فایل/);
console.log("PASS | update zip | verifies streamed entry size and CRC");

await assert.rejects(
  inspectUpdateZip(makeZip([...base, { name: "pumpstation-v1.2/../outside.txt", data: Buffer.from("no") }])),
  /relative path|مسیر|نامعتبر/,
);
console.log("PASS | update zip | rejects traversal paths");

await assert.rejects(
  inspectUpdateZip(makeZip([...base, { name: "pumpstation-v1.2/.data/pglite/store", data: Buffer.from("data") }])),
  /محلی|داده/,
);
console.log("PASS | update zip | rejects embedded data folders");

await assert.rejects(
  inspectUpdateZip(makeZip([...base, { name: "pumpstation-v1.2/data/roster.local.json", data: Buffer.from("secret") }])),
  /روستر/,
);
console.log("PASS | update zip | rejects a local operator roster in the package");

await assert.rejects(
  inspectUpdateZip(makeZip([...base, { name: "pumpstation-v1.2/PACKAGE.JSON", data: Buffer.from("{}") }])),
  /تکراری/,
);
console.log("PASS | update zip | rejects case-insensitive duplicate paths");

await assert.rejects(
  inspectUpdateZip(makeZip(base.map((entry) => entry.name.endsWith("package.json")
    ? { ...entry, data: Buffer.from(JSON.stringify({ name: "other-app", version: "1.4.15" })) }
    : entry))),
  /Pumpstation/,
);
console.log("PASS | update zip | rejects a different app package");

await assert.rejects(
  inspectUpdateZip(makeZip(base.map((entry) => entry.name.endsWith("package.json")
    ? { ...entry, data: Buffer.from(JSON.stringify({ name: "pumpstation-monitoring", version: "1.4.15-beta" })) }
    : entry))),
  /نسخه/,
);
console.log("PASS | update zip | rejects prerelease or malformed versions");
