#!/usr/bin/env node
/**
 * کپی روزانهٔ بک‌آپ روی آینه (حافظهٔ بیرونی) — برای Windows Task Scheduler / cron
 *
 * روش کار: چون دیتابیس PGlite تک‌نویسنده است، اسکریپت خودش فایل دیتابیس را باز نمی‌کند؛
 * به سرور در حال اجرا یک درخواست محلی می‌فرستد و سرور نسخهٔ تازه می‌سازد، آن را روی
 * MIRROR_DIR کپی می‌کند و با sha256 مبدأ/مقصد تأیید می‌کند.
 *
 * استفاده:
 *   node scripts/mirror-backup.mjs
 *   BASE=http://127.0.0.1:3000 node scripts/mirror-backup.mjs
 *
 * خروجی: 0 = موفق، 1 = ناموفق (برای Task Scheduler تا هشدار بدهد)
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BASE = (process.env.BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const TOKEN_FILE = path.resolve(ROOT, process.env.MIRROR_TOKEN_FILE ?? ".data/mirror-token");
const LOG_FILE = path.resolve(ROOT, process.env.MIRROR_LOG ?? ".data/logs/mirror.log");

function stamp() {
  return new Date().toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
}

async function log(line) {
  try {
    await mkdir(path.dirname(LOG_FILE), { recursive: true });
    await appendFile(LOG_FILE, `${new Date().toISOString()}  ${line}\n`, "utf8");
  } catch {
    /* ثبت لاگ نباید اجرای اصلی را متوقف کند */
  }
}

async function main() {
  let token = "";
  try {
    token = (await readFile(TOKEN_FILE, "utf8")).trim();
  } catch {
    console.error(`✖ فایل توکن پیدا نشد: ${TOKEN_FILE}`);
    console.error("  یک‌بار از پنل ادمین «آینهٔ بک‌آپ» را باز کنید تا توکن ساخته شود، یا متغیر MIRROR_TOKEN_FILE را تنظیم کنید.");
    await log("FAIL: missing token file");
    process.exit(1);
  }

  let response;
  try {
    response = await fetch(`${BASE}/api/mirror`, {
      method: "POST",
      headers: { "x-mirror-token": token },
    });
  } catch (error) {
    console.error(`✖ اتصال بهسرور برقرار نشد (${BASE}): ${error instanceof Error ? error.message : error}`);
    console.error("  سرور ایستگاه باید در حال اجرا باشد (سرویس ویندوز).");
    await log(`FAIL: connect ${BASE} — ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    console.error(`✖ کپی ناموفق: ${data.error ?? response.status}`);
    await log(`FAIL: ${data.error ?? response.status}`);
    process.exit(1);
  }

  console.log(`✔ ${stamp()} — نسخهٔ ${data.file} (${(data.bytes / 1024).toFixed(0)} KB) روی آینه کپی شد`);
  console.log(`  مسیر آینه: ${data.target}`);
  if (data.sha256) console.log(`  sha256: ${data.sha256.slice(0, 16)}…`);
  await log(`OK: ${data.file} ${data.bytes}B`);
}

await main();
