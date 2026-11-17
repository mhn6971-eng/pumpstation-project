import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentAppVersion, isNewerVersion } from "../src/lib/updater.ts";

const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
assert.equal(currentAppVersion(), packageVersion, "current version comes from package.json");
assert.equal(isNewerVersion("1.4.15", "1.4.14"), true, "accepts a newer patch release");
assert.equal(isNewerVersion("1.5.0", "1.4.99"), true, "accepts a newer minor release");
assert.equal(isNewerVersion("2.0.0", "1.99.99"), true, "accepts a newer major release");
assert.equal(isNewerVersion("1.4.13", "1.4.14"), false, "rejects a downgrade");
assert.equal(isNewerVersion("1.4.14", "1.4.14"), false, "rejects the same version");
assert.equal(isNewerVersion("1.4.14-beta.1", "1.4.13"), false, "rejects non-stable package versions");
assert.equal(isNewerVersion("not-a-version", "1.4.13"), false, "rejects malformed versions");
console.log("PASS | updater | version source and strict release comparison");
