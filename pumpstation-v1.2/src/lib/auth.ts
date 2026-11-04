import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shifts } from "@/db/schema";
import { verifyPin } from "@/lib/pin";

const COOKIE = "ps_session";
const SECRET = process.env.SESSION_SECRET ?? "pumpstation-local-preview-secret";

function sign(payload: string) {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function createToken(shiftKey: string) {
  const payload = Buffer.from(JSON.stringify({ key: shiftKey, at: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.at && Date.now() - Number(data.at) > 1000 * 60 * 60 * 24 * 30) return null;
    return typeof data.key === "string" ? data.key : null;
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

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const key = verifyToken(store.get(COOKIE)?.value);
  if (!key) return null;
  const rows = await db.select().from(shifts).where(eq(shifts.key, key)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return { key: row.key, label: row.label, role: row.role, members: row.members ?? [] };
}

export async function setSessionCookie(shiftKey: string) {
  const store = await cookies();
  store.set(COOKIE, createToken(shiftKey), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
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
  return { key: row.key, label: row.label, role: row.role, members: row.members ?? [] };
}
