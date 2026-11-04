import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  alerts,
  backups,
  catalogs,
  channels,
  dailyTotals,
  equipment,
  equipmentReports,
  meggerTests,
  motorReadings,
  motorServices,
  motorStateLogs,
  motors,
  oilChanges,
  operatorNotes,
  pmRecords,
  pmTemplates,
  problems,
  processReadings,
  reports,
  sendQueue,
  settings,
  shifts,
  valueAudits,
} from "@/db/schema";
import { jalaliNow, jalaliStamp } from "@/lib/jalali";
import { getAllSettings, saveSettings } from "@/db/seed";

/**
 * نسخهٔ پشتیبان (C3 در گزارش بازبینی)
 * - بک‌آپ «کامل» به‌صورت فایل JSON بیرون از دیتابیس، هر ۲۴ ساعت خودکار.
 * - بازیابی اتمیک (در یک تراکنش) با تطبیق شمارش ردیف‌ها.
 */

export const BACKUP_DIR = path.resolve(process.cwd(), process.env.BACKUP_DIR ?? ".data/backups");
const KEEP = Number(process.env.BACKUP_KEEP ?? 30);
const INTERVAL_MS = 24 * 60 * 60 * 1000;

export type Snapshot = Record<string, unknown[]>;

export const TABLES = {
  valueAudits,
  processReadings,
  dailyTotals,
  motorReadings,
  motorStateLogs,
  motorServices,
  meggerTests,
  oilChanges,
  equipmentReports,
  pmRecords,
  pmTemplates,
  catalogs,
  alerts,
  activity,
  problems,
  sendQueue,
  reports,
  operatorNotes,
  motors,
  equipment,
  channels,
  shifts,
  settings,
};

/** جدول‌هایی که ستون id سری دارند و پس از بازیابی باید شمارنده‌شان هم‌تراز شود */
const SERIAL_TABLES = [
  "value_audits", "process_readings", "daily_totals", "motor_readings", "motor_state_logs",
  "motor_services", "megger_tests", "oil_changes", "equipment_reports", "pm_records",
  "pm_templates", "catalogs", "alerts", "activity", "problems", "send_queue", "reports",
  "operator_notes", "equipment",
];

export async function snapshotAll(): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const [name, table] of Object.entries(TABLES)) out[name] = await db.select().from(table);
  return out;
}

/** فایل‌های PDF داخل بک‌آپ تکرار نمی‌شوند؛ خود فایل روی دیسک است (فقط مسیر و هش می‌ماند) */
function stripBinaries(snapshot: Snapshot): Snapshot {
  const rows = snapshot.catalogs;
  if (!Array.isArray(rows)) return snapshot;
  return {
    ...snapshot,
    catalogs: rows.map((row) => ({ ...(row as Record<string, unknown>), data: "" })),
  };
}

/**
 * بازیابی کامل: اول همه‌چیز داخل یک تراکنش جایگزین می‌شود (اگر خطایی رخ دهد،
 * هیچ تغییری اعمال نمی‌شود) و بعد شمارش ردیف‌ها تطبیق داده می‌شود.
 */
export async function restoreAll(snapshot: Snapshot) {
  const expected: Record<string, number> = {};
  for (const [name, rows] of Object.entries(snapshot)) if (Array.isArray(rows)) expected[name] = rows.length;

  await db.transaction(async (tx) => {
    for (const [name, table] of Object.entries(TABLES)) {
      const rows = snapshot[name];
      if (!Array.isArray(rows)) continue;
      await tx.delete(table);
      for (let i = 0; i < rows.length; i += 400) {
        await tx.insert(table).values(rows.slice(i, i + 400) as never);
      }
    }
    // شمارنده‌های سری را هم‌تراز کن تا رکورد جدید با شناسهٔ تکراری برخورد نکند
    for (const table of SERIAL_TABLES) {
      await tx.execute(
        sql.raw(
          `select setval(pg_get_serial_sequence('${table}','id'), greatest(coalesce((select max(id) from ${table}),0),1))`,
        ),
      );
    }
  });

  const mismatched: string[] = [];
  for (const [name, table] of Object.entries(TABLES)) {
    if (expected[name] === undefined) continue;
    const row = (await db.select({ count: sql<number>`count(*)::int` }).from(table))[0];
    if ((row?.count ?? 0) !== expected[name]) mismatched.push(`${name} (${row?.count ?? 0}/${expected[name]})`);
  }
  if (mismatched.length) throw new Error(`بازیابی ناقص بود: ${mismatched.join("، ")}`);
}

export function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** نوشتن یک فایل بک‌آپ با چک‌سام کنار آن */
export async function writeFileBackup(label: string) {
  const payload = stripBinaries(await snapshotAll());
  const json = JSON.stringify(payload);
  const stamp = jalaliStamp();
  await mkdir(/*turbopackIgnore: true*/ BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `pumpstation-${stamp}.json`);
  await writeFile(/*turbopackIgnore: true*/ file, json, "utf8");
  await writeFile(/*turbopackIgnore: true*/ `${file}.sha256`, createHash("sha256").update(json).digest("hex"), "utf8");
  await pruneFileBackups();
  await saveSettings({ lastFileBackupAt: Date.now(), lastFileBackupFile: file, lastFileBackupLabel: label } as never);
  return { file, bytes: Buffer.byteLength(json, "utf8"), rows: Object.values(payload).reduce((a, b) => a + b.length, 0) };
}

async function pruneFileBackups() {
  try {
    const files = (await readdir(/*turbopackIgnore: true*/ BACKUP_DIR)).filter((f) => f.endsWith(".json")).sort();
    for (const old of files.slice(0, Math.max(0, files.length - KEEP))) {
      await unlink(/*turbopackIgnore: true*/ path.join(BACKUP_DIR, old)).catch(() => {});
      await unlink(/*turbopackIgnore: true*/ path.join(BACKUP_DIR, `${old}.sha256`)).catch(() => {});
    }
  } catch {
    /* پاک‌سازی قدیمی‌ها نباید نوشتن بک‌آپ را خراب کند */
  }
}

export type FileBackupInfo = { file: string; bytes: number; modifiedAt: string; sha256: string | null };

export async function listFileBackups(): Promise<FileBackupInfo[]> {
  await mkdir(/*turbopackIgnore: true*/ BACKUP_DIR, { recursive: true });
  const files = (await readdir(/*turbopackIgnore: true*/ BACKUP_DIR)).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 20);
  const out: FileBackupInfo[] = [];
  for (const file of files) {
    const full = path.join(BACKUP_DIR, file);
    const info = await stat(/*turbopackIgnore: true*/ full).catch(() => null);
    if (!info) continue;
    const sha = await readFile(/*turbopackIgnore: true*/ `${full}.sha256`, "utf8").catch(() => null);
    out.push({ file, bytes: info.size, modifiedAt: info.mtime.toISOString(), sha256: sha?.trim() ?? null });
  }
  return out;
}

/** خواندن و صحت‌سنجی یک فایل بک‌آپ (بدون اعمال) — «آزمون بازیابی» */
export async function verifyFileBackup(file: string) {
  const safe = path.basename(file);
  const full = path.join(BACKUP_DIR, safe);
  const json = await readFile(/*turbopackIgnore: true*/ full, "utf8");
  const sha = (await readFile(/*turbopackIgnore: true*/ `${full}.sha256`, "utf8").catch(() => ""))?.trim();
  const actual = createHash("sha256").update(json).digest("hex");
  const payload = JSON.parse(json) as Snapshot;
  const counts = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
  return { file: safe, checksumOk: !sha || sha === actual, counts, bytes: Buffer.byteLength(json, "utf8") };
}

/** بازیابی کامل از یک فایل بک‌آپ روی دیسک (سناریوی «ویندوز عوض شد») */
export async function restoreFromFile(file: string, opts: { force?: boolean } = {}) {
  const safe = path.basename(file);
  const full = path.join(BACKUP_DIR, safe);
  const json = await readFile(/*turbopackIgnore: true*/ full, "utf8");
  const sha = (await readFile(/*turbopackIgnore: true*/ `${full}.sha256`, "utf8").catch(() => "")).trim();
  const actual = createHash("sha256").update(json).digest("hex");
  if (sha && sha !== actual && !opts.force) {
    throw new Error("چک‌سام فایل با محتوای آن نمی‌خواند؛ برای جلوگیری از بازیابی مخدوش متوقف شد");
  }
  const payload = JSON.parse(json) as Snapshot;
  // نسخهٔ ایمنی از وضعیت فعلی، تا اگر فایل قدیمی بود بتوان برگشت
  await createInternalBackup("نسخه ایمنی قبل از بازیابی از فایل");
  await restoreAll(payload);
  return { file: safe, checksumOk: !sha || sha === actual, rows: Object.values(payload).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0) };
}

let lastCheck = 0;

/**
 * بک‌آپ خودکار روزانه. از مسیرهای پرتردد (بارگذاری داشبورد و هر عملیات) صدا زده می‌شود،
 * ولی حداکثر یک بار در ساعت خودش را بررسی می‌کند.
 */
export async function ensureDailyFileBackup() {
  const now = Date.now();
  if (now - lastCheck < 60 * 60 * 1000) return null;
  lastCheck = now;
  // فقط در ساعات کم‌ترافیک (۳ تا ۵ بامداد به وقت تهران) تا کار اپراتور کند نشود
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hour < 3 || hour >= 5) return null;
  try {
    const cfg = (await getAllSettings()) as Record<string, unknown>;
    const last = Number(cfg.lastFileBackupAt ?? 0);
    if (now - last < INTERVAL_MS) return null;
    const result = await writeFileBackup("بک‌آپ خودکار روزانه");
    await saveSettings({ lastFileBackupError: "" } as never);
    return result;
  } catch (error) {
    await saveSettings({ lastFileBackupError: error instanceof Error ? error.message : "خطای نامشخص" } as never);
    return null;
  }
}

/** ساخت بک‌آپ داخلی (جدول backups) — نسخهٔ سریع برای «قبل از بازیابی» */
export async function createInternalBackup(label: string) {
  const payload = await snapshotAll();
  const sizeBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  const row = await db
    .insert(backups)
    .values({ label: `${label} ${jalaliNow()}`, createdAt: jalaliNow(), sizeBytes, payload })
    .returning({ id: backups.id });
  return { id: row[0]?.id, sizeBytes };
}
