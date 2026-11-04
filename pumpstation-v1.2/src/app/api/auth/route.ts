import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shifts } from "@/db/schema";
import {
  authenticate,
  clearSessionCookie,
  getSessionId,
  getSessionToken,
  getSessionUser,
  setSessionCookie,
  startSession,
} from "@/lib/auth";
import { ensureSeed } from "@/db/seed";
import { clientAgent, clientIp, loginLockRemaining, logSecurityEvent, registerLoginFailure, registerLoginSuccess } from "@/lib/security";
import { errorResponse, jsonResponse, requestId } from "@/lib/errors";
import { verifyPin } from "@/lib/pin";
import { normalizeBackupCode, verifyTotp } from "@/lib/totp";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  const sid = await getSessionId();
  return jsonResponse({ user, sessionId: sid ? sid.slice(0, 8) : null }, { requestId: requestId(request) });
}

type LoginBody = { key?: string; pin?: string; totp?: string };

/** مصرف کد پشتیبان (یک‌بارمصرف). در صورت معتبر بودن، از فهرست حذف می‌شود. */
async function consumeBackupCode(shiftKey: string, code: string) {
  const raw = normalizeBackupCode(code);
  if (raw.length < 6) return false;
  const row = (await db.select().from(shifts).where(eq(shifts.key, shiftKey)).limit(1))[0];
  if (!row) return false;
  const codes = row.totpBackupCodes ?? [];
  const index = codes.findIndex((stored) => verifyPin(raw, stored));
  if (index < 0) return false;
  const remaining = codes.filter((_, i) => i !== index);
  await db.update(shifts).set({ totpBackupCodes: remaining }).where(eq(shifts.key, shiftKey));
  await logSecurityEvent("totp_backup_used", shiftKey, "local", `${remaining.length} کد پشتیبان باقی مانده`);
  return true;
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    await ensureSeed();
    let body: LoginBody;
    try {
      body = (await request.json()) as LoginBody;
    } catch {
      return jsonResponse({ ok: false, error: "درخواست نامعتبر" }, { status: 400, requestId: rid });
    }

    const key = String(body.key ?? "").slice(0, 10);
    const pin = String(body.pin ?? "");
    const ip = clientIp(request);
    const agent = clientAgent(request);

    if (!/^[A-Za-z0-9_-]{1,10}$/.test(key) || !/^\d{4,6}$/.test(pin)) {
      return jsonResponse({ ok: false, error: "PIN باید چهار تا شش رقم باشد" }, { status: 400, requestId: rid });
    }

    // قفل موقت پس از چند تلاش ناموفق
    const locked = await loginLockRemaining(key, ip);
    if (locked > 0) {
      await logSecurityEvent("login_locked", key, ip, `تلاش در حالت قفل — ${locked} ثانیه مانده`);
      return jsonResponse(
        { ok: false, error: `به دلیل تلاش‌های ناموفق، ورود این شیفت موقتاً قفل است. ${Math.ceil(locked / 60)} دقیقه دیگر تلاش کنید.` },
        { status: 429, requestId: rid, headers: { "Retry-After": String(locked) } },
      );
    }

    const user = await authenticate(key, pin);
    if (!user) {
      const failure = await registerLoginFailure(key, ip);
      await logSecurityEvent(failure.locked ? "login_lock" : "login_fail", key, ip, failure.perShift ? "قفل ۱۰ دقیقه‌ای شیفت" : failure.perIp ? "قفل ۵ دقیقه‌ای IP" : "PIN اشتباه");
      return jsonResponse(
        {
          ok: false,
          error: failure.locked ? "چند تلاش ناموفق پشت‌سرهم؛ ورود این شیفت موقتاً قفل شد." : "PIN اشتباه است",
        },
        { status: failure.locked ? 429 : 401, requestId: rid },
      );
    }

    /* ---- مرحلهٔ دوم: ورود دوعاملی (اگر برای این شیفت فعال شده باشد) ---- */
    let row = (await db.select().from(shifts).where(eq(shifts.key, key)).limit(1))[0];
    if (row?.totpEnabled) {
      const code = String(body.totp ?? "").trim();
      if (!code) {
        return jsonResponse(
          { ok: false, needsTotp: true, error: "برای این شیفت ورود دوعاملی فعال است؛ کد ۶ رقمی برنامهٔ Authenticator را وارد کنید" },
          { status: 401, requestId: rid },
        );
      }
      const validTotp = verifyTotp(row.totpSecret, code);
      const valid = validTotp || (await consumeBackupCode(key, code));
      if (valid && !validTotp) {
        // کد پشتیبان مصرف شد؛ تعداد باقی‌مانده را دوباره بخوانید تا پاسخ دقیق باشد
        row = (await db.select().from(shifts).where(eq(shifts.key, key)).limit(1))[0];
      }
      if (!valid) {
        const failure = await registerLoginFailure(key, ip);
        await logSecurityEvent("totp_fail", key, ip, "کد دوعاملی نامعتبر");
        return jsonResponse(
          { ok: false, needsTotp: true, error: failure.locked ? "کد نامعتبر؛ ورود موقتاً قفل شد" : "کد دوعاملی نامعتبر یا منقضی است" },
          { status: failure.locked ? 429 : 401, requestId: rid },
        );
      }
    }

    await registerLoginSuccess(key, ip);
    await logSecurityEvent("login_ok", key, ip, `${user.role} — ${agent.slice(0, 60)}${row?.totpEnabled ? " — دوعاملی" : ""}`);
    const session = await startSession(user, { ip, agent });
    await setSessionCookie(session.token);

    return jsonResponse(
      {
        ok: true,
        user: session.user,
        expiresAt: session.expiresAt,
        twoFactor: Boolean(row?.totpEnabled),
        backupCodesLeft: row?.totpEnabled ? (row.totpBackupCodes ?? []).length : undefined,
      },
      { requestId: rid },
    );
  } catch (error) {
    return errorResponse(error, { source: "api/auth", path: "/api/auth", requestId: rid });
  }
}

export async function DELETE(request: Request) {
  const rid = requestId(request);
  try {
    const user = await getSessionUser();
    const token = await getSessionToken();
    const { revokeToken } = await import("@/lib/auth");
    await revokeToken(token, "خروج");
    await clearSessionCookie();
    if (user) await logSecurityEvent("logout", user.key, clientIp(request));
    return jsonResponse({ ok: true }, { requestId: rid });
  } catch (error) {
    return errorResponse(error, { source: "api/auth", path: "/api/auth", requestId: rid });
  }
}
