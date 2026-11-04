import { db } from "@/db";
import { securityEvents } from "@/db/schema";
import { jalaliNow } from "@/lib/jalali";

/** سقف حجم بدنهٔ درخواست‌های API (۲۵۶ کیلوبایت) — H2 در گزارش بازبینی */
export const MAX_BODY_BYTES = 256 * 1024;

/** محدودیت نرخ نوشتن: ۱۲۰ عملیات در دقیقه برای هر شیفت */
const WRITE_WINDOW_MS = 60 * 1000;
const WRITE_LIMIT = 120;

type Bucket = { fails: number; firstFailAt: number; lockedUntil: number };
const loginBuckets = new Map<string, Bucket>();
const shiftBuckets = new Map<string, Bucket>();
const writeBuckets = new Map<string, { count: number; resetAt: number }>();

const LOCK_MS = 5 * 60 * 1000;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
/** قفل کل شیفت (مستقل از IP) تا با تغییر IP هم نشود حدس زدن را ادامه داد */
const SHIFT_MAX_FAILS = 20;
const SHIFT_LOCK_MS = 10 * 60 * 1000;

export function clientIp(request: Request) {
  const h = request.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "local"
  );
}

export async function logSecurityEvent(kind: string, shiftKey: string, ip: string, detail = "") {
  try {
    await db.insert(securityEvents).values({ ts: Date.now(), at: jalaliNow(), kind, shiftKey, ip, detail });
  } catch {
    /* ثبت رویداد امنیتی نباید جریان اصلی را متوقف کند */
  }
}

function bucket(key: string) {
  const now = Date.now();
  let b = loginBuckets.get(key);
  if (!b) {
    b = { fails: 0, firstFailAt: now, lockedUntil: 0 };
    loginBuckets.set(key, b);
  }
  if (b.fails > 0 && now - b.firstFailAt > FAIL_WINDOW_MS && b.lockedUntil < now) {
    b.fails = 0;
    b.firstFailAt = now;
  }
  return b;
}

function shiftBucket(key: string) {
  const now = Date.now();
  let b = shiftBuckets.get(key);
  if (!b) {
    b = { fails: 0, firstFailAt: now, lockedUntil: 0 };
    shiftBuckets.set(key, b);
  }
  if (b.fails > 0 && now - b.firstFailAt > FAIL_WINDOW_MS && b.lockedUntil < now) {
    b.fails = 0;
    b.firstFailAt = now;
  }
  return b;
}

/** آیا این شیفت/IP فعلاً قفل است؟ (بیشترین زمان باقی‌مانده بین قفل IP و قفل کل شیفت) */
export function loginLockRemaining(key: string, ip: string) {
  const now = Date.now();
  const perIp = Math.max(0, bucket(`${key}|${ip}`).lockedUntil - now);
  const perShift = Math.max(0, shiftBucket(key).lockedUntil - now);
  const remaining = Math.max(perIp, perShift);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export function registerLoginFailure(key: string, ip: string) {
  const b = bucket(`${key}|${ip}`);
  if (b.fails === 0) b.firstFailAt = Date.now();
  b.fails += 1;
  let locked = false;
  if (b.fails >= 5) {
    b.lockedUntil = Date.now() + LOCK_MS;
    b.fails = 0;
    locked = true;
  }
  const g = shiftBucket(key);
  if (g.fails === 0) g.firstFailAt = Date.now();
  g.fails += 1;
  if (g.fails >= SHIFT_MAX_FAILS) {
    g.lockedUntil = Date.now() + SHIFT_LOCK_MS;
    g.fails = 0;
    locked = true;
  }
  return locked;
}

export function registerLoginSuccess(key: string, ip: string) {
  loginBuckets.delete(`${key}|${ip}`);
}

/** کنترل نرخ نوشتن (درخواست‌های POST) */
export function writeRateLimited(shiftKey: string) {
  const now = Date.now();
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
  return Response.json(
    { ok: false, error: "حجم درخواست بیش از حد مجاز است" },
    { status: 413 },
  );
}

export function rateLimitedResponse() {
  return Response.json(
    { ok: false, error: "تعداد درخواست‌ها زیاد است؛ چند لحظه صبر کنید و دوباره تلاش کنید" },
    { status: 429 },
  );
}
