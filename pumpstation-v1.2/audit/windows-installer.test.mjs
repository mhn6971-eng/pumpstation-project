import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const installer = await readFile(path.join(root, "install-windows.ps1"), "utf8");
const batch = await readFile(path.join(root, "install-windows.bat"), "utf8");
const launcher = await readFile(path.join(root, "launch-pumpstation.ps1"), "utf8");
const appLauncher = await readFile(path.join(root, "pumpstation-v1.2/launch-pumpstation.ps1"), "utf8");
const packager = await readFile(path.join(root, "package-windows.ps1"), "utf8");

assert.equal(/\bRead-Host\b/i.test(installer), false, "the installation flow must not ask for interactive input");
for (let step = 1; step <= 8; step += 1) {
  assert.ok(installer.includes(`STEP ${step}/8`), `installer should report step ${step}/8`);
}
assert.match(installer, /\[regex\]::Replace\(\[string\]\$item, '\[\^\\x00-\\x7F\]', '\?'\)/);
assert.match(installer, /INSTALLATION COMPLETE/);
assert.match(installer, /Verifying every database backup file by size and SHA-256/);
assert.match(installer, /Assert-DirectoryFilesEqual/);
assert.match(installer, /Get-CimInstance Win32_Process/);
assert.match(installer, /CommandLine\.IndexOf\(\$AppDir/);
assert.match(installer, /CommandLine -match '\(\?i\)scripts\[/);
assert.doesNotMatch(installer, /Get-NetTCPConnection|Stop-Process\s+-Name\s+node/i, "server shutdown must not target arbitrary processes by port or name");
assert.match(installer, /DATABASE ROLLBACK FAILED/);
assert.match(installer, /Previous application code and configuration were restored/);
assert.match(installer, /Data drive selected automatically/);
assert.match(installer, /New-RandomPin/);
assert.match(installer, /PUMPSTATION_SKIP_BROWSER = '1'/);
const npmCiCommands = installer.split(/\r?\n/).filter((line) => line.includes("$npmCiArguments = @($npmCli, 'ci'"));
assert.equal(npmCiCommands.length, 3, "online, offline, and fallback dependency installs should all be tested");
assert.ok(npmCiCommands.every((line) => line.includes("'--include=dev'")), "Next build tooling is in devDependencies and must be installed even when NODE_ENV=production");
assert.match(installer, /Verifying first-run database setup/);
assert.match(installer, /api\/auth/);
const seedCheck = installer.indexOf("Verifying first-run database setup");
const rosterDelete = installer.indexOf("Remove-Item -LiteralPath $paths.rosterFile", seedCheck);
const browserOpen = installer.indexOf("Start-Process $applicationUrl", seedCheck);
assert.ok(seedCheck >= 0 && rosterDelete > seedCheck && browserOpen > rosterDelete, "seed verification and PIN cleanup must finish before opening the browser");
assert.match(installer, /Existing data location preserved/);
assert.match(installer, /Existing database files were found without an installer marker; saved PINs will not be replaced/);
assert.equal(/\bRead-Host\b/i.test(launcher), true, "launch errors can wait for the user in a visible console");
assert.match(launcher, /\[regex\]::Replace\(\[string\]\$item, '\[\^\\x00-\\x7F\]', '\?'\)/);
assert.match(launcher, /PUMPSTATION_SKIP_BROWSER -eq '1'/);
assert.equal(launcher, appLauncher, "the bundled and root launchers must stay in sync");
assert.match(batch, /INSTALLATION COMPLETE/);
assert.match(batch, /set \/p "PUMPSTATION_WAIT="/);
assert.match(batch, /Diagnostic log:/);
assert.match(packager, /Creating an online installer/);
assert.match(packager, /Pumpstation-Windows-\$version\.zip/);
assert.match(packager, /\$downloadDir = Join-Path \$root 'downloads'/);
assert.match(packager, /Join-Path \$downloadDir/);
assert.match(packager, /'\.data'/);
assert.match(packager, /'\*\.local\.json'/);

console.log("PASS | windows installer | automatic ASCII progress, persistent data paths, backups, rollback and visible completion");
