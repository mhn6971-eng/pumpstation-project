/**
 * اجرای مهاجرت‌های دیتابیس (بدون نیاز به سرور PostgreSQL).
 * همهٔ فایل‌های drizzle/*.sql به ترتیب اجرا می‌شوند و نامشان در جدول
 * `_migrations` ثبت می‌شود؛ بنابراین اجرای دوباره بی‌خطر است.
 *
 *   node scripts/init-db.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { requireLocalSqlite } from "../src/lib/sqlite-cloud.ts";

const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
try {
  requireLocalSqlite(dataDir);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
await mkdir(dataDir, { recursive: true });

/**
 * قفل: اگر سامانه همین حالا روشن است، مهاجرت اجرا نشود تا فایل‌های دیتابیس خراب نشوند.
 */
const lockFile = path.join(path.resolve(dataDir), ".pumpstation.lock");
if (existsSync(lockFile)) {
  try {
    const info = JSON.parse(readFileSync(lockFile, "utf8"));
    if (info?.pid) {
      try {
        process.kill(info.pid, 0);
        console.error(`[migrate] سامانه در حال اجراست (PID ${info.pid}). ابتدا آن را ببندید، بعد مهاجرت را اجرا کنید.`);
        process.exit(1);
      } catch {
        console.warn(`[migrate] قفل قدیمی (PID ${info.pid}) پیدا شد؛ ادامه می‌دهیم.`);
      }
    }
  } catch {
    /* قفل ناقص؛ ادامه */
  }
}
writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: Date.now(), dir: path.resolve(dataDir) }), "utf8");
const client = new PGlite(dataDir);

await client.exec(`CREATE TABLE IF NOT EXISTS "_migrations" ("name" text PRIMARY KEY NOT NULL, "applied_at" text NOT NULL);`);

const applied = new Set((await client.query(`SELECT name FROM "_migrations"`)).rows.map((r) => r.name));

// دیتابیسی که قبل از اضافه‌شدن جدول مهاجرت ساخته شده: مهاجرت اول را ثبت‌شده فرض کن
if (applied.size === 0) {
  const legacy = await client.query(`SELECT to_regclass('public.settings') AS tbl`);
  if (legacy.rows?.[0]?.tbl) {
    await client.query(`INSERT INTO "_migrations" ("name","applied_at") VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
      "0000_baseline",
      new Date().toISOString(),
    ]);
    applied.add("0000_baseline");
  }
}

const files = (await readdir("drizzle")).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const name = file.replace(/\.sql$/, "");
  const baseline = name.startsWith("0000_") && applied.has("0000_baseline");
  if (applied.has(name) || baseline) {
    console.log(`[migrate] skip ${file}`);
    continue;
  }
  const raw = await readFile(path.join("drizzle", file), "utf8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await client.exec(statement);
  await client.query(`INSERT INTO "_migrations" ("name","applied_at") VALUES ($1,$2)`, [name, new Date().toISOString()]);
  console.log(`[migrate] applied ${file} (${statements.length} statements)`);
}

await client.close();
try {
  unlinkSync(lockFile);
} catch {
  /* ignore */
}
console.log("[migrate] done");
