/**
 * نگهبان مسیر دیتابیس: دیتابیس هرگز داخل پوشهٔ ابری (خطر خرابی فایل) — نسخهٔ ۱٫۴٫۱.
 *
 * پوشه‌های همگام‌سازی ابری (گوگل‌درایو/وان‌درایو/دراپ‌باکس/آی‌کلاد) فایل‌های
 * دیتابیس را قفل و نیمه‌همگام می‌کنند و عامل شناخته‌شدهٔ خرابی‌اند.
 * این ماژول مسیر را بررسی می‌کند و در صورت خطر، سرور/اسکریپت با پیام فارسی
 * متوقف می‌شود. خالص و بدون ایمپورت داخلی (قابل استفاده در تست‌ها).
 */

export type CloudService = "Google Drive" | "OneDrive" | "Dropbox" | "iCloud";

const CLOUD_HINT =
  "دیتابیس را به پوشه‌ای محلی (خارج از فضای ابری) منتقل کنید و برای نسخهٔ بیرونی از آینه (MIRROR_DIR) استفاده کنید.";

/** بررسی بخش‌های مسیر؛ حساس به غلط‌نویسی نیست ولی به «sandbox» گیر نمی‌دهد. */
export function detectCloudPath(dir: string): CloudService | null {
  const segments = dir.split(/[\\/]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const seg of segments) {
    if (seg.includes("google drive") || seg === "googledrive") return "Google Drive";
    if (seg === "onedrive" || seg.startsWith("onedrive ") || seg.startsWith("onedrive-") || seg.startsWith("onedrive_")) return "OneDrive";
    if (seg === "dropbox") return "Dropbox";
    if (seg.includes("icloud")) return "iCloud";
  }
  return null;
}

/**
 * اگر مسیر داخل فضای ابری باشد، خطا می‌دهد و برنامه متوقف می‌شود.
 * راه فرار فقط برای حالت‌های خاص و آگاهانه: PGLITE_ALLOW_CLOUD=1
 */
export function requireLocalSqlite(dataDir: string, env?: Record<string, string | undefined>): void {
  const allow = (env ?? process.env).PGLITE_ALLOW_CLOUD === "1";
  if (allow) return;
  const service = detectCloudPath(dataDir);
  if (service) {
    throw new Error(
      `مسیر دیتابیس داخل ${service} است و این خطر خرابی دیتابیس دارد؛ سرور بالا نمی‌آید. ${CLOUD_HINT}`,
    );
  }
}
