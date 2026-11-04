import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { authLocks, securityEvents } from "@/db/schema";
import { jalaliNow } from "@/lib/jalali";

/** سقف حجم بدنهٔ درخواست‌های API (۲۵۶ کیلوبایت) */
export const MAX_BODY_BYTES = 256 * 1024;

/** محدودیت نرخ نوشتن: ۱۲۰ عملیات در دقیقه برای هر شیفت */
const WRITE_WINDOW_MS = 60 * 1000;
const WRITE_LIMIT = 120;

const LOCK_MS = 5 * 60 * 1000;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
/** قفل کل شیفت (مستقل از IP) تا با تغییر IP هم نشود حدس زدن را ادامه داد */
const SHIFT_MAX_FAILS = 20;
const SHIFT_LOCK_MS = 10 * 60 * 1000;
const PER_IP_MAX_FAILS = 5;

/**
 * قفل‌ها در جدول `auth_locks` نگه داشته می‌شوند (نه فقط در حافظه)،
 * بنابراین ری‌استارت سرور یا پاک‌شدن کش، قفل را باز نمی‌کند.
 */
const lockCache = new Map<string, { fails: number; firstFailAt: number; lockedUntil: number }>();

type LockRow = { scope: string; fails: number; firstFailAt: number; lockedUntil: number; updatedAt: number };

async function readLock(scope: string): Promise<LockRow> {
  const cached = lockCache.get(scope);
  if (cached) return { scope, ...cached, updatedAt: 0 };
  const row = (await db.select().from(authLocks).where(eq(authLocks.scope, scope)).limit(1))[0];
  const value = {
    scope,
    fails: row?.fails ?? 0,
    firstFailAt: Number(row?.firstFailAt ?? 0),
    lockedUntil: Number(row?.lockedUntil ?? 0),
    updatedAt: Number(row?.updatedAt ?? 0),
  };
  lockCache.set(scope, { fails: value.fails, firstFailAt: value.firstFailAt, lockedUntil: value.lockedUntil });
  return value;
}

async function writeLock(row: LockRow) {
  const now = Date.now();
  lockCache.set(row.scope, { fails: row.fails, firstFailAt: row.firstFailAt, lockedUntil: row.lockedUntil });
  await db
    .insert(authLocks)
    .values({ scope: row.scope, fails: row.fails, firstFailAt: row.firstFailAt, lockedUntil: row.lockedUntil, updatedAt: now })
    .onConflictDoUpdate({
      target: authLocks.scope,
      set: { fails: row.fails, firstFailAt: row.firstFailAt, lockedUntil: row.lockedUntil, updatedAt: now },
    });
}

function normalize(row: LockRow, now: number): LockRow {
  if (row.fails > 0 && now - row.firstFailAt > FAIL_WINDOW_MS && row.lockedUntil < now) {
    return { ...row, fails: 0, firstFailAt: now };
  }
  return row;
}

async function bump(scope: string, limit: number, lockMs: number) {
  const now = Date.now();
  const row = normalize(await readLock(scope), now);
  const fails = row.fails + 1;
  if (fails >= limit) {
    const locked = { ...row, fails: 0, firstFailAt: now, lockedUntil: now + lockMs };
    await writeLock(locked);
    return { locked: true, remainingMs: lockMs };
  }
  const next = { ...row, fails, firstFailAt: row.fails === 0 ? now : row.firstFailAt };
  await writeLock(next);
  return { locked: false, remainingMs: 0 };
}

export function clientIp(request: Request) {
  const h = request.headers;
  return (
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

export function clientAgent(request: Request) {
  return (request.headers.get("user-agent") ?? "").slice(0, 200);
}

export async function logSecurityEvent(kind: string, shiftKey: string, ip: string, detail = "") {
  try {
    await db.insert(securityEvents).values({ ts: Date.now(), at: jalaliNow(), kind, shiftKey, ip: ip.slice(0, 60), detail: detail.slice(0, 300) });
  } catch {
    /* ثبت رویداد امنیتی نباید جریان اصلی را متوقف کند */
  }
}

/** بیشترین زمان باقی‌مانده بین قفل IP و قفل کل شیفت (ثانیه) */
export async function loginLockRemaining(key: string, ip: string) {
  const now = Date.now();
  const [perIp, perShift] = await Promise.all([readLock(`${key}|${ip}`), readLock(key)]);
  const remaining = Math.max(perIp.lockedUntil - now, perShift.lockedUntil - now, 0);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export async function registerLoginFailure(key: string, ip: string) {
  const perIp = await bump(`${key}|${ip}`, PER_IP_MAX_FAILS, LOCK_MS);
  const perShift = await bump(key, SHIFT_MAX_FAILS, SHIFT_LOCK_MS);
  return { locked: perIp.locked || perShift.locked, perIp: perIp.locked, perShift: perShift.locked };
}

export async function registerLoginSuccess(key: string, ip: string) {
  lockCache.delete(`${key}|${ip}`);
  try {
    await db.delete(authLocks).where(inArray(authLocks.scope, [`${key}|${ip}`, key]));
  } catch {
    /* اگر پاک نشد، مهم نیست؛ پنجرهٔ زمانی خودش پاک می‌کند */
  }
}

/** رفع قفل ورود یک شیفت/همه (فقط ادمین) */
export async function clearLoginLock(key: string) {
  const scopes = Array.from(lockCache.keys()).filter((s) => key === "all" || s === key || s.startsWith(`${key}|`));
  for (const s of scopes) lockCache.delete(s);
  try {
    if (key === "all") {
      const rows = await db.delete(authLocks).returning({ scope: authLocks.scope });
      return rows.length;
    }
    const rows = await db
      .delete(authLocks)
      .where(sql`${authLocks.scope} = ${key} or ${authLocks.scope} like ${`${key}|%`}`)
      .returning({ scope: authLocks.scope });
    return rows.length;
  } catch {
    return 0;
  }
}

/** کنترل نرخ نوشتن (درخواست‌های POST) — نگه‌داری در حافظه برای سرعت */
const writeBuckets = new Map<string, { count: number; resetAt: number }>();

export function writeRateLimited(shiftKey: string) {
  const now = Date.now();
  // پاک‌سازی تنبل برای جلوگیری از رشد حافظه
  if (writeBuckets.size > 500) {
    for (const [k, v] of writeBuckets) if (now > v.resetAt) writeBuckets.delete(k);
  }
  const b = writeBuckets.get(shiftKey);
  if (!b || now > b.resetAt) {
    writeBuckets.set(shiftKey, { count: 1, resetAt: now + WRITE_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > WRITE_LIMIT;
}

/** بررسی سقف حجم بدنه بر اساس هدر Content-Length و طول واقعی متن */
export function bodyTooLarge(request: Request, rawLength: number) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  return declared > MAX_BODY_BYTES || rawLength > MAX_BODY_BYTES;
}

export function tooLargeResponse() {
  return Response.json({ ok: false, error: "حجم درخواست بیش از حد مجاز است" }, { status: 413 });
}

export function rateLimitedResponse(retryAfter = 60) {
  return Response.json(
    { ok: false, error: "تعداد درخواست‌ها زیاد است؛ چند لحظه صبر کنید و دوباره تلاش کنید" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
