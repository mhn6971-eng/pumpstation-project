/**
 * بازنشانی اضطراری PIN ادمین (وقتی کسی به سامانه دسترسی ندارد)
 *   node scripts/reset-admin-pin.mjs            → PIN ادمین به 9999
 *   node scripts/reset-admin-pin.mjs 1234 A     → PIN دلخواه برای شیفت دلخواه
 *
 * شرط‌ها: سامانه باید خاموش باشد (قفل پوشهٔ داده بررسی می‌شود) و
 * رویداد در دفتر فعالیت ثبت می‌شود تا رد پا بماند.
 */
import { PGlite } from "@electric-sql/pglite";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
const lockFile = path.join(path.resolve(dataDir), ".pumpstation.lock");

if (existsSync(lockFile)) {
  try {
    const info = JSON.parse(readFileSync(lockFile, "utf8"));
    if (info?.pid) {
      try {
        process.kill(info.pid, 0);
        console.error(`سامانه در حال اجراست (PID ${info.pid}). ابتدا آن را ببندید.`);
        process.exit(1);
      } catch {
        /* قفل قدیمی */
      }
    }
  } catch {
    /* ignore */
  }
}

const pin = (process.argv[2] ?? "9999").trim();
const shiftKey = (process.argv[3] ?? "admin").trim();
if (!/^\d{4,6}$/.test(pin)) {
  console.error("PIN باید چهار تا شش رقم باشد.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = `scrypt$${salt}$${scryptSync(pin, salt, 32).toString("hex")}`;

const db = new PGlite(dataDir);
try {
  const exists = await db.query(`select count(*)::int as n from shifts where key = $1`, [shiftKey]);
  if (!exists.rows[0].n) {
    console.error(`شیفت «${shiftKey}» در دیتابیس نیست. کلیدهای موجود:`);
    const keys = await db.query(`select key from shifts order by key`);
    for (const row of keys.rows) console.error(`  - ${row.key}`);
    process.exit(1);
  }
  await db.query(`update shifts set pin = $1 where key = $2`, [hash, shiftKey]);
  await db.query(
    `insert into activity (at, shift_key, action, detail, prev_hash, hash) values ($1,$2,$3,$4,'','')`,
    [new Date().toLocaleString("fa-IR"), "system", "بازنشانی اضطراری PIN", `شیفت ${shiftKey} با اسکریپت محلی`],
  );
  console.log(`PIN شیفت «${shiftKey}» بازنشانی شد. پس از ورود، PIN را از تب ادمین عوض کنید.`);
} catch (error) {
  console.error("بازنشانی ناموفق:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.close();
}
