import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createGzip } from "node:zlib";
import { asc, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { archiveRuns, motorReadings, motorReadingsArchive, processReadings, processReadingsArchive } from "@/db/schema";
import { addDaysToDay, jalaliNow, operationalDay } from "@/lib/jalali";
import { BACKUP_DIR } from "@/lib/backup";
import { logEvent } from "@/lib/log";

/**
 * بایگانی داده‌های قدیمی
 * ------------------------------------------------------------
 * چرا؟ جدول قرائت‌ها هر سال حدود ۶۶۰ هزار ردیف رشد می‌کند. با نگه‌داشتن همهٔ سال‌ها
 * در جدول اصلی، ایندکس‌ها بزرگ و نوشتن کند می‌شود. بنابراین داده‌های قدیمی‌تر از
 * N سال به جدول بایگانی منتقل می‌شوند (ساختار یکسان، فقط خواندنی در عمل) و
 * همزمان یک نسخهٔ فشردهٔ gzip روی دیسک نوشته می‌شود که آرشیو سرد و
 * مستقل از دیتابیس است.
 *
 * خواندن گزارش‌ها از «نمای ترکیبی» (motor_readings_all / process_readings_all) انجام
 * می‌شود، پس نمودارهای چندساله هیچ داده‌ای را از دست نمی‌دهند.
 */

export const ARCHIVE_DIR = path.resolve(process.cwd(), process.env.ARCHIVE_DIR ?? path.join(BACKUP_DIR, "archive"));
const CHUNK = 20000;

export type ArchiveResult = {
  cutoffDay: string;
  motorRows: number;
  processRows: number;
  file: string;
  sha256: string;
  bytes: number;
};

function writer(file: string) {
  const gzip = createGzip({ level: 6 });
  const stream = createWriteStream(file);
  gzip.pipe(stream);
  const hash = createHash("sha256");
  const done = new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    gzip.on("error", reject);
  });
  return {
    async line(obj: unknown) {
      const text = `${JSON.stringify(obj)}\n`;
      hash.update(text);
      if (!gzip.write(text)) await new Promise<void>((r) => gzip.once("drain", () => r()));
    },
    async close() {
      await new Promise<void>((resolve) => gzip.end(resolve));
      await done;
      return hash.digest("hex");
    },
  };
}

export async function archiveStats() {
  const main = await db.execute<{ motor: number; process: number }>(
    sql`select (select count(*)::int from motor_readings) as motor, (select count(*)::int from process_readings) as process`,
  );
  const archived = await db.execute<{ motor: number; process: number }>(
    sql`select (select count(*)::int from motor_readings_archive) as motor, (select count(*)::int from process_readings_archive) as process`,
  );
  const runs = await db.select().from(archiveRuns).orderBy(asc(archiveRuns.id)).limit(50);
  return {
    main: { motor: main.rows[0]?.motor ?? 0, process: main.rows[0]?.process ?? 0 },
    archive: { motor: archived.rows[0]?.motor ?? 0, process: archived.rows[0]?.process ?? 0 },
    runs: runs.map((r) => ({ id: r.id, at: r.at, cutoffDay: r.cutoffDay, motorRows: r.motorRows, processRows: r.processRows, file: r.file, bytes: r.bytes })),
    dir: ARCHIVE_DIR,
  };
}

/**
 * انتقال ردیف‌های قدیمی‌تر از `years` سال به بایگانی.
 * عملیات تکه‌تکه انجام می‌شود تا حافظه پر نشود و هر تکه اتمیک باشد.
 */
export async function archiveOlderThan(years: number, shiftKey: string): Promise<ArchiveResult> {
  const safeYears = Math.min(20, Math.max(1, Math.floor(years)));
  const op = operationalDay();
  const cutoffDay = addDaysToDay(op.day, -Math.round(safeYears * 365.25));
  await mkdir(/*turbopackIgnore: true*/ ARCHIVE_DIR, { recursive: true });

  const stamp = `${op.day.replace(/\//g, "-")}_${Date.now()}`;
  const file = path.join(ARCHIVE_DIR, `readings-${stamp}.jsonl.gz`);
  const w = writer(file);
  let motorRows = 0;
  let processRows = 0;

  // موتور
  for (;;) {
    const rows = await db
      .select()
      .from(motorReadings)
      .where(lt(motorReadings.day, cutoffDay))
      .orderBy(asc(motorReadings.id))
      .limit(CHUNK);
    if (!rows.length) break;
    for (const r of rows) await w.line({ t: "motor", ...r });
    await db.transaction(async (tx) => {
      await tx.insert(motorReadingsArchive).values(rows.map((r) => ({ ...r, id: r.id }))).onConflictDoNothing();
      await tx.delete(motorReadings).where(inArray(motorReadings.id, rows.map((r) => r.id)));
    });
    motorRows += rows.length;
    if (rows.length < CHUNK) break;
  }

  // فرایند
  for (;;) {
    const rows = await db
      .select()
      .from(processReadings)
      .where(lt(processReadings.day, cutoffDay))
      .orderBy(asc(processReadings.id))
      .limit(CHUNK);
    if (!rows.length) break;
    for (const r of rows) await w.line({ t: "process", ...r });
    await db.transaction(async (tx) => {
      await tx.insert(processReadingsArchive).values(rows.map((r) => ({ ...r, id: r.id }))).onConflictDoNothing();
      await tx.delete(processReadings).where(inArray(processReadings.id, rows.map((r) => r.id)));
    });
    processRows += rows.length;
    if (rows.length < CHUNK) break;
  }

  const sha256 = await w.close();
  const info = await stat(/*turbopackIgnore: true*/ file).catch(() => null);
  const bytes = info?.size ?? 0;

  await db.insert(archiveRuns).values({
    at: jalaliNow(),
    shiftKey,
    cutoffDay,
    motorRows,
    processRows,
    file,
    sha256,
    bytes,
  });

  logEvent("info", "archive", "بایگانی انجام شد", { cutoffDay, motorRows, processRows, bytes });
  return { cutoffDay, motorRows, processRows, file, sha256, bytes };
}

/**
 * نگه‌داری نسخه‌های آرشیو — «قانون مقدس»: هیچ داده‌ای حذف/پیرایش نمی‌شود.
 * پیش‌فرض نامحدود است و این تابع هیچ فایلی را پاک نمی‌کند (همیشه ۰ برمی‌گرداند).
 * تابع برای آینده نگه داشته شده، ولی اگر کسی صریحاً سقفی کمتر از ۵۰۰ نسخه
 * بخواهد، خطای روشن می‌دهد چون نقض قانون مقدس است.
 */
export async function pruneArchives(keep: number = Infinity) {
  if (keep !== Infinity && (!Number.isFinite(keep) || keep < 500)) {
    throw new Error("پیرایش بایگانی غیرفعال است (قانون مقدس: نگه‌داری نامحدود)؛ حداقل مجاز ۵۰۰ نسخه است");
  }
  return 0;
}

/** بایگانی خودکار: سالی یک‌بار در پنجرهٔ کم‌ترافیک (۳ تا ۵ بامداد) */
export async function ensureYearlyArchive() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", hour: "2-digit", hourCycle: "h23" }).format(new Date()),
  );
  if (hour < 3 || hour >= 5) return null;
  const op = operationalDay();
  const last = (await db.select().from(archiveRuns).orderBy(asc(archiveRuns.id)).limit(1))[0];
  if (last && last.at.slice(0, 10) === op.day) return null;
  return archiveOlderThan(Number(process.env.ARCHIVE_AFTER_YEARS ?? 3), "system");
}
