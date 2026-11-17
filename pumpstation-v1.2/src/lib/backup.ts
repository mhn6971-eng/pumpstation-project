import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  alerts,
  archiveRuns,
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
  motorReadingsArchive,
  processReadingsArchive,
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
import { assertCompleteSnapshot } from "@/lib/backup-validation";
import { badRequest } from "@/lib/errors";

/**
 * snapshot JSON جدول‌های عملیاتی (به‌جز جدول‌های آرشیو و فایل‌های جانبی)، روزانه و دستی.
 * بازیابی جدول‌های snapshot در یک تراکنش با تطبیق شمارش ردیف‌ها؛ بستهٔ کامل جداست.
 */

export const BACKUP_DIR = path.resolve(process.cwd(), process.env.BACKUP_DIR ?? ".data/backups");
export const CATALOG_DIR = path.resolve(process.cwd(), process.env.CATALOG_DIR ?? "files/catalogs");
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

/** جدول‌های بایگانی و سابقهٔ بایگانی فقط در بستهٔ کامل قرار می‌گیرند. */
export const BUNDLE_TABLES = {
  ...TABLES,
  archiveRuns,
  motorReadingsArchive,
  processReadingsArchive,
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
    catalogs: rows.map((row) => {
      const catalog = row as Record<string, unknown>;
      // فایل‌های جدید مسیر جدا دارند؛ کاتالوگ‌های قدیمیِ embed شده باید در بک‌آپ بمانند.
      return catalog.path ? { ...catalog, data: "" } : catalog;
    }),
  };
}

/** رازهای بازگشت‌پذیر نباید از دستگاه خارج شوند؛ توکن‌ها محلی دوباره وارد می‌شوند. */
function stripBackupSecrets(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    ...(Array.isArray(snapshot.channels)
      ? { channels: snapshot.channels.map((row) => ({ ...(row as Record<string, unknown>), token: "" })) }
      : {}),
    ...(Array.isArray(snapshot.shifts)
      ? {
          shifts: snapshot.shifts.map((row) => ({
            ...(row as Record<string, unknown>),
            totpSecret: "",
            totpPending: "",
            totpEnabled: false,
            totpBackupCodes: [],
            totpEnabledAt: "",
          })),
        }
      : {}),
  };
}

/**
 * بازیابی مجموعهٔ جدول‌های snapshot JSON: جایگزینی در یک تراکنش و تطبیق شمارش ردیف‌ها.
 */
export const BUNDLE_SERIAL_TABLES = [...SERIAL_TABLES, "archive_runs"];

async function restoreTables(snapshot: Snapshot, tables: Record<string, unknown>, serialTables: string[]) {
  assertCompleteSnapshot(snapshot, Object.keys(tables));
  const expected: Record<string, number> = {};
  for (const name of Object.keys(tables)) expected[name] = snapshot[name].length;

  await db.transaction(async (tx) => {
    for (const [name, table] of Object.entries(tables)) {
      const rows = snapshot[name];
      await tx.delete(table as never);
      for (let i = 0; i < rows.length; i += 400) {
        await tx.insert(table as never).values(rows.slice(i, i + 400) as never);
      }
    }
    // شمارنده‌های سری را هم‌تراز کن تا رکورد جدید با شناسهٔ تکراری برخورد نکند
    for (const table of serialTables) {
      await tx.execute(
        sql.raw(
          `select setval(pg_get_serial_sequence('${table}','id'), greatest(coalesce((select max(id) from ${table}),0),1))`,
        ),
      );
    }
  });

  const mismatched: string[] = [];
  for (const [name, table] of Object.entries(tables)) {
    const counts = (await db.select({ count: sql<number>`count(*)::int` }).from(table as never)) as unknown as { count: number }[];
    const row = counts[0];
    if ((row?.count ?? 0) !== expected[name]) mismatched.push(`${name} (${row?.count ?? 0}/${expected[name]})`);
  }
  if (mismatched.length) throw new Error(`بازیابی ناقص بود: ${mismatched.join("، ")}`);
}

async function preserveLocalTotp(snapshot: Snapshot): Promise<Snapshot> {
  const localShifts = await db.select().from(shifts);
  const localTotp = new Map(localShifts.map((row) => [row.key, row]));
  const rows = Array.isArray(snapshot.shifts) ? snapshot.shifts as Record<string, unknown>[] : [];
  return {
    ...snapshot,
    shifts: rows.map((row) => {
      const local = localTotp.get(String(row.key ?? ""));
      return {
        ...row,
        totpSecret: local?.totpSecret ?? "",
        totpPending: local?.totpPending ?? "",
        totpEnabled: local?.totpEnabled ?? false,
        totpBackupCodes: local?.totpBackupCodes ?? [],
        totpEnabledAt: local?.totpEnabledAt ?? "",
      };
    }),
  };
}

export async function restoreAll(snapshot: Snapshot) {
  return restoreTables(await preserveLocalTotp(snapshot), TABLES, SERIAL_TABLES);
}

export async function restoreBundleAll(snapshot: Snapshot) {
  return restoreTables(await preserveLocalTotp(snapshot), BUNDLE_TABLES, BUNDLE_SERIAL_TABLES);
}

export function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** نوشتن یک فایل بک‌آپ با چک‌سام کنار آن */
export async function writeFileBackup(label: string) {
  const payload = stripBackupSecrets(stripBinaries(await snapshotAll()));
  const json = JSON.stringify(payload);
  const stamp = jalaliStamp();
  await mkdir(/*turbopackIgnore: true*/ BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `pumpstation-${stamp}.json`);
  await writeFile(/*turbopackIgnore: true*/ file, json, "utf8");
  await writeFile(/*turbopackIgnore: true*/ `${file}.sha256`, createHash("sha256").update(json).digest("hex"), "utf8");
  await saveSettings({ lastFileBackupAt: Date.now(), lastFileBackupFile: file, lastFileBackupLabel: label } as never);
  return { file, bytes: Buffer.byteLength(json, "utf8"), rows: Object.values(payload).reduce((a, b) => a + b.length, 0) };
}

export type FileBackupInfo = { file: string; bytes: number; modifiedAt: string; sha256: string | null };

export async function listFileBackups(): Promise<FileBackupInfo[]> {
  await mkdir(/*turbopackIgnore: true*/ BACKUP_DIR, { recursive: true });
  const files = (await readdir(/*turbopackIgnore: true*/ BACKUP_DIR)).filter((f) => f.endsWith(".json")).sort().reverse();
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
  let payload: Snapshot;
  try {
    payload = JSON.parse(json) as Snapshot;
  } catch {
    throw badRequest("ساختار JSON بک‌آپ خراب است و قابل بررسی نیست");
  }
  const checksumPresent = Boolean(sha);
  const checksumOk = checksumPresent && sha === actual;
  const counts = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
  return { file: safe, checksumPresent, checksumOk, counts, bytes: Buffer.byteLength(json, "utf8") };
}

/** بررسی فایل‌های پیوست کاتالوگ؛ JSON به‌تنهایی PDFهای جدا از دیتابیس را حمل نمی‌کند. */
async function inspectCatalogFiles(snapshot: Snapshot) {
  const rows = Array.isArray(snapshot.catalogs) ? snapshot.catalogs : [];
  const missing: string[] = [];
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const label = `${String(row.tag ?? "")}${row.tag ? " — " : ""}${String(row.name ?? "کاتالوگ")}`;
    const storedPath = String(row.path ?? "");
    if (!storedPath) {
      if (!String(row.data ?? "")) missing.push(label);
      continue;
    }
    const safeName = path.basename(storedPath).replace(/[^\w.-]/g, "_");
    const bytes = await readFile(/*turbopackIgnore: true*/ path.join(CATALOG_DIR, safeName)).catch(() => null);
    const expected = String(row.sha256 ?? "");
    if (!bytes || (expected && createHash("sha256").update(bytes).digest("hex") !== expected)) missing.push(label);
  }
  return { checked: rows.length, missing };
}

/** بازیابی snapshot JSON از دیسک؛ فایل‌های جانبی و جدول‌های آرشیو در این مسیر نیستند. */
export async function restoreFromFile(file: string, opts: { force?: boolean } = {}) {
  const safe = path.basename(file);
  const full = path.join(BACKUP_DIR, safe);
  const json = await readFile(/*turbopackIgnore: true*/ full, "utf8");
  const sha = (await readFile(/*turbopackIgnore: true*/ `${full}.sha256`, "utf8").catch(() => "")).trim();
  const actual = createHash("sha256").update(json).digest("hex");
  if (!sha && !opts.force) {
    throw badRequest("فایل .sha256 کنار بک‌آپ پیدا نشد؛ بازیابی متوقف شد. فقط با تأیید صریح و مسئولیت خودتان force را فعال کنید.");
  }
  if (sha && sha !== actual && !opts.force) {
    throw badRequest("چک‌سام فایل با محتوای آن نمی‌خواند؛ برای جلوگیری از بازیابی مخدوش متوقف شد");
  }
  let payload: Snapshot;
  try {
    payload = JSON.parse(json) as Snapshot;
  } catch {
    throw badRequest("ساختار JSON بک‌آپ خراب است و قابل بازیابی نیست");
  }
  // هر جدول باید حاضر باشد؛ snapshot ناقص نباید دادهٔ فعلی را با دادهٔ قدیمی مخلوط کند.
  assertCompleteSnapshot(payload, Object.keys(TABLES));
  const localShifts = await db.select().from(shifts);
  const localChannels = await db.select({ key: channels.key, provider: channels.provider, chatId: channels.chatId, token: channels.token }).from(channels);
  const channelsNeedSetup: string[] = [];
  const restoredChannels: Record<string, unknown>[] = (payload.channels as Record<string, unknown>[]).map((row) => {
    const key = String(row.key ?? "");
    const local = localChannels.find((item) => item.key === key && item.provider === row.provider && item.chatId === row.chatId);
    const token = local?.token ?? "";
    if (row.enabled === true && !token) channelsNeedSetup.push(key);
    return { ...row, token };
  });
  payload.channels = restoredChannels;
  // نسخهٔ ایمنی از وضعیت فعلی، تا اگر فایل قدیمی بود بتوان برگشت
  await createInternalBackup("نسخه ایمنی قبل از بازیابی از فایل");
  await restoreAll(payload);
  const catalogFiles = await inspectCatalogFiles(payload);
  return {
    file: safe,
    checksumPresent: Boolean(sha),
    checksumOk: Boolean(sha) && sha === actual,
    totpPreserved: localShifts.filter((row) => row.totpEnabled).map((row) => row.key),
    rows: Object.values(payload).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0),
    catalogFiles,
    channelsNeedSetup,
  };
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
