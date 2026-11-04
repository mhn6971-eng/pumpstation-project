import { authenticate, clearSessionCookie, getSessionUser, setSessionCookie } from "@/lib/auth";
import { ensureSeed } from "@/db/seed";

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
  if (!key || !/^\d{4}$/.test(pin)) {
    return Response.json({ ok: false, error: "PIN باید چهار رقم باشد" }, { status: 400 });
  }
  const user = await authenticate(key, pin);
  if (!user) return Response.json({ ok: false, error: "PIN اشتباه است" }, { status: 401 });
  await setSessionCookie(key);
  return Response.json({ ok: true, user });
}

export async function DELETE() {
  await clearSessionCookie();
  return Response.json({ ok: true });
}
