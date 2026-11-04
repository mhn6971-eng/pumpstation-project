import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ورود دوعاملی (TOTP — RFC 6238)
 * ------------------------------------------------------------
 * سازگار با Google Authenticator، Microsoft Authenticator، Authy و اپ‌های ایرانی
 * (هر اپلی که TOTP استاندارد را پشتیبانی کند). کد ۶ رقمی هر ۳۰ ثانیه عوض می‌شود.
 * پیاده‌سازی بدون هیچ کتابخانهٔ بیرونی است تا وابستگی و ریسک تأمین کم بماند.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string) {
  const clean = input.replace(/=+$/g, "").replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]*$/.test(clean)) throw new Error("کد Base32 نامعتبر است");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("کد Base32 نامعتبر است");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** راز تازه برای هر کاربر (پیش‌فرض ۲۰ بایت = ۱۶۰ بیت، مثل استاندارد) */
export function generateTotpSecret(bytes = 20) {
  return base32Encode(randomBytes(bytes));
}

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function totpCode(secret: string, at: number = Date.now(), step = TOTP_STEP_SECONDS) {
  const counter = Math.floor(at / 1000 / step);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * بررسی کد با پنجرهٔ تحمل ±`window` گام (پیش‌فرض ۱ گام = ۳۰ ثانیه قبل/بعد)
 * تا اختلاف ساعت گوشی و سرور باعث رد شدن کد نشود.
 */
export function verifyTotp(secret: string, code: string, options: { window?: number; at?: number } = {}) {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (digits.length !== TOTP_DIGITS) return false;
  const window = options.window ?? 1;
  const at = options.at ?? Date.now();
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = totpCode(secret, at + offset * TOTP_STEP_SECONDS * 1000);
    const a = Buffer.from(candidate);
    const b = Buffer.from(digits);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** نشانی otpauth برای ثبت در اپ Authenticator (به‌صورت متن/QR) */
export function otpauthUrl(input: { issuer: string; account: string; secret: string }) {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** کد پشتیبان یک‌بارمصرف (به‌صورت «XXXX-XXXX») */
export function generateBackupCode() {
  const raw = base32Encode(randomBytes(5)).slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizeBackupCode(code: string) {
  return String(code ?? "").replace(/[\s-]/g, "").toUpperCase();
}
