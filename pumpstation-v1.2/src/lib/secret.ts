import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * رازِ امضای نشست.
 * ترتیب اولویت: متغیر محیطی SESSION_SECRET → فایل `.data/session-secret` (خودکار ساخته می‌شود).
 * هیچ مقدار پیش‌فرض ثابتی در کد وجود ندارد تا کسی نتواند کوکی ادمین جعل کند.
 */
function loadSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  const dir = process.env.SESSION_SECRET_DIR ?? ".data";
  const file = `${dir}/session-secret`;
  try {
    mkdirSync(dir, { recursive: true });
    if (existsSync(/*turbopackIgnore: true*/ file)) {
      const stored = readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
      if (stored.length >= 16) return stored;
    }
    const generated = randomBytes(32).toString("hex");
    writeFileSync(/*turbopackIgnore: true*/ file, generated, { mode: 0o600 });
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

export const SECRET = loadSecret();

export function sign(payload: string) {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
