import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings, shifts } from "@/db/schema";
import { verifyPin } from "@/lib/pin";

const COOKIE = "ps_session";
/** عمر نشست: هم‌تراز یک شیفت کاری (قبلاً ۳۰ روز بود — C4 در گزارش بازبینی) */
export const SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * رازِ امضای نشست.
 * ترتیب اولویت: متغیر محیطی SESSION_SECRET → فایل `.data/session-secret` (خودکار ساخته می‌شود).
 * هیچ مقدار پیش‌فرض ثابتی در کد وجود ندارد تا کسی نتواند کوکی ادمین جعل کند (C1).
 */
function loadSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  const dir = process.env.SESSION_SECRET_DIR ?? ".data";
  const file = `${dir}/session-secret`;
  try {
    mkdirSync(dir, { recursive: true });
    if (existsSync(file)) {
      const stored = readFileSync(file, "utf8").trim();
      if (stored.length >= 16) return stored;
    }
    const generated = randomBytes(32).toString("hex");
    writeFileSync(file, generated, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      /* ویندوز ممکن است chmod را نپذیرد */
    }
    return generated;
  } catch {
    // اگر نوشتن فایل ممکن نبود، راز یکتای درون‌حافظه‌ای (با هر ری‌استارت تازه می‌شود)
    return randomBytes(32).toString("hex");
  }
}

const SECRET = loadSecret();

function sign(payload: string) {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** اثر انگشت PIN: با تغییر PIN، همهٔ نشست‌های قبلی همان شیفت باطل می‌شوند */
export function pinVersion(pinHash: string) {
  return createHash("sha256").update(pinHash).digest("hex").slice(0, 24);
}

export function createToken(shiftKey: string, version: string) {
  const payload = Buffer.from(JSON.stringify({ key: shiftKey, at: Date.now(), v: version })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): { key: string; at: number; v: string } | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { key?: unknown; at?: unknown; v?: unknown };
    if (typeof data.key !== "string" || typeof data.at !== "number" || typeof data.v !== "string") return null;
    if (Date.now() - data.at > SESSION_MS) return null;
    return { key: data.key, at: data.at, v: data.v };
  } catch {
    return null;
  }
}

export type SessionUser = {
  key: string;
  label: string;
  role: string;
  members: string[];
};

/** اثر انگشت کوکی برای فهرست ابطال‌شده‌ها (خروج سروری) */
function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}

/** ابطال همین نشست هنگام «خروج» — تا کوکی کپی‌شده هم دیگر کار نکند */
export async function revokeToken(token: string | undefined) {
  if (!token) return;
  const rows = await db.select().from(settings).where(eq(settings.key, "revokedTokens")).limit(1);
  const list = Array.isArray(rows[0]?.value) ? (rows[0]!.value as string[]) : [];
  const next = [...list, tokenHash(token)].slice(-500);
  await db
    .insert(settings)
    .values({ key: "revokedTokens", value: next as never })
    .onConflictDoUpdate({ target: settings.key, set: { value: next as never } });
}

async function isTokenRevoked(token: string) {
  const rows = await db.select().from(settings).where(eq(settings.key, "revokedTokens")).limit(1);
  const list = Array.isArray(rows[0]?.value) ? (rows[0]!.value as string[]) : [];
  return list.includes(tokenHash(token));
}

/** زمان ابطال دسته‌جمعی نشست‌ها (دکمهٔ «خروج از همهٔ دستگاه‌ها» در تب ادمین) */
async function revokedAt(shiftKey: string): Promise<number> {
  const rows = await db.select().from(settings).where(eq(settings.key, "sessionRevoked")).limit(1);
  const map = (rows[0]?.value ?? {}) as Record<string, unknown>;
  const value = map[shiftKey] ?? map.all;
  return typeof value === "number" ? value : 0;
}

export async function revokeSessions(shiftKey: string) {
  const rows = await db.select().from(settings).where(eq(settings.key, "sessionRevoked")).limit(1);
  const map = { ...((rows[0]?.value ?? {}) as Record<string, number>) };
  map[shiftKey] = Date.now();
  await db
    .insert(settings)
    .values({ key: "sessionRevoked", value: map as never })
    .onConflictDoUpdate({ target: settings.key, set: { value: map as never } });
}

/** خواندن خام کوکی نشست (برای ابطال هنگام خروج) */
export async function getSessionToken() {
  const store = await cookies();
  return store.get(COOKIE)?.value;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  const data = verifyToken(raw);
  if (!data || !raw) return null;
  if (await isTokenRevoked(raw)) return null;

  const rows = await db.select().from(shifts).where(eq(shifts.key, data.key)).limit(1);
  const row = rows[0];
  if (!row) return null;
  // PIN عوض شده؟ نشست باطل است
  if (data.v !== pinVersion(row.pin)) return null;
  // ادمین «خروج از همهٔ دستگاه‌ها» را زده است؟
  if (data.at < (await revokedAt(row.key))) return null;

  return { key: row.key, label: row.label, role: row.role, members: row.members ?? [] };
}

export async function setSessionCookie(shiftKey: string, version: string) {
  const store = await cookies();
  store.set(COOKIE, createToken(shiftKey, version), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // پشت HTTPS (نسخهٔ نهایی) با COOKIE_SECURE=1 فعال شود
    secure: process.env.COOKIE_SECURE === "1",
    maxAge: Math.floor(SESSION_MS / 1000),
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function authenticate(shiftKey: string, pin: string) {
  const rows = await db.select().from(shifts).where(eq(shifts.key, shiftKey)).limit(1);
  const row = rows[0];
  if (!row || !verifyPin(pin.trim(), row.pin)) return null;
  return { key: row.key, label: row.label, role: row.role, members: row.members ?? [], version: pinVersion(row.pin) };
}
