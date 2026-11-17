#!/usr/bin/env node
/**
 * ساخت اسکیمای سامانه روی سرور PostgreSQL (به‌جای PGlite).
 * همهٔ فایل‌های drizzle/*.sql به ترتیب نام اجرا می‌شوند و در جدول `_migrations`
 * ثبت می‌شوند؛ بنابراین اجرای دوباره بی‌خطر است.
 *
 *   DATABASE_URL=postgresql://psuser:SECRET@127.0.0.1:5432/pumpstation node scripts/pg-init.mjs
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const url = (process.env.DATABASE_URL ?? "").trim();
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("✖ DATABASE_URL تنظیم نشده است. مثال:");
  console.error("  DATABASE_URL=postgresql://psuser:SECRET@127.0.0.1:5432/pumpstation node scripts/pg-init.mjs");
  process.exit(1);
}

const dir = path.resolve(process.cwd(), "drizzle");
const pool = new pg.Pool({ connectionString: url, max: 2 });

try {
  const who = await pool.query("select current_database() as db, current_user as usr, version() as v");
  console.log(`→ اتصال به دیتابیس «${who.rows[0].db}» با کاربر «${who.rows[0].usr}»`);
  console.log(`  ${String(who.rows[0].v).split(",")[0]}`);

  await pool.query("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const applied = new Set((await pool.query("select name from _migrations")).rows.map((r) => r.name));

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] skip ${file}`);
      continue;
    }
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into _migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`[migrate] applied ${file}`);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      console.error(`✖ خطا در ${file}: ${error.message}`);
      process.exitCode = 1;
      break;
    } finally {
      client.release();
    }
  }

  const tables = await pool.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
  );
  console.log(`[migrate] done — ${tables.rows[0].n} جدول در public`);
} catch (error) {
  console.error(`✖ اتصال/مهاجرت ناموفق: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
