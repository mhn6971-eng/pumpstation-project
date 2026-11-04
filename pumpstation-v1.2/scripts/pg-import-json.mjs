#!/usr/bin/env node
/**
 * انتقال دادهٔ موجود (فایل بک‌آپ JSON نسخهٔ PGlite) به سرور PostgreSQL.
 *
 *   DATABASE_URL=postgresql://psuser:SECRET@127.0.0.1:5432/pumpstation \
 *     node scripts/pg-import-json.mjs --file .data/backups/pumpstation-1405-08-13_20-51-55.json
 *
 *   بدون --file: آخرین فایل بک‌آپ در .data/backups (یا MIRROR_DIR) انتخاب می‌شود.
 *
 * ویژگی‌ها:
 *  • پیش از نوشتن، هش فایل با کنارِ آن (‎.sha256‎) بررسی می‌شود.
 *  • همه‌چیز در یک تراکنش است؛ هر خطا = هیچ تغییری در مقصد.
 *  • نگاشت camelCase→snake_case انجام و با information_schema اعتبارسنجی می‌شود.
 *  • پیش‌فرض: مقصد باید خالی باشد (برای جلوگیری از دوباره‌نویسی)؛ با --replace پاک می‌شود.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const url = (process.env.DATABASE_URL ?? "").trim();
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("✖ DATABASE_URL تنظیم نشده است.");
  process.exit(1);
}

const args = process.argv.slice(2);
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : "";
const replace = args.includes("--replace");

/** کلید شیء در فایل بک‌آپ → نام جدول در PostgreSQL (هم‌ترتیب با TABLES در src/lib/backup.ts) */
const TABLE_MAP = {
  shifts: "shifts",
  settings: "settings",
  motors: "motors",
  equipment: "equipment",
  channels: "channels",
  catalogs: "catalogs",
  pmTemplates: "pm_templates",
  pmRecords: "pm_records",
  equipmentReports: "equipment_reports",
  motorReadings: "motor_readings",
  motorStateLogs: "motor_state_logs",
  processReadings: "process_readings",
  dailyTotals: "daily_totals",
  valueAudits: "value_audits",
  motorServices: "motor_services",
  meggerTests: "megger_tests",
  oilChanges: "oil_changes",
  alerts: "alerts",
  activity: "activity",
  problems: "problems",
  sendQueue: "send_queue",
  reports: "reports",
  operatorNotes: "operator_notes",
};

const snake = (s) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

async function pickFile() {
  if (fileArg) return path.resolve(fileArg);
  const dirs = [".data/backups", process.env.MIRROR_DIR ?? "", ".data/mirror"].filter(Boolean);
  for (const dir of dirs) {
    try {
      const files = (await readdir(path.resolve(dir))).filter((f) => f.endsWith(".json")).sort().reverse();
      if (files.length) return path.resolve(dir, files[0]);
    } catch {
      /* پوشه نیست */
    }
  }
  throw new Error("هیچ فایل بک‌آپی پیدا نشد؛ مسیر را با --file بدهید");
}

async function verifyHash(file) {
  try {
    const expected = (await readFile(`${file}.sha256`, "utf8")).trim();
    const actual = createHash("sha256").update(await readFile(file)).digest("hex");
    if (expected && expected !== actual) throw new Error("هش فایل با فایل .sha256 یکسان نیست؛ فایل آسیب دیده است");
    return expected ? "مهر تأیید هش درست است" : "فایل .sha256 ندارد";
  } catch (error) {
    if (error.code === "ENOENT") return "فایل .sha256 ندارد";
    throw error;
  }
}

async function main() {
  const file = await pickFile();
  const info = await stat(file);
  console.log(`→ فایل بک‌آپ: ${file} (${(info.size / 1024).toFixed(0)} KB)`);
  console.log(`  ${await verifyHash(file)}`);

  const snapshot = JSON.parse(await readFile(file, "utf8"));
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const client = await pool.connect();

  try {
    await client.query("begin");

    // اگر مقصد داده دارد و --replace نبوده، متوقف شو
    const existing = await client.query("select count(*)::int as n from shifts");
    if (existing.rows[0].n > 0 && !replace) {
      throw new Error("دیتابیس مقصد داده دارد. برای بازنویسی کامل --replace بدهید یا مقصد تازه بسازید");
    }

    // ترتیب درج مهم نیست اگر تریگرهای کلید خارجی موقتاً خاموش شوند
    let replicationRole = false;
    try {
      await client.query("set session_replication_role = replica");
      replicationRole = true;
    } catch {
      const tables = Object.values(TABLE_MAP);
      for (const t of tables) await client.query(`alter table if exists ${t} disable trigger all`).catch(() => {});
    }

    if (replace) {
      for (const t of Object.values(TABLE_MAP)) await client.query(`delete from ${t}`).catch(() => {});
    }

    const columnsCache = new Map();
    let total = 0;
    for (const [key, table] of Object.entries(TABLE_MAP)) {
      const rows = snapshot[key];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      if (!columnsCache.has(table)) {
        const res = await client.query(
          "select column_name from information_schema.columns where table_schema='public' and table_name=$1",
          [table],
        );
        columnsCache.set(table, new Set(res.rows.map((r) => r.column_name)));
      }
      const cols = columnsCache.get(table);
      if (cols.size === 0) {
        console.warn(`  ! جدول ${table} در مقصد نیست؛ ${rows.length} ردیف رد شد`);
        continue;
      }

      const first = rows[0];
      const mapped = Object.keys(first).map((k) => [k, cols.has(snake(k)) ? snake(k) : null]);
      const use = mapped.filter(([, c]) => c);
      const dropped = mapped.filter(([, c]) => !c).map(([k]) => k);
      if (dropped.length) console.warn(`  ! ستون‌های ناشناخته در ${table}: ${dropped.join(", ")}`);

      const chunk = 200;
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        const values = [];
        const tuples = slice.map((row, r) => {
          const placeholders = use.map(([k], c) => {
            let v = row[k];
            if (v !== null && typeof v === "object") v = JSON.stringify(v);
            values.push(v === undefined ? null : v);
            return `$${r * use.length + c + 1}`;
          });
          return `(${placeholders.join(",")})`;
        });
        const sql = `insert into ${table} (${use.map(([, c]) => c).join(",")}) values ${tuples.join(",")}`;
        await client.query(sql, values);
      }
      total += rows.length;
      console.log(`  ✔ ${table}: ${rows.length} ردیف`);
    }

    // هم‌تراز کردن شمارنده‌های سری
    const serials = await client.query(`
      select c.relname as table_name, a.attname as column_name
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid
      join pg_depend d on d.objid = a.attrelid and d.refobjid = c.oid
      where c.relkind = 'r' and a.attname = 'id' and a.attnum > 0
        and pg_get_serial_sequence(c.relname, 'id') is not null
    `);
    for (const row of serials.rows) {
      await client
        .query(
          `select setval(pg_get_serial_sequence('${row.table_name}','id'),
                         coalesce((select max(id) from ${row.table_name}), 1))`,
        )
        .catch(() => {});
    }

    if (replicationRole) await client.query("set session_replication_role = default");
    else {
      for (const t of Object.values(TABLE_MAP)) await client.query(`alter table if exists ${t} enable trigger all`).catch(() => {});
    }

    await client.query("commit");
    console.log(`✔ انتقال کامل شد — ${total} ردیف در ${Object.keys(snapshot).length} گروه`);
    console.log("  قدم بعد: سرور را با همان DATABASE_URL بالا بیاورید و در پنل ادمین یک بک‌آپ تازه بگیرید.");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
