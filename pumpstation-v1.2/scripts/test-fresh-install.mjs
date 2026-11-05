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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractBundle } from "./extract-code-all.mjs";

const appRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const bundle = process.env.FRESH_BUNDLE ?? path.join(appRoot, "CODE_ALL_FA.txt");
const PORT = Number(process.env.FRESH_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), "pumpstation-fresh-"));
const dataDir = path.join(tmp, ".data", "pglite");
let server = null;

const tail = (s, n = 8) => String(s || "").trim().split("\n").slice(-n).join(" | ");
const ok = (step, detail = "") => console.log(`FRESH-INSTALL PASS | ${step}${detail ? ` | ${detail}` : ""}`);
const fail = (step, detail) => {
  console.error(`FRESH-INSTALL FAIL | ${step} | ${detail}`);
  throw new Error(step);
};

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { cwd: tmp, timeout: opts.timeout ?? 600000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...(opts.env ?? {}) } }, (error, stdout, stderr) => {
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
  ok("extract", `${files.length} files${skipped.length ? ` (${skipped.length} skipped)` : ""}`);

  // ۲) نصب وابستگی‌ها (با lockfile داخل بسته: npm ci قطعی)
  const hasLock = existsSync(path.join(tmp, "package-lock.json"));
  const inst = await run(npmCmd, hasLock ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"], { timeout: 900000 });
  if (inst.code !== 0) fail("npm-install", tail(inst.stderr || inst.stdout));
  ok("npm-install", hasLock ? "npm ci" : "npm install");

  // ۳) مهاجرت روی دیتابیس خالی
  const mig = await run("node", ["scripts/init-db.mjs"], { env: { PGLITE_DATA_DIR: dataDir } });
  if (mig.code !== 0 || !mig.stdout.includes("[migrate] done")) fail("db-migrate", tail(mig.stderr || mig.stdout));
  if (!mig.stdout.includes("0005_megger_pi")) fail("db-migrate", "0005_megger_pi اجرا نشد");
  ok("db-migrate", "0000..0005");

  // ۴) بیلد تولیدی
  const bld = await run(npmCmd, ["run", "build"], { timeout: 900000 });
  if (bld.code !== 0) fail("build", tail(bld.stderr || bld.stdout));
  ok("build");

  // ۵) استارت در پس‌زمینه + انتظار سلامت (تا ~۱۲۰ ثانیه)
  server = spawn("node", ["scripts/serve.mjs", "start"], {
    cwd: tmp,
    env: { ...process.env, PORT: String(PORT), PGLITE_DATA_DIR: dataDir },
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
  ok("state", `motors=${sj.motors?.length ?? "?"} equipment=${sj.equipment?.length ?? "?"}`);

  // ۷) مجموعهٔ کامل تست‌ها روی نصب تازه
  const tst = await run(npmCmd, ["test"], { env: { BASE }, timeout: 900000 });
  if (tst.code !== 0) {
    const fails = tst.stdout.split("\n").filter((l) => l.startsWith("FAIL") || l.includes("✗")).slice(0, 20);
    fail("npm-test", fails.length ? fails.join(" | ") : tail(tst.stdout) || tail(tst.stderr));
  }
  const passN = (tst.stdout.match(/^PASS /gm) ?? []).length;
  const tickN = (tst.stdout.match(/✓/g) ?? []).length;
  ok("npm-test", `${passN + tickN} checks (PASS=${passN} tick=${tickN})`);
  for (const m of tst.stdout.match(/^(total=\d+ pass=\d+ fail=\d+|audit5: \d+\/\d+)$/gm) ?? []) console.log(`FRESH-INSTALL SUITE | ${m}`);

  console.log("FRESH-INSTALL RESULT | OK");
} catch {
  console.error("FRESH-INSTALL RESULT | FAIL");
  process.exitCode = 1;
} finally {
  killServer();
  if (process.env.FRESH_KEEP === "1") console.log(`kept: ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}
