import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, existsSync } from "node:fs";
import { appendFile, copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const execFile = promisify(execFileCallback);
const env = process.env;
const manifest = JSON.parse(env.PS_UPDATE_MANIFEST_JSON ?? "null");
const appDir = path.resolve(env.PS_UPDATE_APP_DIR ?? "");
let dataRoot = path.resolve(env.PS_UPDATE_DATA_ROOT ?? "");
let statusFile = path.resolve(env.PS_UPDATE_STATUS_FILE ?? path.join(dataRoot, "update-status.json"));
let logFile = path.resolve(env.PS_UPDATE_LOG_FILE ?? path.join(dataRoot, "logs", "auto-update.log"));
let lockFile = path.resolve(env.PS_UPDATE_LOCK_FILE ?? path.join(dataRoot, "update.lock"));
const token = env.PS_UPDATE_STOP_TOKEN ?? "";
const port = Number(env.PORT ?? 3000);
const baseUrl = `http://127.0.0.1:${Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000}`;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const stageRoot = path.join(path.dirname(appDir), `.pumpstation-update-${stamp}`);
const archivePath = path.join(stageRoot, "update.zip");
const stageApp = path.join(stageRoot, "pumpstation-v1.2");
const previousApp = path.join(path.dirname(appDir), `app.previous-${stamp}`);
let dbDir = path.resolve(env.PGLITE_DATA_DIR ?? "");
let backupBase = path.resolve(env.BACKUP_DIR ?? path.join(dataRoot, "backups"));
let dbBackup = path.join(backupBase, "قبل از به‌روزرسانی", stamp, "پایگاه داده");
const launcher = path.resolve(env.PUMPSTATION_LAUNCHER ?? "");
const launcherKind = env.PUMPSTATION_LAUNCHER_KIND ?? "";
const localZip = path.resolve(env.PS_UPDATE_LOCAL_ZIP ?? "");
const expectedSha256 = env.PS_UPDATE_EXPECTED_SHA256 ?? manifest?.sha256 ?? "";
const expectedVersion = env.PS_UPDATE_EXPECTED_VERSION ?? manifest?.version ?? "";
const dataRelativeToApp = appDir && dataRoot ? path.relative(appDir, dataRoot) : "..";
const isDescendant = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== "." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const appLocalData = isDescendant(appDir, dataRoot);
const dbInsideApp = isDescendant(appDir, dbDir);
const originalDataPaths = { dataRoot, statusFile, logFile, lockFile, dbDir, backupBase, dbBackup };
let serverStopped = false;
let databaseBackedUp = false;
let appSwapped = false;
let migrationStarted = false;

function remapDataPath(current, root) {
  const relative = path.relative(originalDataPaths.dataRoot, current);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) return path.join(root, relative);
  return current;
}

function switchDataRoot(root) {
  dataRoot = path.resolve(root);
  statusFile = remapDataPath(originalDataPaths.statusFile, dataRoot);
  logFile = remapDataPath(originalDataPaths.logFile, dataRoot);
  lockFile = remapDataPath(originalDataPaths.lockFile, dataRoot);
  dbDir = remapDataPath(originalDataPaths.dbDir, dataRoot);
  backupBase = remapDataPath(originalDataPaths.backupBase, dataRoot);
  dbBackup = remapDataPath(originalDataPaths.dbBackup, dataRoot);
  env.PUMPSTATION_DATA_ROOT = dataRoot;
  env.PGLITE_DATA_DIR = dbDir;
  env.BACKUP_DIR = backupBase;
  env.PUMPSTATION_UPDATE_STATUS_FILE = statusFile;
  env.PUMPSTATION_UPDATE_LOG_FILE = logFile;
  env.PUMPSTATION_UPDATE_LOCK_FILE = lockFile;
}

function log(text) {
  const line = `${new Date().toISOString()}  ${text}\n`;
  process.stdout.write(line);
  return appendFile(logFile, line, "utf8").catch(() => {});
}

async function setStatus(phase, message, extra = {}) {
  const value = { phase, message, version: expectedVersion, updatedAt: new Date().toISOString(), logPath: logFile, ...extra };
  await mkdir(path.dirname(statusFile), { recursive: true });
  const temp = `${statusFile}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, statusFile);
  return value;
}

function run(command, args, cwd, description) {
  return new Promise((resolve, reject) => {
    log(`START ${description}: ${command} ${args.join(" ")} (cwd=${cwd})`);
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { void appendFile(logFile, chunk); });
    child.stderr.on("data", (chunk) => { void appendFile(logFile, chunk); });
    child.on("error", (error) => reject(new Error(`${description}: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${description} با کد ${code} شکست خورد`)));
  });
}

function runSync(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`فرمان ${command} ناموفق بود: ${(result.stderr || result.stdout || "").slice(-1500)}`);
  return result.stdout;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function validateArchive(file) {
  const tool = process.platform === "win32" ? "tar.exe" : "unzip";
  const listArgs = process.platform === "win32" ? ["-tf", file] : ["-Z1", file];
  const entries = runSync(tool, listArgs, stageRoot).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (entries.length < 5 || entries.length > 20_000) throw new Error("تعداد فایل‌های بسته معتبر نیست");
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    if (!normalized.startsWith("pumpstation-v1.2/") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || parts.some((part) => part === ".." || part === ".") || parts.some((part) => ["node_modules", ".next", ".data"].includes(part)) || parts.some((part) => part.startsWith(".env"))) {
      throw new Error(`مسیر نامعتبر در بستهٔ به‌روزرسانی: ${entry}`);
    }
  }
  return tool;
}

async function launch() {
  if (!launcher || !existsSync(launcher)) throw new Error("راه‌انداز پایدار برنامه پیدا نشد؛ امکان راه‌اندازی خودکار امن نیست");
  const launchEnv = { ...env };
  for (const key of Object.keys(launchEnv)) if (key.startsWith("PS_UPDATE_")) delete launchEnv[key];
  if (launcherKind === "wscript") {
    const proc = spawn("wscript.exe", [launcher], { cwd: path.dirname(launcher), detached: true, windowsHide: true, stdio: "ignore", env: launchEnv });
    proc.unref();
    return;
  }
  if (launcherKind === "powershell") {
    launchEnv.PUMPSTATION_LAUNCHER_HIDDEN = "1";
    const proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", launcher], { cwd: path.dirname(launcher), detached: true, windowsHide: true, stdio: "ignore", env: launchEnv });
    proc.unref();
    return;
  }
  throw new Error("نوع راه‌انداز خودکار پشتیبانی نمی‌شود");
}

async function waitForHealth(expectedVersion, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        const result = await response.json();
        if (result?.ok === true && result?.version === expectedVersion) return true;
      }
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function stopServer() {
  const response = await fetch(`${baseUrl}/api/admin/update/stop`, {
    method: "POST",
    headers: { "x-pumpstation-update-token": token },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`توقف ایمن برنامه پذیرفته نشد (HTTP ${response.status})`);
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    try {
      const health = await fetch(`${baseUrl}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(1_000) });
      if (!health.ok) break;
    } catch { break; }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  // Let any already accepted short database operation drain before taking the filesystem snapshot.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  try {
    const responseAfter = await fetch(`${baseUrl}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(1_000) });
    if (responseAfter.ok) throw new Error("سرور پس از درخواست توقف همچنان پاسخ می‌دهد");
  } catch (error) {
    if (error instanceof Error && error.message.includes("همچنان پاسخ")) throw error;
  }
  serverStopped = true;
}

async function clearStopToken() {
  const response = await fetch(`${baseUrl}/api/admin/update/stop`, {
    method: "DELETE",
    headers: { "x-pumpstation-update-token": token },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`پاک‌سازی کلید موقت توقف ناموفق بود (HTTP ${response.status})`);
}

async function copyDatabaseToBackup() {
  if (!dbDir || !existsSync(dbDir)) throw new Error("پوشهٔ پایدار پایگاه‌داده پیدا نشد؛ برای جلوگیری از خطر، آپدیت متوقف شد");
  await mkdir(path.dirname(dbBackup), { recursive: true });
  await rm(dbBackup, { recursive: true, force: true });
  await import("node:fs/promises").then(({ cp }) => cp(dbDir, dbBackup, { recursive: true, errorOnExist: true }));
  databaseBackedUp = true;
  await log(`Database backup created: ${dbBackup}`);
}

async function restoreDatabase() {
  if (!databaseBackedUp) return;
  const { cp } = await import("node:fs/promises");
  await rm(dbDir, { recursive: true, force: true });
  await mkdir(path.dirname(dbDir), { recursive: true });
  await cp(dbBackup, dbDir, { recursive: true, errorOnExist: true });
  await log(`Database restored from safety backup: ${dbBackup}`);
}

async function restorePreviousApp() {
  if (!appSwapped) return;
  const previousVersion = JSON.parse(await readFile(path.join(previousApp, "package.json"), "utf8")).version;
  const failedNew = `${appDir}.failed-${stamp}`;
  await rm(failedNew, { recursive: true, force: true });
  if (existsSync(appDir)) await rename(appDir, failedNew);
  if (existsSync(previousApp)) await rename(previousApp, appDir);
  await patchInstallConfig(previousVersion);
  appSwapped = false;
  await log(`Previous app restored: ${appDir} (version ${previousVersion})`);
}

async function patchInstallConfig(version) {
  const installRoot = path.dirname(launcher);
  const configPath = path.join(installRoot, "config", "install.json");
  if (existsSync(configPath)) {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.appVersion = version;
    await writeFile(`${configPath}.tmp`, JSON.stringify(config, null, 2), "utf8");
    await rename(`${configPath}.tmp`, configPath);
  }

  // Production shortcuts used to point at a BAT file, which briefly displayed CMD.
  // The bundled WSH wrapper keeps subsequent launches console-free and uses the app icon.
  if (launcherKind === "powershell") {
    const launcherSource = path.join(appDir, "launch-pumpstation.ps1");
    const launcherTarget = path.join(installRoot, "launch-pumpstation.ps1");
    const wrapperSource = path.join(appDir, "launch-pumpstation.vbs");
    const wrapperTarget = path.join(installRoot, "launch-pumpstation.vbs");
    if (existsSync(launcherSource) && existsSync(wrapperSource)) {
      await copyFile(launcherSource, launcherTarget);
      await copyFile(wrapperSource, wrapperTarget);
      const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
      const icon = path.join(appDir, "public", "brand", "logo.ico");
      const wscript = path.join(env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe");
      const shortcutScript = [
        "$ErrorActionPreference='Stop'",
        "$shell=New-Object -ComObject WScript.Shell",
        `$target=${quote(wscript)}`,
        `$vbs=${quote(wrapperTarget)}`,
        `$icon=${quote(icon)}`,
        "$targets=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pumpstation.lnk'),(Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\\Pumpstation.lnk'))",
        "foreach($p in $targets){$parent=Split-Path -Parent $p;New-Item -ItemType Directory -Path $parent -Force|Out-Null;$s=$shell.CreateShortcut($p);$s.TargetPath=$target;$s.Arguments='\"'+$vbs+'\"';$s.WorkingDirectory=Split-Path -Parent $vbs;$s.Description='اجرای سامانهٔ Pumpstation';if(Test-Path -LiteralPath $icon){$s.IconLocation=$icon+',0'};$s.Save()}",
      ].join(";");
      try {
        await execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", shortcutScript], {
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
        await log("Desktop and Start Menu shortcuts now launch the hidden VBS wrapper");
      } catch (error) {
        await log(`WARN shortcut refresh failed; installer can repair it: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

async function main() {
  await mkdir(path.dirname(logFile), { recursive: true });
  await log(`Updater started for ${expectedVersion || "unknown"}`);
  if (!manifest || typeof expectedVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(expectedVersion) || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("اطلاعات نسخهٔ به‌روزرسانی نامعتبر است");
  if (!appDir || !existsSync(path.join(appDir, "package.json")) || !dataRoot || !dbDir || !localZip || !existsSync(localZip)) throw new Error("مسیر برنامه، داده یا ZIP انتخاب‌شده پیدا نشد");
  if (path.resolve(dataRoot) === path.resolve(appDir) || (dbInsideApp && !appLocalData) || (appLocalData && !isDescendant(dataRoot, dbDir))) {
    throw new Error("مسیر پایگاه‌داده با مسیر دادهٔ پایدار سازگار نیست؛ برای جلوگیری از جابه‌جایی ناخواسته، به‌روزرسانی متوقف شد");
  }
  if ((env.DATABASE_URL ?? "").trim()) throw new Error("منبع داده PostgreSQL سروری است؛ updater فقط از PGlite محلی پشتیبانی می‌کند");
  await mkdir(stageRoot, { recursive: true });
  await setStatus("preparing", `ساخت و آماده‌سازی نسخهٔ ${expectedVersion}؛ برنامه فعلاً در حال کار است.`);
  await log(`Copying administrator-selected ZIP from ${localZip}`);
  const archiveInfo = await stat(localZip);
  if (archiveInfo.size < 1024 || archiveInfo.size > 100 * 1024 * 1024) throw new Error("اندازهٔ ZIP انتخاب‌شده خارج از محدودهٔ مجاز است");
  await copyFile(localZip, archivePath);
  const actualHash = await sha256(archivePath);
  if (actualHash !== expectedSha256) throw new Error("کنترل SHA-256 بسته ناموفق بود؛ فایل اجرا نشد");
  const archiveTool = validateArchive(archivePath);
  if (process.platform === "win32") runSync(archiveTool, ["-xf", archivePath, "-C", stageRoot], stageRoot);
  else runSync(archiveTool, ["-q", archivePath, "-d", stageRoot], stageRoot);
  if (!existsSync(path.join(stageApp, "package.json"))) throw new Error("فایل‌های برنامه در بسته پیدا نشد");
  const stagedPackage = JSON.parse(await readFile(path.join(stageApp, "package.json"), "utf8"));
  if (stagedPackage.version !== expectedVersion) throw new Error("نسخهٔ داخل ZIP با نسخهٔ تأییدشده یکی نیست");

  await log("Installing pinned dependencies in staging folder");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await run(npmCommand, ["ci", "--include=dev", "--no-audit", "--no-fund"], stageApp, "نصب وابستگی‌های نسخهٔ جدید");
  await run(npmCommand, ["run", "build"], stageApp, "ساخت نسخهٔ جدید");

  await setStatus("restarting", `نسخهٔ ${expectedVersion} آماده شد؛ در حال قفل نوشتن‌های جدید و گرفتن نسخهٔ پشتیبان.`, { logPath: logFile });
  await writeFile(lockFile, JSON.stringify({ version: expectedVersion, startedAt: new Date().toISOString() }), "utf8");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await stopServer();
  await copyDatabaseToBackup();

  // Legacy one-click folders may keep .data inside the application directory.
  // Copy it into the new code tree only after shutdown; the old app and its data
  // remain untouched in previousApp for a complete rollback.
  if (appLocalData) {
    const stagedDataRoot = path.join(stageApp, dataRelativeToApp);
    if (existsSync(stagedDataRoot)) throw new Error("بستهٔ ZIP حاوی مسیر دادهٔ محلی است؛ فایل‌های داده با کد مخلوط نمی‌شوند");
    await mkdir(path.dirname(stagedDataRoot), { recursive: true });
    await cp(dataRoot, stagedDataRoot, { recursive: true, errorOnExist: true });
    switchDataRoot(stagedDataRoot);
    await log(`Preserved app-local operational data into staged app: ${stagedDataRoot}`);
  }

  const localRoster = path.join(appDir, "data", "roster.local.json");
  if (existsSync(localRoster)) {
    const stagedRoster = path.join(stageApp, "data", "roster.local.json");
    await mkdir(path.dirname(stagedRoster), { recursive: true });
    await copyFile(localRoster, stagedRoster);
    await log("Preserved local operator roster");
  }

  migrationStarted = true;
  const nodePath = process.execPath;
  await run(nodePath, ["scripts/init-db.mjs"], stageApp, "اعمال مهاجرت‌های پایگاه‌داده");

  if (existsSync(previousApp)) throw new Error(`نسخهٔ پشتیبان برنامه از قبل وجود دارد و حذف نشد: ${previousApp}`);
  await rename(appDir, previousApp);
  try {
    await rename(stageApp, appDir);
    appSwapped = true;
  } catch (error) {
    await rename(previousApp, appDir);
    throw error;
  }
  if (appLocalData) switchDataRoot(path.join(appDir, dataRelativeToApp));
  await patchInstallConfig(expectedVersion);
  await log(`Application swapped. Previous version retained at ${previousApp}`);
  await launch();
  if (!(await waitForHealth(expectedVersion))) throw new Error("نسخهٔ جدید پس از ۹۰ ثانیه health-check را نگذرانْد");
  await clearStopToken().catch((error) => log(`WARN could not clear temporary stop token: ${error instanceof Error ? error.message : error}`));

  await rm(lockFile, { force: true });
  await setStatus("complete", `به‌روزرسانی به نسخهٔ ${expectedVersion} انجام شد؛ داده‌ها حفظ و سرور دوباره راه‌اندازی شد.`, { logPath: logFile });
  await log("Update completed and health-check passed");
  await rm(stageRoot, { recursive: true, force: true });
  await rm(localZip, { force: true }).catch(() => {});
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await log(`ERROR: ${message}`);
  let rollbackReady = true;
  if (appSwapped) {
    try { await stopServer(); } catch { /* failed candidate may already be down */ }
  }
  if (migrationStarted && databaseBackedUp && !appLocalData) {
    try { await restoreDatabase(); }
    catch (rollbackError) {
      rollbackReady = false;
      await log(`DATABASE ROLLBACK ERROR: ${rollbackError instanceof Error ? rollbackError.message : rollbackError}`);
    }
  }
  try { await restorePreviousApp(); }
  catch (rollbackError) {
    rollbackReady = false;
    await log(`APPLICATION ROLLBACK ERROR: ${rollbackError instanceof Error ? rollbackError.message : rollbackError}`);
  }
  if (appLocalData && existsSync(path.join(appDir, dataRelativeToApp))) switchDataRoot(path.join(appDir, dataRelativeToApp));
  else if (appLocalData) switchDataRoot(originalDataPaths.dataRoot);
  await rm(lockFile, { force: true }).catch(() => {});
  if (serverStopped && rollbackReady) {
    try {
      await launch();
      const restoredVersion = JSON.parse(await readFile(path.join(appDir, "package.json"), "utf8")).version;
      if (await waitForHealth(restoredVersion, 90_000)) {
        await clearStopToken().catch((restartError) => log(`WARN could not clear rollback stop token: ${restartError instanceof Error ? restartError.message : restartError}`));
      }
    } catch (restartError) {
      await log(`RESTART ERROR: ${restartError instanceof Error ? restartError.message : restartError}`);
    }
  } else if (serverStopped) {
    await log("Automatic restart skipped because rollback was incomplete; inspect the diagnostic log before restarting.");
  }
  await setStatus("failed", `به‌روزرسانی کامل نشد: ${message} نسخهٔ قبلی/پشتیبان برای بازیابی نگه داشته شد.`, { logPath: logFile });
  await rm(stageRoot, { recursive: true, force: true }).catch(() => {});
  process.exitCode = 1;
}
