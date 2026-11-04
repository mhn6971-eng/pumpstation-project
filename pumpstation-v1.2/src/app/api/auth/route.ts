import {
  clearSessionCookie,
  getSessionId,
  getSessionToken,
  getSessionUser,
  login,
  revokeToken,
  setSessionCookie,
} from "@/lib/auth";
import { ensureSeed } from "@/db/seed";
import { clientAgent, clientIp, loginLockRemaining, logSecurityEvent, registerLoginFailure, registerLoginSuccess } from "@/lib/security";
import { errorResponse, jsonResponse, requestId } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  const sid = await getSessionId();
  return jsonResponse({ user, sessionId: sid ? sid.slice(0, 8) : null }, { requestId: requestId(request) });
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    await ensureSeed();
    let body: { key?: string; pin?: string };
    try {
      body = (await request.json()) as { key?: string; pin?: string };
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

    const result = await login(key, pin, { ip, agent });
    if (!result) {
      const failure = await registerLoginFailure(key, ip);
      await logSecurityEvent(failure.locked ? "login_lock" : "login_fail", key, ip, failure.perShift ? "قفل ۱۰ دقیقه‌ای شیفت" : failure.perIp ? "قفل ۵ دقیقه‌ای IP" : "PIN اشتباه");
      return jsonResponse(
        {
          ok: false,
          error: failure.locked
            ? "چند تلاش ناموفق پشت‌سرهم؛ ورود این شیفت موقتاً قفل شد."
            : "PIN اشتباه است",
        },
        { status: failure.locked ? 429 : 401, requestId: rid },
      );
    }

    await registerLoginSuccess(key, ip);
    await logSecurityEvent("login_ok", key, ip, `${result.user.role} — ${agent.slice(0, 60)}`);
    await setSessionCookie(result.token);

    return jsonResponse(
      {
        ok: true,
        user: { key: result.user.key, label: result.user.label, role: result.user.role, members: result.user.members },
        expiresAt: result.expiresAt,
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
    await revokeToken(token, "خروج");
    await clearSessionCookie();
    if (user) await logSecurityEvent("logout", user.key, clientIp(request));
    return jsonResponse({ ok: true }, { requestId: rid });
  } catch (error) {
    return errorResponse(error, { source: "api/auth", path: "/api/auth", requestId: rid });
  }
}
