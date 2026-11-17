#!/usr/bin/env node
/**
 * پشتیبان‌گیری روزانه از PostgreSQL با pg_dump (فرمت custom، فشرده).
 * مناسب Windows Task Scheduler / cron. هیچ نسخهٔ قدیمی به‌صورت خودکار پاک نمی‌شود.
 *
 *   DATABASE_URL=postgresql://... node scripts/pg-dump.mjs
 *
 * متغیرها:
 *   PGDUMP_DIR   پوشهٔ مقصد        (پیش‌فرض: .data/pgdump)
 *   PGDUMP_BIN   مسیر pg_dump.exe  (اگر در PATH نیست)
 * نسخه‌های قدیمی فقط با اقدام دستی ادمین حذف می‌شوند.
 *   MIRROR_DIR   اگر ست باشد، نسخهٔ تازه همان‌جا هم کپی می‌شود
 */
import { spawn } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const url = (process.env.DATABASE_URL ?? "").trim();
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("✖ DATABASE_URL تنظیم نشده است.");
  process.exit(1);
}

const outDir = path.resolve(process.cwd(), process.env.PGDUMP_DIR ?? ".data/pgdump");
const bin = process.env.PGDUMP_BIN?.trim() || "pg_dump";
const mirrorDir = process.env.MIRROR_DIR?.trim() ? path.resolve(process.env.MIRROR_DIR) : "";

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const file = path.join(outDir, `pumpstation-${stamp}.dump`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "pipe"], env: process.env });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (error) => reject(new Error(`اجرای ${command} ممکن نشد: ${error.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} با کد ${code} خارج شد — ${stderr.trim()}`))));
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log(`→ pg_dump به ${file}`);
  await run(bin, ["--format=custom", "--compress=9", "--no-owner", "--no-privileges", `--file=${file}`, url]);

  const info = await stat(file);
  if (info.size < 1024) throw new Error("فایل دامپ غیرعادی کوچک است؛ عملیات ناموفق تلقی می‌شود");
  console.log(`✔ حجم دامپ: ${(info.size / 1024).toFixed(0)} KB`);

  if (mirrorDir) {
    await mkdir(mirrorDir, { recursive: true });
    await copyFile(file, path.join(mirrorDir, path.basename(file)));
    console.log(`✔ کپی روی آینه: ${mirrorDir}`);
  }

  console.log(`✔ نسخهٔ تازه ذخیره شد؛ هیچ دامپ قدیمی به‌طور خودکار حذف نمی‌شود (${outDir})`);
}

try {
  await main();
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
