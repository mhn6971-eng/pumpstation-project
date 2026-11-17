/** اعتبارسنجی خالصِ کامل‌بودن snapshot پیش از هرگونه تغییر در دیتابیس. */
export function assertCompleteSnapshot(
  snapshot: unknown,
  requiredTables: readonly string[],
): asserts snapshot is Record<string, unknown[]> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("فایل بک‌آپ نامعتبر است: ساختار جدول‌ها پیدا نشد");
  }
  const data = snapshot as Record<string, unknown>;
  const missing = requiredTables.filter((name) => !Array.isArray(data[name]));
  if (missing.length) {
    throw new Error(`فایل بک‌آپ ناقص است؛ جدول‌های لازم وجود ندارند: ${missing.join("، ")}`);
  }
}
