/**
 * ابزار تشخیص و تعمیر دیتابیس (Doctor)
 * ------------------------------------------------
 *   node scripts/doctor.mjs                 بررسی سلامت و شمارش ردیف‌ها
 *   node scripts/doctor.mjs --restore FILE  بازیابی از یک فایل بک‌آپ (JSON)
 *   node scripts/doctor.mjs --repair        اگر دیتابیس باز نشد: قرنطینه + ساخت تازه + بازیابی از آخرین بک‌آپ
 *   node scripts/doctor.mjs --latest        بازیابی از آخرین فایل بک‌آپ
 *
 * نکته: سامانه باید خاموش باشد (قفل پوشهٔ داده بررسی می‌شود).
 */
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
const backupDir = process.env.BACKUP_DIR ?? ".data/backups";
const lockFile = path.join(path.resolve(dataDir), ".pumpstation.lock");

/** جدول‌های بک‌آپ: کلید JSON → نام جدول در دیتابیس */
const TABLE_MAP = {
  valueAudits: "value_audits",
  processReadings: "process_readings",
  dailyTotals: "daily_totals",
  motorReadings: "motor_readings",
  motorStateLogs: "motor_state_logs",
  motorServices: "motor_services",
  meggerTests: "megger_tests",
  oilChanges: "oil_changes",
  equipmentReports: "equipment_reports",
  pmRecords: "pm_records",
  pmTemplates: "pm_templates",
  catalogs: "catalogs",
  alerts: "alerts",
  activity: "activity",
  problems: "problems",
  sendQueue: "send_queue",
  reports: "reports",
  operatorNotes: "operator_notes",
  motors: "motors",
  equipment: "equipment",
  channels: "channels",
  shifts: "shifts",
  settings: "settings",
};

const SERIAL_TABLES = [
  "value_audits", "process_readings", "daily_totals", "motor_readings", "motor_state_logs",
  "motor_services", "megger_tests", "oil_changes", "equipment_reports", "pm_records",
  "pm_templates", "catalogs", "alerts", "activity", "problems", "send_queue", "reports",
  "operator_notes", "equipment",
];

const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function assertServerStopped() {
  if (!existsSync(lockFile)) return;
  try {
    const info = JSON.parse(readFileSync(lockFile, "utf8"));
    if (info?.pid) {
      try {
        process.kill(info.pid, 0);
        console.error(`سامانه در حال اجراست (PID ${info.pid}). ابتدا آن را ببندید.`);
        process.exit(1);
      } catch {
        console.warn(`قفل قدیمی از PID ${info.pid} باقی مانده؛ ادامه می‌دهیم.`);
      }
    }
  } catch {
    /* ignore */
  }
}

async function openDb(dir) {
  const db = new PGlite(dir);
  await db.query("select 1");
  return db;
}

async function counts(db) {
  const out = {};
  for (const table of Object.values(TABLE_MAP)) {
    try {
      const r = await db.query(`select count(*)::int as n from "${table}"`);
      out[table] = r.rows[0].n;
    } catch {
      out[table] = null;
    }
  }
  return out;
}

async function listBackups() {
  await mkdir(backupDir, { recursive: true });
  const files = (await readdir(backupDir)).filter((f) => f.endsWith(".json"));
  const rows = [];
  for (const file of files) {
    const full = path.join(backupDir, file);
    const info = await stat(full);
    rows.push({ file, full, bytes: info.size, mtime: info.mtimeMs });
  }
  return rows.sort((a, b) => b.mtime - a.mtime);
}

async function applySnapshot(db, snapshot) {
  const report = {};
  for (const [key, table] of Object.entries(TABLE_MAP)) {
    const rows = snapshot[key];
    if (!Array.isArray(rows)) continue;
    await db.query(`delete from "${table}"`);
    if (!rows.length) {
      report[table] = 0;
      continue;
    }
    const columns = Object.keys(rows[0]).map((c) => snake(c));
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(",");
    const sql = `insert into "${table}" (${columns.map((c) => `"${c}"`).join(",")}) values (${placeholders})`;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      for (const row of chunk) {
        const values = Object.keys(rows[0]).map((c) => {
          const v = row[c];
          if (v === undefined) return null;
          if (v !== null && typeof v === "object") return JSON.stringify(v); // jsonb
          return v;
        });
        await db.query(sql, values);
      }
    }
    report[table] = rows.length;
  }
  for (const table of SERIAL_TABLES) {
    try {
      await db.query(`select setval(pg_get_serial_sequence('${table}','id'), greatest(coalesce((select max(id) from "${table}"),0),1))`);
    } catch {
      /* جدول بدون سری */
    }
  }
  return report;
}

async function runMigrations(db) {
  const files = (await readdir("drizzle")).filter((f) => f.endsWith(".sql")).sort();
  await db.exec(`CREATE TABLE IF NOT EXISTS "_migrations" ("name" text PRIMARY KEY NOT NULL, "applied_at" text NOT NULL);`);
  const applied = new Set((await db.query(`SELECT name FROM "_migrations"`)).rows.map((r) => r.name));
  for (const file of files) {
    const name = file.replace(/\.sql$/, "");
    if (applied.has(name) || (name.startsWith("0000_") && applied.has("0000_baseline"))) continue;
    const raw = await readFile(path.join("drizzle", file), "utf8");
    const statements = raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    for (const statement of statements) await db.exec(statement);
    await db.query(`INSERT INTO "_migrations" ("name","applied_at") VALUES ($1,$2)`, [name, new Date().toISOString()]);
    console.log(`[doctor] applied ${file}`);
  }
}

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

assertServerStopped();

/* --------------------------------------------------- بررسی سلامت */
let healthy = true;
try {
  const db = await openDb(dataDir);
  const c = await counts(db);
  const missing = Object.entries(c).filter(([, n]) => n === null).map(([t]) => t);
  console.log("[doctor] دیتابیس باز شد.");
  if (missing.length) {
    console.log(`[doctor] جدول‌های ناموجود: ${missing.join(", ")}`);
    healthy = false;
  }
  const important = ["motor_readings", "process_readings", "equipment", "shifts", "settings", "activity"];
  for (const t of important) console.log(`  ${t}: ${c[t] ?? "—"}`);
  await db.close();
} catch (error) {
  healthy = false;
  console.log(`[doctor] دیتابیس خراب یا غیرقابل‌باز شدن است: ${error instanceof Error ? error.message : error}`);
}

if (healthy && !has("--restore") && !has("--latest") && !has("--repair")) {
  const backups = await listBackups();
  console.log(`[doctor] بک‌آپ‌های موجود: ${backups.length}`);
  if (backups[0]) console.log(`  آخرین: ${backups[0].file} — ${(backups[0].bytes / 1024).toFixed(0)} KB`);
  console.log("[doctor] همه‌چیز مرتب است.");
  process.exit(0);
}

/* --------------------------------------------------- تعمیر/بازیابی */
let target = valueOf("--restore");
const backups = await listBackups();

if (!target && (has("--repair") || has("--latest"))) {
  if (!backups.length) {
    console.error("[doctor] هیچ فایل بک‌آپی پیدا نشد؛ بازیابی ممکن نیست.");
    process.exit(1);
  }
  target = backups[0].file;
}

if (target && !target.endsWith(".json")) target = `${target}.json`;
const full = path.resolve(backupDir, path.basename(target ?? ""));
if (!target || !existsSync(full)) {
  console.error(`[doctor] فایل بک‌آپ پیدا نشد: ${target}`);
  process.exit(1);
}

const json = await readFile(full, "utf8");
const sha = existsSync(`${full}.sha256`) ? (await readFile(`${full}.sha256`, "utf8")).trim() : "";
const actual = createHash("sha256").update(json).digest("hex");
if (sha && sha !== actual) {
  console.error("[doctor] چک‌سام فایل با محتوا نمی‌خواند؛ برای جلوگیری از بازیابی مخدوش متوقف شد.");
  console.error("  اگر مطمئنید فایل سالم است، دستی بررسی کنید یا از فایل دیگری استفاده کنید.");
  process.exit(1);
}
const snapshot = JSON.parse(json);

let workingDir = dataDir;
if (!healthy) {
  const quarantine = `${dataDir}.broken-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  renameSync(path.resolve(dataDir), quarantine);
  console.log(`[doctor] نسخهٔ خراب به ${quarantine} منتقل شد.`);
  await mkdir(dataDir, { recursive: true });
  workingDir = dataDir;
}

const db = await openDb(workingDir);
writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), "utf8");
try {
  if (!healthy) await runMigrations(db);
  const report = await applySnapshot(db, snapshot);
  const total = Object.values(report).reduce((a, b) => a + b, 0);
  console.log(`[doctor] بازیابی انجام شد: ${total} ردیف از ${path.basename(full)}`);
  for (const [t, n] of Object.entries(report)) if (n) console.log(`  ${t}: ${n}`);
  const after = await counts(db);
  const bad = Object.entries(report).filter(([t, n]) => after[t] !== n);
  if (bad.length) {
    console.error("[doctor] شمارش پس از بازیابی تطبیق ندارد:", bad.map(([t, n]) => `${t} (${after[t]}/${n})`).join(", "));
    process.exitCode = 1;
  } else {
    console.log("[doctor] تطبیق شمارش ردیف‌ها تأیید شد.");
  }
} catch (error) {
  console.error("[doctor] بازیابی ناموفق:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.close();
  try {
    unlinkSync(lockFile);
  } catch {
    /* ignore */
  }
}
