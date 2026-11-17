import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { acquireDbLock, releaseDbLock } from "@/lib/dblock";
import { requireLocalSqlite } from "@/lib/sqlite-cloud";

/**
 * دو حالت اجرای دیتابیس — با یک متغیر محیطی انتخاب می‌شود:
 *
 *   ۱) بدون DATABASE_URL  → PGlite (PostgreSQL تعبیه‌شده، بدون نصب سرور) در `.data/pglite`
 *      مناسب ایستگاه تک‌دستگاهی و نسخهٔ پیش‌نمایش.
 *   ۲) با DATABASE_URL=postgresql://... → PostgreSQL سروری (pg Pool)
 *      مناسب نصب سازمانی، چند کاربر هم‌زمان و پشتیبان‌گیری با pg_dump.
 *
 * هر دو حالت همان موتور PostgreSQL و همان کد drizzle هستند؛ مهاجرت یعنی فقط
 * عوض کردن مقدار DATABASE_URL (قدم‌به‌قدم در docs/POSTGRES_MIGRATION_FA.md).
 */

const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
export const usingPostgres = /^postgres(ql)?:\/\//i.test(databaseUrl);

const buildPhase = process.env.NEXT_PHASE === "phase-production-build";
const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";

// دیتابیس داخل پوشهٔ ابری (گوگل‌درایو/وان‌درایو/…) = خطر خرابی؛ سرور بالا نمی‌آید
if (!usingPostgres && !buildPhase) requireLocalSqlite(dataDir);

/**
 * قفل پوشهٔ داده (فقط PGlite): جلوگیری از باز شدن هم‌زمان توسط دو برنامه
 * (عامل اصلی خرابی فایل‌ها). در حالت PostgreSQL سرور خودش هم‌زمانی را مدیریت می‌کند.
 */
if (!usingPostgres && !buildPhase && !(globalThis as { __psDbLocked?: boolean }).__psDbLocked) {
  acquireDbLock(dataDir, { enforce: process.env.NODE_ENV === "production" });
  (globalThis as { __psDbLocked?: boolean }).__psDbLocked = true;
  const release = () => releaseDbLock(dataDir);
  process.once("exit", release);
  process.once("SIGTERM", release);
  process.once("SIGINT", release);
}

const globalForDb = globalThis as typeof globalThis & {
  __pumpstationPglite?: PGlite;
  __pumpstationPool?: Pool;
};

const pglite: PGlite | null = usingPostgres
  ? null
  : globalForDb.__pumpstationPglite ??
    new PGlite(buildPhase ? undefined : dataDir, {
      /**
       * During `next build`, use PGlite's in-memory filesystem. Route modules can be
       * evaluated by Next while collecting build metadata; opening the real data
       * directory here leaves an un-migrated cluster behind when the build process
       * exits. The installer then starts a separate migration process against that
       * directory. Avoiding this cross-process handoff prevents the Windows PGlite
       * filesystem failure (ENOTDIR / errno 20) seen when reopening that directory.
       *
       * In the running application, durability واقعی: هر تراکنش با fsync روی دیسک
       * می‌نشیند تا قطع برق داده را از بین نبرد (C3 در گزارش بازبینی). اگر سرعت
       * روی سخت‌افزار ضعیف مشکل شد، با PGLITE_RELAXED=1 می‌توان موقتاً خاموشش کرد.
       */
      relaxedDurability: process.env.PGLITE_RELAXED === "1",
    });

if (pglite) globalForDb.__pumpstationPglite = pglite;

const pool: Pool | null = usingPostgres
  ? globalForDb.__pumpstationPool ??
    new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "pumpstation",
    })
  : null;

if (pool) globalForDb.__pumpstationPool = pool;

const instance = usingPostgres ? drizzlePg(pool!) : drizzlePglite(pglite!);

/**
 * نوع‌ها یکسان‌اند (هر دو PgDatabase)؛ برای اینکه همهٔ فراخوانی‌های موجود بدون تغییر کار کنند،
 * نوع PGlite اعلام می‌شود. تفاوت رفتاری در زمان اجرا با `usingPostgres` قابل تشخیص است.
 */
export const db = instance as unknown as PgliteDatabase<Record<string, never>>;

/** بستن تمیز اتصال‌ها (instrumentation در خاموشی و اسکریپت‌ها) */
export async function closeDb() {
  if (pool) {
    await pool.end();
    globalForDb.__pumpstationPool = undefined;
    return;
  }
  if (pglite) await pglite.close();
}

/** برای سازگاری با کدهای قبلی که `client.close()` را صدا می‌زنند */
export const client = {
  close: closeDb,
  pglite,
  pool,
  usingPostgres,
};

export default db;
