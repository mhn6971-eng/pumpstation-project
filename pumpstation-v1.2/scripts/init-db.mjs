/**
 * اجرای مهاجرت‌های دیتابیس (بدون نیاز به سرور PostgreSQL).
 * همهٔ فایل‌های drizzle/*.sql به ترتیب اجرا می‌شوند و نامشان در جدول
 * `_migrations` ثبت می‌شود؛ بنابراین اجرای دوباره بی‌خطر است.
 *
 *   node scripts/init-db.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
await mkdir(dataDir, { recursive: true });
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
console.log("[migrate] done");
