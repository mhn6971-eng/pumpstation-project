import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** PIN به‌صورت scrypt ذخیره می‌شود؛ مقدار خام هیچ‌گاه در دیتابیس نمی‌ماند. */
export function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPin(pin: string, stored: string) {
  // فقط قالب هش‌شده پذیرفته می‌شود؛ مقایسهٔ متنی (مسیر جایگزین قدیمی) حذف شد — H8
  if (!stored.startsWith("scrypt$")) return false;
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const test = scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (test.length !== expected.length) return false;
  return timingSafeEqual(test, expected);
}
