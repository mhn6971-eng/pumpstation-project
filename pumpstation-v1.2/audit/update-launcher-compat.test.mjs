import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(new URL("../launch-pumpstation.ps1", import.meta.url), "utf8");
const runner = readFileSync(new URL("../scripts/update-runner.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.equal(packageJson.version, "1.4.33", "compatibility fix is packaged in release 1.4.33");
assert.match(launcher, /\$updateLaunch = -not \[string\]::IsNullOrWhiteSpace\(\$env:PUMPSTATION_UPDATE_STOP_TOKEN\)/);
assert.match(launcher, /\$updaterRequestedPort = 0[\s\S]*\[int\]::TryParse\(\[string\]\$env:PORT/,
  "the updated launcher must capture the active updater's original health-check port before replacing PORT");
assert.match(launcher, /if \(\$updateLaunch -and \$updaterRequestedPort -ge 1024[\s\S]*\$preferredPort = \$updaterRequestedPort/,
  "the candidate server must start on the same port monitored by the previously installed updater");
assert.match(launcher, /if \(\$updateLaunch\) \{[\s\S]*Update restart refused to use an alternate port/,
  "an updater launch must refuse a second port instead of creating another PGlite process");
assert.match(launcher, /launch-failure\.txt[\s\S]*پورت در اختیار PID/,
  "port conflicts must be written to launch-failure.txt with the owner PID");
assert.match(runner, /async function waitForHealth\([\s\S]*configuredPort\(\)[\s\S]*preferred \+ index \+ 1/,
  "future updater versions should also probe the launcher's bounded fallback ports");
console.log("PASS | updater launcher compatibility | retains legacy health-check port and refuses duplicate DB servers");
