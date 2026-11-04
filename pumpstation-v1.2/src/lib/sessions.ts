import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { logEvent } from "@/lib/log";
import { safeEqual, sign } from "@/lib/secret";

/**
 * نشست‌های سروری (نسخه ۱.۳)
 * -------------------------------------------------------------
 * هر ورود یک ردیف در جدول `sessions` می‌سازد. توکن کوکی شامل شناسهٔ نشست است و
 * امضای HMAC دارد. مزیت‌ها نسبت به حالت قبل:
 *   • فهرست دستگاه‌های فعال و ابطال تک‌تک آن‌ها
 *   • «خروج از همهٔ دستگاه‌ها» واقعی
 *   • پایان خودکار نشست بی‌استفاده (idle) و نشست منقضی
 *   • امکان پاک‌سازی دوره‌ای ردیف‌های کهنه (بدون رشد بی‌پایان)
 */

/** عمر مطلق نشست: ۱۲ ساعت (هم‌تراز یک شیفت کاری) */
export const SESSION_MS = 12 * 60 * 60 * 1000;
/** اگر این مدت هیچ درخواستی از نشست نیاید، خودکار بسته می‌شود */
export const IDLE_MS = 4 * 60 * 60 * 1000;
/** فاصلهٔ به‌روزرسانی «آخرین فعالیت» برای کم‌کردن نوشتن‌های اضافی */
const TOUCH_MS = 60 * 1000;

export type IssuedSession = { token: string; sid: string; expiresAt: number };

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function buildToken(sid: string, payload: string) {
  return `v2.${sid}.${payload}.${sign(`${sid}.${payload}`)}`;
}

export type ParsedToken = { sid: string; key: string; at: number; v: string; exp: number };

export function parseToken(raw: string | undefined): ParsedToken | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") return null;
  const [, sid, payload, signature] = parts;
  if (!safeEqual(signature, sign(`${sid}.${payload}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      key?: unknown;
      at?: unknown;
      v?: unknown;
      exp?: unknown;
    };
    if (typeof data.key !== "string" || typeof data.v !== "string") return null;
    if (typeof data.at !== "number" || typeof data.exp !== "number") return null;
    return { sid, key: data.key, at: data.at, v: data.v, exp: data.exp };
  } catch {
    return null;
  }
}

export async function issueSession(input: {
  shiftKey: string;
  role: string;
  pinVersion: string;
  ip?: string;
  agent?: string;
}): Promise<IssuedSession> {
  const sid = randomBytes(16).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_MS;
  const payload = Buffer.from(
    JSON.stringify({ key: input.shiftKey, at: now, v: input.pinVersion, exp: expiresAt }),
  ).toString("base64url");
  const token = buildToken(sid, payload);

  await db.insert(sessions).values({
    id: sid,
    tokenHash: hashToken(token),
    shiftKey: input.shiftKey,
    role: input.role,
    ip: (input.ip ?? "").slice(0, 60),
    agent: (input.agent ?? "").slice(0, 200),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    revokedAt: 0,
    revokedReason: "",
  });

  return { token, sid, expiresAt };
}

export type SessionCheck = { sid: string; key: string; at: number; v: string; lastSeenAt: number };

/** اعتبارسنجی کوکی؛ در صورت نبود/انقضا/ابطال، null برمی‌گرداند */
export async function checkSession(raw: string | undefined): Promise<SessionCheck | null> {
  const parsed = parseToken(raw);
  if (!parsed) return null;
  const now = Date.now();
  if (parsed.exp <= now) return null;

  const row = (await db.select().from(sessions).where(eq(sessions.id, parsed.sid)).limit(1))[0];
  if (!row) return null;
  if (row.revokedAt > 0) return null;
  if (row.expiresAt <= now) return null;
  if (row.shiftKey !== parsed.key) return null;
  if (now - row.lastSeenAt > IDLE_MS) {
    await revokeSession(parsed.sid, "بی‌استفاده ماندن");
    return null;
  }
  if (now - row.lastSeenAt > TOUCH_MS) {
    try {
      await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, parsed.sid));
    } catch (error) {
      logEvent("warn", "sessions", "به‌روزرسانی آخرین فعالیت نشست ناموفق بود", error);
    }
  }
  return { sid: parsed.sid, key: parsed.key, at: parsed.at, v: parsed.v, lastSeenAt: row.lastSeenAt };
}

export async function revokeSession(sid: string, reason = "خروج") {
  await db
    .update(sessions)
    .set({ revokedAt: Date.now(), revokedReason: reason.slice(0, 100) })
    .where(and(eq(sessions.id, sid), eq(sessions.revokedAt, 0)));
}

export async function revokeToken(raw: string | undefined, reason = "خروج") {
  const parsed = parseToken(raw);
  if (parsed) await revokeSession(parsed.sid, reason);
}

/** ابطال همهٔ نشست‌های یک شیفت یا همهٔ شیفت‌ها؛ می‌توان نشست جاری را استثنا کرد */
export async function revokeAllSessions(target: string, reason = "خروج از همهٔ دستگاه‌ها", exceptSid?: string) {
  const now = Date.now();
  const conditions = [eq(sessions.revokedAt, 0), sql`${sessions.expiresAt} > ${now}`];
  if (target !== "all") conditions.push(eq(sessions.shiftKey, target));
  if (exceptSid) conditions.push(sql`${sessions.id} <> ${exceptSid}`);
  const res = await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason.slice(0, 100) })
    .where(and(...conditions))
    .returning({ id: sessions.id });
  return res.length;
}

export type SessionInfo = {
  id: string;
  shiftKey: string;
  role: string;
  ip: string;
  agent: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number;
  revokedReason: string;
};

export async function listSessions(options: { shiftKey?: string; includeRevoked?: boolean } = {}) {
  const conditions = [];
  if (options.shiftKey) conditions.push(eq(sessions.shiftKey, options.shiftKey));
  if (!options.includeRevoked) conditions.push(eq(sessions.revokedAt, 0));
  const query = db.select().from(sessions);
  const rows = conditions.length ? await query.where(and(...conditions)).orderBy(desc(sessions.lastSeenAt)).limit(100) : await query.orderBy(desc(sessions.lastSeenAt)).limit(100);
  return rows.map((r) => ({
    id: r.id,
    shiftKey: r.shiftKey,
    role: r.role,
    ip: r.ip,
    agent: r.agent,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    revokedReason: r.revokedReason,
  })) satisfies SessionInfo[];
}

/** پاک‌سازی ردیف‌های کهنه: منقضی‌های قدیمی‌تر از ۳۰ روز و ابطال‌شده‌های قدیمی‌تر از ۳۰ روز */
export async function cleanupSessions() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const res = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, cutoff), and(lt(sessions.revokedAt, cutoff), sql`${sessions.revokedAt} > 0`)))
    .returning({ id: sessions.id });
  if (res.length) logEvent("info", "sessions", `${res.length} نشست کهنه پاک شد`);
  return res.length;
}

/** نگه‌داری نشست‌ها زیر سقف منطقی: حداکثر ۵۰۰ ردیف فعال */
export async function pruneSessions(max = 500) {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.revokedAt, 0), sql`${sessions.expiresAt} > ${Date.now()}`))
    .orderBy(desc(sessions.lastSeenAt));
  if (rows.length <= max) return 0;
  const extra = rows.slice(max).map((r) => r.id);
  let removed = 0;
  for (const sid of extra) {
    await revokeSession(sid, "سقف نشست‌های فعال");
    removed += 1;
  }
  return removed;
}

/** آیا جدول نشست‌ها آماده است؟ (برای مسیرهای تشخیصی) */
export async function sessionsReady() {
  try {
    await db.select({ n: sql<number>`count(*)::int` }).from(sessions).limit(1);
    return true;
  } catch {
    return false;
  }
}
