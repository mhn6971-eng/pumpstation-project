import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * رازِ امضای نشست.
 * ترتیب اولویت: متغیر محیطی SESSION_SECRET → فایل `.data/session-secret` (خودکار ساخته می‌شود).
 * هیچ مقدار پیش‌فرض ثابتی در کد وجود ندارد تا کسی نتواند کوکی ادمین جعل کند.
 */
export type SessionSecretStatus = { persistent: boolean; source: "env" | "file" | "memory" };

let status: SessionSecretStatus = { persistent: false, source: "memory" };

function loadSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) {
    status = { persistent: true, source: "env" };
    return fromEnv;
  }

  const dir = process.env.SESSION_SECRET_DIR ?? ".data";
  const file = `${dir}/session-secret`;
  try {
    mkdirSync(dir, { recursive: true });
    if (existsSync(/*turbopackIgnore: true*/ file)) {
      const stored = readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
      if (stored.length >= 16) {
        status = { persistent: true, source: "file" };
        return stored;
      }
    }
    const generated = randomBytes(32).toString("hex");
    writeFileSync(/*turbopackIgnore: true*/ file, generated, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      /* ویندوز ممکن است chmod را نپذیرد */
    }
    status = { persistent: true, source: "file" };
    return generated;
  } catch (error) {
    // راز موقتی نشست‌ها را پس از راه‌اندازی مجدد باطل می‌کند؛ شکست را پنهان نکن.
    status = { persistent: false, source: "memory" };
    console.error(
      `[auth] هشدار جدی: راز نشست در ${file} ذخیره نشد؛ نشست‌ها با راه‌اندازی مجدد سرور باطل می‌شوند. دسترسی/فضای دیسک را بررسی کنید.`,
      error,
    );
    return randomBytes(32).toString("hex");
  }
}

export const SECRET = loadSecret();

/** وضعیت غیرحساس برای گزارش سلامت ادمین؛ هرگز خودِ راز را برنمی‌گرداند. */
export function sessionSecretStatus(): SessionSecretStatus {
  return { ...status };
}

export function sign(payload: string) {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
