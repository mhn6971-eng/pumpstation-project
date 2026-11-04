import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

/**
 * در نسخهٔ پیش‌نمایش (داخل این محیط اجرایی) به‌جای سرور PostgreSQL از PGlite
 * استفاده می‌شود؛ یعنی همان موتور PostgreSQL ولی به‌صورت تعبیه‌شده و بدون نصب سرور.
 * دیتابیس در پوشهٔ `.data/pglite` ذخیره می‌شود و بین اجراها باقی می‌ماند.
 *
 * برای نسخهٔ نهایی روی سرور ایستگاه، فقط همین فایل به `pg` + `DATABASE_URL`
 * برگردانده می‌شود (نسخهٔ اصلی در همین فایل کامنت شده است).
 */

const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";

const globalForDb = globalThis as typeof globalThis & {
  __pumpstationPglite?: PGlite;
};

export const client =
  globalForDb.__pumpstationPglite ??
  new PGlite(dataDir, {
    // پیکربندی حداقلی؛ منطقهٔ زمانی و تاریخ‌ها در برنامه به‌صورت شمسی مدیریت می‌شوند
    relaxedDurability: true,
  });

globalForDb.__pumpstationPglite = client;

export const db = drizzle(client);

/* ---------------------------------------------------------------------------
 * نسخهٔ اصلی (PostgreSQL سروری):
 *
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { Pool } from "pg";
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * export const db = drizzle(pool);
 * ------------------------------------------------------------------------- */
