import { authenticate, clearSessionCookie, getSessionToken, getSessionUser, revokeToken, setSessionCookie } from "@/lib/auth";
import { ensureSeed } from "@/db/seed";
import { clientIp, loginLockRemaining, logSecurityEvent, registerLoginFailure, registerLoginSuccess } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  return Response.json({ user });
}

export async function POST(request: Request) {
  await ensureSeed();
  let body: { key?: string; pin?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "درخواست نامعتبر" }, { status: 400 });
  }

  const key = String(body.key ?? "");
  const pin = String(body.pin ?? "");
  const ip = clientIp(request);

  if (!key || !/^\d{4,6}$/.test(pin)) {
    return Response.json({ ok: false, error: "PIN باید چهار رقم باشد" }, { status: 400 });
  }

  // قفل موقت پس از چند تلاش ناموفق (C2)
  const locked = loginLockRemaining(key, ip);
  if (locked > 0) {
    await logSecurityEvent("login_locked", key, ip, `تلاش در حالت قفل — ${locked} ثانیه مانده`);
    return Response.json(
      { ok: false, error: `به دلیل تلاش‌های ناموفق، ورود این شیفت موقتاً قفل است. ${Math.ceil(locked / 60)} دقیقه دیگر تلاش کنید.` },
      { status: 429, headers: { "Retry-After": String(locked) } },
    );
  }

  const user = await authenticate(key, pin);
  if (!user) {
    const nowLocked = registerLoginFailure(key, ip);
    await logSecurityEvent(nowLocked ? "login_lock" : "login_fail", key, ip, nowLocked ? "قفل ۵ دقیقه‌ای" : "PIN اشتباه");
    return Response.json(
      {
        ok: false,
        error: nowLocked
          ? "چند تلاش ناموفق پشت‌سرهم؛ ورود این شیفت برای ۵ دقیقه قفل شد."
          : "PIN اشتباه است",
      },
      { status: nowLocked ? 429 : 401 },
    );
  }

  registerLoginSuccess(key, ip);
  await logSecurityEvent("login_ok", key, ip, user.role);
  await setSessionCookie(user.key, user.version);
  return Response.json({ ok: true, user: { key: user.key, label: user.label, role: user.role, members: user.members } });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  const token = await getSessionToken();
  await revokeToken(token);
  await clearSessionCookie();
  if (user) await logSecurityEvent("logout", user.key, clientIp(request));
  return Response.json({ ok: true });
}
