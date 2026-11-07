import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db, usingPostgres } from "@/db";
import { settings } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { sessionSecretStatus } from "@/lib/secret";
import { localRosterPath, resolveRoster } from "@/lib/roster";
import { APP_VERSION } from "@/lib/version";
import { listFileBackups } from "@/lib/backup";
import { jsonResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

/** سلامت پایه: بدون احراز هویت هم در دسترس است (برای مانیتور و keep-alive) */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const t0 = performance.now();
  let dbOk = true;
  let dbLatency = 0;
  try {
    await db.execute(sql`select 1`);
    dbLatency = Math.round(performance.now() - t0);
  } catch {
    dbOk = false;
  }

  const base = {
    ok: dbOk,
    version: APP_VERSION,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    db: { ok: dbOk, latencyMs: dbLatency, mode: usingPostgres ? "postgres" : "pglite" },
    time: new Date().toISOString(),
  };
  if (url.searchParams.get("full") !== "1") return jsonResponse(base);

  const user = await getSessionUser();
  if (!user || user.role !== "admin") return jsonResponse({ ...base, note: "برای گزارش کامل، با حساب ادمین وارد شوید" });

  const warnings: string[] = [];
  const detail: Record<string, unknown> = {};

  const secretStatus = sessionSecretStatus();
  detail.sessionSecret = secretStatus;
  if (!secretStatus.persistent) {
    warnings.push("راز نشست فقط در حافظه است؛ با راه‌اندازی مجدد سرور همهٔ نشست‌ها باطل می‌شوند");
  }

  try {
    const seeded = await db.select({ key: settings.key }).from(settings).where(sql`${settings.key} = 'seeded'`).limit(1);
    if (seeded.length > 0 && !existsSync(localRosterPath())) {
      detail.roster = { source: "database" };
    } else {
      const roster = resolveRoster();
      detail.roster = { source: roster.source };
      if (roster.source === "sample") warnings.push("از روستر نمونهٔ آزمایشی استفاده می‌شود؛ پیش از بهره‌برداری واقعی roster.local.json را بسازید");
    }
  } catch {
    detail.roster = { source: "unavailable" };
    warnings.push("روستر شیفت‌ها در دسترس یا معتبر نیست؛ ورود و بهره‌برداری را بررسی کنید");
  }

  try {
    const sizeRow = await db.execute<{ size: number }>(sql`select pg_database_size(current_database())::bigint as size`);
    detail.dbSizeMB = Math.round(Number(sizeRow.rows[0]?.size ?? 0) / (1024 * 1024));
  } catch {
    detail.dbSizeMB = null;
  }

  try {
    const fs = await statfs(process.env.PGLITE_DATA_DIR ?? ".data");
    const freeMB = Math.round((fs.bavail * fs.bsize) / (1024 * 1024));
    detail.diskFreeMB = freeMB;
    detail.diskTotalMB = Math.round((fs.blocks * fs.bsize) / (1024 * 1024));
    if (freeMB < 1024) warnings.push("فضای دیسک کمتر از ۱ گیگابایت است");
  } catch {
    detail.diskFreeMB = null;
  }

  try {
    const files = await listFileBackups();
    const last = files[0];
    const ageHours = last ? Math.round((Date.now() - new Date(last.modifiedAt).getTime()) / 3_600_000) : null;
    detail.backups = { count: files.length, lastAt: last?.modifiedAt ?? null, ageHours, lastBytes: last?.bytes ?? 0 };
    if (ageHours === null) warnings.push("هیچ بک‌آپ فایلی موجود نیست");
    else if (ageHours > 48) warnings.push(`آخرین بک‌آپ ${ageHours} ساعت پیش ساخته شده است`);
  } catch {
    detail.backups = null;
  }

  try {
    const row = await db.execute<{ active: number; queue: number; errors: number; events: number }>(sql`
      select
        (select count(*)::int from sessions where revoked_at = 0 and expires_at > ${Date.now()}) as active,
        (select count(*)::int from send_queue where status = 'pending') as queue,
        (select count(*)::int from app_events where level = 'error' and ts > ${Date.now() - 24 * 3600 * 1000}) as errors,
        (select count(*)::int from app_events where ts > ${Date.now() - 24 * 3600 * 1000}) as events
    `);
    const r = row.rows[0];
    detail.sessions = { active: r?.active ?? 0 };
    detail.queue = { pending: r?.queue ?? 0 };
    detail.errors24h = r?.errors ?? 0;
    detail.events24h = r?.events ?? 0;
    if ((r?.errors ?? 0) > 20) warnings.push("تعداد خطاهای ۲۴ ساعت گذشته زیاد است");
    if ((r?.queue ?? 0) > 0) warnings.push(`${r?.queue} گزارش در صف ارسال منتظر است`);
  } catch {
    detail.sessions = null;
  }

  try {
    const counts = await db.execute<{ motor: number; process: number; totals: number; archiveMotor: number; archiveProcess: number }>(sql`
      select
        (select count(*)::int from motor_readings) as motor,
        (select count(*)::int from process_readings) as process,
        (select count(*)::int from daily_totals) as totals,
        (select count(*)::int from motor_readings_archive) as "archiveMotor",
        (select count(*)::int from process_readings_archive) as "archiveProcess"
    `);
    detail.rows = counts.rows[0] ?? null;
  } catch {
    detail.rows = null;
  }

  try {
    const { mirrorStatus } = await import("@/lib/mirror");
    const mirror = await mirrorStatus();
    detail.mirror = { verdict: mirror.verdict, available: mirror.available, last: mirror.last?.at ?? null, last24: mirror.last24, dir: mirror.dir };
    if (mirror.verdict !== "ok") warnings.push(`آینهٔ بک‌آپ: ${mirror.message}`);
  } catch {
    detail.mirror = null;
  }

  detail.migrations = (
    await db.execute<{ name: string; applied_at: string }>(sql`select name, applied_at from _migrations order by name`).catch(() => ({ rows: [] as { name: string; applied_at: string }[] }))
  ).rows;

  return jsonResponse({ ...base, warnings, detail });
}
