import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shifts } from "@/db/schema";
import { verifyPin } from "@/lib/pin";
import {
  SESSION_MS,
  checkSession,
  issueSession,
  revokeAllSessions,
  revokeToken as revokeTokenImpl,
} from "@/lib/sessions";

const COOKIE = "ps_session";

/** عمر نشست: هم‌تراز یک شیفت کاری */
export { SESSION_MS };

/** اثر انگشت PIN: با تغییر PIN، همهٔ نشست‌های قبلی همان شیفت باطل می‌شوند */
export function pinVersion(pinHash: string) {
  return createHash("sha256").update(pinHash).digest("hex").slice(0, 24);
}

export type SessionUser = {
  key: string;
  label: string;
  role: string;
  members: string[];
};

async function userOf(shiftKey: string, version: string): Promise<SessionUser | null> {
  const row = (await db.select().from(shifts).where(eq(shifts.key, shiftKey)).limit(1))[0];
  if (!row) return null;
  // PIN عوض شده؟ نشست باطل است
  if (version !== pinVersion(row.pin)) return null;
  return { key: row.key, label: row.label, role: row.role, members: row.members ?? [] };
}

/** کاربر جاری بر پایهٔ کوکی؛ null یعنی باید وارد شود */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  const session = await checkSession(raw);
  if (!session) return null;
  return userOf(session.key, session.v);
}

/** شناسهٔ نشست جاری (برای نمایش «این دستگاه» و استثنا کردن در ابطال دسته‌جمعی) */
export async function getSessionId(): Promise<string | null> {
  const store = await cookies();
  const session = await checkSession(store.get(COOKIE)?.value);
  return session?.sid ?? null;
}

/** خواندن خام کوکی نشست (برای ابطال هنگام خروج) */
export async function getSessionToken() {
  const store = await cookies();
  return store.get(COOKIE)?.value;
}

export async function authenticate(shiftKey: string, pin: string) {
  const rows = await db.select().from(shifts).where(eq(shifts.key, shiftKey)).limit(1);
  const row = rows[0];
  if (!row || !verifyPin(pin.trim(), row.pin)) return null;
  return { key: row.key, label: row.label, role: row.role, members: row.members ?? [], version: pinVersion(row.pin) };
}

/** ساخت نشست برای کاربری که قبلاً احراز هویت شده (پس از بررسی PIN و کد دوعاملی) */
export async function startSession(
  user: { key: string; role: string; version: string; label: string; members: string[] },
  meta: { ip?: string; agent?: string } = {},
) {
  const session = await issueSession({
    shiftKey: user.key,
    role: user.role,
    pinVersion: user.version,
    ip: meta.ip,
    agent: meta.agent,
  });
  return { user: { key: user.key, label: user.label, role: user.role, members: user.members }, token: session.token, sid: session.sid, expiresAt: session.expiresAt };
}

/** ورود کامل: بررسی PIN + ساخت نشست سروری + توکن */
export async function login(shiftKey: string, pin: string, meta: { ip?: string; agent?: string } = {}) {
  const user = await authenticate(shiftKey, pin);
  if (!user) return null;
  const session = await issueSession({
    shiftKey: user.key,
    role: user.role,
    pinVersion: user.version,
    ip: meta.ip,
    agent: meta.agent,
  });
  return { user, token: session.token, sid: session.sid, expiresAt: session.expiresAt };
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  let behindHttps = false;
  try {
    const h = await headers();
    behindHttps = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
  } catch {
    /* بیرون از درخواست (تست/اسکریپت) */
  }
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // پشت HTTPS (نسخهٔ نهایی) با COOKIE_SECURE=1 فعال شود
    secure: process.env.COOKIE_SECURE === "1" || behindHttps,
    maxAge: Math.floor(SESSION_MS / 1000),
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

/** ابطال همین نشست (خروج) — کوکی کپی‌شده هم دیگر کار نمی‌کند */
export async function revokeToken(token: string | undefined, reason = "خروج") {
  await revokeTokenImpl(token, reason);
}

/** ابطال همهٔ نشست‌های یک شیفت یا «all» */
export async function revokeSessions(target: string, reason = "خروج از همهٔ دستگاه‌ها", exceptSid?: string) {
  return revokeAllSessions(target, reason, exceptSid);
}
