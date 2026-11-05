/**
 * تولید دادهٔ حجیم آزمایشی با SQL مستقیم — فقط دیتابیس TEST (نسخهٔ ۱٫۴٫۱).
 *
 *   node audit/bulk.mjs --db /tmp/bulk-test --days 30 --confirm-test
 *
 * این ابزار برای آزمون بار/کارایی است، نه ورود اطلاعات واقعی (برای ورود
 * واقعی از scripts/bulk-import.mjs که از مسیر API می‌گذرد استفاده کنید).
 * ایمنی: بدون --confirm-test اجرا نمی‌شود؛ روی دیتابیسِ در حال اجرا
 * (قفل زنده) و مسیر ابری (گوگل‌درایو/…) اجرا نمی‌شود.
 */
import { PGlite } from "@electric-sql/pglite";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { addDaysToDay, jalaliNow, operationalDay } from "../src/lib/jalali.ts";
import { requireLocalSqlite } from "../src/lib/sqlite-cloud.ts";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.findIndex((a) => a === name);
  return i >= 0 ? (args[i + 1] ?? "").trim() : "";
};

const dbPath = flag("--db");
const days = Math.min(730, Math.max(1, Number(flag("--days") || 30)));
const end = flag("--to") || operationalDay().day;

if (!dbPath) {
  console.error("استفاده: node audit/bulk.mjs --db <مسیر دیتابیس TEST> [--days 30] [--to 1405/08/14] --confirm-test");
  process.exit(1);
}
if (!args.includes("--confirm-test")) {
  console.error("بدون --confirm-test اجرا نمی‌شود (تأیید می‌کنید این دیتابیس آزمایشی است).");
  process.exit(1);
}
try {
  requireLocalSqlite(dbPath);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// هرگز روی دیتابیسی که سامانه‌ای روی آن روشن است ننویس
const lockFile = path.join(path.resolve(dbPath), ".pumpstation.lock");
if (existsSync(lockFile)) {
  try {
    const info = JSON.parse(readFileSync(lockFile, "utf8"));
    if (info?.pid) {
      try {
        process.kill(info.pid, 0);
        console.error(`دیتابیس توسط سامانه‌ای با PID ${info.pid} باز است؛ ابتدا آن را ببندید.`);
        process.exit(1);
      } catch {
        /* قفل قدیمی */
      }
    }
  } catch {
    /* ignore */
  }
}

const allDays = [];
for (let i = 0; i < days; i += 1) allDays.push(addDaysToDay(end, -i));

// هم‌گام با MOTORS و PROCESS_PARAMS در src/lib/domain.ts
const tags = ["M-01", "M-02", "M-03", "M-04", "M-05", "M-06", "M-07", "M-08"];
const params = ["I1", "I2", "I3", ...Array.from({ length: 10 }, (_, i) => `T${i + 1}`), "BRG-P-DE", "BRG-P-NDE", "VIB-P-DE", "VIB-P-NDE", "VIB-M-DE", "VIB-M-NDE"];
const ptags = ["PIT-001", "PIT-002", "PIT-003", "PIT-004", "FIT-001", "LT-01", "LT-02"];

const db = new PGlite(dbPath);
try {
  const now = jalaliNow();
  const t0 = Date.now();
  for (let i = 0; i < allDays.length; i += 60) {
    const slice = allDays.slice(i, i + 60);
    await db.query(
      `insert into motor_readings (tag, day, interval_index, param, value, shift_key, recorded_at, updated_at)
       select t, d, i, p, 50 + random()*20, 'A', $4, $4
       from unnest($1::text[]) d cross join unnest($2::text[]) t cross join generate_series(0,5) i cross join unnest($3::text[]) p on conflict do nothing`,
      [slice, tags, params, now],
    );
    await db.query(
      `insert into process_readings (day, interval_index, tag, value, shift_key, recorded_at, updated_at)
       select d, i, t, 3 + random()*2, 'A', $3, $3
       from unnest($1::text[]) d cross join generate_series(0,5) i cross join unnest($2::text[]) t on conflict do nothing`,
      [slice, ptags, now],
    );
    console.log(`  … ${Math.min(i + 60, allDays.length)}/${allDays.length} روز (${Date.now() - t0}ms)`);
  }
  await db.query(
    `insert into daily_totals (day, value, shift_key, recorded_at, updated_at)
     select d, 30000 + random()*5000, 'A', $2, $2 from unnest($1::text[]) d on conflict do nothing`,
    [allDays, now],
  );
  await db.query(
    `insert into alerts (at, day, tag, param, label, value, severity, message, shift_key, seen_at, acted_at, seen_shift, acted_shift)
     select $2, d, 'M-01', 'T1', 'دما', 100, 'warning', 'bulk test alert', 'A', '', '', '', '' from unnest($1::text[]) d`,
    [allDays.slice(0, 2000), now],
  );
  await db.query(`insert into activity (at, shift_key, action, detail) select $1,'A','bulk','row' from generate_series(1,5000)`, [now]);
  const c = await db.query(`select (select count(*) from motor_readings) mr, (select count(*) from process_readings) pr, (select count(*) from daily_totals) dt, (select pg_size_pretty(pg_database_size(current_database()))) size`);
  console.log("--- گزارش ---");
  console.log(`روزها: ${allDays.length} تا ${end}`);
  console.log(c.rows[0]);
  console.log(`زمان کل: ${Date.now() - t0}ms`);
} finally {
  await db.close();
}
