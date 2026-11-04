/**
 * ساخت جدول‌های دیتابیس پیش‌نمایش (PGlite) از فایل‌های SQL در پوشهٔ drizzle/.
 * اجرای دوباره بی‌خطر است: اگر جدول‌ها از قبل باشند، کاری انجام نمی‌شود.
 *
 *   node scripts/init-db.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
await mkdir(dataDir, { recursive: true });
const client = new PGlite(dataDir);

const probe = await client.query("select to_regclass('public.settings') as tbl");
const exists = probe.rows?.[0]?.tbl;

if (exists) {
  console.log(`[init-db] schema already present in ${dataDir}`);
} else {
  const files = (await readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const raw = await readFile(path.join("drizzle", file), "utf8");
    const statements = raw
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await client.exec(statement);
    }
    console.log(`[init-db] applied ${file} (${statements.length} statements)`);
  }
}

await client.close();
console.log("[init-db] done");
