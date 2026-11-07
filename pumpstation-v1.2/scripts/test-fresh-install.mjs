#!/usr/bin/env node
/**
 * آزمون نصب تازه از صفر (۱٫۴٫۴، بخش ۵) — معیار نهایی نصب‌پذیری بسته.
 *
 *   node scripts/test-fresh-install.mjs
 *
 * زنجیره: استخراج CODE_ALL در پوشهٔ موقت ← npm ci ← db:migrate (دیتابیس
 * خالی) ← build ← start ← /api/health ← /api/state ← npm test کامل ← پاک‌سازی.
 * خروج ۰ = بسته نصب‌پذیر است؛ خروج ۱ + گزارش دقیق مرحله/سنجه = شکست.
 * Idempotent (پوشهٔ موقت یکتا در هر اجرا)؛ پوشه همیشه پاک می‌شود (finally)،
 * مگر FRESH_KEEP=1. پورت با FRESH_PORT (پیش‌فرض 3210).
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractBundle } from "./extract-code-all.mjs";

const appRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const bundle = process.env.FRESH_BUNDLE ?? path.join(appRoot, "CODE_ALL_FA.txt");
const PORT = Number(process.env.FRESH_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), "pumpstation-fresh-"));
const dataDir = path.join(tmp, ".data", "pglite");
const backupDir = path.join(tmp, ".data", "backups");
const archiveDir = path.join(backupDir, "archive");
const catalogDir = path.join(backupDir, "catalogs-legacy");
const mirrorDir = path.join(tmp, ".data", "mirror");
const mirrorTokenFile = path.join(tmp, ".data", "mirror-token");
const processReportDir = path.join(tmp, "گزارشات", "گزارشات فرایند");
const pmReportDir = path.join(tmp, "گزارشات", "PM");
const rosterFile = path.join(tmp, "data", "roster.local.json");
let server = null;

const tail = (s, n = 8) => String(s || "").trim().split("\n").slice(-n).join(" | ");
const ok = (step, detail = "") => console.log(`FRESH-INSTALL PASS | ${step}${detail ? ` | ${detail}` : ""}`);
const fail = (step, detail) => {
  console.error(`FRESH-INSTALL FAIL | ${step} | ${detail}`);
  throw new Error(step);
};

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { cwd: tmp, timeout: opts.timeout ?? 600000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, DATABASE_URL: "", BACKUP_DIR: backupDir, CATALOG_DIR: catalogDir, ARCHIVE_DIR: archiveDir, MIRROR_DIR: mirrorDir, MIRROR_TOKEN_FILE: mirrorTokenFile, PROCESS_REPORT_DIR: processReportDir, PM_REPORT_DIR: pmReportDir, ROSTER_FILE: rosterFile, ADMIN_PIN: "9009", ...(opts.env ?? {}) } }, (error, stdout, stderr) => {
    resolve({ code: error ? 1 : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
  });
});
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function killServer() {
  if (!server || !server.pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-server.pid, "SIGKILL");
  } catch {
    try { server.kill("SIGKILL"); } catch {}
  }
  server = null;
}

try {
  if (!existsSync(bundle)) fail("bundle", `پیدا نشد: ${bundle}`);

  // ۱) استخراج بسته در پوشهٔ موقت تازه
  const { files, skipped } = extractBundle(bundle, tmp);
  // روستر نمونه فقط برای fixture تست، با نام محلی؛ production نباید به fallback تکیه کند.
  copyFileSync(path.join(tmp, "data", "roster.sample.json"), path.join(tmp, "data", "roster.local.json"));
  ok("extract", `${files.length} files${skipped.length ? ` (${skipped.length} skipped)` : ""}`);

  // ۲) نصب وابستگی‌ها (با lockfile داخل بسته: npm ci قطعی)
  const hasLock = existsSync(path.join(tmp, "package-lock.json"));
  const inst = await run(npmCmd, hasLock ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"], { timeout: 900000 });
  if (inst.code !== 0) fail("npm-install", tail(inst.stderr || inst.stdout));
  ok("npm-install", hasLock ? "npm ci" : "npm install");

  // ۳) مهاجرت روی دیتابیس خالی
  const mig = await run("node", ["scripts/init-db.mjs"], { env: { PGLITE_DATA_DIR: dataDir } });
  if (mig.code !== 0 || !mig.stdout.includes("[migrate] done")) fail("db-migrate", tail(mig.stderr || mig.stdout));
  if (!mig.stdout.includes("0005_megger_pi") || !mig.stdout.includes("0006_alerts_open_unique")) fail("db-migrate", "0005_megger_pi یا 0006_alerts_open_unique اجرا نشد");
  ok("db-migrate", "0000..0006");

  // ۴) بیلد تولیدی
  const bld = await run(npmCmd, ["run", "build"], { timeout: 900000 });
  if (bld.code !== 0) fail("build", tail(bld.stderr || bld.stdout));
  ok("build");

  // ۵) استارت در پس‌زمینه + انتظار سلامت (تا ~۱۲۰ ثانیه)
  server = spawn("node", ["scripts/serve.mjs", "start"], {
    cwd: tmp,
    // نمونهٔ حساب‌ها برای آزمون HTTP؛ این opt-in فقط به پردازهٔ آزمون داده می‌شود.
    env: { ...process.env, DATABASE_URL: "", BACKUP_DIR: backupDir, CATALOG_DIR: catalogDir, ARCHIVE_DIR: archiveDir, MIRROR_DIR: mirrorDir, MIRROR_TOKEN_FILE: mirrorTokenFile, PROCESS_REPORT_DIR: processReportDir, PM_REPORT_DIR: pmReportDir, ROSTER_FILE: rosterFile, ADMIN_PIN: "9009", NODE_ENV: "production", ALLOW_SAMPLE_ROSTER: "1", PORT: String(PORT), PGLITE_DATA_DIR: dataDir },
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  if (typeof server.unref === "function") server.unref();
  let healthy = false;
  let lastErr = "";
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const h = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (h.ok) { healthy = true; break; }
      lastErr = `status=${h.status}`;
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
  }
  if (!healthy) fail("start+health", lastErr);
  ok("start+health", BASE);

  // ۶) ورود + خواندن وضعیت (اثبات زنده‌بودن /api/state پس از migrate تازه)
  const login = await fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "admin", pin: "9009" }) });
  if (login.status !== 200) fail("login", `status=${login.status}`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const st = await fetch(`${BASE}/api/state`, { headers: { cookie } });
  if (!st.ok) fail("state", `status=${st.status}`);
  const sj = await st.json().catch(() => null);
  if (!sj || sj.ok === false) fail("state", sj?.error ?? "پاسخ نامعتبر");
  if (sj.motors?.length !== 8 || sj.motors.some((m) => m.state !== "unknown" || m.totalHours !== 0)) {
    fail("production-safe-seed", "موتورهای نصب تازه باید بررسی‌نشده و بدون ساعت نمونه باشند");
  }
  if ((sj.counts?.readings ?? -1) !== 0 || (sj.counts?.alerts ?? -1) !== 0 || (sj.alerts?.length ?? -1) !== 0) {
    fail("production-safe-seed", "نصب تازهٔ production دادهٔ تله‌متری/هشدار ساختگی دارد");
  }
  ok("production-safe-seed", "8 موتور بررسی‌نشده؛ بدون قرائت/هشدار نمونه");
  ok("state", `motors=${sj.motors?.length ?? "?"} equipment=${sj.equipment?.length ?? "?"}`);

  // ۷) مجموعهٔ کامل تست‌ها روی نصب تازه
  const tst = await run(npmCmd, ["test"], { env: { BASE }, timeout: 900000 });
  if (tst.code !== 0) {
    const fails = tst.stdout.split("\n").filter((l) => l.startsWith("FAIL") || l.includes("✗")).slice(0, 20);
    fail("npm-test", [fails.join(" | "), `stdout=${tail(tst.stdout, 16)}`, `stderr=${tail(tst.stderr, 16)}`].filter(Boolean).join(" || "));
  }
  const passN = (tst.stdout.match(/^PASS /gm) ?? []).length;
  const tickN = (tst.stdout.match(/✓/g) ?? []).length;
  const auditFailures = tst.stdout.split("\n").filter((line) => line.startsWith("FAIL |"));
  if (auditFailures.length) fail("npm-test-audit", auditFailures.join(" || "));
  ok("npm-test", `${passN + tickN} checks (PASS=${passN} tick=${tickN}; reported failures=0)`);
  for (const m of tst.stdout.match(/^(total=\d+ pass=\d+ fail=\d+|audit5: \d+\/\d+)$/gm) ?? []) console.log(`FRESH-INSTALL SUITE | ${m}`);

  // ۸) تمرین بازیابی واقعیِ بسته روی نصب دوم با دیتابیس و مسیر فایل‌های جدا
  killServer();
  await new Promise((r) => setTimeout(r, 500));
  const sourceBundleRoot = path.join(backupDir, "bundles");
  const candidates = readdirSync(sourceBundleRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("pumpstation-bundle-"));
  const sourceBundles = candidates.map((entry) => {
    const manifest = JSON.parse(readFileSync(path.join(sourceBundleRoot, entry.name, "manifest.json"), "utf8"));
    return { name: entry.name, manifest };
  }).sort((a, b) => a.manifest.createdAt.localeCompare(b.manifest.createdAt));
  const chosen = sourceBundles[sourceBundles.length - 1];
  if (!chosen || !chosen.manifest.complete || chosen.manifest.tableCounts?.processReadingsArchive < 1) {
    fail("cross-install-recovery", "منبع باید بستهٔ کامل با قرائت بایگانی‌شده داشته باشد");
  }
  const restoreRoot = path.join(tmp, "restore-target");
  const restoreDataDir = path.join(restoreRoot, ".data", "pglite");
  const restoreBackupDir = path.join(restoreRoot, ".data", "backups");
  const restoreArchiveDir = path.join(restoreBackupDir, "archive");
  const restoreBundlesDir = path.join(restoreBackupDir, "bundles");
  mkdirSync(restoreBundlesDir, { recursive: true });
  cpSync(path.join(sourceBundleRoot, chosen.name), path.join(restoreBundlesDir, chosen.name), { recursive: true });
  const targetMig = await run("node", ["scripts/init-db.mjs"], { env: { PGLITE_DATA_DIR: restoreDataDir, BACKUP_DIR: restoreBackupDir, ARCHIVE_DIR: restoreArchiveDir } });
  if (targetMig.code !== 0 || !targetMig.stdout.includes("[migrate] done")) fail("cross-install-migrate", tail(targetMig.stderr || targetMig.stdout));

  server = spawn("node", ["scripts/serve.mjs", "start"], {
    cwd: tmp,
    env: { ...process.env, DATABASE_URL: "", BACKUP_DIR: restoreBackupDir, ARCHIVE_DIR: restoreArchiveDir, MIRROR_DIR: path.join(restoreRoot, ".data", "mirror"), MIRROR_TOKEN_FILE: path.join(restoreRoot, ".data", "mirror-token"), ROSTER_FILE: rosterFile, ADMIN_PIN: "9009", NODE_ENV: "production", ALLOW_SAMPLE_ROSTER: "1", PORT: String(PORT), PGLITE_DATA_DIR: restoreDataDir },
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  if (typeof server.unref === "function") server.unref();
  let targetHealthy = false;
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    try { const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) }); if (response.ok) { targetHealthy = true; break; } } catch {}
  }
  if (!targetHealthy) fail("cross-install-start", "نصب هدف پس از migrate سالم نشد");
  const targetLogin = await fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "admin", pin: "9009" }) });
  if (targetLogin.status !== 200) fail("cross-install-login", `status=${targetLogin.status}`);
  let targetCookie = (targetLogin.headers.get("set-cookie") || "").split(";")[0];
  const targetAction = async (action, payload = {}) => {
    const response = await fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: targetCookie }, body: JSON.stringify({ action, payload }) });
    return { response, json: await response.json().catch(() => null) };
  };
  const targetVerify = await targetAction("backup.bundle.verify", { name: chosen.name });
  if (!targetVerify.response.ok || targetVerify.json?.ok !== true) fail("cross-install-verify", String(targetVerify.json?.error ?? targetVerify.response.status));
  const targetRestore = await targetAction("backup.bundle.restore", { name: chosen.name });
  if (!targetRestore.response.ok || targetRestore.json?.ok !== true) fail("cross-install-restore", String(targetRestore.json?.error ?? targetRestore.response.status));
  const postRestoreLogin = await fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "admin", pin: "9009" }) });
  if (postRestoreLogin.status !== 200) fail("cross-install-relogin", `status=${postRestoreLogin.status}`);
  targetCookie = (postRestoreLogin.headers.get("set-cookie") || "").split(";")[0];
  const targetStats = await targetAction("data.stats");
  if (Number(targetStats.json?.archive?.archive?.process ?? 0) < 1) fail("cross-install-archive", JSON.stringify(targetStats.json));
  if (!readdirSync(restoreArchiveDir).some((file) => file.endsWith(".jsonl.gz"))) fail("cross-install-cold-archive", "فایل سرد در مقصد بازیابی نشد");
  if (!((targetRestore.json?.channelsNeedSetup ?? [])).includes("backup")) fail("cross-install-redaction", "توکن کانال باید روی نصب تازه دوباره تنظیم شود");
  ok("cross-install-recovery", `آرشیو=${targetStats.json.archive.archive.process}، توکن کانال نیازمند تنظیم مجدد`);

  console.log("FRESH-INSTALL RESULT | OK");
} catch {
  console.error("FRESH-INSTALL RESULT | FAIL");
  process.exitCode = 1;
} finally {
  killServer();
  if (process.env.FRESH_KEEP === "1") console.log(`kept: ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}
